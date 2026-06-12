import QRCode from "qrcode";

export type QrOptions = {
  url: string;
  fgColor: string;
  bgColor: string;
  transparentBg: boolean;
  quietZone: boolean;
};

const QUIET_ZONE_MODULES = 4;

export function buildQrSvg(opts: QrOptions): string {
  const qr = QRCode.create(opts.url, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const margin = opts.quietZone ? QUIET_ZONE_MODULES : 0;
  const view = size + margin * 2;

  const rects: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y * size + x]) {
        rects.push(
          `<rect x="${x + margin}" y="${y + margin}" width="1" height="1"/>`,
        );
      }
    }
  }

  const bg = opts.transparentBg
    ? ""
    : `<rect width="${view}" height="${view}" fill="${escapeAttr(opts.bgColor)}"/>`;
  const fg = `<g fill="${escapeAttr(opts.fgColor)}" shape-rendering="crispEdges">${rects.join("")}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view} ${view}">${bg}${fg}</svg>`;
}

export function svgToDataUrl(svg: string): string {
  // base64-encode for the strictest dataUrl validators (Canva requires ;base64
  // for data URLs).
  const base64 =
    typeof btoa === "function"
      ? btoa(unicodeToLatin1(svg))
      : Buffer.from(svg, "utf-8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}

function unicodeToLatin1(input: string): string {
  // btoa requires latin-1 input; URLs we generate are ASCII, but be safe.
  return unescape(encodeURIComponent(input));
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
