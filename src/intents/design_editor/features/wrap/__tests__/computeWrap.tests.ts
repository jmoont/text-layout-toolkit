import {
  computeWrap,
  detectSide,
  obstacleExtentAtRow,
  overlapArea,
  unwrapText,
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

describe("obstacleExtentAtRow", () => {
  const bounds = { left: 0, right: 100, top: 0, bottom: 100 };

  it("returns the full box edges for a rectangle", () => {
    expect(obstacleExtentAtRow("rectangle", bounds, 10, 20)).toEqual({
      left: 0,
      right: 100,
    });
  });

  it("returns null when the row is clear of the obstacle", () => {
    expect(obstacleExtentAtRow("rectangle", bounds, 120, 130)).toBeNull();
    expect(obstacleExtentAtRow("ellipse", bounds, 120, 130)).toBeNull();
  });

  it("gives an ellipse its full width at the centre row", () => {
    expect(obstacleExtentAtRow("ellipse", bounds, 45, 55)).toEqual({
      left: 0,
      right: 100,
    });
  });

  it("narrows an ellipse's extent away from the centre", () => {
    // Row [0,10]: nearest point to centre is y=10, dy=-40, half = 50*0.6 = 30.
    expect(obstacleExtentAtRow("ellipse", bounds, 0, 10)).toEqual({
      left: 20,
      right: 80,
    });
  });
});

describe("unwrapText", () => {
  it("joins each paragraph's wrapped lines and drops indents", () => {
    const wrapped = "First line\nsecond line\n\n   indented body\nmore body";
    const result = unwrapText(wrapped);
    expect(result.text).toBe("First line second line\n\nindented body more body");
  });

  it("preserves blank-line paragraph separators", () => {
    const result = unwrapText("A\na2\n\nB\n\nC");
    expect(result.text).toBe("A a2\n\nB\n\nC");
    expect(result.paragraphs).toHaveLength(5);
    expect(result.paragraphs[1]).toMatchObject({ isBlank: true });
  });

  it("returns empty output for blank input", () => {
    expect(unwrapText("   \n  ")).toEqual({ text: "", paragraphs: [] });
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
    // imgRight = 80 → indent = 80/10 = 8 non-breaking spaces on overlapping rows.
    expect(out[0]!.startsWith(" ".repeat(8))).toBe(true);
    // A row below the image should not be indented.
    const clearRow = out.find((l) => !l.startsWith(" "));
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

  it("preserves blank lines and re-flows each paragraph", () => {
    const image: Rect = { top: 1000, left: 0, width: 10, height: 10 }; // no overlap
    // "three" and "four" are soft-wrapped lines of one paragraph; the blank
    // line separates them from the first paragraph and must be kept.
    const messy = "one   two\n\nthree\nfour";
    const result = computeWrap(
      messy,
      TEXT_BOX,
      image,
      font,
      { side: "right", gutterPx: 0 },
      measure,
    );
    expect(result.text).toBe("one two\n\nthree four");
  });

  it("keeps blank-line paragraphs and tags their source offset", () => {
    const image: Rect = { top: 1000, left: 0, width: 10, height: 10 }; // no overlap
    const source = "Title\n\nBody text here";
    const result = computeWrap(
      source,
      TEXT_BOX,
      image,
      font,
      { side: "right", gutterPx: 0 },
      measure,
    );
    expect(result.text).toBe("Title\n\nBody text here");
    expect(result.paragraphs).toHaveLength(3);
    // Title paragraph inherits formatting from source offset 0.
    expect(result.paragraphs[0]).toMatchObject({ isBlank: false, sourceIndex: 0 });
    // Blank line is preserved and points at the empty line in the source (6).
    expect(result.paragraphs[1]).toMatchObject({ isBlank: true, sourceIndex: 6 });
    // Body paragraph inherits formatting from source offset 7.
    expect(result.paragraphs[2]).toMatchObject({ isBlank: false, sourceIndex: 7 });
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
    expect(result).toEqual({
      text: "",
      side: expect.any(String),
      lineCount: 0,
      paragraphs: [],
    });
  });

  it("follows a circle's curve, leaving more room near the poles", () => {
    // A right-side ellipse spanning the full height; near the top the curve
    // pulls in, so a top row fits more text than the same rectangle would.
    const obstacle: Rect = { top: 0, left: 100, width: 100, height: 200 };
    const text = Array(40).fill("ab").join(" ");

    const rect = computeWrap(
      text,
      TEXT_BOX,
      obstacle,
      font,
      { side: "right", gutterPx: 0, shape: "rectangle" },
      measure,
    );
    const ellipse = computeWrap(
      text,
      TEXT_BOX,
      obstacle,
      font,
      { side: "right", gutterPx: 0, shape: "ellipse" },
      measure,
    );

    const rectTop = lines(rect.text)[0]!;
    const ellipseTop = lines(ellipse.text)[0]!;
    expect(ellipseTop.length).toBeGreaterThan(rectTop.length);
  });

  it("fits more text per line with negative letter spacing", () => {
    const image: Rect = { top: 1000, left: 0, width: 10, height: 10 }; // no overlap
    const text = Array(40).fill("ab").join(" ");
    const opts = { side: "right" as const, gutterPx: 0 };

    const normal = computeWrap(text, TEXT_BOX, image, font, opts, measure);
    const tight = computeWrap(
      text,
      TEXT_BOX,
      image,
      font,
      { ...opts, letterSpacingPx: -4 },
      measure,
    );

    // Tighter spacing means each line holds at least as many characters.
    expect(lines(tight.text)[0]!.length).toBeGreaterThan(
      lines(normal.text)[0]!.length,
    );
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
