// Service der Fläche: einzige Stelle zwischen Hooks und Transport. Ohne React.

import type { Annotation, Layout, RemovedItems, RemovedVersions } from "../../../shared/contracts.ts";
import type { AnnotationPatch, NewAnnotationInput, Stage, ThumbnailRequest } from "../../../shared/ipc.ts";
import { bridge } from "../../shared/bridge.ts";

export const canvasKeys = {
  all: ["canvas"] as const,
  detail: (name: string) => ["canvas", "detail", name] as const,
  /** Datei im Schlüssel: Wird ein Bild getauscht, gibt es ein neues Vorschaubild. */
  thumbnail: (req: ThumbnailRequest, path: string) => ["canvas", "thumbnail", req.canvas, req.itemId, path, req.rect?.join(",") ?? "", req.size] as const,
};

export const canvasService = {
  get: (name: string) => bridge.get(name),
  current: () => bridge.current(),
  addImages: (canvas: string | null, paths: string[], at: { x: number; y: number }) => bridge.addImages(canvas, paths, at),
  pathForFile: (file: File) => bridge.pathForFile(file),
  pasteImage: (canvas: string | null, at: { x: number; y: number }) => bridge.pasteImage(canvas, at),
  nativePaste: () => bridge.nativePaste(),
  onPaste: bridge.onPaste,
  onStage: (cb: (stage: Stage) => void) => bridge.onStage(cb),
  addAnnotation: (canvas: string, input: NewAnnotationInput) => bridge.addAnnotation(canvas, input),
  updateAnnotation: (canvas: string, id: string, patch: AnnotationPatch) => bridge.updateAnnotation(canvas, id, patch),
  removeAnnotation: (canvas: string, id: string) => bridge.removeAnnotation(canvas, id),
  restoreAnnotation: (canvas: string, annotation: Annotation, index: number) => bridge.restoreAnnotation(canvas, annotation, index),
  applyLayout: (canvas: string, layout: Layout) => bridge.applyLayout(canvas, layout),
  removeItems: (canvas: string, ids: string[]) => bridge.removeItems(canvas, ids),
  restoreItems: (canvas: string, removed: RemovedItems) => bridge.restoreItems(canvas, removed),
  removeVersions: (canvas: string, itemId: string, indices: number[]) => bridge.removeVersions(canvas, itemId, indices),
  restoreVersions: (canvas: string, removed: RemovedVersions) => bridge.restoreVersions(canvas, removed),
  thumbnail: (req: ThumbnailRequest) => bridge.thumbnail(req),
  onUndo: bridge.onUndo,
  onRedo: bridge.onRedo,
  onOpened: bridge.onOpened,
  onChanged: bridge.onChanged,
};
