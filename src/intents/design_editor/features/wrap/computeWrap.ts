/**
 * Pure geometry + greedy text-reflow logic for wrapping a paragraph around an
 * overlapping image.
 *
 * Canva exposes no text-measurement API, so width is estimated by an injected
 * `MeasureText` function (a canvas-backed measurer in the app, a deterministic
 * fake in tests). Because of that, wrapping is necessarily approximate — see the
 * tool's UI copy and the project README for the caveats.
 */

export type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type FontSpec = {
  fontSizePx: number;
  fontFamily?: string;
  fontWeight?: string | number;
};

/** Estimates the rendered width, in pixels, of `text` in the given font. */
export type MeasureText = (text: string, font: FontSpec) => number;

/** Which side of the text the image sits on. */
export type WrapSide = "left" | "right";

export type WrapOptions = {
  side: WrapSide | "auto";
  gutterPx: number;
};

export type WrapResult = {
  text: string;
  side: WrapSide;
  lineCount: number;
};

// Approximate line height as a multiple of font size (Canva's default leading).
const LINE_HEIGHT_FACTOR = 1.2;

/** The overlapping area of two rectangles (0 if they don't overlap). */
export function overlapArea(a: Rect, b: Rect): number {
  const x = Math.max(
    0,
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left),
  );
  const y = Math.max(
    0,
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top),
  );
  return x * y;
}

/** Picks which side the image is on by comparing horizontal centres. */
export function detectSide(textBox: Rect, image: Rect): WrapSide {
  const imageCenter = image.left + image.width / 2;
  const boxCenter = textBox.left + textBox.width / 2;
  return imageCenter >= boxCenter ? "right" : "left";
}

/**
 * Reflows `text` so it avoids the image. The whole text is treated as a single
 * flowing paragraph: existing whitespace (including line breaks) is collapsed,
 * then greedily repacked with hard line breaks — and, for a left-side image,
 * leading spaces — inserted so each line fits the width available beside the
 * image on that line's row.
 */
export function computeWrap(
  text: string,
  textBox: Rect,
  image: Rect,
  font: FontSpec,
  options: WrapOptions,
  measure: MeasureText,
): WrapResult {
  const side =
    options.side === "auto" ? detectSide(textBox, image) : options.side;
  const gutter = Math.max(0, options.gutterPx);
  const lineHeight = font.fontSizePx * LINE_HEIGHT_FACTOR;

  // Image bounds relative to the text box's top-left.
  const imgTop = image.top - textBox.top;
  const imgBottom = imgTop + image.height;
  const imgLeft = image.left - textBox.left;
  const imgRight = imgLeft + image.width;

  const spaceWidth = Math.max(1, measure(" ", font) || font.fontSizePx * 0.25);

  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) {
    return { text: "", side, lineCount: 0 };
  }

  const lines: string[] = [];
  let y = 0;
  let i = 0;
  while (i < words.length) {
    const overlaps = y + lineHeight > imgTop - gutter && y < imgBottom + gutter;

    let indent = "";
    let available = textBox.width;
    if (overlaps) {
      if (side === "right") {
        available = imgLeft - gutter;
      } else {
        const indentPx = imgRight + gutter;
        available = textBox.width - indentPx;
        indent = " ".repeat(Math.max(0, Math.round(indentPx / spaceWidth)));
      }
    }
    available = Math.max(available, 0);

    // Greedy packing. The first word always goes on the line (even if it
    // overflows a too-narrow row) to guarantee forward progress.
    const first = words[i];
    if (first === undefined) {
      break;
    }
    let line = first;
    i++;
    while (i < words.length) {
      const next = words[i];
      if (next === undefined) {
        break;
      }
      if (measure(`${line} ${next}`, font) <= available) {
        line = `${line} ${next}`;
        i++;
      } else {
        break;
      }
    }

    lines.push(indent + line);
    y += lineHeight;
  }

  return { text: lines.join("\n"), side, lineCount: lines.length };
}
