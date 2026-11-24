// Welcher Vergleich offen ist: das Bild und links die frühere Fassung. Schließt sich von selbst, wenn das Bild
// wegfällt, keine früheren Fassungen mehr hat oder ein anderes Canvas erscheint.

import { useCallback, useEffect, useState } from "react";
import type { CanvasState, ImageItem } from "../../../shared/contracts.ts";
import { useT } from "../../shared/i18n.tsx";
import { canvasService } from "./canvas-service.ts";
import type { History } from "./useHistory.ts";
import { defaultLeft, stepLeft } from "./version-compare.ts";

export type Compare = {
  item: ImageItem | null;
  /** Index der früheren Fassung links (in `item.versions`). */
  left: number;
  open(itemId: string): void;
  close(): void;
  /** Links −1 ältere, +1 neuere Fassung. */
  step(by: number): void;
  /** Links die frühere Fassung mit diesem Index (in `item.versions`), etwa „Fassung zwei“. */
  show(index: number): void;
  /** Die Fassung links löschen, samt ihren Anmerkungen; „Rückgängig“ bringt beides zurück. Links rückt die nächste nach. */
  removeLeft(): Promise<void>;
};

export function useCompare(state: CanvasState | null, history: History): Compare {
  const { t } = useT();
  const [open, setOpen] = useState<{ canvas: string; itemId: string; left: number } | null>(null);
  const found = open && state?.name === open.canvas ? state.items.find((i) => i.id === open.itemId) : undefined;
  const item = found?.versions?.length ? found : null;

  useEffect(() => {
    if (open && !item) setOpen(null);
  }, [open, item]);

  const name = state?.name;
  const items = state?.items;
  const openFor = useCallback(
    (itemId: string) => {
      const it = items?.find((i) => i.id === itemId);
      if (name && it?.versions?.length) setOpen({ canvas: name, itemId, left: defaultLeft(it) });
    },
    [name, items],
  );
  const close = useCallback(() => setOpen(null), []);
  const step = useCallback(
    (by: number) => setOpen((o) => {
      const it = o && items?.find((i) => i.id === o.itemId);
      return o && it ? { ...o, left: stepLeft(o.left, by, it) } : o;
    }),
    [items],
  );

  const show = useCallback(
    (index: number) => setOpen((o) => {
      const it = o && items?.find((i) => i.id === o.itemId);
      return o && it ? { ...o, left: stepLeft(index, 0, it) } : o;
    }),
    [items],
  );

  const left = item && open ? Math.min(open.left, item.versions!.length - 1) : 0;
  const removeLeft = useCallback(async () => {
    if (!name || !item) return;
    const itemId = item.id;
    const index = left;
    const removed = await canvasService.removeVersions(name, itemId, [index]);
    history.push({
      label: t("history.versionDeleted", { n: index + 1 }),
      toast: true,
      undo: () => canvasService.restoreVersions(name, removed),
      redo: () => canvasService.removeVersions(name, itemId, [index]),
    });
  }, [name, item, left, history, t]);

  return { item, left, open: openFor, close, step, show, removeLeft };
}
