// Gemeinsame Orte und Ports von App und MCP-Server. Beide lesen dieselben Umgebungsvariablen.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT } from "./brand.ts";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Läuft aus der installierten App (/Applications/<Name>.app), nicht aus dem Repo. */
export const INSTALLED = /\.app\/Contents\/Resources\/app\/?$/.test(ROOT);

/** Eingerichtet über `npx … init`: eine Kopie unter <Daten>/app mit der Marke `.user-install`. */
export const USER_INSTALL = fs.existsSync(path.join(ROOT, ".user-install"));

/** Datenordner einer installierten App, je Benutzer. */
export const userDataDir = (home = os.homedir()) => path.join(home, "Library/Application Support", PRODUCT);

/** Frühere Namen der App, deren Datenordner beim ersten Start unter neuem Namen übernommen wird. */
export const FORMER_PRODUCTS = ["Canvas"];

/**
 * Übernimmt den Datenordner einer früheren App (23.11.: Canvas → Sideview): verschiebt ihn und legt am alten Ort einen
 * Verweis an. So bleiben absolute Pfade in den Canvas-Dateien (eingefügte Bilder, Importe) und Skripte, die den alten
 * Ort kennen, gültig. Tut nichts, wenn der neue Ordner schon da ist oder der alte schon ein Verweis ist.
 */
export function adoptFormerData(home = os.homedir(), product = PRODUCT, former = FORMER_PRODUCTS, f: Pick<typeof fs, "existsSync" | "lstatSync" | "renameSync" | "symlinkSync"> = fs): string | null {
  const target = path.join(home, "Library/Application Support", product);
  if (f.existsSync(target)) return null;
  for (const name of former) {
    if (name === product) continue;
    const old = path.join(home, "Library/Application Support", name);
    try {
      if (!f.lstatSync(old).isDirectory()) continue;
      f.renameSync(old, target);
      f.symlinkSync(target, old);
      return old;
    } catch {
      // nicht vorhanden oder gleichzeitig von App und MCP-Server übernommen
    }
  }
  return null;
}

// Installiert (App oder npx): Port 4720, Daten unter ~/Library/Application Support/<Name>. Aus dem Repo
// (Entwicklung): Port 4730, Daten in data/. So laufen beide nebeneinander, und Arbeit am Code stört die
// installierte App nicht.
// Nur die installierte App übernimmt alte Daten; Prüfungen (CANVAS_DATA) und das Repo nicht.
if (INSTALLED && !process.env.CANVAS_DATA) adoptFormerData();

export const config = {
  port: Number(process.env.CANVAS_PORT || (INSTALLED || USER_INSTALL ? 4720 : 4730)),
  dataDir: process.env.CANVAS_DATA || (INSTALLED || USER_INSTALL ? userDataDir() : path.join(ROOT, "data")),
};

export const paths = {
  canvases: () => path.join(config.dataDir, "canvases"),
  regions: () => path.join(config.dataDir, "regions"),
  logs: () => path.join(config.dataDir, "logs"),
  /** Bilder, die Claude als Adresse übergibt (etwa Figma-Frames), geladen und hier abgelegt. */
  imports: () => path.join(config.dataDir, "imports"),
  /** Eingefügte Bilder ohne Datei (⌘V nach einem Screenshot oder Kopieren aus Browser, Figma). */
  pasted: () => path.join(config.dataDir, "pasted"),
  /** Einstellungen der App, etwa die Schlüsselwörter. */
  settings: () => path.join(config.dataDir, "settings.json"),
  /** Zugangsschlüssel der lokalen Schnittstelle, Rechte 0600, neu bei jedem Start der App. */
  token: () => path.join(config.dataDir, "run", "api-token"),
};
