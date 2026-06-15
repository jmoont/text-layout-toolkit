import {
  Alert,
  Button,
  FormField,
  NumberInput,
  Rows,
  SegmentedControl,
  Text,
} from "@canva/app-ui-kit";
import { useFeatureSupport } from "@canva/app-hooks";
import { openDesign } from "@canva/design";
import type {
  DesignEditing,
  InlineFormatting,
  RichtextFormatting,
} from "@canva/design";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import {
  computeWrap,
  overlapArea,
  unwrapText,
  type FontSpec,
  type ObstacleShape,
  type OutputParagraph,
  type Rect,
  type WrapSide,
} from "./computeWrap";
import { createCanvasMeasurer } from "./measureText";

const DEFAULT_GUTTER = 16;
const FALLBACK_FONT_SIZE = 18;

// Canva expresses letter spacing in thousandths of an em, so the rendered extra
// width per character is (value / 1000) × font size.
const LETTER_SPACING_UNIT = 1000;

type SideOption = WrapSide | "auto";
type ShapeOption = ObstacleShape | "auto";

/** Any non-text element the text can be wrapped around (image, frame, shape…). */
type Obstacle = Exclude<DesignEditing.AbsoluteElement, DesignEditing.TextElement>;

/**
 * Best-effort guess of an obstacle's outline from its metadata. Shape elements
 * expose their vector paths, so a curved path (cubic bezier or arc command)
 * implies a rounded outline best modelled as an ellipse; everything else falls
 * back to the bounding box. Images/frames are plain rectangles with no contour.
 */
function detectObstacleShape(obstacle: Obstacle): ObstacleShape {
  if (obstacle.type === "shape") {
    try {
      const rounded = obstacle.paths
        .toArray()
        .some((path) => /[csa]/i.test(path.d));
      return rounded ? "ellipse" : "rectangle";
    } catch {
      return "rectangle";
    }
  }
  return "rectangle";
}

type Status =
  | { tone: "positive" | "critical" | "warn"; text: string }
  | undefined;

const elementRect = (el: DesignEditing.Element): Rect => ({
  top: el.top,
  left: el.left,
  width: el.width,
  height: el.height,
});

