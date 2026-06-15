import type {
  Bounds,
  FontRef,
  InlineFormatting,
  RichtextFormatting,
  TextRegion,
} from "@canva/design";

/**
 * The subset of `RichtextRange` methods that the spacing algorithm needs.
 *
 * Declared as its own interface so the algorithm can be unit tested against a
 * lightweight fake. A real `@canva/design` `RichtextRange` satisfies it
 * structurally.
 */
export interface RichtextEditable {
  readPlaintext(): string;
  readTextRegions(): readonly TextRegion[];
  replaceText(
    bounds: Bounds,
    characters: string,
    formatting?: InlineFormatting,
  ): { bounds: Bounds };
  formatParagraph(bounds: Bounds, formatting: RichtextFormatting): void;
}

export type ApplySpacingResult = {
  /** Whether the range was changed (false when there's nothing to space). */
  changed: boolean;
  /** Number of blank paragraphs inserted/normalised between paragraphs. */
  blanksTouched: number;
};

export type SpacingOptions = {
  /**
   * Controls where blank lines are inserted:
   *
   * - When `true`, a blank line is added after *every* line break — each line is
   *   treated as its own paragraph. Use this when paragraphs are separated by a
   *   single line break (no blank lines).
   * - When `false` (default), spacing is paragraph-aware: if the text already
   *   separates paragraphs with blank lines, only those gaps are normalised and
   *   single line breaks within a paragraph are preserved. If the text has no
   *   blank lines at all, it automatically falls back to spacing every line
   *   break (so the tool still does something useful).
   */
  everyLineBreak?: boolean;
};

// Canva clamps richtext font size to 1–100px.
const MIN_FONT_SIZE = 1;
const MAX_FONT_SIZE = 100;

type Paragraph = { index: number; text: string };

/**
 * Splits richtext plaintext into paragraphs, recording each paragraph's start
 * offset within the original string. Paragraphs are separated by `\n`.
 */
export function splitParagraphs(text: string): Paragraph[] {
  const result: Paragraph[] = [];
  let index = 0;
  for (const part of text.split("\n")) {
    result.push({ index, text: part });
    index += part.length + 1; // +1 for the `\n` separator
  }
  return result;
}

/**
 * Normalises the spacing between paragraphs of a richtext range so that every
 * pair of adjacent non-empty paragraphs is separated by exactly one empty
 * paragraph, sized to `blankFontSizePx`.
 *
 * This mirrors the manual Canva workaround (insert a blank line, then shrink or
 * grow its font size to control the gap) — Canva exposes no line-spacing API.
 *
 * The algorithm is deliberately non-destructive: it never rewrites the content
 * paragraphs, so all of their formatting (per-word colour, weight, size, font,
 * links, alignment) is preserved. It only collapses the "gaps" between content
 * paragraphs into a single, correctly-sized empty paragraph. Edits are applied
 * right-to-left so that earlier offsets stay valid as the text mutates.
 *
 * Idempotent: running it again with the same size is a no-op; running it with a
 * new size simply re-sizes the existing blank lines.
 */
export function applyParagraphSpacing(
  target: RichtextEditable,
  blankFontSizePx: number,
  options: SpacingOptions = {},
): ApplySpacingResult {
  const size = clamp(Math.round(blankFontSizePx), MIN_FONT_SIZE, MAX_FONT_SIZE);

  const text = target.readPlaintext();
  const paragraphs = splitParagraphs(text);
  const contentParagraphs = paragraphs.filter((p) => p.text.trim().length > 0);

  // Need at least two paragraphs to have a gap to space.
  if (contentParagraphs.length < 2) {
    return { changed: false, blanksTouched: 0 };
  }

  const regions = readRegionsSafely(target);

  // Each gap spans from the end of one content paragraph to the start of the
  // next, swallowing any existing newlines / blank paragraphs in between.
  const allGaps: { start: number; end: number; fontRef?: FontRef }[] = [];
  for (let i = 0; i + 1 < contentParagraphs.length; i++) {
    const before = contentParagraphs[i];
    const after = contentParagraphs[i + 1];
    if (!before || !after) {
      continue;
    }
    const start = before.index + before.text.length;
    const end = after.index;
    allGaps.push({ start, end, fontRef: fontRefAt(regions, start - 1) });
  }

  // A gap longer than a single "\n" already holds a blank line (an empty or
  // whitespace-only paragraph). A gap of exactly one "\n" is a bare line break.
  const hasBlankGap = allGaps.some((g) => g.end - g.start > 1);

  // Auto behaviour: when the text already uses blank lines to separate
  // paragraphs, only resize those existing gaps and leave single line breaks
  // alone. When it has no blank lines, space every line break instead. The
  // explicit option forces every-line-break spacing.
  const spaceEveryBreak = (options.everyLineBreak ?? false) || !hasBlankGap;

  const gaps = spaceEveryBreak
    ? allGaps
    : allGaps.filter((g) => g.end - g.start > 1);

  if (gaps.length === 0) {
    return { changed: false, blanksTouched: 0 };
  }

  // 1. Replace every gap with a single empty paragraph ("\n\n"). Apply
  //    right-to-left so each replacement doesn't shift the offsets of the gaps
  //    we haven't processed yet.
  for (let i = gaps.length - 1; i >= 0; i--) {
    const gap = gaps[i];
    if (!gap) {
      continue;
    }
    target.replaceText({ index: gap.start, length: gap.end - gap.start }, "\n\n");
  }

  // 2. Size each blank paragraph. The replacements above change the text
  //    length, so compute each blank's final offset with a left-to-right
  //    running delta, then format once the text is settled. The empty
  //    paragraph is terminated by the second of its two newlines.
  let delta = 0;
  for (const gap of gaps) {
    const blankTerminator = gap.start + delta + 1;
    const formatting: RichtextFormatting = { fontSize: size };
    if (gap.fontRef) {
      formatting.fontRef = gap.fontRef;
    }
    target.formatParagraph({ index: blankTerminator, length: 1 }, formatting);
    delta += 2 - (gap.end - gap.start);
  }

  return { changed: true, blanksTouched: gaps.length };
}

function readRegionsSafely(target: RichtextEditable): readonly TextRegion[] {
  try {
    return target.readTextRegions();
  } catch {
    return [];
  }
}

/** Returns the font of the region containing `charIndex` (or the last region). */
function fontRefAt(
  regions: readonly TextRegion[],
  charIndex: number,
): FontRef | undefined {
  if (charIndex < 0 || regions.length === 0) {
    return undefined;
  }
  let offset = 0;
  for (const region of regions) {
    if (charIndex < offset + region.text.length) {
      return region.formatting?.fontRef;
    }
    offset += region.text.length;
  }
  return regions[regions.length - 1]?.formatting?.fontRef;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}
