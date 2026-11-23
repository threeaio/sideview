// Vorschaubild eines Bildes oder eines Ausschnitts, vom Hauptprozess verkleinert. Bleibt im Cache, bis das Bild
// getauscht wird (Datei im Schlüssel).

import { useQuery } from "@tanstack/react-query";
import type { ImageItem, Rect } from "../../../shared/contracts.ts";
import { canvasKeys, canvasService } from "./canvas-service.ts";

export function useThumbnail(canvas: string, item: ImageItem | undefined, rect: Rect | undefined, size: number, enabled = true) {
  const req = { canvas, itemId: item?.id ?? "", rect, size: Math.round(size * (window.devicePixelRatio || 1)) };
  return useQuery({
    queryKey: canvasKeys.thumbnail(req, item?.path ?? ""),
    queryFn: () => canvasService.thumbnail(req),
    enabled: enabled && !!item,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  }).data;
}
