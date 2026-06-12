import {
  Alert,
  Button,
  FormField,
  Rows,
  Swatch,
  Switch,
  Text,
  TextInput,
} from "@canva/app-ui-kit";
import { useFeatureSupport } from "@canva/app-hooks";
import type {
  Anchor,
  ColorSelectionEvent,
  ColorSelectionScope,
} from "@canva/asset";
import { openColorSelector, upload } from "@canva/asset";
import { addElementAtPoint } from "@canva/design";
import { useState } from "react";
import { useIntl } from "react-intl";
import { buildQrSvg, svgToDataUrl } from "./qr";

const DEFAULT_FG = "#000000";
const DEFAULT_BG = "#FFFFFF";
const QR_SIZE_PX = 400;

type Target = "fg" | "bg";

export const QrPanel = () => {
  const intl = useIntl();
  const isSupported = useFeatureSupport();
  const canInsert = isSupported(addElementAtPoint);

  const [url, setUrl] = useState("");
  const [fgColor, setFgColor] = useState<string>(DEFAULT_FG);
  const [bgColor, setBgColor] = useState<string>(DEFAULT_BG);
  const [transparentBg, setTransparentBg] = useState(true);
  const [quietZone, setQuietZone] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const trimmedUrl = url.trim();
  const disabled = !canInsert || trimmedUrl.length === 0 || isLoading;

  const t = {
    intro: intl.formatMessage({
      defaultMessage:
        "Enter a URL, choose your colors, and add a vector QR code to your design. Resize it on the canvas without losing quality.",
      description: "Intro paragraph explaining what the app does.",
    }),
    urlLabel: intl.formatMessage({
      defaultMessage: "URL",
      description: "Label for the URL text input.",
    }),
    urlPlaceholder: intl.formatMessage({
      defaultMessage: "https://example.com",
      description: "Placeholder shown in the URL text input.",
    }),
    fgLabel: intl.formatMessage({
      defaultMessage: "Foreground color",
      description: "Label for the foreground (modules) color picker.",
    }),
    bgLabel: intl.formatMessage({
      defaultMessage: "Background color",
      description: "Label for the background color picker.",
    }),
    transparentLabel: intl.formatMessage({
      defaultMessage: "Transparent background",
      description: "Switch label to make the QR background transparent.",
    }),
    transparentDescription: intl.formatMessage({
      defaultMessage: "Skip the background — the design behind shows through.",
      description: "Helper text for the transparent background switch.",
    }),
    quietZoneLabel: intl.formatMessage({
      defaultMessage: "Quiet zone",
      description: "Switch label for the quiet-zone (margin) toggle.",
    }),
    quietZoneDescription: intl.formatMessage({
      defaultMessage:
        "Add a margin around the code. Recommended for reliable scanning.",
      description: "Helper text for the quiet zone switch.",
    }),
    addButton: intl.formatMessage({
      defaultMessage: "Add QR code",
      description: "Primary button to add the QR code to the design.",
    }),
    unsupportedTooltip: intl.formatMessage({
      defaultMessage: "Adding elements isn't supported in the current design.",
      description: "Tooltip when add-element APIs aren't supported here.",
    }),
    unsupportedAlert: intl.formatMessage({
      defaultMessage:
        "Adding elements isn't supported in the current design type.",
      description: "Alert shown when the host design doesn't support inserts.",
    }),
    genericError: intl.formatMessage({
      defaultMessage: "Failed to add QR code to design.",
      description: "Generic fallback error when insertion fails.",
    }),
  };

  const openPicker = (target: Target, anchor: Anchor) => {
    openColorSelector(anchor, {
      scopes: ["solid"],
      onColorSelect: (e: ColorSelectionEvent<ColorSelectionScope>) => {
        if (e.selection.type !== "solid") {
          return;
        }
        if (target === "fg") {
          setFgColor(e.selection.hexString);
        } else {
          setBgColor(e.selection.hexString);
        }
      },
    });
  };

  const onAdd = async () => {
    setError(undefined);
    setIsLoading(true);
    try {
      const svg = buildQrSvg({
        url: trimmedUrl,
        fgColor,
        bgColor,
        transparentBg,
        quietZone,
      });
      const dataUrl = svgToDataUrl(svg);

      const queued = await upload({
        type: "image",
        mimeType: "image/svg+xml",
        url: dataUrl,
        thumbnailUrl: dataUrl,
        aiDisclosure: "none",
      });

      await addElementAtPoint({
        type: "image",
        ref: queued.ref,
        altText: {
          text: intl.formatMessage(
            {
              defaultMessage: "QR code for {url}",
              description: "Alt text for the inserted QR image.",
            },
            { url: trimmedUrl },
          ),
          decorative: false,
        },
        top: 0,
        left: 0,
        width: QR_SIZE_PX,
        height: QR_SIZE_PX,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t.genericError);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Rows spacing="2u">
      <Text>{t.intro}</Text>

      <FormField
        label={t.urlLabel}
        value={url}
        control={(props) => (
          <TextInput
            {...props}
            placeholder={t.urlPlaceholder}
            onChange={setUrl}
          />
        )}
      />

      <FormField
        label={t.fgLabel}
        control={() => (
          <Swatch
            fill={[fgColor]}
            onClick={(e) =>
              openPicker("fg", e.currentTarget.getBoundingClientRect())
            }
          />
        )}
      />

      <FormField
        label={t.bgLabel}
        control={() => (
          <Swatch
            fill={[bgColor]}
            disabled={transparentBg}
            onClick={(e) =>
              openPicker("bg", e.currentTarget.getBoundingClientRect())
            }
          />
        )}
      />

      <Switch
        label={t.transparentLabel}
        description={t.transparentDescription}
        value={transparentBg}
        onChange={setTransparentBg}
      />

      <Switch
        label={t.quietZoneLabel}
        description={t.quietZoneDescription}
        value={quietZone}
        onChange={setQuietZone}
      />

      <Button
        variant="primary"
        onClick={onAdd}
        disabled={disabled}
        loading={isLoading}
        tooltipLabel={!canInsert ? t.unsupportedTooltip : undefined}
        stretch
      >
        {t.addButton}
      </Button>

      {error && <Alert tone="critical">{error}</Alert>}
      {!canInsert && <Alert tone="warn">{t.unsupportedAlert}</Alert>}
    </Rows>
  );
};
