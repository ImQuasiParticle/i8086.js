# i8086.js
16bit x86 virtual machine written in modern JS ES6.

## Status
- [x] Basic ASM compiler with NASM Syntax
- [x] Add expression parsers (such as jmp .label + 2)
- [x] Preprocessor for NASM
- [x] Improve diassembler (add jump arrows)
- [ ] FPU Support
  - [x] Assembler
  - [ ] Emulator
- [ ] Add VGA mode (13h)
- [ ] Tiny 16bit C compiler
- [ ] App frontend

## Screens
![Prototype](/doc/screen.gif)
![Prototype](/doc/screen-2.png)
![Tetris](/doc/screen-5.png)
![ASM Preprocessor](/doc/screen-4.png)
![ASM Compiler](/doc/screen-3.png)

## Docs
https://gist.github.com/nikAizuddin/0e307cac142792dcdeba
http://www.plantation-productions.com/Webster/www.artofasm.com/Windows/HTML/RealArithmetica3.html
https://gist.github.com/mikesmullin/6259449
http://teaching.idallen.com/dat2343/10f/notes/040_overflow.txt
http://ece425web.groups.et.byu.net/stable/labs/8086Assembly.html
http://dsearls.org/courses/C391OrgSys/IntelAL/8086_instruction_set.html
https://pdos.csail.mit.edu/6.828/2008/readings/i386/s17_02.htm
https://xem.github.io/minix86/manual/intel-x86-and-64-manual-vol1/o_7281d5ea06a5b67a-194.html
https://johnloomis.org/ece314/notes/fpu/fpu.pdf
https://www.felixcloutier.com/x86/index.html

## License
The MIT License (MIT)
Copyright (c) 2020 Mateusz Bagiński

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
