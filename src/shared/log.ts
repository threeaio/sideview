// Protokoll als JSON-Zeilen. Jede Zeile hat Zeitpunkt, Ereignis und Daten. Schreibfehler halten die App nicht an.

import fs from "node:fs";
import path from "node:path";

export type Log = (event: string, data: Record<string, unknown>) => void;

export function createLog(file: string): Log {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return (event, data) => {
    try {
      fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), event, ...data }) + "\n");
    } catch {
      // Protokoll ist Beiwerk
    }
  };
}
