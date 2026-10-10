/**
 * The Windows taskbar badge: a red disc with the unread count in white.
 *
 * Windows is the one platform with no numeric badge API — macOS gets
 * `app.setBadgeCount` and Linux's Unity launcher reads the same call — so there
 * the count has to be drawn. It is built by hand and handed to
 * `nativeImage.createFromBitmap`, which takes raw BGRA bytes: no image encoder,
 * no asset on disk, and nothing to keep in step with the icon.
 *
 * Kept out of `main.cts` so the drawing can be exercised on its own — a
 * `win32`-only branch is otherwise never run on the machines this is developed
 * on.
 */
import { nativeImage, type NativeImage } from "electron";

/**
 * 5×7 dot-matrix digits, the shape bitmap fonts use at this size.
 */
const GLYPHS: Record<string, readonly string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
};

/** Edge of the bitmap, in pixels. Windows scales it down to the icon's size. */
const SIZE = 32;
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const GLYPH_GAP = 1;

/**
 * Two digits do not fit legibly at this size, so anything past nine is spelled
 * "9+" — which is also what a plain badge means: "more than you need to count".
 */
function label(count: number): string {
  return count > 9 ? "9+" : String(count);
}

export function badgeOverlay(count: number): NativeImage {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const centre = SIZE / 2 - 0.5;
  const radius = SIZE / 2 - 1;
  const text = label(count);
  // A single digit gets three pixels per dot; "9+" has twice the width to fit.
  const scale = text.length > 1 ? 2 : 3;
  const textWidth = text.length * GLYPH_WIDTH + (text.length - 1) * GLYPH_GAP;
  const originX = Math.round((SIZE - textWidth * scale) / 2);
  const originY = Math.round((SIZE - GLYPH_HEIGHT * scale) / 2);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (Math.hypot(x - centre, y - centre) > radius) continue;
      const offset = (y * SIZE + x) * 4;
      // BGRA. The disc is fully opaque, so nothing here is premultiplied.
      pixels[offset] = 0x3c;
      pixels[offset + 1] = 0x30;
      pixels[offset + 2] = 0xf0;
      pixels[offset + 3] = 0xff;
    }
  }

  for (let index = 0; index < text.length; index++) {
    const glyph = GLYPHS[text[index]] ?? [];
    for (let row = 0; row < GLYPH_HEIGHT; row++) {
      for (let column = 0; column < GLYPH_WIDTH; column++) {
        if (glyph[row]?.[column] !== "1") continue;
        const left = originX + (index * (GLYPH_WIDTH + GLYPH_GAP) + column) * scale;
        const top = originY + row * scale;
        for (let y = top; y < top + scale; y++) {
          for (let x = left; x < left + scale; x++) {
            if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
            const offset = (y * SIZE + x) * 4;
            // The glyphs sit well inside the disc, so each white pixel was
            // already filled with an opaque red — only the colour changes here.
            pixels[offset] = 0xff;
            pixels[offset + 1] = 0xff;
            pixels[offset + 2] = 0xff;
          }
        }
      }
    }
  }

  return nativeImage.createFromBitmap(pixels, { width: SIZE, height: SIZE });
}
