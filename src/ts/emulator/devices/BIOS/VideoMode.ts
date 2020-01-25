import {X86_REALMODE_MAPPED_ADDRESSES} from '../../constants/x86';

/**
 * Creates video buffer description
 *
 * @export
 * @class VideoMode
 */
export class VideoMode {
  private w: number;

  private h: number;

  public code: number;

  private offset: number;

  private pages: number;

  constructor(
    code: number,
    w: number,
    h: number,
    pages: number = 0x1,
    offset: number = X86_REALMODE_MAPPED_ADDRESSES.text,
  ) {
    this.code = code;
    this.w = w;
    this.h = h;
    this.offset = offset;
    this.pages = pages;
  }

  get pageSize() {
    return this.w * this.h * 0x2;
  }

  /**
   * Memory can contain multiple pages
   *
   * @param {number} [page=0x0]
   * @returns {number}
   * @memberof VideoMode
   */
  getPageOffset(page = 0x0): number {
    return this.offset + page * this.pageSize;
  }

  /**
   * Write to VRAM
   *
   * @param {Memory} mem    Memory driver
   * @param {Number} char   Character code
   * @param {Number} color  Color BIOS number
   * @param {Number} x      X screen coordinate
   * @param {Number} y      Y screen coordinate
   * @param {Number} page   Page index
   */
  write(mem, char: number, color: number|boolean, x: number, y: number, page: number = 0x0): void {
    /** Write direct to memory */
    const address = this.offset + this.pageSize * page + (y * this.w + x) * 0x2;
    if (color === false)
      mem.write[0x1](char & 0xFF, address);
    else
      mem.write[0x2]((char & 0xFF) | ((<number> color & 0xFF) << 8), address);
  }

  /**
   * Read VRAM at address
   *
   * @param {Memory} mem    Memory driver
   * @param {Number} x      X screen coordinate
   * @param {Number} y      Y screen coordinate
   * @param {Number} page   Page index
   * @returns
   * @memberof VideoMode
   */
  read(mem, x: number, y: number, page: number = 0x0): void {
    const address = this.offset + this.pageSize * page + (y * this.w + x) * 0x2;

    return mem.read[0x2](address);
  }

  /**
   * Scrolls screen up
   *
   * @param {Memory}  mem   Memory driver
   * @param {Number}  lines Lines amount
   * @param {Number}  page  Page index
   */
  scrollUp(mem, lines: number = 0x1, page: number = 0x0): void {
    const {pageSize} = this;
    const lineSize = this.w * 0x2,
      startOffset = this.offset + pageSize * page;

    /** Copy previous lines memory */
    mem.device.copy(
      mem.device,
      startOffset,
      startOffset + lineSize * lines,
      this.offset + pageSize * (page + 1),
    );

    /** Fill with zeros new line, preserve attributes! */
    for (let i = 0; i < this.w; ++i)
      this.write(mem, 0, false, i, this.h - 1, page);
  }

  /**
   * Iterate every pixel
   *
   * @param {Function} fn
   * @memberof VideoMode
   */
  iterate(read, cpu, page, fn) {
    const {w, h} = this;
    let offset = this.getPageOffset(page);

    for (let y = 0; y < h; ++y) {
      for (let x = 0; x < w; ++x) {
        /** Read from memory */
        const num = read && cpu.memIO.read[0x2](offset);

        fn(offset, x, y, num);
        offset += 0x2;
      }
    }
  }

  clear(mem) {
    mem.device.fill(
      0, // value
      this.offset, // offset
      this.offset + this.pages * this.pageSize,
    );
  }
}