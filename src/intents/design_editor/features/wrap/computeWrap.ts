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

/** How to model the obstacle's outline when reserving space for it. */
export type ObstacleShape = "rectangle" | "ellipse";

export type WrapOptions = {
  side: WrapSide | "auto";
  gutterPx: number;
  /** Defaults to "rectangle" (the obstacle's bounding box). */
  shape?: ObstacleShape;
  /**
   * Extra rendered width per character from the text's letter spacing, in px
   * (negative for tighter spacing). Canva doesn't expose letter spacing through
   * the API, so the panel derives this from a user-entered value. Applied to
   * every measurement — including the indent spaces — so lines break and indent
   * where the text actually renders. Defaults to 0.
   */
  letterSpacingPx?: number;
};

/** A rectangle described by its edges rather than width/height. */
type Bounds = { left: number; right: number; top: number; bottom: number };

/**
 * The obstacle's horizontal extent across the text row spanning `rowTop`..
 * `rowBottom`, or `null` if the obstacle doesn't reach that row. For an ellipse
 * the extent follows the curve (widest point within the row band, so text never
 * overlaps the shape); for a rectangle it's the constant box edges.
 */
export function obstacleExtentAtRow(
  shape: ObstacleShape,
  bounds: Bounds,
  rowTop: number,
  rowBottom: number,
): { left: number; right: number } | null {
  if (rowBottom <= bounds.top || rowTop >= bounds.bottom) {
    return null;
  }
  if (shape === "ellipse") {
    const cx = (bounds.left + bounds.right) / 2;
    const cy = (bounds.top + bounds.bottom) / 2;
    const rx = (bounds.right - bounds.left) / 2;
    const ry = (bounds.bottom - bounds.top) / 2;
    if (rx <= 0 || ry <= 0) {
      return { left: bounds.left, right: bounds.right };
    }
    // Use the point in the row band nearest the centre — the widest part of the
    // ellipse the row touches — so the reserved gap fully clears the curve.
    const y = Math.max(rowTop, Math.min(cy, rowBottom));
    const dy = y - cy;
    const ratio = 1 - (dy * dy) / (ry * ry);
    if (ratio <= 0) {
      return null;
    }
    const halfWidth = rx * Math.sqrt(ratio);
    return { left: cx - halfWidth, right: cx + halfWidth };
  }
  return { left: bounds.left, right: bounds.right };
}

/** Describes where one output paragraph sits, and where its formatting comes from. */
export type OutputParagraph = {
  /** Start offset of the paragraph within the wrapped text. */
  start: number;
  /** Length of the paragraph's text, excluding its trailing newline. */
  length: number;
  /** Whether this paragraph is a preserved blank line (a paragraph separator). */
  isBlank: boolean;
  /**
   * Character offset in the *source* text whose formatting this output
   * paragraph should inherit. Lets the caller restore per-paragraph formatting
   * (headings, body text, and the sized blank lines from the spacing tool).
   */
  sourceIndex: number;
};

export type WrapResult = {
  text: string;
  side: WrapSide;
  lineCount: number;
  /** One entry per output paragraph, in document order. */
  paragraphs: OutputParagraph[];
};

// Approximate line height as a multiple of font size (Canva's default leading).
const LINE_HEIGHT_FACTOR = 1.2;

// Indent character for left-side wrapping. A non-breaking space is used instead
// of a regular space because editors trim/collapse leading regular spaces, which
// would drop the indent and let the text overlap the image.
const INDENT_CHAR = " ";

