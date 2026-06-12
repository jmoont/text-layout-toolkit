import {
  computeWrap,
  detectSide,
  overlapArea,
  type FontSpec,
  type MeasureText,
  type Rect,
} from "../computeWrap";

// Deterministic monospace-style measurer: every character is 10px wide.
const CHAR_WIDTH = 10;
const measure: MeasureText = (text) => text.length * CHAR_WIDTH;

const font: FontSpec = { fontSizePx: 20 }; // line height = 24px

const TEXT_BOX: Rect = { top: 0, left: 0, width: 200, height: 400 };

const lines = (text: string) => text.split("\n");

describe("overlapArea", () => {
  it("returns the intersection area", () => {
    const a: Rect = { top: 0, left: 0, width: 100, height: 100 };
    const b: Rect = { top: 50, left: 50, width: 100, height: 100 };
    expect(overlapArea(a, b)).toBe(50 * 50);
  });

  it("returns 0 when rectangles are disjoint", () => {
    const a: Rect = { top: 0, left: 0, width: 10, height: 10 };
    const b: Rect = { top: 100, left: 100, width: 10, height: 10 };
    expect(overlapArea(a, b)).toBe(0);
  });
});

describe("detectSide", () => {
  it("detects an image on the right", () => {
    const image: Rect = { top: 0, left: 120, width: 80, height: 50 };
    expect(detectSide(TEXT_BOX, image)).toBe("right");
  });

  it("detects an image on the left", () => {
    const image: Rect = { top: 0, left: 0, width: 80, height: 50 };
    expect(detectSide(TEXT_BOX, image)).toBe("left");
  });
});

describe("computeWrap", () => {
  it("narrows lines that overlap a right-side image, widening below it", () => {
    // Image occupies the top-right; rows at y=0 and y=24 overlap (height 48),
    // rows at y>=48 are clear. Overlap rows have width imgLeft=120 → 12 chars.
    const image: Rect = { top: 0, left: 120, width: 80, height: 48 };
    const text = Array(40).fill("ab").join(" "); // many short words

    const result = computeWrap(
      text,
      TEXT_BOX,
      image,
      font,
      { side: "right", gutterPx: 0 },
      measure,
    );

    const out = lines(result.text);
    expect(result.side).toBe("right");
    // First two rows overlap → must fit within 120px (<= 12 chars).
    expect(measure(out[0]!, font)).toBeLessThanOrEqual(120);
    expect(measure(out[1]!, font)).toBeLessThanOrEqual(120);
    // A later, full-width row should be wider than the narrow rows allow.
    const widest = Math.max(...out.map((l) => l.length));
    expect(widest).toBeGreaterThan(12);
  });

  it("indents lines beside a left-side image", () => {
    const image: Rect = { top: 0, left: 0, width: 80, height: 48 };
    const text = Array(40).fill("ab").join(" ");

    const result = computeWrap(
      text,
      TEXT_BOX,
      image,
      font,
      { side: "left", gutterPx: 0 },
      measure,
    );

    const out = lines(result.text);
    expect(result.side).toBe("left");
    // imgRight = 80 → indent = 80/10 = 8 spaces on overlapping rows.
    expect(out[0]!.startsWith("        ")).toBe(true);
    // A row below the image should not be indented.
    const clearRow = out.find((l) => !l.startsWith(" "));
    expect(clearRow).toBeDefined();
  });

  it("auto-detects the side", () => {
    const image: Rect = { top: 0, left: 140, width: 60, height: 24 };
    const result = computeWrap(
      text(),
      TEXT_BOX,
      image,
      font,
      { side: "auto", gutterPx: 0 },
      measure,
    );
    expect(result.side).toBe("right");
  });

  it("collapses existing whitespace and line breaks", () => {
    const image: Rect = { top: 1000, left: 0, width: 10, height: 10 }; // no overlap
    const messy = "one   two\n\nthree\nfour";
    const result = computeWrap(
      messy,
      TEXT_BOX,
      image,
      font,
      { side: "right", gutterPx: 0 },
      measure,
    );
    // No overlap and the box fits all words on one line (18 chars < 200px).
    expect(result.text).toBe("one two three four");
  });

  it("returns empty output for empty text", () => {
    const image: Rect = { top: 0, left: 0, width: 10, height: 10 };
    const result = computeWrap(
      "   ",
      TEXT_BOX,
      image,
      font,
      { side: "auto", gutterPx: 0 },
      measure,
    );
    expect(result).toEqual({ text: "", side: expect.any(String), lineCount: 0 });
  });

  it("places an over-long word on its own line instead of looping forever", () => {
    const image: Rect = { top: 0, left: 0, width: 200, height: 1000 }; // covers all
    const longWord = "x".repeat(50);
    const result = computeWrap(
      `${longWord} ${longWord}`,
      TEXT_BOX,
      image,
      font,
      { side: "right", gutterPx: 0 },
      measure,
    );
    expect(result.lineCount).toBe(2);
  });
});

function text(): string {
  return Array(20).fill("ab").join(" ");
}
