// Benannte Bereiche zu einem Screenshot. Quelle sind die Dateien in data/regions, die
// scripts/regions.mjs aus dem HTML eines Laufs erzeugt (nur private Fassung), und regions.json neben dem Bild,
// wie es der Skill page-shots schreibt.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ROOT, paths } from "../shared/config.ts";
import type { Region } from "../shared/contracts.ts";

const run = promisify(execFile);

export type RegionView = { scale: number; regions: Region[] };
type RegionFile = { source?: string; views: Record<string, { image: string; scale: number; regions: Region[] }> };

/** Liest alle Bereichsdateien und ordnet sie dem Bildpfad zu. */
export async function loadRegionIndex(dir = paths.regions()): Promise<Map<string, RegionView>> {
  const index = new Map<string, RegionView>();
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return index;
  }
  for (const f of files) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as RegionFile;
      for (const view of Object.values(data.views ?? {})) index.set(view.image, { scale: view.scale, regions: view.regions });
    } catch {
      // kaputte Datei: Bilder daraus haben eben keine Bereiche
    }
  }
  return index;
}

/** Ordner eines Laufs mit eigenem HTML: …/runs/<marke>/<lauf>/shots/<ansicht>.png (nur private Fassung). */
export function runDirOf(imagePath: string): string | null {
  const m = imagePath.match(/^(.*\/runs\/[^/]+\/[^/]+)\/shots\/(desktop|mobile)\.png$/);
  return m?.[1] ?? null;
}

/** Bereiche aus `regions.json` neben dem Bild, wie sie der Skill page-shots schreibt. */
async function siblingRegions(imagePath: string, index: Map<string, RegionView>): Promise<RegionView | null> {
  try {
    const data = JSON.parse(await fs.readFile(path.join(path.dirname(imagePath), "regions.json"), "utf8")) as RegionFile;
    for (const view of Object.values(data.views ?? {})) index.set(view.image, { scale: view.scale, regions: view.regions });
  } catch {
    return null;
  }
  return index.get(imagePath) ?? null;
}

/**
 * Bereiche zu einem Bild, das schon auf einer Fläche liegt: aus dem Index oder aus regions.json daneben.
 * Erzeugt nichts. Nötig nach einem Neustart, denn der Index kennt nur data/regions.
 */
export async function knownRegions(imagePath: string, index: Map<string, RegionView>): Promise<RegionView | null> {
  return index.get(imagePath) ?? (await siblingRegions(imagePath, index));
}

/** Adresse und Ansicht eines Screenshots aus page-shots (regions.json daneben), sonst null. */
export async function pageOrigin(imagePath: string): Promise<{ source: string; view: string } | null> {
  try {
    const data = JSON.parse(await fs.readFile(path.join(path.dirname(imagePath), "regions.json"), "utf8")) as RegionFile;
    const view = Object.entries(data.views ?? {}).find(([, v]) => v.image === imagePath)?.[0];
    return data.source && view ? { source: data.source, view } : null;
  } catch {
    return null;
  }
}

/** Sorgt dafür, dass es Bereiche zum Bild gibt: bekannt, neben dem Bild (page-shots) oder aus dem HTML eines Laufs. */
export async function ensureRegions(imagePath: string, index: Map<string, RegionView>): Promise<RegionView | null> {
  const known = await knownRegions(imagePath, index);
  if (known) return known;
  const runDir = runDirOf(imagePath);
  // Nur in der privaten Fassung: Läufe mit eigenem HTML (scripts/regions.mjs ist im öffentlichen Repo nicht dabei).
  const script = path.join(ROOT, "scripts/regions.mjs");
  if (!runDir || !(await fs.access(script).then(() => true, () => false))) return null;
  try {
    await fs.access(path.join(runDir, "index.html"));
  } catch {
    return null;
  }
  // In Electron ist process.execPath die App selbst; ELECTRON_RUN_AS_NODE macht daraus ein reines Node.
  await run(process.execPath, [script, runDir], { cwd: ROOT, timeout: 60_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  const fresh = await loadRegionIndex();
  for (const [image, view] of fresh) index.set(image, view);
  return index.get(imagePath) ?? null;
}