// The indent is built from spaces whose rendered width we can only estimate
// (letter spacing/kerning isn't exposed by the API). Pad it by this fraction so
// the text clears the obstacle even when the spaces render narrower than
// measured — erring toward a slightly larger gap rather than an overlap.
const INDENT_SAFETY = 0.2;

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
 * Reflows `text` so it avoids the obstacle, **preserving the paragraph
 * structure**. Blank lines (the empty paragraphs the spacing tool inserts) are
 * kept as-is; each non-empty paragraph has its own line breaks collapsed and is
 * then greedily repacked with hard line breaks — and, for a left-side obstacle,
 * leading spaces — so each line fits the width available beside the obstacle on
 * that row. Vertical position accumulates across paragraphs, so the obstacle is
 * dodged continuously down the whole text box.
 *
 * Consecutive non-empty source lines are treated as one logical paragraph (so a
 * previous wrap's hard breaks are re-flowed rather than frozen).
 */
export function computeWrap(
  text: string,
  textBox: Rect,
  obstacle: Rect,
  font: FontSpec,
  options: WrapOptions,
  measure: MeasureText,
): WrapResult {
  const side =
    options.side === "auto" ? detectSide(textBox, obstacle) : options.side;
  const gutter = Math.max(0, options.gutterPx);
  const shape = options.shape ?? "rectangle";
  const letterSpacingPx = options.letterSpacingPx ?? 0;
  const lineHeight = font.fontSizePx * LINE_HEIGHT_FACTOR;

  // Width as actually rendered: the base measurement plus letter spacing applied
  // after each character. Used for line breaks and the indent width alike.
  const measureText: MeasureText = (t, f) =>
    measure(t, f) + letterSpacingPx * t.length;

  // Obstacle bounds relative to the text box's top-left, inflated by the gutter
  // so the gap is reserved around the whole outline (rectangle or curve).
  const obs: Bounds = {
    top: obstacle.top - textBox.top - gutter,
    bottom: obstacle.top - textBox.top + obstacle.height + gutter,
    left: obstacle.left - textBox.left - gutter,
    right: obstacle.left - textBox.left + obstacle.width + gutter,
  };

  const spaceWidth = Math.max(
    1,
    measureText(" ", font) || font.fontSizePx * 0.25,
  );

  if (text.replace(/\s+/g, "").length === 0) {
    return { text: "", side, lineCount: 0, paragraphs: [] };
  }

  // Split into source lines, remembering each line's start offset so the caller
  // can map output paragraphs back to their source formatting.
  const srcLines: { text: string; index: number }[] = [];
  let srcOffset = 0;
  for (const part of text.split("\n")) {
    srcLines.push({ text: part, index: srcOffset });
    srcOffset += part.length + 1; // +1 for the "\n" separator
  }

  const outLines: { text: string; isBlank: boolean; sourceIndex: number }[] = [];
  let y = 0;

  // Greedily packs `words` into lines starting at the current `y`, dodging the
  // obstacle row by row. The first word always goes on the line (even if it
  // overflows a too-narrow row) to guarantee forward progress.
  const flowParagraph = (words: string[], sourceIndex: number) => {
    let i = 0;
    while (i < words.length) {
      const extent = obstacleExtentAtRow(shape, obs, y, y + lineHeight);

      let indent = "";
      let available = textBox.width;
      if (extent) {
        if (side === "right") {
          available = extent.left;
        } else {
          const indentPx = extent.right;
          // Round up and pad so the indent reliably clears the obstacle even if
          // the spaces render narrower than measured. Reserve the indent's
          // estimated width from `available` so the line still fits the box.
          const indentChars = Math.max(
            0,
            Math.ceil((indentPx * (1 + INDENT_SAFETY)) / spaceWidth),
          );
          indent = INDENT_CHAR.repeat(indentChars);
          available = textBox.width - indentChars * spaceWidth;
        }
      }
      available = Math.max(available, 0);

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
        if (measureText(`${line} ${next}`, font) <= available) {
          line = `${line} ${next}`;
          i++;
        } else {
          break;
        }
      }

      outLines.push({ text: indent + line, isBlank: false, sourceIndex });
      y += lineHeight;
    }
  };

  let li = 0;
  while (li < srcLines.length) {
    const cur = srcLines[li];
    if (cur === undefined) {
      break;
    }
    if (cur.text.trim().length === 0) {
      // Preserve the blank line (paragraph separator) and advance past it.
      outLines.push({ text: "", isBlank: true, sourceIndex: cur.index });
      y += lineHeight;
      li++;
      continue;
    }
    // Gather consecutive non-empty source lines into one logical paragraph.
    const sourceIndex = cur.index;
    const words: string[] = [];
    while (li < srcLines.length) {
      const ln = srcLines[li];
      if (ln === undefined || ln.text.trim().length === 0) {
        break;
      }
      for (const word of ln.text.trim().split(/\s+/)) {
        words.push(word);
      }
      li++;
    }
    flowParagraph(words, sourceIndex);
  }

  const outText = outLines.map((l) => l.text).join("\n");
  const paragraphs: OutputParagraph[] = [];
  let pos = 0;
  for (const l of outLines) {
    paragraphs.push({
      start: pos,
      length: l.text.length,
      isBlank: l.isBlank,
      sourceIndex: l.sourceIndex,
    });
    pos += l.text.length + 1; // +1 for the "\n" separator
  }

  return { text: outText, side, lineCount: outLines.length, paragraphs };
}

/**
 * Reverses a wrap: collapses the hard line breaks and leading-space indents that
 * wrapping inserted, joining each paragraph's lines back into one. Blank lines
 * (the spacing tool's paragraph separators) are preserved. Returns the same
 * paragraph metadata as {@link computeWrap} so the caller can restore formatting.
 */
export function unwrapText(text: string): {
  text: string;
  paragraphs: OutputParagraph[];
} {
  if (text.replace(/\s+/g, "").length === 0) {
    return { text: "", paragraphs: [] };
  }

  const srcLines: { text: string; index: number }[] = [];
  let srcOffset = 0;
  for (const part of text.split("\n")) {
    srcLines.push({ text: part, index: srcOffset });
    srcOffset += part.length + 1;
  }

  const outLines: { text: string; isBlank: boolean; sourceIndex: number }[] = [];
  let li = 0;
  while (li < srcLines.length) {
    const cur = srcLines[li];
    if (cur === undefined) {
      break;
    }
    if (cur.text.trim().length === 0) {
      outLines.push({ text: "", isBlank: true, sourceIndex: cur.index });
      li++;
      continue;
    }
    const sourceIndex = cur.index;
    const words: string[] = [];
    while (li < srcLines.length) {
      const ln = srcLines[li];
      if (ln === undefined || ln.text.trim().length === 0) {
        break;
      }
      for (const word of ln.text.trim().split(/\s+/)) {
        words.push(word);
      }
      li++;
    }
    outLines.push({ text: words.join(" "), isBlank: false, sourceIndex });
  }

  const outText = outLines.map((l) => l.text).join("\n");
  const paragraphs: OutputParagraph[] = [];
  let pos = 0;
  for (const l of outLines) {
    paragraphs.push({
      start: pos,
      length: l.text.length,
      isBlank: l.isBlank,
      sourceIndex: l.sourceIndex,
    });
    pos += l.text.length + 1;
  }
  return { text: outText, paragraphs };
}
