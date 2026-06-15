import {
  Accordion,
  AccordionItem,
  Alert,
  Button,
  Column,
  Columns,
  FormField,
  Rows,
  Select,
  Slider,
  Text,
} from "@canva/app-ui-kit";
import { useFeatureSupport } from "@canva/app-hooks";
import { editContent, selection } from "@canva/design";
import type { TextRegion } from "@canva/design";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { applyParagraphSpacing } from "./applySpacing";

const MIN_SIZE = 3;
const MAX_SIZE = 80;
const DEFAULT_SIZE = 24;

// Auto spacing is a quarter of the text size, never smaller than this.
const AUTO_MIN = 3;
const FONT_DIVISOR = 4;
const FALLBACK_FONT_SIZE = 24;

const SNIPPET_MAX = 36;
const ALL = "all";

/** Auto spacing for a given font size: a quarter of it, clamped to a minimum. */
const autoSpacingFor = (fontSizePx: number) =>
  Math.max(AUTO_MIN, Math.round(fontSizePx / FONT_DIVISOR));

type Status =
  | { tone: "positive" | "critical" | "warn"; text: string }
  | undefined;

/** A text box on the page, identified by its content (Canva exposes no id). */
type TextBox = {
  text: string;
  snippet: string;
  fontSize: number;
  paragraphs: number;
};

function firstFontSize(regions: readonly TextRegion[]): number | undefined {
  for (const region of regions) {
    if (typeof region.formatting?.fontSize === "number") {
      return region.formatting.fontSize;
    }
  }
  return undefined;
}

/** Number of non-empty paragraphs in the text. */
function countParagraphs(text: string): number {
  return text.split("\n").filter((p) => p.trim().length > 0).length;
}

function snippet(text: string): string {
  const firstLine =
    text
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s.length > 0) ?? "";
  return firstLine.length > SNIPPET_MAX
    ? `${firstLine.slice(0, SNIPPET_MAX - 1)}…`
    : firstLine;
}

/** Reads every non-empty text box on the current page (read-only, no sync). */
async function readTextBoxes(): Promise<TextBox[]> {
  const boxes: TextBox[] = [];
  await editContent(
    { contentType: "richtext", target: "current_page" },
    async (session) => {
      for (const range of session.contents) {
        if (range.deleted) {
          continue;
        }
        const plain = range.readPlaintext();
        if (plain.trim().length === 0) {
          continue;
        }
        boxes.push({
          text: plain,
          snippet: snippet(plain),
          fontSize:
            firstFontSize(range.readTextRegions()) ?? FALLBACK_FONT_SIZE,
          paragraphs: countParagraphs(plain),
        });
      }
    },
  );
  return boxes;
}

