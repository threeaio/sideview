// Generates the test fixtures in test/fixtures/page/: two full-page screenshots of a made-up landing page,
// as the page-shots skill would take them (desktop 1440 wide, mobile 390 @2x), plus regions.json.
// Deterministic: no text rendering (type is drawn as bars), no randomness. The PNGs are committed, so tests
// never need this script; run it only to change the fixtures: node test/fixtures/make.mjs

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "page");
const SOURCE = "https://fixture.example/";

const C = { paper: "#f4f1ea", ink: "#1f1d1a", soft: "#d9d3c7", accent: "#e2562b", band: "#22313f", bandInk: "#e9e4da", tile: "#ebe6dc" };

/** A line of "type" as a rounded bar. */
const bar = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(h / 3)}" fill="${fill}"/>`;

/** A paragraph: `lines` bars, the last one shorter. */
function para(x, y, width, lines, size, fill, gap = 1.7) {
  let out = "";
  for (let i = 0; i < lines; i++) out += bar(x, Math.round(y + i * size * gap), i === lines - 1 ? Math.round(width * 0.62) : width, size, fill);
  return out;
}

/** A photo placeholder: a soft gradient with a horizon, so crops are not flat. */
function photo(id, x, y, w, h) {
  return (
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9b79a"/><stop offset="1" stop-color="#6d7f86"/></linearGradient></defs>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="url(#${id})"/>` +
    `<path d="M${x} ${y + h * 0.7} L${x + w * 0.35} ${y + h * 0.48} L${x + w * 0.6} ${y + h * 0.62} L${x + w} ${y + h * 0.4} L${x + w} ${y + h} L${x} ${y + h} Z" fill="#3e4a4f" opacity="0.55"/>`
  );
}

/**
 * One page as SVG. `u` is one CSS pixel in image pixels (2 on mobile), `W` the CSS width.
 * Returns the SVG and the regions in CSS pixels.
 */
