// Einstellungen in data/settings.json und die Kosten aus logs/commands.jsonl. Schreibt atomar.

import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../shared/config.ts";
import { parseSettings, type Settings } from "../shared/settings.ts";
import { jevCallsFromLog, summarizeUsage, type UsageSummary } from "../shared/usage.ts";

export type SettingsStore = Awaited<ReturnType<typeof createSettingsStore>>;

export async function createSettingsStore({ file = paths.settings(), log = path.join(paths.logs(), "commands.jsonl") } = {}) {
  let current: Settings = parseSettings(await fs.readFile(file, "utf8").then(JSON.parse, () => null));

  return {
    /** Gilt sofort, auch für die nächste Äußerung. */
    get: () => current,
    async set(next: Settings): Promise<Settings> {
      current = parseSettings(next);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(current, null, 2) + "\n");
      await fs.rename(tmp, file);
      return current;
    },
    async usage(now = new Date()): Promise<UsageSummary> {
      const text = await fs.readFile(log, "utf8").catch(() => "");
      return summarizeUsage(jevCallsFromLog(text), now);
    },
  };
}
