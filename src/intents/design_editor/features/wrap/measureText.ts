import type { FontSpec, MeasureText } from "./computeWrap";

/**
 * Builds a canvas-backed text measurer. Canva exposes no text-measurement API,
 * so we approximate using the 2D canvas `measureText`, matching the font size
 * and weight as closely as we can. The exact Canva font usually can't be loaded
 * inside the app iframe, so a generic family is used as a fallback — this is the
 * main source of wrapping inaccuracy.
 */
export function createCanvasMeasurer(): MeasureText {
  let ctx: CanvasRenderingContext2D | null | undefined;

  return (text: string, font: FontSpec): number => {
    if (ctx === undefined) {
      ctx = document.createElement("canvas").getContext("2d");
    }
    if (!ctx) {
      // Canvas unavailable (e.g. in a non-DOM environment): rough fallback.
      return text.length * font.fontSizePx * 0.5;
    }
    const family = font.fontFamily ?? "sans-serif";
    const weight = font.fontWeight ?? "normal";
    ctx.font = `${weight} ${font.fontSizePx}px ${family}`;
    return ctx.measureText(text).width;
  };
}
