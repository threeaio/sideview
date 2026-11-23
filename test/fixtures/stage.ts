// Copies the page-shots fixture (test/fixtures/page) into a folder and writes regions.json there with absolute
// image paths, exactly as the page-shots skill leaves it. The canvas then reads regions and origin by itself.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "page");

/** Size of the fixture images in pixels. */
export const DESKTOP_SIZE = { width: 1440, height: 6000 } as const;
export const MOBILE_SIZE = { width: 780, height: 12320 } as const;

type RegionFile = { source: string; createdAt: string; views: Record<string, { image: string; scale: number; regions: unknown[] }> };

/** Stages the fixture in `dir` and returns the absolute image paths. */
export async function stagePageShots(dir: string): Promise<{ desktop: string; mobile: string; source: string }> {
  await fs.mkdir(dir, { recursive: true });
  const data = JSON.parse(await fs.readFile(path.join(FIXTURE_DIR, "regions.json"), "utf8")) as RegionFile;
  for (const view of Object.values(data.views)) {
    const target = path.join(dir, view.image);
    await fs.copyFile(path.join(FIXTURE_DIR, view.image), target);
    view.image = target;
  }
  await fs.writeFile(path.join(dir, "regions.json"), JSON.stringify(data, null, 2));
  return { desktop: path.join(dir, "desktop.png"), mobile: path.join(dir, "mobile.png"), source: data.source };
}
