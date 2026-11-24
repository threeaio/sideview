// Durchblättern (22.11., Idee R3 aus „Rounds“): nächstes und voriges Bild, Gruppe für Gruppe in ihrer
// Reihe. Pfeil links und rechts, die Knöpfe in der Werkzeugleiste oder „nächstes“,
// „voriges“ sagen. Welches Bild gerade dran ist, ergibt sich aus der Kamera: das in der Mitte des Fensters.

import { useEffect, useRef, useState } from "react";
import type { CanvasState } from "../../../shared/contracts.ts";
import { useT } from "../../shared/i18n.tsx";
import { useVoiceCommands } from "../voice/index.ts";
import type { Engine } from "./engine/engine.ts";
import { isTyping } from "./engine/input.ts";
import { focusItem, itemInView, readingOrder } from "./navigation.ts";

export type Stepper = {
  /** Stelle des Bildes im Blick (ab 1) und Zahl aller Bilder; `at` ist null in der Übersicht. */
  at: number | null;
  total: number;
  next(): void;
  previous(): void;
};

/** `paused`: solange etwas anderes die Fläche deckt (Fassungsvergleich), keine Sprachbefehle. */
export function useImageStepper(engine: Engine | null, state: CanvasState | null, paused = false): Stepper {
  const order = state ? readingOrder(state) : [];
  const { t, phrases } = useT();
  const [current, setCurrent] = useState<string | null>(null);
  // Während einer Fahrt zählt das Ziel, nicht das Bild, über das die Kamera gerade fliegt.
  const target = useRef<string | null>(null);
  const latest = useRef({ order, engine });
  latest.current = { order, engine };

  useEffect(() => {
    if (!engine) return;
    return engine.onFrame(() => {
      const { order } = latest.current;
      const id = engine.status().flying && target.current ? target.current : itemInView(engine, order);
      if (!engine.status().flying) target.current = null;
      setCurrent((c) => (c === id ? c : id));
    });
  }, [engine]);

  const step = (by: 1 | -1) => {
    const { order, engine } = latest.current;
    if (!engine || order.length === 0) return;
    const from = target.current ?? itemInView(engine, order);
    const at = from ? order.findIndex((i) => i.id === from) : -1;
    const next = at < 0 ? (by > 0 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, at + by));
    const item = order[next]!;
    target.current = item.id;
    setCurrent(item.id);
    focusItem(engine, item);
  };
  const next = () => step(1);
  const previous = () => step(-1);

  // Pfeil links und rechts, solange nichts getippt wird. Pfeil hoch und runter gehören der Liste der Anmerkungen.
  const keys = useRef({ next, previous });
  keys.current = { next, previous };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping() || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        keys.current.next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        keys.current.previous();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useVoiceCommands("stepper", {
    commands:
      order.length > 1 && !paused
        ? [
            { id: "naechstes-bild", label: t("cmd.next.label"), meaning: "Go to the next image in order (like the right arrow key).", phrases: phrases("cmd.next.phrases"), run: next },
            { id: "voriges-bild", label: t("cmd.previous.label"), meaning: "Go to the previous image in order (like the left arrow key).", phrases: phrases("cmd.previous.phrases"), run: previous },
          ]
        : [],
  });

  const at = current ? order.findIndex((i) => i.id === current) : -1;
  return { at: at < 0 ? null : at + 1, total: order.length, next, previous };
}
