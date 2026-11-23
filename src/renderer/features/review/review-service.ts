// Service der Besprechung: „Claude wartet“ und „Fertig“. Ohne React.

import { bridge } from "../../shared/bridge.ts";

export const reviewKeys = { open: ["reviews", "open"] as const };

export const reviewService = {
  open: () => bridge.openReviews(),
  finish: (canvas: string) => bridge.finish(canvas),
  onChange: bridge.onReviews,
};
