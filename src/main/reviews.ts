// Offene Besprechungen: Claude wartet auf „Fertig“ einer Fläche. Der MCP-Server fragt in kurzen
// Abständen nach (`wait`), damit keine Verbindung lange offen hängen muss. Erledigte Besprechungen
// bleiben eine Weile abrufbar, falls der MCP-Server die Antwort verpasst hat.

import { randomUUID } from "node:crypto";
import type { CancelReason, ReviewResult, ReviewStatus } from "../shared/contracts.ts";

type Entry = { status: ReviewStatus; startedAt: number; endedAt: number | null; toolUseId: string | null; waiters: Set<() => void> };

export type Reviews = ReturnType<typeof createReviews>;

export function createReviews({ keepMs = 10 * 60_000, now = () => Date.now(), onChange = () => {} } = {}) {
  const entries = new Map<string, Entry>();

  const notify = (entry: Entry) => {
    entry.endedAt = now();
    for (const wake of entry.waiters) wake();
    entry.waiters.clear();
    onChange();
  };
  const prune = () => {
    for (const [id, e] of entries) if (e.endedAt !== null && now() - e.endedAt > keepMs) entries.delete(id);
  };

  return {
    start(canvas: string, prompt: string | null, toolUseId: string | null = null): string {
      prune();
      const reviewId = randomUUID();
      entries.set(reviewId, { status: { status: "open", reviewId, canvas, prompt }, startedAt: now(), endedAt: null, toolUseId, waiters: new Set() });
      onChange();
      return reviewId;
    },

    get(reviewId: string): ReviewStatus | null {
      return entries.get(reviewId)?.status ?? null;
    },

    /** Wartet höchstens `ms`, kehrt früher zurück, sobald sich der Stand ändert. */
    async wait(reviewId: string, ms: number): Promise<ReviewStatus | null> {
      const entry = entries.get(reviewId);
      if (!entry || entry.status.status !== "open") return entry?.status ?? null;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          entry!.waiters.delete(done);
          resolve();
        }
        entry.waiters.add(done);
      });
      return entry.status;
    },

    /** „Fertig“ auf einer Fläche beendet alle offenen Besprechungen dieser Fläche. */
    finish(canvas: string, result: ReviewResult): string[] {
      const finished: string[] = [];
      for (const [reviewId, entry] of entries) {
        if (entry.status.status !== "open" || entry.status.canvas !== canvas) continue;
        entry.status = { status: "done", reviewId, canvas, result };
        finished.push(reviewId);
        notify(entry);
      }
      return finished;
    },

    cancel(reviewId: string, reason: CancelReason): boolean {
      const entry = entries.get(reviewId);
      if (!entry || entry.status.status !== "open") return false;
      entry.status = { status: "cancelled", reviewId, canvas: entry.status.canvas, reason };
      notify(entry);
      return true;
    },

    /** Offene Besprechungen, für die Anzeige „Claude wartet“. */
    open(): Extract<ReviewStatus, { status: "open" }>[] {
      return [...entries.values()].flatMap((e) => (e.status.status === "open" ? [e.status] : []));
    },
  };
}