export const SpacingPanel = () => {
  const intl = useIntl();
  const isSupported = useFeatureSupport();
  const canEdit = isSupported(editContent);

  const [boxes, setBoxes] = useState<TextBox[]>([]);
  const [target, setTarget] = useState<string>(ALL);
  const [selectedText, setSelectedText] = useState<string | undefined>(undefined);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [autoSize, setAutoSize] = useState(DEFAULT_SIZE);
  const [isLoading, setIsLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<Status>(undefined);
  const scanInFlight = useRef(false);
  const lastSeededFont = useRef<number | undefined>(undefined);

  // Re-read the page's text boxes. Guarded so overlapping calls don't stack.
  const scan = useCallback(async () => {
    if (!canEdit || scanInFlight.current) {
      return;
    }
    scanInFlight.current = true;
    setScanning(true);
    try {
      setBoxes(await readTextBoxes());
    } catch {
      // Best-effort scan; leave the existing list in place.
    } finally {
      scanInFlight.current = false;
      setScanning(false);
    }
  }, [canEdit]);

  // Rescan automatically: on mount and whenever the canvas selection changes,
  // so the box list is always fresh without the user asking for it.
  useEffect(() => {
    void scan();
  }, [scan, selectedText]);

  // Follow the user's selection via the *plaintext* scope (the richtext scope
  // is preview and blocks release). It exposes only the selected text — no
  // location — so the box is matched by its content below.
  useEffect(() => {
    let dispose: (() => void) | undefined;
    try {
      dispose = selection.registerOnChange({
        scope: "plaintext",
        onChange: async (event) => {
          if (event.count === 0) {
            setSelectedText(undefined);
            return;
          }
          try {
            const draft = await event.read();
            const text = draft.contents.map((c) => c.text).join("\n");
            setSelectedText(text.trim().length > 0 ? text : undefined);
          } catch {
            setSelectedText(undefined);
          }
        },
      });
    } catch {
      // Plaintext selection unavailable in this context; the picker still works.
    }
    return () => dispose?.();
  }, []);

  // Match the selected text to a scanned box and target it automatically.
  useEffect(() => {
    if (!selectedText) {
      return;
    }
    const exact = boxes.findIndex((b) => b.text === selectedText);
    const idx =
      exact >= 0 ? exact : boxes.findIndex((b) => b.text.includes(selectedText));
    if (idx >= 0) {
      setTarget(String(idx));
    }
  }, [selectedText, boxes]);

  // Seed the slider from the targeted box's font size (a quarter of it). Only
  // reseeds when that size actually changes, so manual tweaks and background
  // rescans don't reset the slider.
  useEffect(() => {
    const fontSize =
      target === ALL ? boxes[0]?.fontSize : boxes[Number(target)]?.fontSize;
    if (fontSize !== undefined && fontSize !== lastSeededFont.current) {
      lastSeededFont.current = fontSize;
      const auto = autoSpacingFor(fontSize);
      setAutoSize(auto);
      setSize(auto);
    }
  }, [target, boxes]);

  const t = {
    intro: intl.formatMessage({
      defaultMessage:
        "Adds an evenly-sized blank line between paragraphs of the selected text box. Set the gap size, then apply.",
      description: "Intro/instructions for the paragraph spacing tool.",
    }),
    applyingToAll: intl.formatMessage({
      defaultMessage: "Applying to all text boxes",
      description: "Indicator shown when spacing targets every text box.",
    }),
    targetLabel: intl.formatMessage({
      defaultMessage: "Text box",
      description: "Label for the text-box picker.",
    }),
    targetAll: intl.formatMessage({
      defaultMessage: "All text boxes",
      description: "Picker option that applies spacing to every text box.",
    }),
    advancedTitle: intl.formatMessage({
      defaultMessage: "Advanced: choose text box",
      description: "Title of the collapsible advanced-selection section.",
    }),
    rescan: intl.formatMessage({
      defaultMessage: "Rescan page",
      description: "Button that re-reads the page's text boxes.",
    }),
    sizeLabel: intl.formatMessage({
      defaultMessage: "Space between paragraphs",
      description: "Label for the paragraph gap size control.",
    }),
    sizeUnit: intl.formatMessage({
      defaultMessage:
        "Size of the blank line, in pixels. Starts at a quarter of the text size.",
      description: "Helper text describing the gap size control.",
    }),
    sizeValue: intl.formatMessage(
      {
        defaultMessage: "{size} px",
        description: "Current paragraph gap size, in pixels.",
      },
      { size },
    ),
    autoButton: intl.formatMessage({
      defaultMessage: "Auto",
      description:
        "Button that resets the gap size to a quarter of the font size.",
    }),
    applyButton: intl.formatMessage({
      defaultMessage: "Apply spacing",
      description: "Button that applies paragraph spacing.",
    }),
    unsupported: intl.formatMessage({
      defaultMessage: "Editing isn't supported in the current design type.",
      description: "Shown when the design-editing API isn't supported.",
    }),
    noText: intl.formatMessage({
      defaultMessage: "No text boxes found on this page. Add text to get started.",
      description: "Shown when the page has no text boxes.",
    }),
    success: intl.formatMessage({
      defaultMessage: "Spacing applied.",
      description: "Confirmation shown after spacing is applied.",
    }),
    nothingToSpace: intl.formatMessage({
      defaultMessage:
        "No paragraphs to space — a text box needs two or more paragraphs.",
      description: "Shown when nothing could be spaced.",
    }),
    notFound: intl.formatMessage({
      defaultMessage:
        "Couldn't find that text box — it may have changed. Try again.",
      description: "Shown when the chosen text box no longer matches.",
    }),
    genericError: intl.formatMessage({
      defaultMessage: "Couldn't apply spacing.",
      description: "Generic error when applying spacing fails.",
    }),
  };

  const boxLabel = (box: TextBox) =>
    intl.formatMessage(
      {
        defaultMessage:
          "{snippet} · {count, plural, one {# paragraph} other {# paragraphs}}",
        description: "A text box option: snippet and paragraph count.",
      },
      { snippet: box.snippet, count: box.paragraphs },
    );

  const options = [
    { value: ALL, label: t.targetAll },
    ...boxes.map((box, i) => ({ value: String(i), label: boxLabel(box) })),
  ];

  const targetBox = target === ALL ? undefined : boxes[Number(target)];
  const applyingTo =
    target === ALL
      ? t.applyingToAll
      : intl.formatMessage(
          {
            defaultMessage: "Applying to: {snippet}",
            description: "Indicator showing which text box spacing targets.",
          },
          { snippet: targetBox?.snippet ?? "" },
        );

  const hasText = boxes.length > 0;
  const disabled = !canEdit || !hasText || isLoading;

  const onApply = async () => {
    setStatus(undefined);
    setIsLoading(true);
    let result: Status;
    try {
      await editContent(
        { contentType: "richtext", target: "current_page" },
        async (session) => {
          const ranges = session.contents.filter((r) => !r.deleted);

          let targets = ranges;
          if (target !== ALL) {
            const box = boxes[Number(target)];
            const match = box
              ? ranges.find((r) => r.readPlaintext() === box.text)
              : undefined;
            if (!match) {
              result = { tone: "warn", text: t.notFound };
              return;
            }
            targets = [match];
          }

          let changed = false;
          for (const range of targets) {
            const outcome = applyParagraphSpacing(range, size);
            changed = changed || outcome.changed;
          }
          if (!changed) {
            result = { tone: "warn", text: t.nothingToSpace };
            return;
          }
          await session.sync();
          result = { tone: "positive", text: t.success };
        },
      );
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

      {canEdit && hasText && (
        <Text size="small" tone="tertiary">
          {applyingTo}
        </Text>
      )}

      <FormField
        label={t.sizeLabel}
        description={t.sizeUnit}
        control={() => (
          <Rows spacing="1u">
            <Slider
              min={MIN_SIZE}
              max={MAX_SIZE}
              step={1}
              value={size}
              onChange={setSize}
            />
            <Columns spacing="1u" alignY="center">
              <Column width="fluid">
                <Text size="small" tone="tertiary">
                  {t.sizeValue}
                </Text>
              </Column>
              <Column width="content">
                <Button
                  variant="tertiary"
                  onClick={() => setSize(autoSize)}
                  disabled={size === autoSize}
                >
                  {t.autoButton}
                </Button>
              </Column>
            </Columns>
          </Rows>
        )}
      />

      <Button
        variant="primary"
        onClick={onApply}
        disabled={disabled}
        loading={isLoading}
        tooltipLabel={!canEdit ? t.unsupported : undefined}
        stretch
      >
        {t.applyButton}
      </Button>

      {canEdit && hasText && (
        <Accordion>
          <AccordionItem title={t.advancedTitle}>
            <Rows spacing="1u">
              <FormField
                label={t.targetLabel}
                control={() => (
                  <Select
                    stretch
                    value={target}
                    options={options}
                    onChange={(value) => setTarget(value)}
                  />
                )}
              />
              <Button
                variant="secondary"
                onClick={() => void scan()}
                loading={scanning}
                stretch
              >
                {t.rescan}
              </Button>
            </Rows>
          </AccordionItem>
        </Accordion>
      )}

      {!canEdit && <Alert tone="warn">{t.unsupported}</Alert>}
      {canEdit && !hasText && !scanning && (
        <Alert tone="info">{t.noText}</Alert>
      )}
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
    </Rows>
  );
};