export const WrapPanel = () => {
  const intl = useIntl();
  const isSupported = useFeatureSupport();
  const canEdit = isSupported(openDesign);
  const measure = useMemo(() => createCanvasMeasurer(), []);

  const [side, setSide] = useState<SideOption>("auto");
  const [shape, setShape] = useState<ShapeOption>("auto");
  const [gutter, setGutter] = useState(DEFAULT_GUTTER);
  const [letterSpacing, setLetterSpacing] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<Status>(undefined);

  const t = {
    intro: intl.formatMessage({
      defaultMessage:
        "Place a paragraph over an image, frame, or other element so they overlap, then apply. The plugin adds line breaks so the text flows around it.",
      description: "Intro/instructions for the wrap-text tool.",
    }),
    approx: intl.formatMessage({
      defaultMessage:
        "Wrapping is approximate — Canva doesn't expose text measurements, so you may need to nudge the result. Re-run after moving things; undo (Ctrl/Cmd+Z) reverts it.",
      description: "Caveat explaining that wrapping is approximate.",
    }),
    sideLabel: intl.formatMessage({
      defaultMessage: "Element side",
      description: "Label for the control choosing which side the element is on.",
    }),
    sideAuto: intl.formatMessage({
      defaultMessage: "Auto",
      description: "Option: auto-detect which side the element is on.",
    }),
    sideLeft: intl.formatMessage({
      defaultMessage: "Left",
      description: "Option: the element is on the left.",
    }),
    sideRight: intl.formatMessage({
      defaultMessage: "Right",
      description: "Option: the element is on the right.",
    }),
    shapeLabel: intl.formatMessage({
      defaultMessage: "Element shape",
      description: "Label for the control choosing the obstacle's outline.",
    }),
    shapeAuto: intl.formatMessage({
      defaultMessage: "Auto",
      description: "Option: detect the element's shape automatically.",
    }),
    shapeRectangle: intl.formatMessage({
      defaultMessage: "Box",
      description: "Option: treat the element as a rectangle.",
    }),
    shapeCircle: intl.formatMessage({
      defaultMessage: "Circle",
      description: "Option: treat the element as a circle or ellipse.",
    }),
    shapeHint: intl.formatMessage({
      defaultMessage:
        "Pick Circle to flow text along a round image or shape. Auto detects round shapes from their outline; images and frames are treated as boxes.",
      description: "Helper text explaining the element-shape control.",
    }),
    gutterLabel: intl.formatMessage({
      defaultMessage: "Gap around element (px)",
      description: "Label for the gutter/spacing control.",
    }),
    letterSpacingLabel: intl.formatMessage({
      defaultMessage: "Letter spacing",
      description: "Label for the letter-spacing control.",
    }),
    letterSpacingHint: intl.formatMessage({
      defaultMessage:
        "Match your text's letter spacing (the Spacing value in Canva's text settings) so lines wrap accurately. Leave at 0 for default spacing.",
      description: "Helper text for the letter-spacing control.",
    }),
    applyButton: intl.formatMessage({
      defaultMessage: "Wrap text",
      description: "Button that wraps the text around the element.",
    }),
    success: intl.formatMessage({
      defaultMessage: "Text wrapped around the element.",
      description: "Confirmation after wrapping succeeds.",
    }),
    unwrapButton: intl.formatMessage({
      defaultMessage: "Remove wrapping",
      description: "Button that removes wrap line breaks, keeping paragraphs.",
    }),
    unwrapped: intl.formatMessage({
      defaultMessage: "Wrapping removed.",
      description: "Confirmation after wrapping is removed.",
    }),
    noPair: intl.formatMessage({
      defaultMessage:
        "Couldn't find a text box overlapping another element on this page. Move a paragraph over an image, frame, or shape and try again.",
      description: "Shown when no overlapping text + element pair is found.",
    }),
    notAbsolute: intl.formatMessage({
      defaultMessage:
        "This tool only works on designs with fixed layouts (such as presentations or social posts), not on docs or whiteboards.",
      description: "Shown when the page type doesn't support positioning.",
    }),
    unsupported: intl.formatMessage({
      defaultMessage: "Editing isn't supported in the current design type.",
      description: "Shown when the design-editing API isn't supported.",
    }),
    empty: intl.formatMessage({
      defaultMessage: "The overlapping text box is empty.",
      description: "Shown when the matched text element has no text.",
    }),
    genericError: intl.formatMessage({
      defaultMessage: "Couldn't wrap the text.",
      description: "Generic error when wrapping fails.",
    }),
  };

  // Reflow the overlapping text box in a single openDesign pass. `produce` turns
  // the plaintext into the new text + paragraph metadata (wrap or unwrap).
  //
  // Size handling mirrors the original, size-preserving behaviour: the new text
  // inherits the box's size on replace, and an explicit size is only re-applied
  // when the source actually has one — never a forced fallback, so auto-sized
  // text isn't shrunk. Per-paragraph inline formatting is restored so headings
  // stay bold and body stays regular (instead of flattening to one style).
  const reflow = async (
    produce: (ctx: {
      best: { text: DesignEditing.TextElement; obstacle: Obstacle };
      plain: string;
      fontSpec: FontSpec;
    }) => { text: string; paragraphs: OutputParagraph[] },
    successText: string,
  ) => {
    setStatus(undefined);
    setIsLoading(true);
    let result: Status;
    try {
      await openDesign({ type: "current_page" }, async (session) => {
        const page = session.page;
        if (page.type !== "absolute") {
          result = { tone: "warn", text: t.notAbsolute };
          return;
        }

        const elements = page.elements.toArray();
        const texts = elements.filter(
          (el): el is DesignEditing.TextElement => el.type === "text",
        );
        // Any non-text element can be an obstacle to wrap around: images and
        // frames (both `rect`), shapes, embeds, and grouped content all have a
        // bounding box, which is all the geometry the wrap needs.
        const obstacles = elements.filter(
          (el): el is Obstacle =>
            el.type !== "text" && el.width > 0 && el.height > 0,
        );

        // Pick the text + obstacle pair with the greatest overlap.
        let best:
          | { text: DesignEditing.TextElement; obstacle: Obstacle; area: number }
          | undefined;
        for (const textEl of texts) {
          for (const obstacle of obstacles) {
            const area = overlapArea(elementRect(textEl), elementRect(obstacle));
            if (area > 0 && (!best || area > best.area)) {
              best = { text: textEl, obstacle, area };
            }
          }
        }
        if (!best) {
          result = { tone: "warn", text: t.noPair };
          return;
        }

        const range = best.text.text;
        const plain = range.readPlaintext();
        if (plain.trim().length === 0) {
          result = { tone: "warn", text: t.empty };
          return;
        }

        const regions = range.readTextRegions();
        // "Dominant" = the explicitly-sized run covering the most characters
        // (the body), used for measurement and as the uniform baseline.
        const dominant =
          [...regions]
            .filter((r) => r.formatting?.fontSize !== undefined)
            .sort((a, b) => b.text.length - a.text.length)[0]?.formatting ??
          regions[0]?.formatting;
        const fontSpec: FontSpec = {
          fontSizePx: dominant?.fontSize ?? FALLBACK_FONT_SIZE,
          fontWeight: dominant?.fontWeight,
        };

        const produced = produce({ best, plain, fontSpec });

        // Replace the text, inheriting the box's size via the body's inline
        // style. Don't force a size — that would shrink auto-sized text.
        range.replaceText(
          { index: 0, length: plain.length },
          produced.text,
          pickInline(dominant),
        );

        // Re-apply size/font uniformly only when the source has an explicit
        // size or font; otherwise leave the inherited size untouched.
        const baseParagraph: RichtextFormatting = {};
        if (dominant?.fontSize !== undefined) {
          baseParagraph.fontSize = dominant.fontSize;
        }
        if (dominant?.fontRef !== undefined) {
          baseParagraph.fontRef = dominant.fontRef;
        }
        if (dominant?.textAlign !== undefined) {
          baseParagraph.textAlign = dominant.textAlign;
        }
        if (Object.keys(baseParagraph).length > 0) {
          range.formatParagraph(
            { index: 0, length: produced.text.length },
            baseParagraph,
          );
        }

        // Restore each content paragraph's inline style (bold heading, colour,
        // links) over the uniform baseline. No per-paragraph paragraph
        // formatting, so there's no blank-line size bleed.
        for (const para of produced.paragraphs) {
          if (para.isBlank || para.length === 0) {
            continue;
          }
          if (para.start + para.length > produced.text.length) {
            continue;
          }
          const inline = pickInline(formattingAt(regions, para.sourceIndex));
          if (inline) {
            range.formatText(
              { index: para.start, length: para.length },
              inline,
            );
          }
        }

        await session.sync();
        result = { tone: "positive", text: successText };
      });
    } catch (e) {
      result = {
        tone: "critical",
        text: e instanceof Error ? e.message : t.genericError,
      };
    } finally {
      setStatus(result);
      setIsLoading(false);
    }
  };

  const onApply = () =>
    reflow(({ best, plain, fontSpec }) => {
      const effectiveShape =
        shape === "auto" ? detectObstacleShape(best.obstacle) : shape;
      const letterSpacingPx =
        (letterSpacing / LETTER_SPACING_UNIT) * fontSpec.fontSizePx;
      return computeWrap(
        plain,
        elementRect(best.text),
        elementRect(best.obstacle),
        fontSpec,
        { side, gutterPx: gutter, shape: effectiveShape, letterSpacingPx },
        measure,
      );
    }, t.success);

  const onUnwrap = () => reflow(({ plain }) => unwrapText(plain), t.unwrapped);

  return (
    <Rows spacing="2u">
      <Text>{t.intro}</Text>

      <FormField
        label={t.sideLabel}
        control={() => (
          <SegmentedControl
            value={side}
            options={[
              { value: "auto", label: t.sideAuto },
              { value: "left", label: t.sideLeft },
              { value: "right", label: t.sideRight },
            ]}
            onChange={setSide}
          />
        )}
      />

      <FormField
        label={t.shapeLabel}
        description={t.shapeHint}
        control={() => (
          <SegmentedControl
            value={shape}
            options={[
              { value: "auto", label: t.shapeAuto },
              { value: "rectangle", label: t.shapeRectangle },
              { value: "ellipse", label: t.shapeCircle },
            ]}
            onChange={setShape}
          />
        )}
      />

      <FormField
        label={t.gutterLabel}
        control={() => (
          <NumberInput
            value={gutter}
            min={0}
            max={200}
            step={1}
            onChange={(value) => {
              if (value !== undefined) {
                setGutter(value);
              }
            }}
          />
        )}
      />

      <FormField
        label={t.letterSpacingLabel}
        description={t.letterSpacingHint}
        control={() => (
          <NumberInput
            value={letterSpacing}
            min={-200}
            max={800}
            step={10}
            onChange={(value) => {
              if (value !== undefined) {
                setLetterSpacing(value);
              }
            }}
          />
        )}
      />

      <Button
        variant="primary"
        onClick={onApply}
        disabled={!canEdit || isLoading}
        loading={isLoading}
        tooltipLabel={!canEdit ? t.unsupported : undefined}
        stretch
      >
        {t.applyButton}
      </Button>

      <Button
        variant="secondary"
        onClick={onUnwrap}
        disabled={!canEdit || isLoading}
        loading={isLoading}
        tooltipLabel={!canEdit ? t.unsupported : undefined}
        stretch
      >
        {t.unwrapButton}
      </Button>

      <Alert tone="info">{t.approx}</Alert>
      {!canEdit && <Alert tone="warn">{t.unsupported}</Alert>}
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
    </Rows>
  );
};

