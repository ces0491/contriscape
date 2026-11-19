import { crc32, deflateSync } from 'node:zlib';

/** Red, green and blue, each from 0 to 255. */
export type Rgb = readonly [number, number, number];

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** One PNG chunk: its length, its four-letter type, its data, and a checksum over the type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * A picture made of flat rectangles, which is all a card of towers and block letters needs. It saves as a PNG with
 * nothing but Node's own zlib, so the card costs the site no dependency.
 */
export class Picture {
  /** Three bytes a pixel, row by row from the top. */
  private readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    background: Rgb,
  ) {
    this.pixels = new Uint8Array(width * height * 3);
    this.rect(0, 0, width, height, background);
  }

  /** Fills a rectangle, clipped to the picture. `alpha` blends it over what is there, from 0 to 1. */
  rect(x: number, y: number, width: number, height: number, colour: Rgb, alpha = 1): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + width));
    const y1 = Math.min(this.height, Math.round(y + height));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = (py * this.width + px) * 3;
        for (let c = 0; c < 3; c++) this.pixels[i + c] += (colour[c] - this.pixels[i + c]) * alpha;
      }
    }
  }

  /** The colour at a point, for tests. */
  at(x: number, y: number): Rgb {
    const i = (y * this.width + x) * 3;
    return [this.pixels[i], this.pixels[i + 1], this.pixels[i + 2]];
  }

  /** The picture as a PNG: eight bits a channel, no alpha, every row unfiltered. */
  png(): Uint8Array<ArrayBuffer> {
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, this.width);
    view.setUint32(4, this.height);
    header.set([8, 2, 0, 0, 0], 8);

    const stride = this.width * 3;
    const rows = new Uint8Array((stride + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      rows.set(this.pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    const parts = [SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', new Uint8Array())];
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}
