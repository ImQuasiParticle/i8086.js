'use strict';

const opcodesTable = {};

/**
 * Simple logger
 * @class Logger
 */
class Logger {
  constructor() {
    (['error', 'info', 'warn', 'table', 'log']).forEach((scope) => {
      this[scope] = this.log.bind(this, scope);
    });
  }

  /**
   * Log message
   *
   * @param {String}  type  Message type
   * @param {String}  msg   Message content
   */
  log(type, msg) {
    console[type](msg);
  }
}

/**
 * Main code exec
 * @class CPU
 */
class CPU {
  /**
   * Creates an instance of CPU
   *
   * @param {Config}  CPU config
   */
  constructor(config) {
    /** Debug logger */
    this.logger = new Logger;
    this.pause = false;

    /** Default CPU config */
    this.config = {
      ignoreMagic: true,
      debugger: false
    }
    config && Object.assign(this.config, config);

    /** Devices list */
    this.devices = [];
    this.interrupts = {};
    this.ports = {};

    /**
     * Alloc 1024 KB of RAM memory
     * todo: Implement A20 line support
     */
    this.mem = Buffer.alloc(2 * 1048576);
    this.memIO = {
      device: this.mem,
      read: {
        /** 8bit  */  0x1: this.mem.readUInt8.bind(this.mem),
        /** 16bit */  0x2: this.mem.readUInt16LE.bind(this.mem),
        /** 32bit */  0x4: this.mem.readUInt32LE.bind(this.mem)
      },
      write: {
        /** 8bit  */  0x1: this.mem.writeUInt8.bind(this.mem),
        /** 16bit */  0x2: this.mem.writeUInt16LE.bind(this.mem),
        /** 32bit */  0x4: this.mem.writeUInt16LE.bind(this.mem)
      }
    };

    this.registers = {
      /** Main registers */
      ax: 0x0, bx: 0x0, cx: 0x0, dx: 0x0,

      /** Index registers */
      si: 0x0, di: 0x0, bp: 0x0, sp: 0x0,

      /** Instruction counter */
      ip: 0x0,

      /** Segment registers */
      cs: 0x0, ds: 0x0, es: 0x0, ss: 0x0, fs: 0x0,

      /** Flags */
      flags: 0x0, status: {}
    };

    /**
     * Define opcodes prefixes
     * see: http://www.c-jump.com/CIS77/CPU/x86/X77_0240_prefix.htm
     */
    CPU.prefixes = {
      0xF0: 0x0, /** LOCK */
      0xF3: 0x0, /** REP  */
      0xF2: 0x1, /** REPNE */

      /** Segment override */
      0x2E: { _sr: 'cs' },
      0x36: { _sr: 'ss' },
      0x3E: { _sr: 'ds' },
      0x26: { _sr: 'es' },
      0x64: { _sr: 'fs' },
      0x65: { _sr: 'gs' },

      0x66: 0x2, /** Operrand override */
      0x67: 0x3  /** Adress override  */
    };
    CPU.prefixMap = {
      0x0: 'instruction',
      0x1: 'segment',
      0x2: 'operandSize',
      0x3: 'addressSize'
    };
    this.prefixes = {
      [CPU.prefixMap[0x0]]: null,  /** Group 1: LOCK, REPE/REPZ, REP, REPNE/REPNZ         */
      [CPU.prefixMap[0x1]]: null,  /** Group 2: CS, DS, ES, FS, GS, SS, Branch hints      */
      [CPU.prefixMap[0x2]]: null,  /** Group 3: Operand-size override (16 bit vs. 32 bit) */
      [CPU.prefixMap[0x3]]: null   /** Group 4: Address-size override (16 bit vs. 32 bit) */
    };

    /** Define flags register helpers */
    CPU.flags = {
      'cf': 0x0,  /** Carry flag */
      'pf': 0x2,  /** Parity flag */
      'af': 0x4,  /** Auxiliary - Carry Flags */
      'zf': 0x6,  /** Zero flag */
      'sf': 0x7,  /** Signum flag */
      'tf': 0x8,  /** Trap flag */
      'if': 0x9,  /** Interrupt flag */
      'df': 0xA,  /** Direction flag */
      'of': 0xB   /** Overflow flag */
    }
    for(let k in CPU.flags) {
      ((name, bit) => {
        Object.defineProperty(this.registers.status, name, {
          get: ()     => (this.registers.flags >> bit) & 0x1,
          set: (val)  => this.registers.flags ^= (-(val ? 1 : 0) ^ this.registers.flags) & (1 << bit)
        });
      })(k, CPU.flags[k]);
    }

    /**
     * Separate registers, emulate C++ unions
     * numbers representation
     * Bits:
     * high     low
     * 00000000 00000000
     * todo: Optimize set() methods
     */
    const separateRegister = (reg, high, low) => {
      Object.defineProperty(this.registers, low, {
        get: () => this.registers[reg] & 0xFF,
        set: (val) => this.registers[reg] = (this.registers[reg] & 0xFF00) | (val & 0xFF)
      });

      Object.defineProperty(this.registers, high, {
        get: () => (this.registers[reg] >> 0x8) & 0xFF,
        set: (val) => this.registers[reg] = (this.registers[reg] & 0xFF) | ((val & 0xFF) << 8)
      });
    };
    ([
      ['ax', 'ah', 'al'],
      ['bx', 'bh', 'bl'],
      ['cx', 'ch', 'cl'],
      ['dx', 'dh', 'dl']
    ]).forEach((args) => {
      separateRegister.apply(this, args);
    });

    /** Map register codes */
    this.regMap = {
      /** 8bit registers indexes */
      0x1: {
        0x0: 'al', 0x1: 'cl',
        0x2: 'dl', 0x3: 'bl',
        0x4: 'ah', 0x5: 'ch',
        0x6: 'dh', 0x7: 'bh'
      },

      /** 16bit register indexes */
      0x2: {
        0x0: 'ax', 0x1: 'cx',
        0x2: 'dx', 0x3: 'bx',
        0x4: 'sp', 0x5: 'bp',
        0x6: 'si', 0x7: 'di'
      },

      /** Segment registers */
      sreg: {
        0x0: 'es', 0x1: 'cs',
        0x2: 'ss', 0x3: 'ds',
        0x4: 'fs', 0x5: 'gs'
      }
    };

    /** Generate instructions */
    this.initOpcodeSet();
  }

  /**
   * Attach device to CPU
   *
   * @param {Device} device Device class
   * @param {Array}  args   Array of params
   * @returns CPU
   */
  attach(Device, ...args) {
    this.devices.push(
      new Device().attach(this, args)
    );
    return this;
  }

