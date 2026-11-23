// Bilddateien aus dem Finder auf die Fläche ziehen. Sie landen dort, wo man loslässt; ohne offene
// Fläche entsteht die Fläche „Ablage“. Andere Dateien nimmt die Fläche nicht an.

import { useEffect, useRef, useState, type RefObject } from "react";
import type { CanvasState } from "../../../shared/contracts.ts";
import { canvasService } from "./canvas-service.ts";
import { screenToWorld } from "./engine/camera.ts";
import type { Engine } from "./engine/engine.ts";
import { isImageFile, isImageType } from "./image-drop.ts";

/** Wo der Hinweis steht und wie viele Bilder kommen. */
export type DropHint = { x: number; y: number; count: number } | null;

const imageCount = (data: DataTransfer | null) => [...(data?.items ?? [])].filter((i) => i.kind === "file" && isImageType(i.type)).length;

export function useImageDrop(host: RefObject<HTMLDivElement | null>, engine: Engine | null, state: CanvasState | null): DropHint {
  const [hint, setHint] = useState<DropHint>(null);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const el = host.current;
    if (!el || !engine) return;
    const local = (e: DragEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      const count = imageCount(e.dataTransfer);
      e.dataTransfer.dropEffect = count > 0 ? "copy" : "none";
      setHint(count > 0 ? { ...local(e), count } : null);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget || !el.contains(e.relatedTarget as Node)) setHint(null);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setHint(null);
      const files = [...(e.dataTransfer?.files ?? [])].filter(isImageFile);
      const paths = files.map((f) => canvasService.pathForFile(f)).filter(Boolean);
      if (paths.length === 0) return;
      const at = screenToWorld(engine.camera(), local(e));
      canvasService.addImages(latest.current?.name ?? null, paths, at).catch((err: unknown) => console.warn(`Ablegen fehlgeschlagen: ${String(err)}`));
    };
    el.addEventListener("dragover", over);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragover", over);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
    };
  }, [engine, host]);

  // Eine Datei, die neben der Fläche landet (Kopfzeile, Sprachknopf), soll nichts tun.
  useEffect(() => {
    const block = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  return hint;
}
