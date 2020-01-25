/** Callbacks */
export type UnmountCallback = () => void;

/** Size types */
export type RectangleDimensions = {
  x?: number,
  y?: number,
  w?: number,
  h?: number,
};

export class Rectangle implements RectangleDimensions {
  x: number;
  y: number;
  w: number;
  h: number;

  constructor(x: number, y: number, w: number, h: number) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }
}

/** Debugger types */
export interface MemRange {
  low: number,
  high: number,
}
