import type {
  Bounds,
  InlineFormatting,
  RichtextFormatting,
  TextRegion,
} from "@canva/design";
import {
  applyParagraphSpacing,
  splitParagraphs,
  type RichtextEditable,
} from "../applySpacing";

/**
 * A minimal in-memory stand-in for a Canva `RichtextRange`. It actually splices
 * its backing string on `replaceText` so tests can assert the resulting text,
 * and records every `formatParagraph` call.
 */
class FakeRange implements RichtextEditable {
  text: string;
  regions: TextRegion[];
  formatCalls: { bounds: Bounds; formatting: RichtextFormatting }[] = [];

  constructor(text: string, regions?: TextRegion[]) {
    this.text = text;
    this.regions = regions ?? [{ text, formatting: {} }];
  }

  readPlaintext(): string {
    return this.text;
  }

  readTextRegions(): readonly TextRegion[] {
    return this.regions;
  }

  replaceText(
    bounds: Bounds,
    characters: string,
    _formatting?: InlineFormatting,
  ): { bounds: Bounds } {
    this.text =
      this.text.slice(0, bounds.index) +
      characters +
      this.text.slice(bounds.index + bounds.length);
    return { bounds: { index: bounds.index, length: characters.length } };
  }

  formatParagraph(bounds: Bounds, formatting: RichtextFormatting): void {
    this.formatCalls.push({ bounds, formatting });
  }

  /** The character at each formatted bounds — should always be a newline. */
  formattedChars(): string[] {
    return this.formatCalls.map((c) => this.text[c.bounds.index] ?? "");
  }
}

describe("splitParagraphs", () => {
  it("records the start offset of each paragraph", () => {
    expect(splitParagraphs("ab\ncd\ne")).toEqual([
      { index: 0, text: "ab" },
      { index: 3, text: "cd" },
      { index: 6, text: "e" },
    ]);
  });
});

describe("applyParagraphSpacing", () => {
  it("inserts a sized blank line between two paragraphs", () => {
    const range = new FakeRange("First\nSecond");
    const result = applyParagraphSpacing(range, 24);

    expect(result).toEqual({ changed: true, blanksTouched: 1 });
    expect(range.text).toBe("First\n\nSecond");
    expect(range.formatCalls).toHaveLength(1);
    expect(range.formatCalls[0]!.formatting.fontSize).toBe(24);
    // The formatted bounds must land on the blank paragraph's newline.
    expect(range.formattedChars()).toEqual(["\n"]);
  });

  it("handles three paragraphs with correct final blank offsets", () => {
    const range = new FakeRange("P1\nP2\nP3");
    const result = applyParagraphSpacing(range, 12);

    expect(result.blanksTouched).toBe(2);
    expect(range.text).toBe("P1\n\nP2\n\nP3");
    // Both formatted positions sit on a newline in the *final* text.
    expect(range.formattedChars()).toEqual(["\n", "\n"]);
    // Specifically the second newline of each "\n\n" pair: indices 3 and 7.
    expect(range.formatCalls.map((c) => c.bounds.index).sort((a, b) => a - b)).toEqual([
      3, 7,
    ]);
  });

  it("collapses multiple existing blank lines into one", () => {
    const range = new FakeRange("A\n\n\n\nB");
    applyParagraphSpacing(range, 30);
    expect(range.text).toBe("A\n\nB");
  });

  it("is idempotent when run twice at the same size", () => {
    const range = new FakeRange("One\nTwo\nThree");
    applyParagraphSpacing(range, 18);
    const afterFirst = range.text;
    applyParagraphSpacing(range, 18);
    expect(range.text).toBe(afterFirst);
    expect(range.text).toBe("One\n\nTwo\n\nThree");
  });

  it("re-sizes existing blank lines on a second run", () => {
    const range = new FakeRange("One\nTwo");
    applyParagraphSpacing(range, 10);
    applyParagraphSpacing(range, 40);
    expect(range.text).toBe("One\n\nTwo");
    const last = range.formatCalls[range.formatCalls.length - 1]!;
    expect(last.formatting.fontSize).toBe(40);
  });

  it("does nothing for a single paragraph", () => {
    const range = new FakeRange("Just one paragraph");
    const result = applyParagraphSpacing(range, 24);
    expect(result).toEqual({ changed: false, blanksTouched: 0 });
    expect(range.text).toBe("Just one paragraph");
    expect(range.formatCalls).toHaveLength(0);
  });

  it("ignores whitespace-only paragraphs when counting content", () => {
    const range = new FakeRange("Solo\n   \n  ");
    const result = applyParagraphSpacing(range, 24);
    expect(result.changed).toBe(false);
  });

  it("clamps the font size to Canva's 1-100px range", () => {
    const range = new FakeRange("A\nB");
    applyParagraphSpacing(range, 9999);
    expect(range.formatCalls[0]!.formatting.fontSize).toBe(100);

    const range2 = new FakeRange("A\nB");
    applyParagraphSpacing(range2, 0);
    expect(range2.formatCalls[0]!.formatting.fontSize).toBe(1);
  });

  it("inherits the font of the preceding paragraph for the blank line", () => {
    const fontRef =
      "FONT123" as unknown as NonNullable<TextRegion["formatting"]>["fontRef"];
    const range = new FakeRange("Alpha\nBeta", [
      { text: "Alpha\nBeta", formatting: { fontRef } },
    ]);
    applyParagraphSpacing(range, 24);
    expect(range.formatCalls[0]!.formatting.fontRef).toBe(fontRef);
  });
});
