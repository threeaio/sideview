// Startet die lokale Schnittstelle ohne Fenster: für Tests und solange die Electron-Hülle fehlt.
// Die Hülle ruft später dieselbe Funktion `startApp` auf und zeigt die Fläche dazu.

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "../shared/config.ts";
import type { CanvasState } from "../shared/contracts.ts";
import { createApiServer } from "./api.ts";
import { createCanvasStore } from "./canvas-store.ts";
import { createLog } from "../shared/log.ts";
import { createReviews } from "./reviews.ts";

export const VERSION = "0.1.0";

export type AppHooks = {
  port?: number;
  /** Claude hat eine Fläche geöffnet: zeigen, nach vorn holen, auf den Bereich zoomen. */
  onOpen?: (state: CanvasState, focus: string | null) => void;
  onChange?: (state: CanvasState) => void;
  /** Offene Besprechungen haben sich geändert, etwa „Claude wartet“ an oder aus. */
  onReviewsChange?: () => void;
};

export async function startApp({ port = config.port, onOpen, onChange, onReviewsChange }: AppHooks = {}) {
  const log = createLog(path.join(paths.logs(), "app.jsonl"));
  const token = randomBytes(32).toString("base64url");
  await fs.mkdir(path.dirname(paths.token()), { recursive: true });
  await fs.writeFile(paths.token(), token, { mode: 0o600 });
  await fs.chmod(paths.token(), 0o600);

  const store = await createCanvasStore();
  const reviews = createReviews({ onChange: onReviewsChange });
  const server = createApiServer({ token, version: VERSION, store, reviews, onOpen, onChange, log });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  log("app_start", { port, pid: process.pid });
  return { server, store, reviews, log };
}

if (import.meta.main) {
  const { log } = await startApp({ onOpen: (state, focus) => console.log(`Canvas ${state.name} geöffnet${focus ? `, Bereich ${focus}` : ""}`) });
  console.log(`Schnittstelle auf http://127.0.0.1:${config.port}`);
  process.on("SIGINT", () => {
    log("app_stop", {});
    process.exit(0);
  });
}
