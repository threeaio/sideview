// Werkzeug: Auswählen (V) oder Markieren (M). M kurz tippen wechselt, M halten markiert nur so lange
// (danach zurück, wie die Leertaste für die Hand). Startet Claude eine Besprechung, wechselt das Canvas sichtbar
// auf Markieren (5.11.: Variante A).

import { useCallback, useEffect, useRef, useState } from "react";
import { isTyping } from "./engine/input.ts";

export type Tool = "select" | "mark";

/** Länger gehalten zählt als „nur so lange“. */
const HOLD_MS = 350;

export function useTool(reviewing: boolean) {
  const [tool, setTool] = useState<Tool>("select");
  const held = useRef<{ from: Tool; at: number } | null>(null);

  useEffect(() => {
    if (reviewing) setTool("mark");
  }, [reviewing]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || isTyping() || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "KeyV") setTool("select");
      if (e.code === "KeyM") {
        setTool((t) => {
          held.current = { from: t, at: performance.now() };
          return "mark";
        });
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "KeyM" || !held.current) return;
      const { from, at } = held.current;
      held.current = null;
      if (performance.now() - at > HOLD_MS) setTool(from);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return { tool, select: useCallback(() => setTool("select"), []), mark: useCallback(() => setTool("mark"), []) };
}

export type ToolState = ReturnType<typeof useTool>;