function page({ W, mobile }) {
  const pad = mobile ? 20 : 120;
  const inner = W - 2 * pad;
  const parts = [];
  const regions = [];
  let y = 0;
  const section = (kind, label, heading, aliases, height, draw, fill = C.paper) => {
    parts.push(`<rect x="0" y="${y}" width="${W}" height="${height}" fill="${fill}"/>`);
    parts.push(draw(y, height));
    regions.push({ kind, label, heading, aliases, rect: [0, y, W, height] });
    y += height;
  };

  // Header: navigation and hero
  section("head", "Kopf", "Northwind Coffee", ["kopf", "oben"], mobile ? 760 : 820, (top, h) => {
    let s = bar(pad, top + 32, mobile ? 120 : 160, 24, C.ink);
    if (!mobile) for (let i = 0; i < 4; i++) s += bar(W - pad - 460 + i * 120, top + 38, 80, 12, C.ink);
    else s += bar(W - pad - 28, top + 34, 28, 4, C.ink) + bar(W - pad - 28, top + 44, 28, 4, C.ink);
    const textW = mobile ? inner : 560;
    s += para(pad, top + (mobile ? 130 : 220), textW, mobile ? 3 : 2, mobile ? 34 : 56, C.ink, 1.35);
    s += para(pad, top + (mobile ? 290 : 400), textW, 3, mobile ? 12 : 16, C.ink);
    s += bar(pad, top + (mobile ? 380 : 520), mobile ? 160 : 200, mobile ? 44 : 52, C.accent);
    s += mobile ? photo("hero", pad, top + 460, inner, h - 500) : photo("hero", 760, top + 140, W - 760 - pad, h - 220);
    return s;
  });

  // Features: three tiles
  section("section", "Roasted on Monday, at your door by Thursday", "Roasted on Monday, at your door by Thursday", ["features"], mobile ? 1260 : 1200, (top) => {
    let s = para(pad, top + 120, mobile ? inner : 720, 2, mobile ? 26 : 40, C.ink, 1.4);
    const cols = mobile ? 1 : 3;
    const gap = 32;
    const tw = (inner - gap * (cols - 1)) / cols;
    const th = mobile ? 300 : 640;
    for (let i = 0; i < 3; i++) {
      const tx = pad + (i % cols) * (tw + gap);
      const ty = top + (mobile ? 260 : 300) + Math.floor(i / cols) * (th + gap);
      s += `<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="16" fill="${C.tile}"/>`;
      s += bar(tx + 28, ty + 32, 48, 48, C.accent);
      s += para(tx + 28, ty + 120, tw - 56, 1, 22, C.ink);
      s += para(tx + 28, ty + 170, tw - 56, mobile ? 3 : 6, 14, C.ink);
    }
    return s;
  });

  // How it works: dark band with steps
  section(
    "section",
    "How it works",
    "How it works",
    ["steps"],
    mobile ? 1100 : 1280,
    (top) => {
      let s = para(pad, top + 120, mobile ? inner : 520, 1, mobile ? 28 : 40, C.bandInk);
      for (let i = 0; i < 3; i++) {
        const sy = top + (mobile ? 230 : 260) + i * (mobile ? 280 : 320);
        s += `<circle cx="${pad + 28}" cy="${sy + 28}" r="28" fill="${C.accent}"/>`;
        s += para(pad + 90, sy + 12, mobile ? inner - 90 : 600, 1, 22, C.bandInk);
        s += para(pad + 90, sy + 60, mobile ? inner - 90 : 600, 3, 14, C.soft);
        if (!mobile) s += photo(`step${i}`, 840, sy, W - 840 - pad, 260);
      }
      return s;
    },
    C.band,
  );

  // Pricing: plans
  section("section", "Pick a plan", "Pick a plan", ["pricing"], mobile ? 1500 : 1200, (top) => {
    let s = para(pad, top + 120, mobile ? inner : 480, 1, mobile ? 28 : 40, C.ink);
    const cols = mobile ? 1 : 3;
    const gap = 32;
    const pw = (inner - gap * (cols - 1)) / cols;
    const ph = mobile ? 380 : 760;
    for (let i = 0; i < 3; i++) {
      const px = pad + (i % cols) * (pw + gap);
      const py = top + 240 + Math.floor(i / cols) * (ph + gap);
      s += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="16" fill="${i === 1 ? C.ink : C.tile}"/>`;
      const ink = i === 1 ? C.bandInk : C.ink;
      s += para(px + 32, py + 40, pw * 0.5, 1, 20, ink);
      s += para(px + 32, py + 100, pw * 0.4, 1, mobile ? 40 : 56, ink);
      for (let k = 0; k < (mobile ? 3 : 6); k++) s += bar(px + 32, py + (mobile ? 170 : 230) + k * (mobile ? 36 : 48), pw - 64, 12, ink);
      s += bar(px + 32, py + ph - 92, pw - 64, 52, i === 1 ? C.accent : C.ink);
    }
    return s;
  });

  // Questions: accordion rows
  section("section", "Questions", "Questions", ["faq"], mobile ? 900 : 900, (top) => {
    let s = para(pad, top + 120, mobile ? inner : 400, 1, mobile ? 28 : 40, C.ink);
    for (let i = 0; i < 6; i++) {
      const ry = top + (mobile ? 220 : 240) + i * (mobile ? 104 : 96);
      s += `<rect x="${pad}" y="${ry + (mobile ? 92 : 84)}" width="${inner}" height="2" fill="${C.soft}"/>`;
      s += bar(pad, ry + 30, mobile ? inner * 0.75 : 640, 18, C.ink);
      s += bar(W - pad - 24, ry + 38, 24, 4, C.ink);
    }
    return s;
  });

  // Footer
  section(
    "foot",
    "Fuß",
    "Northwind Coffee",
    ["fuss", "unten"],
    mobile ? 640 : 600,
    (top) => {
      let s = bar(pad, top + 100, 160, 24, C.bandInk);
      const cols = mobile ? 2 : 4;
      for (let c = 0; c < cols; c++) for (let r = 0; r < 4; r++) s += bar(pad + (mobile ? 0 : 520) + c * (mobile ? inner / 2 : 180), top + (mobile ? 180 : 100) + r * 40, 110, 12, C.soft);
      s += bar(pad, top + (mobile ? 540 : 500), mobile ? inner : 420, 10, C.soft);
      return s;
    },
    C.ink,
  );

  return { width: W, height: y, body: parts.join(""), regions };
}

async function render(view, { W, scale, mobile }) {
  const p = page({ W, mobile });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${p.width * scale}" height="${p.height * scale}" viewBox="0 0 ${p.width} ${p.height}">${p.body}</svg>`;
  const file = path.join(OUT, `${view}.png`);
  await sharp(Buffer.from(svg), { limitInputPixels: false }).png({ palette: true, colours: 64, compressionLevel: 9, effort: 10 }).toFile(file);
  const regions = p.regions.map((r) => ({ ...r, rect: r.rect.map((v) => Math.round(v * scale)) }));
  const { size } = await fs.stat(file);
  console.log(`${view}.png ${p.width * scale} × ${p.height * scale} px, ${Math.round(size / 1024)} KB`);
  // page-shots writes absolute paths; the fixture keeps the file name, tests resolve it (see stage.ts).
  return { image: `${view}.png`, scale, regions };
}

await fs.mkdir(OUT, { recursive: true });
const views = {
  desktop: await render("desktop", { W: 1440, scale: 1, mobile: false }),
  mobile: await render("mobile", { W: 390, scale: 2, mobile: true }),
};
await fs.writeFile(path.join(OUT, "regions.json"), JSON.stringify({ source: SOURCE, createdAt: "2026-11-22T12:00:00.000Z", views }, null, 2) + "\n");
console.log("regions.json written");
