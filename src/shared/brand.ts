// Name der App an einer Stelle: package.json (productName, name, repository). Der endgültige öffentliche Name steht
// noch aus; ihn dort ändern (und den Schlüssel unter "bin") genügt für Befehl, Ordner und Fenstertitel.
// Gelesen statt importiert: bin/sideview.mjs läuft im npx-Cache unter node_modules, wo Node keine .ts-Dateien lädt.

import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { name: string; productName: string; repository?: string };

export const PRODUCT = pkg.productName;
/** Für Befehle, MCP-Server und Ordner: klein, ohne Leerzeichen. */
export const SLUG = pkg.name;
/** GitHub-Repo der öffentlichen Fassung, für `npx github:<REPO>`. */
export const REPO = (pkg.repository ?? "").replace(/^github:/, "");
