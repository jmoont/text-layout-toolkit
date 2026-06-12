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
  type FontSpec,
  type Rect,
  type WrapSide,
} from "./computeWrap";
import { createCanvasMeasurer } from "./measureText";

const DEFAULT_GUTTER = 16;
const FALLBACK_FONT_SIZE = 18;

type SideOption = WrapSide | "auto";

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
  const [gutter, setGutter] = useState(DEFAULT_GUTTER);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<Status>(undefined);

  const t = {
    intro: intl.formatMessage({
      defaultMessage:
        "Place a paragraph and an image so they overlap, then apply. The plugin adds line breaks so the text flows around the image.",
      description: "Intro/instructions for the wrap-text tool.",
    }),
    approx: intl.formatMessage({
      defaultMessage:
        "Wrapping is approximate — Canva doesn't expose text measurements, so you may need to nudge the result. Re-run after moving things; undo (Ctrl/Cmd+Z) reverts it.",
      description: "Caveat explaining that wrapping is approximate.",
    }),
    sideLabel: intl.formatMessage({
      defaultMessage: "Image side",
      description: "Label for the image-side control.",
    }),
    sideAuto: intl.formatMessage({
      defaultMessage: "Auto",
      description: "Option: auto-detect which side the image is on.",
    }),
    sideLeft: intl.formatMessage({
      defaultMessage: "Left",
      description: "Option: image is on the left.",
    }),
    sideRight: intl.formatMessage({
      defaultMessage: "Right",
      description: "Option: image is on the right.",
    }),
    gutterLabel: intl.formatMessage({
      defaultMessage: "Gap around image (px)",
      description: "Label for the gutter/spacing control.",
    }),
    applyButton: intl.formatMessage({
      defaultMessage: "Wrap text",
      description: "Button that wraps the text around the image.",
    }),
    success: intl.formatMessage({
      defaultMessage: "Text wrapped around the image.",
      description: "Confirmation after wrapping succeeds.",
    }),
    noPair: intl.formatMessage({
      defaultMessage:
        "Couldn't find a text box overlapping an image on this page. Move a paragraph over an image and try again.",
      description: "Shown when no overlapping text + image pair is found.",
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

  const onApply = async () => {
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
        const images = elements.filter(
          (el): el is DesignEditing.RectElement =>
            el.type === "rect" &&
            el.fill.mediaContainer.ref?.type === "image",
        );

        // Pick the text + image pair with the greatest overlap.
        let best:
          | { text: DesignEditing.TextElement; image: DesignEditing.RectElement; area: number }
          | undefined;
        for (const textEl of texts) {
          for (const image of images) {
            const area = overlapArea(elementRect(textEl), elementRect(image));
            if (area > 0 && (!best || area > best.area)) {
              best = { text: textEl, image, area };
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
        const fmt =
          regions.find((r) => r.formatting?.fontSize !== undefined)
            ?.formatting ?? regions[0]?.formatting;
        const fontSpec: FontSpec = {
          fontSizePx: fmt?.fontSize ?? FALLBACK_FONT_SIZE,
          fontWeight: fmt?.fontWeight,
        };

        const wrapped = computeWrap(
          plain,
          elementRect(best.text),
          elementRect(best.image),
          fontSpec,
          { side, gutterPx: gutter },
          measure,
        );

        const inline = pickInline(fmt);
        range.replaceText({ index: 0, length: plain.length }, wrapped.text, inline);
        if (fmt?.fontSize !== undefined || fmt?.fontRef !== undefined) {
          range.formatParagraph(
            { index: 0, length: wrapped.text.length },
            { fontSize: fmt?.fontSize, fontRef: fmt?.fontRef },
          );
        }

        await session.sync();
        result = { tone: "positive", text: t.success };
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

      <Alert tone="info">{t.approx}</Alert>
      {!canEdit && <Alert tone="warn">{t.unsupported}</Alert>}
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
    </Rows>
  );
};

/** Extracts only the inline-formatting fields that `replaceText` accepts. */
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
  return inline;
}