  /** Last stack item address */
  get lastStackAddr() {
    return this.getMemAddress('ss', 'sp');
  }

  /**
   * Decrement stack pointer and push value to stack
   *
   * @param {Number}  val   Value to be stored on stack
   * @param {Number}  bits  Intel 8086 supports only 16bit stack
   */
  push(val, bits = 0x2) {
    this.registers.sp = this.registers.sp - bits;
    if (this.registers.sp < 0)
      this.registers.sp = 0xFFFE;

    this.memIO.write[bits](val, this.lastStackAddr);
  }

  /**
   * POP n-bytes from stack
   *
   * @param {Number}  bits  Bytes number
   * @param {Boolean} read  Read bytes or only pop
   * @returns
   */
  pop(bits = 0x2, read = true) {
    const val = read && this.memIO.read[bits](this.lastStackAddr);

    this.registers.sp = this.registers.sp + bits;
    if (this.registers.sp > 0xFFFE) {
      this.registers.sp = 0
      // this.registers.ss += 0x1000;
    }

    return val;
  }

  /**
   * Default stack segment address, after push()
   * values will be added at the end of mem
   *
   * @param {Number}  segment Stack segment index
   */
  initStack(segment = 0x0) {
    /** Set default stack environment */
    Object.assign(this.registers, {
      ss: segment,
      sp: 0x0
    });

    /**
     * Segment register push mapper
     * see: http://csiflabs.cs.ucdavis.edu/~ssdavis/50/8086%20Opcodes.pdf
     */
    const stackSregMap = {
      0x0:  'es', 0x8:  'cs',
      0x10: 'ss', 0x18: 'ds'
    };
    for (let sregIndex in stackSregMap) {
      ((index) => {
        /** PUSH sr16 */ this.opcodes[0x6 + index] = () => this.push(this.registers[stackSregMap[index]]);
        /** POP sr16  */ this.opcodes[0x7 + index] = () => this.registers[stackSregMap[index]] = this.pop();
      })(parseInt(sregIndex));
    }
  }

  /**
   * Boot device
   *
   * @param {File|string} device  Node file pointer
   * @param {Number}      id      Device ID loaded into DL register
   */
  boot(device, id = 0x0) {
    /** Convert HEX string to Node buffer */
    if(typeof device === 'string')
      device = new Buffer(device, 'hex');

    /** Remove logging if silent */
    if(this.config.silent)
      this.logger.log = function() {}

    /** Booting procedure */
    this.clock = true;
    this.device = device;
    Object.assign(this.registers, {
      dl: id
    });

    this.logger.info('CPU: Intel 8086 compatible processor');
    this.loadMBR(this.readChunk(0, 512));
  }

