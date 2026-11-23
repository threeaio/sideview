// Lädt Erweiterungen aus extensions/<name>/ (siehe src/shared/extensions.ts). Fehlt der Ordner, gibt es keine.
// Eine kaputte Erweiterung hält die App nicht auf: Fehler gehen ins Protokoll.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../shared/config.ts";

export type Loaded<T> = { name: string; dir: string; module: T };

/** Ordner der Erweiterungen; ausgeblendet sind solche, die mit „.“ oder „_“ beginnen. */
export function extensionDirs(root = ROOT): { name: string; dir: string }[] {
  const base = path.join(root, "extensions");
  let names: string[] = [];
  try {
    names = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && !/^[._]/.test(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
  return names.sort().map((name) => ({ name, dir: path.join(base, name) }));
}

/** Eine Datei aus jeder Erweiterung, die sie hat, als Modul mit `default`. */
export async function loadExtensions<T>(file: "main.ts" | "mcp.ts", onError: (name: string, error: unknown) => void, root = ROOT): Promise<Loaded<T>[]> {
  const out: Loaded<T>[] = [];
  for (const { name, dir } of extensionDirs(root)) {
    const entry = path.join(dir, file);
    if (!fs.existsSync(entry)) continue;
    try {
      const mod = (await import(pathToFileURL(entry).href)) as { default?: T };
      if (mod.default) out.push({ name, dir, module: mod.default });
    } catch (e) {
      onError(name, e);
    }
  }
  return out;
}

/** Glossar-Dateien aller Erweiterungen. */
export const extensionGlossaries = (root = ROOT) => extensionDirs(root).map((e) => path.join(e.dir, "glossary.json")).filter((f) => fs.existsSync(f));