/** Returns the formatting of the region containing `charIndex` in the source. */
function formattingAt(
  regions: readonly { text: string; formatting?: Partial<RichtextFormatting> }[],
  charIndex: number,
): Partial<RichtextFormatting> | undefined {
  if (charIndex < 0 || regions.length === 0) {
    return undefined;
  }
  let offset = 0;
  for (const region of regions) {
    if (charIndex < offset + region.text.length) {
      return region.formatting;
    }
    offset += region.text.length;
  }
  return regions[regions.length - 1]?.formatting;
}

/** Extracts the inline-formatting fields, or undefined if none are set. */
function pickInline(
  formatting: Partial<RichtextFormatting> | undefined,
): InlineFormatting | undefined {
  if (!formatting) {
    return undefined;
  }
  const inline: InlineFormatting = {};
  if (formatting.color !== undefined) inline.color = formatting.color;
  if (formatting.fontWeight !== undefined)
    inline.fontWeight = formatting.fontWeight;
  if (formatting.fontStyle !== undefined) inline.fontStyle = formatting.fontStyle;
  if (formatting.decoration !== undefined)
    inline.decoration = formatting.decoration;
  if (formatting.strikethrough !== undefined)
    inline.strikethrough = formatting.strikethrough;
  if (formatting.link !== undefined) inline.link = formatting.link;
  return Object.keys(inline).length > 0 ? inline : undefined;
}
