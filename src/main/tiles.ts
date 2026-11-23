// Kacheln je Bild, abgelegt in data/tiles/<schlüssel>/. Der Schlüssel hängt an Pfad, Größe und Änderungszeit;
// ändert sich die Datei, entstehen neue Kacheln. Erzeugt wird in einem eigenen Prozess (tiles-worker.ts).

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ROOT, config } from "../shared/config.ts";
import type { TileManifest } from "../shared/contracts.ts";

const run = promisify(execFile);
const tilesDir = () => path.join(config.dataDir, "tiles");

export async function tileKeyFor(imagePath: string): Promise<string> {
  const stat = await fs.stat(imagePath);
  return createHash("sha1").update(`${imagePath}|${stat.size}|${Math.round(stat.mtimeMs)}`).digest("hex").slice(0, 16);
}

const cache = new Map<string, Promise<TileManifest>>();

/** Kacheln zum Bild, falls nötig erzeugt (rund eine Sekunde für einen ganzseitigen Screenshot). */
export function ensureTiles(imagePath: string): Promise<TileManifest> {
  return tileKeyFor(imagePath).then((key) => {
    let job = cache.get(key);
    if (!job) {
      job = load(key, imagePath);
      cache.set(key, job);
      job.catch(() => cache.delete(key));
    }
    return job;
  });
}

async function load(key: string, imagePath: string): Promise<TileManifest> {
  const dir = path.join(tilesDir(), key);
  try {
    return JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8")) as TileManifest;
  } catch {
    // noch keine Kacheln
  }
  await fs.mkdir(tilesDir(), { recursive: true });
  // In Electron ist process.execPath die App selbst; ELECTRON_RUN_AS_NODE macht daraus ein reines Node.
  await run(process.execPath, [path.join(ROOT, "src/main/tiles-worker.ts"), imagePath, dir, key], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    timeout: 120_000,
  });
  return JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8")) as TileManifest;
}

/** Datei einer Kachel, nur innerhalb von data/tiles/<schlüssel>/image_files. Sonst null. */
export function tileFile(key: string, rest: string): string | null {
  if (!/^[0-9a-f]{16}$/.test(key) || !/^\d+\/\d+_\d+\.png$/.test(rest)) return null;
  return path.join(tilesDir(), key, "image_files", rest);
}
