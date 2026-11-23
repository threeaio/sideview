// Verlauf für Widerrufen (Cmd+Z) und Wiederholen (Cmd+Shift+Z): Verschieben, Gruppen, Löschen von Bildern und
// Anmerkungen. Jeder Schritt bringt mit, wie er zurück- und wieder vorgeht. Die Tasten kommen über das Menü
// „Bearbeiten“; in einem Textfeld gelten sie dem Text. Je Canvas ein eigener Verlauf.

import { useCallback, useEffect, useRef, useState } from "react";
import { canvasService } from "./canvas-service.ts";
import { isTyping } from "./engine/input.ts";

export type Step = { label: string; undo: () => Promise<unknown> | void; redo: () => Promise<unknown> | void; /** Nach dem Schritt „Rückgängig“ anbieten (beim Löschen). */ toast?: boolean };

/** So lange steht „… gelöscht · Rückgängig“ unten. */
const TOAST_MS = 8000;

export function useHistory(canvas: string) {
  const past = useRef<Step[]>([]);
  const future = useRef<Step[]>([]);
  const [toast, setToast] = useState<Step | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    past.current = [];
    future.current = [];
    setToast(null);
  }, [canvas]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const push = useCallback((step: Step) => {
    past.current.push(step);
    future.current = [];
    setToast(step.toast ? step : null);
  }, []);

  const undo = useCallback(async () => {
    const step = past.current.pop();
    if (!step || busy.current) return;
    busy.current = true;
    setToast(null);
    try {
      await step.undo();
      future.current.push(step);
    } finally {
      busy.current = false;
    }
  }, []);

  const redo = useCallback(async () => {
    const step = future.current.pop();
    if (!step || busy.current) return;
    busy.current = true;
    try {
      await step.redo();
      past.current.push(step);
    } finally {
      busy.current = false;
    }
  }, []);

  // Menü „Bearbeiten“: im Textfeld der Text, sonst das Canvas.
  useEffect(() => {
    const offUndo = canvasService.onUndo(() => (isTyping() ? document.execCommand("undo") : void undo()));
    const offRedo = canvasService.onRedo(() => (isTyping() ? document.execCommand("redo") : void redo()));
    return () => {
      offUndo();
      offRedo();
    };
  }, [undo, redo]);

  return { push, undo, redo, toast, canUndo: () => past.current.length > 0 };
}

export type History = ReturnType<typeof useHistory>;
