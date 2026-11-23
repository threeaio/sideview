// Service der Canvas-Liste: einzige Stelle zwischen Hooks und Transport. Ohne React.

import { bridge } from "../../shared/bridge.ts";

export const canvasesKeys = {
  list: ["canvases", "list"] as const,
  /** Stand im Schlüssel: Ändert sich das Canvas, kommt ein neues Vorschaubild. */
  cover: (name: string, itemId: string, updatedAt: string, size: number) => ["canvases", "cover", name, itemId, updatedAt, size] as const,
};

export const canvasesService = {
  list: () => bridge.list(),
  open: (name: string) => bridge.openCanvas(name),
  create: (title: string) => bridge.createCanvas(title),
  cover: (canvas: string, itemId: string, size: number) => bridge.thumbnail({ canvas, itemId, size }),
  onOpenList: (cb: () => void) => bridge.onOpenCanvases(cb),
  onNew: (cb: () => void) => bridge.onNewCanvas(cb),
};
