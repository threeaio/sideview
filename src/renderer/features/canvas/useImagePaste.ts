// Einsetzen (⌘V, Menü Bearbeiten > Einsetzen). Das Menü fängt die Taste ab wie bei Widerrufen; hier wird
// entschieden: In einem Textfeld normales Einsetzen, sonst ein Bild aus der Zwischenablage auf das Canvas.
// Es landet unter dem Zeiger, steht der nicht über der Fläche, in der Mitte der Ansicht. Ohne offene Fläche
// entsteht „Ablage“ wie beim Ablegen. Den Inhalt der Zwischenablage liest der Hauptprozess.

import { useEffect, useRef, type RefObject } from "react";
import type { CanvasState } from "../../../shared/contracts.ts";
import { canvasService } from "./canvas-service.ts";
import { screenToWorld } from "./engine/camera.ts";
import type { Engine } from "./engine/engine.ts";
import { isTyping } from "./engine/input.ts";

export function useImagePaste(host: RefObject<HTMLDivElement | null>, engine: Engine | null, state: CanvasState | null): void {
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const el = host.current;
    if (!el || !engine) return;
    let pointer: { x: number; y: number } | null = null;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const leave = () => {
      pointer = null;
    };
    const off = canvasService.onPaste(() => {
      if (isTyping() || document.querySelector("dialog[open]")) {
        void canvasService.nativePaste();
        return;
      }
      const r = el.getBoundingClientRect();
      const at = screenToWorld(engine.camera(), pointer ?? { x: r.width / 2, y: r.height / 2 });
      canvasService.pasteImage(latest.current?.name ?? null, at).catch((err: unknown) => console.warn(`Einfügen fehlgeschlagen: ${String(err)}`));
    });
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      off();
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [engine, host]);
}
