import {
  Alert,
  Button,
  Column,
  Columns,
  FormField,
  NumberInput,
  Rows,
  Slider,
  Text,
} from "@canva/app-ui-kit";
import { selection } from "@canva/design";
import type { SelectionEvent } from "@canva/design";
import { useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { applyParagraphSpacing } from "./applySpacing";

const MIN_SIZE = 4;
const MAX_SIZE = 80;
const DEFAULT_SIZE = 24;

type Status =
  | { tone: "positive" | "critical" | "warn"; text: string }
  | undefined;

export const SpacingPanel = () => {
  const intl = useIntl();
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [selectionCount, setSelectionCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<Status>(undefined);
  const eventRef = useRef<SelectionEvent<"richtext"> | undefined>(undefined);

  useEffect(() => {
    return selection.registerOnChange({
      scope: "richtext",
      onChange: (event) => {
        eventRef.current = event;
        setSelectionCount(event.count);
      },
    });
  }, []);

  const t = {
    intro: intl.formatMessage({
      defaultMessage:
        "Select a text box, then set how big the gap between paragraphs should be. The plugin adds an evenly-sized blank line between each paragraph.",
      description: "Intro/instructions for the paragraph spacing tool.",
    }),
    sizeLabel: intl.formatMessage({
      defaultMessage: "Space between paragraphs",
      description: "Label for the paragraph gap size control.",
    }),
    sizeUnit: intl.formatMessage({
      defaultMessage: "Size of the blank line, in pixels.",
      description: "Helper text describing the gap size control.",
    }),
    applyButton: intl.formatMessage({
      defaultMessage: "Apply spacing",
      description: "Button that applies paragraph spacing to the selection.",
    }),
    selectPrompt: intl.formatMessage({
      defaultMessage: "Select a text box to enable this tool.",
      description: "Shown when no text is selected.",
    }),
    success: intl.formatMessage({
      defaultMessage: "Spacing applied.",
      description: "Confirmation shown after spacing is applied.",
    }),
    nothingToSpace: intl.formatMessage({
      defaultMessage:
        "The selected text needs at least two paragraphs to space.",
      description: "Shown when the selection has fewer than two paragraphs.",
    }),
    genericError: intl.formatMessage({
      defaultMessage: "Couldn't apply spacing to the selection.",
      description: "Generic error when applying spacing fails.",
    }),
  };

  const hasSelection = selectionCount > 0;
  const disabled = !hasSelection || isLoading;

  const onApply = async () => {
    setStatus(undefined);
    const event = eventRef.current;
    if (!event || event.count === 0) {
      return;
    }
    setIsLoading(true);
    try {
      const draft = await event.read();
      let changed = false;
      for (const range of draft.contents) {
        const result = applyParagraphSpacing(range, size);
        changed = changed || result.changed;
      }
      if (!changed) {
        setStatus({ tone: "warn", text: t.nothingToSpace });
        return;
      }
      await draft.save();
      setStatus({ tone: "positive", text: t.success });
    } catch (e) {
      setStatus({
        tone: "critical",
        text: e instanceof Error ? e.message : t.genericError,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Rows spacing="2u">
      <Text>{t.intro}</Text>

      <FormField
        label={t.sizeLabel}
        description={t.sizeUnit}
        control={() => (
          <Columns spacing="1u" alignY="center">
            <Column width="fluid">
              <Slider
                min={MIN_SIZE}
                max={MAX_SIZE}
                step={1}
                value={size}
                onChange={setSize}
              />
            </Column>
            <Column width="content">
              <NumberInput
                value={size}
                min={MIN_SIZE}
                max={MAX_SIZE}
                step={1}
                onChange={(value) => {
                  if (value !== undefined) {
                    setSize(value);
                  }
                }}
              />
            </Column>
          </Columns>
        )}
      />

      <Button
        variant="primary"
        onClick={onApply}
        disabled={disabled}
        loading={isLoading}
        stretch
      >
        {t.applyButton}
      </Button>

      {!hasSelection && <Alert tone="info">{t.selectPrompt}</Alert>}
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
    </Rows>
  );
};