  /**
   * For faster exec generates CPU specific opcodes list
   * see:
   * http://csiflabs.cs.ucdavis.edu/~ssdavis/50/8086%20Opcodes.pdf
   * https://en.wikipedia.org/wiki/X86_instruction_listings#Original_8086.2F8088_instructions
   */
  initOpcodeSet() {
    /** Operators binded to the same opcode, its changed using byte.rm */
    const switchOpcode = (bits, operators) => {
      const operator = (val, byte) => {
        let operator = (operators[byte.reg] || operators.default)
        if(operator)
          return operator(val, byte);
        else
          throw new Error(`Unsupported operator! ${byte.reg}`);
      };
      this.parseRmByte(
        (reg, _, byte) => {
          this.registers[reg] = operator(this.registers[reg], byte);
        },
        (address, _, byte) => {
          this.memIO.write[bits](
            operator(this.memIO.read[bits](address), byte),
            address
          );
        }, bits
      );
    };

    this.opcodes = {
      /** MOV r/m8, reg8 */  0x88: (bits = 0x1) => {
        this.parseRmByte(
          (reg, modeReg)  => this.registers[reg] = this.registers[this.regMap[bits][modeReg]],
          (address, src)  => this.memIO.write[bits](this.registers[src], address),
          bits
        );
      },
      /** MOV r/m16, sreg */  0x8C: () => {
        this.parseRmByte(
          (reg, modeReg)      => this.registers[reg] = this.registers[this.regMap.sreg[modeReg]],
          (address, _, byte)  => this.memIO.write[0x2](this.registers[this.regMap.sreg[byte.reg]], address),
          0x2
        );
      },
      /** MOV sreg, r/m16 */  0x8E: () => {
        this.parseRmByte(
          (reg, modeReg)  => {
            this.registers[this.regMap.sreg[modeReg]] = this.registers[reg]
          },
          (address, _, byte)  => {
            this.registers[this.regMap.sreg[byte.reg]] = this.memIO.read[0x2](address);
          },
          0x2
        );
      },
      /** MOV r8, r/m8    */ 0x8A: (bits = 0x1) => {
        this.parseRmByte(
          (reg, modeReg) => this.registers[this.regMap[bits][modeReg]] = this.registers[reg],
          (address, reg) => this.registers[reg] = this.memIO.read[bits](address),
          bits
        );
      },

      /** MOV al, m16  */ 0xA0: (bits = 0x1) => {
        this.registers[this.regMap[bits][0]] = this.memIO.read[bits](
          this.getMemAddress(this.segmentReg, this.fetchOpcode(0x2))
        );
      },
      /** MOV ax, m16 */ 0xA1: () => this.opcodes[0xA0](0x2),

      /** MOV m8, al  */ 0xA2: (bits = 0x1) => {
        this.memIO.write[bits](
          this.registers[this.regMap[bits][0x0]],
          this.getMemAddress(this.segmentReg, this.fetchOpcode(bits))
        );
      },
      /** MOV m16, ax */ 0xA3: () => this.opcodes[0xA2](0x2),

      /** MOV r/m8, imm8  */ 0xC6: (bits = 0x1) => {
        this.parseRmByte(
          (reg, modeReg)  => { /** todo */ throw new Error('0xC6: Fix me!') },
          (address)       => this.memIO.write[bits](this.fetchOpcode(bits), address),
          bits
        );
      },
      /** MOV r/m16, reg16  */ 0x89:  () => this.opcodes[0x88](0x2),
      /** MOV r16, r/m16    */ 0x8B:  () => this.opcodes[0x8A](0x2),
      /** MOV r/m16, imm16  */ 0xC7:  () => this.opcodes[0xC6](0x2),

      /** PUSH/INC/DEC reg8 */ 0xFE: (bits = 0x1) => {
        this.parseRmByte(
          (_, modeReg, mode) => {
            const reg = this.regMap[bits][mode.rm];
            if(mode.reg === 0x6)
              this.push(this.registers[reg]);
            else {
              this.registers[reg] = this.alu(
                this.operators.extra[mode.reg === 0x1 ? 'decrement' : 'increment'],
                this.registers[reg], null, bits
              );
            }
          },
          (address, reg, mode) => {
            const memVal = this.memIO.read[bits](address);
            if(mode.reg === 0x6)
              this.push(memVal);
            else {
              this.memIO.write[bits](
                this.alu(
                  this.operators.extra[mode.reg === 0x1 ? 'decrement' : 'increment'],
                  memVal, null, bits
                ),
                address
              );
            }
          }, bits
        );
      },
      /** INC/DEC reg16 */  0xFF: () => this.opcodes[0xFE](0x2),

      /** PUSHA */  0x60: () => {
        const temp = this.registers.sp;
        for(let i = 0;i <= 0x7;++i) {
          this.push(
            i == 0x4 ? temp : this.registers[this.regMap[0x2][i]]
          );
        }
      },
      /** POPA  */  0x61: () => {
        /** Skip SP */
        for(let i = 0x7;i >= 0;--i) {
          const val = this.pop();
          if(i != 0x4)
            this.registers[this.regMap[0x2][i]] = val;
        }
      },

      /** PUSH imm8     */  0x6A: () => this.push(this.fetchOpcode(), 0x2),
      /** PUSH imm16    */  0x68: () => this.push(this.fetchOpcode(0x2), 0x2),

      /** PUSHF         */  0x9C: () => this.push(this.registers.flags),
      /** POPF          */  0x9D: () => this.registers.flags = this.pop(),

      /** LOOPNE        */  0xE0: () => {
        const relativeAddress = this.fetchOpcode();
        if(--this.registers.cx && !this.registers.status.zf)
          this.relativeJump(0x1, relativeAddress);
      },
      /** LOOP 8bit rel */  0xE2: () => {
        const relativeAddress = this.fetchOpcode();
        if(--this.registers.cx)
          this.relativeJump(0x1, relativeAddress);
      },

      /** IRET 48b  */  0xCF: () => {
        Object.assign(this.registers, {
          ip: this.pop(),
          cs: this.pop(),
          flags: this.pop()
        });
      },

      /** RET far   */  0xCB: () => {
        this.registers.ip = this.pop();
        this.registers.cs = this.pop();
      },
      /** RET near  */  0xC3: (bits = 0x2) => this.registers.ip = this.pop(bits),
      /** RET 16b   */  0xC2: (bits = 0x2) => {
        const items = this.fetchOpcode(bits, false);
        this.registers.ip = this.pop();

        this.pop(items, false);
      },

      /** CALL 16bit/32bit dis  */  0xE8: () => {
        this.push(this.registers.ip + 0x2);
        this.relativeJump(0x2);
      },

      /** JMP rel 8bit  */  0xEB: () => this.relativeJump(0x1),
      /** JMP rel 16bit */  0xE9: () => this.relativeJump(0x2),
      /** FAR JMP 32bit */  0xEA: () => {
        Object.assign(this.registers, {
          ip: this.fetchOpcode(0x2),
          cs: this.fetchOpcode(0x2)
        });
      },

      /** STOSB */  0xAA: (bits = 0x1) => {
        this.memIO.write[bits](
          this.registers[this.regMap[bits][0]],
          this.getMemAddress('es', 'di')
        );
        this.dfIncrement(bits, 'di');
      },
      /** STOSW */  0xAB: () => this.opcodes[0xAA](0x2),

      /** CLI   */  0xFA: () => this.registers.status.if = 0x0,
      /** STI   */  0xFB: () => this.registers.status.if = 0x1,

      /** CLC   */  0xF8: () => this.registers.status.cf = 0x0,
      /** STC   */  0xF9: () => this.registers.status.cf = 0x1,

      /** CLD   */  0xFC: () => this.registers.status.df = 0x0,
      /** STD   */  0xFD: () => this.registers.status.df = 0x1,

      /** MOVSB */  0xA4: (bits = 0x1) => {
        this.memIO.write[bits](
          this.memIO.read[bits](this.getMemAddress('ds', 'si')),
          this.getMemAddress('es', 'di')
        );

        /** Increment indexes */
        this.dfIncrement(bits, 'si', 'di');
      },
      /** MOVSW */  0xA5: () => this.opcodes[0xA4](0x2),

      /** LODSB */  0xAC: (bits = 0x1) => {
        this.registers[this.regMap[bits][0x0]] = this.memIO.read[bits](this.getMemAddress('ds', 'si'));
        this.dfIncrement(bits, 'si');
      },
      /** LODSW */  0xAD: () => this.opcodes[0xAC](0x2),

      /** LDS r16, m16:16 */  0xC5: (segment = 'ds') => {
        const reg = CPU.decodeRmByte(this.fetchOpcode()).reg,
              addr = CPU.getSegmentedAddress(this.fetchOpcode(0x2, false));

        this.regMap[0x2][reg] = addr.offset;
        this.registers[segment] = addr.segment;
      },
      /** LES r16, m16:16 */  0xC4: () => this.opcodes[0xC5]('es'),
      /** LEA r16, mem    */  0x8D: () => {
        this.parseRmByte(null, (address, reg) => this.registers[reg] = address, 0x2, null);
      },

      /** INT imm8    */  0xCD: () => {
        const code = this.fetchOpcode(),
              interrupt = this.interrupts[code];
        if(!interrupt)
          this.halt(`unknown interrupt 0x${code.toString(16)}`);
        else
          interrupt();
      },

      /** RCL r/m8,  cl */  0xD2: (bits = 0x1, dir = 0x1) => {
        this.parseRmByte(
          (reg, _, byte) => {
            this.registers[reg] = this.rotl(this.registers[reg], this.registers.cl * dir, bits);
          },
          (address) => {
            this.memIO.write[bits](
              this.rotl(this.memIO.read[bits](address), this.registers.cl * dir, bits),
              address
            );
          }, bits
        );
      },
      /** RCL	r/m16, cl */  0xD3: () => this.opcodes[0xD2](0x2),
      /** ROL/SHR/SHL   */  0xD0: (bits = 0x1) => {
        switchOpcode(bits, {
          /** ROL */ 0x0: (val) => this.rotate(val, -0x1, bits),
          /** ROR */ 0x1: (val) => this.rotate(val, 0x1, bits),
          /** SHL */ 0x4: (val) => this.shl(val, 0x1, bits),
          /** SHR */ 0x5: (val) => this.shr(val, 0x1, bits)
        });
      },
      /** ROL/SHR/SHL   */  0xC1: () => {
        switchOpcode(0x2, {
          /** SHL IMM8 */ 0x4: (val, byte) => this.shl(val, this.fetchOpcode(), 0x2),
          /** SHR IMM8 */ 0x5: (val, byte) => this.shr(val, this.fetchOpcode(), 0x2)
        });
      },

      /** ROR r/m8, 1   */  0xD1: () => this.opcodes[0xD0](0x2),

      /** CBW */  0x98: () => this.registers.ah = (this.registers.al & 0x80) == 0x80 ? 0xFF : 0x0,
      /** CWD */  0x99: () => this.registers.ax = (this.registers.ax & 0x8000) == 0x8000 ? 0xFFFF : 0x0,

      /** SALC */ 0xD6: () => {
        this.registers.al = this.registers.status.cf ? 0xFF : 0x0;
      },

      /** XCHG bx, bx */  0x87: () => {
        let arg = this.fetchOpcode(0x1, false, true);
        switch(arg) {
          case 0xDB:
          case 0xD2:
            this.registers.ip++;
            this.raiseException(CPU.Exception.MEM_DUMP);

            if(arg == 0xDB)
              this.halt('Debug dump!', true);
            else
              this.dumpRegisters();
          break;

          default:
            this.parseRmByte(
              (reg, reg2) => {
                [
                  this.registers[this.regMap[0x2][reg2]],
                  this.registers[reg]
                ] = [
                  this.registers[reg],
                  this.registers[this.regMap[0x2][reg2]]
                ];
              },
              (address, _, byte) => { throw new Error('todo: xchg in mem address') },
              0x2
            );
        }
      },

      /** HLT */  0xF4: this.halt.bind(this),

      /** ICE BreakPoint */ 0xF1: () => {},
      /** NOP */            0x90: () => {}
    };

    /** General usage registers opcodes */
    for(let opcode = 0; opcode < Object.keys(this.regMap[0x1]).length; ++opcode) {
      /** MOV register opcodes */
      ((_opcode) => {
        const _r8 = this.regMap[0x1][_opcode]
            , _r16 = this.regMap[0x2][_opcode];

        /** XCHG AX, r16 */ this.opcodes[0x90 + _opcode] = () => {
          const dest = this.regMap[0x2][this.fetchOpcode(0x1)],
                temp = this.registers[dest];

          this.registers[dest] = this.registers.ax;
          this.registers.ax = temp;
        };

        /** MOV reg8, imm8 $B0 + reg8 code */
        this.opcodes[0xB0 + _opcode] = () => this.registers[_r8] = this.fetchOpcode();

        /** MOV reg16, imm16 $B8 + reg16 code */
        this.opcodes[0xB8 + _opcode] = () => this.registers[_r16] = this.fetchOpcode(0x2);

        /** INC reg16 */
        this.opcodes[0x40 + _opcode] = () => {
          this.registers[_r16] = this.alu(this.operators.extra.increment, this.registers[_r16], null, 0x2);
        };

        /** DEC reg16 */
        this.opcodes[0x48 + _opcode] = () => {
          this.registers[_r16] = this.alu(this.operators.extra.decrement, this.registers[_r16], null, 0x2);
        };

        /** PUSH reg16 */
        this.opcodes[0x50 + _opcode] = () => this.push(this.registers[_r16]);

        /** POP reg16 */
        this.opcodes[0x58 + _opcode] = () => this.registers[_r16] = this.pop();
      })(opcode);
    }

    /** 8 bit jump instructions set */
    const jmpOpcodes = {
      /** JO  */  0x70: (f) => f.of,
      /** JNO */  0x71: (f) => !f.of,
      /** JB  */  0x72: (f) => f.cf,
      /** JAE */  0x73: (f) => !f.cf,
      /** JZ  */  0x74: (f) => f.zf,
      /** JNE */  0x75: (f) => !f.zf,
      /** JBE */  0x76: (f) => f.cf || f.zf,
      /** JA  */  0x77: (f) => !f.cf && !f.zf,
      /** JS  */  0x78: (f) => f.sf,
      /** JNS */  0x79: (f) => !f.sf,
      /** JP  */  0x7A: (f) => f.pf,
      /** JNP */  0x7B: (f) => !f.pf,
      /** JG  */  0x7F: (f) => !f.zf && f.sf === f.of,
      /** JGE */  0x7D: (f) => f.sf === f.of,
      /** JL  */  0x7C: (f) => f.sf !== f.of,
      /** JLE */  0x7E: (f) => f.zf || f.sf !== f.of
    };
    const jumpIf = (flagCondition, bits = 0x1) => {
      let relative = this.fetchOpcode(bits);
      flagCondition(this.registers.status) && this.relativeJump(bits, relative);
    }
    for(let opcode in jmpOpcodes) {
      ((_opcode) => {
        this.opcodes[_opcode] = () => jumpIf(jmpOpcodes[_opcode]);
        this.opcodes[(0x0F << 0x8) | (parseInt(_opcode) + 0x10)]  = () => jumpIf(jmpOpcodes[_opcode], 0x2);
      })(opcode);
    }

    /** Create stack */
    this.initStack();

    /**
     * Generate algebra offset calls
     * todo: implement FPU
     */
    this.initALU();
    this.initIO();
  }

