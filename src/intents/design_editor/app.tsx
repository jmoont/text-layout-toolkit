import {
  ChevronRightIcon,
  GridIcon,
  ImageIcon,
  Menu,
  MenuItem,
  Rows,
  SurfaceHeader,
  Text,
  TextSpacingIcon,
  Title,
} from "@canva/app-ui-kit";
import type { IconElement } from "@canva/app-ui-kit";
import { useState } from "react";
import { useIntl } from "react-intl";
import * as styles from "styles/components.css";
import { QrPanel } from "./features/qr/QrPanel";
import { SpacingPanel } from "./features/spacing/SpacingPanel";
import { WrapPanel } from "./features/wrap/WrapPanel";

type ToolId = "spacing" | "wrap" | "qr";
type View = "home" | ToolId;

type Tool = {
  id: ToolId;
  title: string;
  description: string;
  icon: () => IconElement;
  render: () => React.JSX.Element;
};

export const App = () => {
  const intl = useIntl();
  const [view, setView] = useState<View>("home");

  const t = {
    appTitle: intl.formatMessage({
      defaultMessage: "Text & Layout Toolkit",
      description: "Name of the app, shown on the home screen.",
    }),
    appIntro: intl.formatMessage({
      defaultMessage:
        "A set of tools for things Canva can't do on its own. Pick a tool to get started.",
      description: "Intro paragraph on the home screen.",
    }),
    backLabel: intl.formatMessage({
      defaultMessage: "Back to tools",
      description: "Accessibility label for the back button on a tool screen.",
    }),
    spacingTitle: intl.formatMessage({
      defaultMessage: "Paragraph spacing",
      description: "Title of the paragraph spacing tool.",
    }),
    spacingDescription: intl.formatMessage({
      defaultMessage: "Add even spacing between paragraphs in a text box.",
      description: "One-line description of the paragraph spacing tool.",
    }),
    wrapTitle: intl.formatMessage({
      defaultMessage: "Wrap text around image",
      description: "Title of the wrap-text tool.",
    }),
    wrapDescription: intl.formatMessage({
      defaultMessage: "Flow a paragraph around an overlapping image.",
      description: "One-line description of the wrap-text tool.",
    }),
    qrTitle: intl.formatMessage({
      defaultMessage: "QR code",
      description: "Title of the QR code tool.",
    }),
    qrDescription: intl.formatMessage({
      defaultMessage: "Add a crisp vector QR code to your design.",
      description: "One-line description of the QR code tool.",
    }),
  };

  const tools: Tool[] = [
    {
      id: "spacing",
      title: t.spacingTitle,
      description: t.spacingDescription,
      icon: TextSpacingIcon,
      render: () => <SpacingPanel />,
    },
    {
      id: "wrap",
      title: t.wrapTitle,
      description: t.wrapDescription,
      icon: ImageIcon,
      render: () => <WrapPanel />,
    },
    {
      id: "qr",
      title: t.qrTitle,
      description: t.qrDescription,
      icon: GridIcon,
      render: () => <QrPanel />,
    },
  ];

  if (view === "home") {
    return (
      <div className={styles.scrollContainer}>
        <Rows spacing="2u">
          <Title size="small">{t.appTitle}</Title>
          <Text>{t.appIntro}</Text>
          <Menu ariaLabel={t.appTitle}>
            {tools.map((tool) => (
              <MenuItem
                key={tool.id}
                label={tool.title}
                description={tool.description}
                start={tool.icon}
                end={ChevronRightIcon}
                onClick={() => setView(tool.id)}
              />
            ))}
          </Menu>
        </Rows>
      </div>
    );
  }

  const active = tools.find((tool) => tool.id === view);
  if (!active) {
    // Should never happen; fall back to home.
    setView("home");
    return null;
  }

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="2u">
        <SurfaceHeader
          title={active.title}
          start={{ ariaLabel: t.backLabel, onClick: () => setView("home") }}
        />
        {active.render()}
      </Rows>
    </div>
  );
};
