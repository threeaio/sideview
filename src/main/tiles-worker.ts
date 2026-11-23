// Erzeugt eine Deep-Zoom-Kachelpyramide für ein Bild. Läuft als eigener Prozess, damit libvips den
// Hauptprozess der App nicht blockiert. Aufruf: node tiles-worker.ts <bild> <zielordner>
// Ergebnis: <ziel>/image_files/<stufe>/<spalte>_<zeile>.png und <ziel>/manifest.json.
// Kacheln 512 px mit 3 px Überlappung (reicht für den bikubischen Filter), PNG, verlustfrei für Schrift.

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { TileManifest } from "../shared/contracts.ts";

export const TILE_SIZE = 512;
export const OVERLAP = 3;

/** Maße jeder Stufe: Stufe L hat ceil(Breite / 2^(maxLevel - L)) Pixel, maxLevel = ceil(log2(max(Breite, Höhe))). */
export function pyramidLevels(width: number, height: number, tileSize = TILE_SIZE): TileManifest["levels"] {
  const maxLevel = Math.ceil(Math.log2(Math.max(width, height)));
  const levels: TileManifest["levels"] = [];
  for (let level = 0; level <= maxLevel; level++) {
    const k = maxLevel - level;
    const w = Math.ceil(width / 2 ** k);
    const h = Math.ceil(height / 2 ** k);
    levels.push({ level, width: w, height: h, cols: Math.ceil(w / tileSize), rows: Math.ceil(h / tileSize) });
  }
  return levels;
}

export async function makeTiles(input: string, outDir: string, key: string): Promise<TileManifest> {
  const tmp = `${outDir}.tmp-${process.pid}`;
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp, { recursive: true });
  const meta = await sharp(input, { limitInputPixels: false }).metadata();
  if (!meta.width || !meta.height) throw new Error(`no size: ${input}`);
  await sharp(input, { limitInputPixels: false })
    .png({ compressionLevel: 6, adaptiveFiltering: false })
    .tile({ size: TILE_SIZE, overlap: OVERLAP, layout: "dz" })
    .toFile(path.join(tmp, "image.dz"));
  const levels = pyramidLevels(meta.width, meta.height);
  const manifest: TileManifest = {
    key,
    width: meta.width,
    height: meta.height,
    tileSize: TILE_SIZE,
    overlap: OVERLAP,
    format: "png",
    maxLevel: levels.length - 1,
    levels,
  };
  await fs.writeFile(path.join(tmp, "manifest.json"), JSON.stringify(manifest));
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.rename(tmp, outDir);
  return manifest;
}

if (import.meta.main) {
  const [input, outDir, key] = process.argv.slice(2);
  if (!input || !outDir || !key) {
    console.error("Aufruf: node tiles-worker.ts <bild> <zielordner> <schlüssel>");
    process.exit(2);
  }
  makeTiles(input, outDir, key).then(
    () => process.exit(0),
    (e) => {
      console.error(String(e));
      process.exit(1);
    },
  );
}