  /**
   * Rotate bits to left with carry flag
   * see: https://github.com/NeatMonster/Intel8086/blob/master/src/fr/neatmonster/ibmpc/Intel8086.java#L4200
   *
   * @param {Number}  num   Number
   * @param {Number}  times Bits to shift
   * @param {Number}  bits  Mode
   * @returns Number
   * @memberOf CPU
   */
  rotl(num, times, bits = 0x1) {
    const mask = CPU.bitMask[bits];
    for(; times >= 0; --times) {
      let cf = 0;
      num <<= 0x1;
      num |= cf;
      num &= mask;
      this.registers.status.cf = cf;
    }
    return num;
  }

  /**
   * Shift bits to right with carry flag
   * see: https://github.com/NeatMonster/Intel8086/blob/master/src/fr/neatmonster/ibmpc/Intel8086.java#L4200
   *
   * @param {Number}  num   Number
   * @param {Number}  times Bits to shift
   * @param {Number}  bits  Mode
   * @returns Number
   * @memberOf CPU
   */
  shr(num, times, bits = 0x1) {
    const mask = CPU.bitMask[bits];
    for(; times > 0; --times) {
      this.registers.status.cf = num & 0x1;
      num >>= 0x1;
      num &= mask;
    }
    return num;
  }
  shl(num, times, bits = 0x1) {
    const mask = CPU.bitMask[bits];
    for(; times > 0; --times) {
      this.registers.status.cf = CPU.msbit(num, bits);
      num <<= 0x1;
      num &= mask;
    }
    return num;
  }

