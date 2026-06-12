# Text & Layout Kit (Canva app)

A Canva app that bundles three tools for things the Canva editor can't do natively:

- **Paragraph spacing** — adds an evenly-sized blank line between paragraphs of a selected text box. Canva exposes no line-spacing API, so this automates the usual manual workaround (insert a blank line, then change its font size to control the gap).
- **Wrap text around an image** — adds line breaks (and, for a left-side image, leading spaces) so a paragraph flows around an overlapping image.
- **QR code** — generates an editable, vector (SVG) QR code from a URL, with color and quiet-zone options.

Built on the [Canva Apps SDK starter kit](https://www.canva.dev/docs/apps/) (React + TypeScript + webpack, `@canva/app-ui-kit`, `@canva/design`).

## Requirements

- Node.js `v24` and npm `v11` (pinned in [.nvmrc](./.nvmrc) as `lts/krypton`; `engine-strict` is on).
  - With nvm: `nvm install && nvm use`.
  - Or with Homebrew: `brew install node@24` and put `/opt/homebrew/opt/node@24/bin` on your `PATH`.

## Quick start

```bash
npm install
npm start      # local dev server on http://localhost:8080
```

Then open the app in Canva via **Preview** in the Developer Portal (paste your app's `.env` credentials first — Developer Portal → your app → Security → Credentials).

## Architecture

A single Canva **Design Editor intent**. `src/intents/design_editor/app.tsx` is a home screen that routes to three feature modules:

```
src/intents/design_editor/
  app.tsx                       # home screen + tool navigation (SurfaceHeader/back)
  features/
    spacing/
      SpacingPanel.tsx          # slider + numeric input; selection-aware
      applySpacing.ts           # pure: non-destructive paragraph-gap normalisation
    wrap/
      WrapPanel.tsx             # side/gutter controls; openDesign integration
      computeWrap.ts            # pure: geometry + greedy reflow
      measureText.ts            # canvas-backed width estimation
    qr/
      QrPanel.tsx               # URL + colors + options
      qr.ts                     # pure: QR → SVG → data URL
```

### How each tool talks to Canva

- **Spacing** uses the **Selection API** (`selection.registerOnChange({ scope: "richtext" })` → `event.read()` → mutate the `RichtextRange` → `draft.save()`). Font size is a paragraph-level property, so the blank line is its own empty paragraph sized via `formatParagraph`. The algorithm edits in place and never rewrites content paragraphs, so their formatting is preserved.
- **Wrap** uses the **Design Editing API** (`openDesign({ type: "current_page" })`) to read element positions, finds the text box and image with the greatest overlap, reflows the text, writes it back, and `session.sync()`s. Only works on fixed/absolute pages.
- **QR** builds an SVG locally and inserts it with `@canva/asset` `upload` + `addElementAtPoint`.

### The wrapping caveat

Canva exposes **no text-measurement API**, so `computeWrap` estimates line widths with a canvas `measureText` using a generic font family (the real Canva font usually can't be loaded in the iframe). Wrapping is therefore **approximate** and may need manual adjustment; it's re-runnable and undo-safe.

## Scripts

```bash
npm test           # jest unit tests (pure logic for all three tools)
npm run lint       # eslint
npm run lint:types # tsc --noEmit
npm run build      # production build
```

## Hosted policy pages

`docs/` is a static site (privacy policy, terms, support, landing) served via GitHub Pages from the public companion repo. The Privacy Policy / Terms URLs are required for Canva Marketplace submission. Everything in the app runs client-side; no data is collected or sent anywhere except Canva.