  /**
   * Fast bit rotate
   *
   * @param {Number}  num   Number
   * @param {Number}  times Bits to shift
   * @param {Number}  bits  Mode
   * @returns Number
   */
  rotate(num, times, bits = 0x1) {
    const mask = CPU.bitMask[bits]
    if(times > 0) {
      num = (num >> (mask - times)) | (num << times);
      this.registers.status.cf = num & 0x1;
    } else {
      num = (num << (mask + times)) | (num >> -times);
      this.registers.status.cf = CPU.msbit(num, bits);
    }
    return num;
  }

  /**
   * Raise exception to all devices
   *
   * @param {Number} code Raise exception
   */
  raiseException(code) {
    this.devices.forEach(
      (device) => device.exception(code)
    );
  }

  /** Initialize IN/OUT opcodes set */
  initIO() {
    Object.assign(this.opcodes, {
      /** IN AL, 8bits  */ 0xE4: (bits = 0x1, port) => {
        if(!port)
          port = this.fetchOpcode(0x1);
        this.registers[this.regMap[bits][0x0]] = this.ports[port].get(bits);
      },
      /** IN AX, 16bits */ 0xE5: () => this.opcodes[0xE4](0x2),

      /** IN AL, port[DX] */  0xEC: () => this.opcodes[0xE4](0x1, this.registers.dx),
      /** IN AL, port[DX] */  0xED: () => this.opcodes[0xE4](0x2, this.registers.dx),

      /** OUT 8bits, al  */ 0xE6: (bits = 0x1, port) => {
        port = port || this.fetchOpcode(0x1);
        if(port in this.ports)
          this.ports[port].set(this.registers[this.regMap[bits][0x0]], bits);
      },
      /** OUT 8bits, al     */ 0xE7: () => this.opcodes[0xE6](0x2),
      /** OUT port[DX], al  */ 0xEE: () => this.opcodes[0xE6](0x1, this.registers.dx),
      /** OUT port[DX], ah  */ 0xEF: () => this.opcodes[0xE6](0x2, this.registers.dx)
    });
  }

  /**
   * Slow as fuck ALU initializer
   * todo: Make it fast
   */
  initALU() {
    const flagCheckers = {
      /** Carry flag */   [CPU.flags.cf]: function(signed, bits, l, r, val) {
        return val != signed;
      },
      /** Overflow flag */   [CPU.flags.of]: function(signed, bits, l, r) {
        let lmsbit = CPU.msbit(l, bits);
        return l - r > 0 && CPU.msbit(signed, bits) != lmsbit && lmsbit == CPU.msbit(r, bits);
      },
      /** Parity flag */  [CPU.flags.pf]: function(signed) {
        /**
         * Use SWAR algorithm
         * see: http://stackoverflow.com/a/109025/6635215
         */
        signed = signed - ((signed >> 1) & 0x55555555);
        signed = (signed & 0x33333333) + ((signed >> 2) & 0x33333333);
        signed = (((signed + (signed >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
        return !(signed % 2);
      },
      /** Zero flag */    [CPU.flags.zf]: function(signed) {
        return signed === 0x0;
      },
      /** Sign flag */    [CPU.flags.sf]: function(signed, bits) {
        return CPU.msbit(signed, bits) === 0x1;
      }
    };

    /** Key is 0x80 - 0x83 RM Byte */
    this.operators = {
      /** Extra operators used in other opcodes */
      extra: {
        increment: { _c: (s) => s + 1 },
        decrement: { _c: (s) => s - 1 },
        mul:       { set: 0x0, _c: (s, d) => s * d },
        div:       { set: 0x0, _c: (s, d) => s / d }
      },
      /** SBB */  0b011: {
        offset: 0x18,
        _c: (s, d) => s - d - this.registers.status.cf
      },
      /** ADC */  0b010: {
        offset: 0x10,
        _c: (s, d) => s + d + this.registers.status.cf
      },

      /** + */ 0b000: { offset: 0x00, _c: (s, d) => s + d },
      /** - */ 0b101: { offset: 0x28, _c: (s, d) => s - d },
      /** & */ 0b100: {
        offset: 0x20,
        clear: CPU.flags.cf | CPU.flags.of,
        set: CPU.flags.sf | CPU.flags.pf | CPU.flags.zf,
        _c: (s, d) => s & d
      },
      /** | */ 0b001: {
        offset: 0x08,
        clear: CPU.flags.cf | CPU.flags.of,
        set: CPU.flags.sf | CPU.flags.pf | CPU.flags.zf,
        _c: (s, d) => s | d
      },
      /** ^ */ 0b110: {
        offset: 0x30,
        clear: CPU.flags.cf | CPU.flags.of,
        set: CPU.flags.sf | CPU.flags.pf | CPU.flags.zf,
        _c: (s, d) => s ^ d
      },
      /** = */ 0b111: {
        offset: 0x38,
        _flagOnly: true,
        _c: (s, d) => s - d
      }
    };

    /** ALU operation checker */
    this.alu = (operator, l, r, bits) => {
      /** Clear flags */
      if(operator.clear)
        this.registers.flags &= !operator.clear;

      /** Set default flags value for operator */
      let val = operator._c(l, r),
          signed = CPU.toUnsignedNumber(val, bits);

      if(typeof operator.set === 'undefined')
        operator.set = 0xFF;

      /** Value returned after flags */
      for(let key in flagCheckers) {
        if((operator.set & key) == key) {
          let _val = flagCheckers[key](signed, bits, l, r, val);
          this.registers.flags ^= (-(_val ? 1 : 0) ^ this.registers.flags) & (1 << key);
        }
      }

      /** temp - for cmp and temporary operations */
      return operator._flagOnly ? l : signed;
    };

    /** Multiplier opcode is shared with NEG opcode */
    const multiplier = (bits = 0x1, mul) => {
      this.parseRmByte(
        (reg, _, byte) => {
          if(byte.reg === 0x2) {
            /** NOT */
            this.registers[reg] = ~this.registers[reg] & CPU.bitMask[bits];
          } else if(byte.reg === 0x3) {
            /** NEG */
            this.registers[reg] = this.alu(this.operators[0b101], 0, this.registers[reg], bits);
          } else
            /** MUL */
            mul(this.registers[reg], byte);
        },
        (address, _, byte) => {
          const val = this.memIO.read[bits](address);
          if(byte.reg === 0x2) {
            /** NOT */
            this.memIO.write[bits](~val & CPU.bitMask[bits], address);

          }  else if(byte.reg === 0x3) {
            /** NEG */
            this.memIO.write[bits](
              this.alu(this.operators[0b101], 0, val, bits),
              address
            );
          } else
            /** MUL */
            mul(val, byte)
        }, bits
      );
    }

    /** $80, $81, $82 RM Byte specific */
    Object.assign(this.opcodes, {
      /** CMPSB */ 0xA6: (bits = 0x1) => {
        this.alu(
          this.operators[0b111],
          this.memIO.read[bits](this.getMemAddress('es', 'di')),
          this.memIO.read[bits](this.getMemAddress('ds', 'si')),
          bits
        );

        /** Increment indexes */
        this.dfIncrement(bits, 'di', 'si');
      },
      /** CMPSW */ 0xA7: () => this.opcodes[0xA6](0x2),

      /** TEST al,	imm8 */ 0xA8: (bits = 0x1) => {
        this.alu(this.operators[0b100], this.registers[this.regMap[bits][0x0]], this.fetchOpcode(bits));
      },
      /** TEST ax, imm16  */  0xA9: () => this.opcodes[0xA8](0x2),
      /** TEST r/m8, r8   */  0x84: (bits = 0x1) => {
        this.parseRmByte(
          (reg, modeReg) => {
            this.alu(this.operators[0b100], this.registers[reg], this.registers[this.regMap[bits][modeReg]]);
          },
          (address, reg, mode) => {
            this.alu(this.operators[0b100], this.registers[reg], this.memIO.read[bits](address));
          }, bits
        );
      },
      /** TEST r/m16, r16 */  0x85: () => this.opcodes[0x84](0x2),

      /** OPERATOR r/m8, imm8 */   0x80: (bits = 0x1, src = bits) => {
        this.parseRmByte(
          (reg, modeReg) => {
            this.registers[reg] = this.alu(this.operators[modeReg], this.registers[reg], this.fetchOpcode(src), bits);
          },
          (address, reg, mode) => {
            this.memIO.write[bits](
              this.alu(this.operators[mode.reg], this.memIO.read[bits](address), this.fetchOpcode(src), bits),
              address
            );
          }, bits
        );
      },
      /** OPERATOR r/m16, imm8 */  0x83: () => this.opcodes[0x80](0x2, 0x1),
      /** OPERATOR r/m16, imm16 */ 0x81: () => this.opcodes[0x80](0x2),

      /** MULTIPLIER al, r/m8  */  0xF6: () => multiplier(0x1, (val, byte) => {
        if((byte.reg & 0x6) === 0x6) {
          !val && this.raiseException(CPU.Exception.DIV_BY_ZERO);

          if(byte.reg === 0x7) {
            /** IDIV */
            const _ax = CPU.getSignedNumber(this.registers.ax, 0x2),
                  _val = CPU.getSignedNumber(val);
            this.registers.ax = CPU.toUnsignedNumber(parseInt(_ax / _val)) | CPU.toUnsignedNumber((_ax % _val)) << 8;
          } else {
            /** DIV */
            this.registers.ax = parseInt(this.registers.ax / val) | (this.registers.ax % val) << 8;
          }
        } else {
          /** MUL / IMUL */
          this.registers.ax = CPU.toUnsignedNumber(
            byte.reg === 0x5
              ? CPU.getSignedNumber(this.registers.al) * CPU.getSignedNumber(val)
              : (this.registers.al * val),
            0x2
          );

          this.registers.status.cf = this.registers.status.of = (
            byte.reg === 0x5
              ? this.registers.al == this.registers.ax
              : this.registers.al
          );
        }
      }),
      /** MULTIPLIER ax, r/m16 */  0xF7: () => multiplier(0x2, (val, byte) => {
        if((byte.reg & 0x6) === 0x6) {
          !val && this.raiseException(CPU.Exception.DIV_BY_ZERO);

          /** DIV / IDIV */
          if(byte.reg === 0x7) {
            /** IDIV */
            const num = CPU.getSignedNumber((this.registers.dx << 16) | this.registers.ax, 0x4);

            this.registers.ax = CPU.toUnsignedNumber(parseInt(num / val), 0x2);
            this.registers.dx = CPU.toUnsignedNumber(num % val, 0x2);
          } else {
            /** DIV */
            const num = (this.registers.dx << 16) | this.registers.ax;

            this.registers.ax = parseInt(num / val);
            this.registers.dx = num % val;
          }
        } else {
          /** MUL / IMUL */
          const output = CPU.toUnsignedNumber(
            byte.reg === 0x5
              ? CPU.getSignedNumber(this.registers.ax) * CPU.getSignedNumber(val)
              : (this.registers.ax * val),
            0x4
          );

          this.registers.ax = output & 0xFFFF;
          this.registers.dx = (output >> 16) & 0xFFFF;

          this.registers.status.cf = this.registers.status.of = (
            byte.reg === 0x5
              ? output == this.registers.ax
              : this.registers.dx
          );
        }
      }),
    });

    for(let key in this.operators) {
      if(key === 'extra')
        continue;

      ((op) => {
        const offset = op.offset;
        const codes = {
          /** OPERATOR r/m8, r8 */ [0x0 + offset]: (bits = 0x1) => {
            this.parseRmByte(
              (reg, modeReg) => {
                this.registers[reg] = this.alu(op, this.registers[reg], this.registers[this.regMap[bits][modeReg]], bits);
              },
              (address, reg) => {
                this.memIO.write[bits](
                  this.alu(op, this.memIO.read[bits](address), this.registers[reg], bits),
                  address
                );
              }, bits
            );
          },
          /** OPERATOR m8, r/m8 */ [0x2 + offset]: (bits = 0x1) => {
            this.parseRmByte(
              (reg, modeReg) => {
                const dest = this.regMap[bits][modeReg];
                this.registers[dest] = this.alu(op, this.registers[reg], this.registers[dest], bits);
              },
              (address, reg) => {
                this.registers[reg] = this.alu(op, this.registers[reg], this.memIO.read[bits](address), bits);
              }, bits
            );
          },
          /** OPERATOR AL, imm8 */ [0x4 + offset]: (bits = 0x1) => {
            this.registers[this.regMap[bits][0]] = this.alu(op, this.registers[this.regMap[bits][0]], this.fetchOpcode(bits), bits);
          },

          /** OPERATOR AX, imm16  */ [0x5 + offset]: () => this.opcodes[0x4 + offset](0x2),
          /** OPERATOR r/m16, r16 */ [0x1 + offset]: () => this.opcodes[0x0 + offset](0x2),
          /** OPERATOR r/m16, r16 */ [0x3 + offset]: () => this.opcodes[0x2 + offset](0x2)
        };
        Object.assign(this.opcodes, codes);
      })(this.operators[key]);
    }
  }

  /**
   * Fetch opcodes and jump to address
   * relative to ip register. If rel < 0
   * sub 1B instruction size
   *
   * @param {Integer} bits      Mode
   * @param {Integer} relative  Relative address
   */
  relativeJump(bits, relative) {
    if(!relative)
      relative = this.fetchOpcode(bits);

    /** 1B call instruction size */
    relative = CPU.getSignedNumber(relative, bits);
    this.registers.ip += relative - (relative < 0 ? 0x1 : 0);

    /**
     * If overflows its absolute, truncate value
     * dont know why, its undocummented
     */
    if(this.registers.ip > CPU.bitMask[0x2] + 1)
      this.registers.ip &= 0xFF;
  }

  /**
   * Increment relative to DF register flag
   *
   * @param {Number}  bits      Bytes to increment
   * @param {Array}   regs...   Registers to increment
   */
  dfIncrement(bits = 0x1) {
    const dir = this.registers.status.df ? -bits : bits;
    for(let i = 1;i < arguments.length;++i)
      this.registers[arguments[i]] += dir;
  }

  /**
   * Get active segment register
   */
  get segmentReg() {
    if(this.prefixes.segment)
      return this.prefixes.segment._sr;
    else
      return 'ds';
  }

  /**
   * Parse RM mode byte
   * see: http://www.c-jump.com/CIS77/CPU/x86/X77_0060_mod_reg_r_m_byte.htm
   *
   * @param {Function}  regCallback   Callback if register mode opcode
   * @param {Function}  memCallback   Callback if memory mode opcode
   * @param {Integer}   mode          0x1 if 8bit register, 0x2 if 16bit register
   * @param {Integer}   segRegister   Segment register name, overriden if prefix is given
   */
  parseRmByte(regCallback, memCallback, mode, segRegister = this.segmentReg) {
    const byte = CPU.decodeRmByte(this.fetchOpcode(0x1, true, true));

    /** Register */
    if(byte.mod === 0x3)
      regCallback(
        this.regMap[mode][byte.rm],
        byte.reg,
        byte
      );

    /** Adress */
    else if(memCallback) {
      let address = 0,
          displacement = 0;

      if(!byte.mod && byte.rm === 0x6) {
        /** SIB Byte? */
        address = this.fetchOpcode(0x2);
      } else {
        /** Eight-bit displacement, sign-extended to 16 bits */
        if(byte.mod === 0x1 || byte.mod === 0x2)
          displacement = this.fetchOpcode(byte.mod);

        /** Calc address */
        switch(byte.rm) {
          case 0x0: address = this.registers.bx + this.registers.si + displacement; break;
          case 0x1: address = this.registers.bx + this.registers.di + displacement; break;
          case 0x2: address = this.registers.bp + this.registers.si + displacement; break;
          case 0x3: address = this.registers.bp + this.registers.di + displacement; break;

          case 0x4: address = this.registers.si + displacement; break;
          case 0x5: address = this.registers.di + displacement; break;
          case 0x6: address = this.registers.bp + displacement; break;
          case 0x7: address = this.registers.bx + displacement; break;

          default:
            this.logger.error('Unknown RM byte address!');
        }

        /** Seg register ss is set with 0x2, 0x3, 0x6 opcodes */
        if(byte.rm >= 0x2 && !(0x6 % byte.rm) && segRegister === 'ds')
          segRegister = 'ss';
      }

      if (segRegister)
        address = this.getMemAddress(segRegister, address);

      /** Callback and address calc */
      memCallback(
        /** Only effective address */
        address,
        this.regMap[mode][byte.reg],
        byte
      );
    }
  }

  /**
   * Decodes MOD RM byte
   * see: http://www.c-jump.com/CIS77/CPU/x86/X77_0060_mod_reg_r_m_byte.htm
   *
   * @static
   * @param {Integer} byte  8bit mod rm byte
   * @returns Extracted value
   */
  static decodeRmByte(byte) {
    return {
      mod: byte >> 0x6,
      reg: (byte >> 0x3) & 0x7,
      rm: byte & 0x7
    };
  }

  /**
   * Decodes SIB byte
   * see: http://www.swansontec.com/sintel.html
   *
   * @static
   * @param {Integer} byte  8bit SIB byte
   * @returns Extracted value
   */
  static decodeSibByte(byte) {
    return {
      scale: (byte & 0xC0) >> 0x6,
      index: (byte & 0x38) >> 0x3,
      base: byte & 0x7
    };
  }

  /**
   * Get next opcode
   *
   * @param {Integer} size          Opcode size in bytes 8 / 16
   * @param {Boolean} incrementIP   Ignore counter if false
   * @param {Boolean} ignorePrefix  True to ignore override
   * @returns
   */
  fetchOpcode(size = 0x1, incrementIP = true, ignorePrefix = false) {
    if(!ignorePrefix && this.prefixes.operandSize === 0x66)
      size = 0x4;

    const mapper = this.memIO.read[size];
    if(mapper) {
      const opcode = mapper(this.getMemAddress('cs', 'ip'));
      if(incrementIP) {
        this.registers.ip += size;

        // increment CS if overflows
        if (this.registers.ip > 0xFFFE) {
          this.registers.ip = 0;
          this.registers.cs += 0x1000;
        }
      }

      return opcode;
    } else
      this.halt('Unknown opcode size!');
  }

  /**
   * Exec CPU
   *
   * @param {Number}  cycles  Instructions counter
   * @returns Cycles count
   */
  exec(cycles) {
    if(!this.clock)
      return;

    const tick = () => {
      /** Tick */
      if(this.pause)
        return;

      /** Decode prefix */
      let opcode = null;
      for(let i = 0x0;i < 0x4, opcode = this.fetchOpcode(0x1, true, true); ++i) {
        let prefix = CPU.prefixes[opcode];
        if(typeof prefix === 'undefined')
          break;

        /** Segment registers have object instead of opcode */
        let segmentOverride = isNaN(prefix);
        this.prefixes[
          CPU.prefixMap[segmentOverride ? 0x1 : prefix]
        ] = segmentOverride ? prefix : opcode;
      }

      /** 0F prefix opcodes to 2-byte opcodes */
      if(opcode === 0x0F)
        opcode = (opcode << 0x8) | this.fetchOpcode(0x1, true, true);

      /** Decode opcode */
      let operand = this.opcodes[opcode];
      if(!operand)
        return this.halt(`Unknown opcode 0x${opcode.toString(16).toUpperCase()}`);

      /** Log all opcodes when debugger is enabled */
      if(this.config.debugger) {
        const info = opcodesTable[opcode] || {};
        this.logger.log(`0x${opcode.toString(16)} ${info.mnemonic} ${info.op1} ${info.op2}`);
      }

      /** REP - Do something with operand, reset opcode prefix */
      if(this.prefixes.instruction === 0xF3) {
        const ip = this.registers.ip;
        do {
          /** Revert IP,*/
          this.registers.ip = ip;

          /** Decrement CX */
          operand();
          this.registers.cx = CPU.toUnsignedNumber(this.registers.cx - 0x1, 0x2)

          /** Stop loop if zf, check compare flags for SCAS, CMPS  */
          if(!!~[0xAF, 0xAE, 0xA6, 0xA7].indexOf(opcode) && !this.registers.status.zf)
            break;
        } while(this.registers.cx);
      } else
        operand();

      /** Reset opcode */
      for(let key in this.prefixes)
        this.prefixes[key] = null;
    };

    /** Exec CPU */
    if(cycles) {
      for(let i = 0;i < cycles && this.clock;++i)
        tick();
    } else {
      while(this.clock)
        tick();
    }

    /** Return increment cycles */
    return cycles + 0x1;
  }

  /**
   * Force turn off CPU
   *
   * @param {String}  msg   Error message
   * @param {Boolean} dump  Dump registers
   */
  halt(msg, dump) {
    if(!this.clock)
      this.logger.warn('CPU is already turned off');
    else {
      this.clock = false;

      /** Optional args */
      msg && this.logger.warn(msg);
      if(dump) {
        this.dumpRegisters();
        this.logger.warn(this.mem);
      }

      /** Next instruction */
      this.logger.info('Next instruction ' + this.fetchOpcode(0x2).toString(16));
    }
  }

  /**
   * Print contents of registers in table
   *
   * @param {string} loggerInfo Logger description text
   */
  dumpRegisters(loggerInfo = 'Dump registers:') {
    const insertDot = function(str, pos) {
        return str.slice(0, pos) + '.' + str.slice(pos);
    };

    /** Registers */
    const table = [];
    for(let key in this.registers) {
      let reg = this.registers[key];
      if(isNaN(reg))
        continue;

      let val = reg.toString(16).toUpperCase();
      if(val.length < 8)
        val = new Array(8 - val.length + 1).join('0') + val;

      /** add dots to easier reading value */
      table.push({
        register: key,
        value: insertDot(val, 4) + ` (${reg} ${String.fromCharCode(reg & 0xFF)})`
      });
    }
    this.logger.table(table);

    /** Flags */
    let flags = '';
    for(let flag in CPU.flags)
      flags += `${flag}: ${this.registers.status[flag]} `;

    this.logger.warn(flags);
  }

  /**
   * Read chunk of data from device
   *
   * @param {any} offset
   * @param {any} size
   * @returns
   */
  readChunk(offset, size) {
    if(!this.device)
      throw new Error('Cannot read from empty device');

    const buffer = new Buffer(size);
    if(this.device instanceof Buffer) {
      buffer.fill(0);
      this.device.copy(buffer, 0, offset, Math.min(this.device.length, size));
    } else
      this.halt('Unknown storage memory driver!');
    return buffer;
  }

  /**
   * Load buffer into address in RAM memory
   *
   * @param {Buffer}  buffer  Data
   * @param {Integer} address Memory physical address
   * @param {Integer} size    Buffer size, default buffer.size
   */
  loadBuffer(buffer, address, size = buffer.length) {
    buffer.copy(this.mem, address, 0, size);
    return this.mem;
  }

  /**
   * Check code magic number, at the end of 512B
   * block there should be magic number
   *
   * @static
   * @param {Buffer} code First 512B of machine code
   */
  loadMBR(code) {
    if(this.config.ignoreMagic || code.readUInt16LE(510) == 0xAA55) {
      this.logger.info('Booting from MBR');

      /** CS:IP */
      Object.assign(this.registers, {
        cs: 0x0,
        ip: 0x7c00
      });
      this.loadBuffer(
        code,
        this.getMemAddress('cs', 'ip'),
        510
      );
    } else
      this.halt('Unable to boot device!');
  }

  /**
   * Return segmentated address
   *
   * @static
   * @param {Number} num  32bit address
   * @returns Segmented address
   */
  static getSegmentedAddress(num) {
    return {
      offset: num & 0xFFFF,
      segment: (num >> 0x10) & 0xFFFF
    }
  }

  /**
   * Convert segment based address to flat
   *
   * @param {Integer}         sreg  Segment register
   * @param {Integer|String}  reg   Normal register or offset
   * @returns
   */
  getMemAddress(sreg, reg) {
    return (CPU.toUnsignedNumber(this.registers[sreg], 0x2) << 4) + CPU.toUnsignedNumber(isNaN(reg) ? this.registers[reg] : reg, 0x2);
  }

  /**
   * Convert segment based address to flat
   *
   * @static
   * @param {Number}  seg     Segment index
   * @param {Number}  offset  Memory offset
   * @returns Physical mem address
   */
  static getMemAddress(seg, offset) {
    return (seg << 4) + offset;
  }

  /**
   * Convert signed byte number to normal
   * see: http://stackoverflow.com/questions/11433789/why-is-the-range-of-signed-byte-is-from-128-to-127-2s-complement-and-not-fro
   *
   * @static
   * @param {Number}  num   Number
   * @param {Number}  bits  0x1 if 8bits, 0x2 if 16 bits
   * @returns Signed number
   */
  static getSignedNumber(num, bits = 0x1) {
    const sign = (num >> (0x8 * bits - 0x1)) & 0x1;
    if(sign)
      num -= CPU.bitMask[bits];
    return num;
  }

  /**
   * Convert signed byte number to unsigned
   *
   * @static
   * @param {Number}  num   Number
   * @param {Number}  bits  0x1 if 8bits, 0x2 if 16 bits
   * @returns Unsigned number
   */
  static toUnsignedNumber(num, bits = 0x1) {
    const up = CPU.bitMask[bits];
    if(num > up)
      return num - up - 0x1;
    else if(num < 0x0)
      return up + num + 0x1;
    else
      return num;
  }

  /**
   * Get most significant bit
   *
   * @static
   * @param {any} num
   * @param {number} [bits=0x1]
   *
   * @memberOf CPU
   */
  static msbit(num, bits = 0x1) {
    return (num >> (bits * 0x8 - 0x1)) & 0x1;
  }
}

/** Only for speedup calc */
CPU.bitMask = {
  0x1: (0x2 << 0x7) - 0x1,
  0x2: (0x2 << 0xF) - 0x1,
  0x4: (0x2 << 0x1F) - 0x1
};

/** CPU exceptions */
CPU.Exception = {
  MEM_DUMP: 0x0,
  DIV_BY_ZERO: 0x1
};

module.exports = CPU;
