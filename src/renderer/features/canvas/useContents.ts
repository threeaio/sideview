// Brücke zwischen Kopfzeile und Canvas: Inhaltsverzeichnis links (am Namen) und Liste der Anmerkungen rechts (am
// Zähler). Die Kopfzeile liegt außerhalb der Canvas-Ansicht, deshalb meldet die Ansicht hier ihren Motor und die
// Auswahl an. Inhalt: Name anklicken, Taste I oder „Inhalt“. Anmerkungen: Zähler anklicken, Taste A oder
// „Anmerkungen“. Es ist immer höchstens eins offen; Esc schließt.

import { useCallback, useEffect, useState } from "react";
import type { Engine } from "./engine/engine.ts";
import { isTyping } from "./engine/input.ts";

/** Breite der Liste der Anmerkungen und ihr Abstand zum Rand; beim Hinfahren bleibt diese Fläche frei. */
export const NOTES_WIDTH = 368;
const NOTES_GAP = 24;

/** Was die Kopfzeile an der Auswahl im Canvas braucht. */
export type Selection = { selected: string | null; select(id: string | null): void; edit(id: string): void };

export type Contents = {
  open: boolean;
  notesOpen: boolean;
  engine: Engine | null;
  selection: Selection | null;
  toggle(): void;
  toggleNotes(): void;
  /** Bild, auf das die Liste gerade beschränkt ist (über die Zahl an seiner Marke), sonst null. */
  notesFor: string | null;
  /** Liste nur für ein Bild öffnen; null zeigt wieder alle. */
  showNotes(itemId: string | null): void;
  close(): void;
  /** Pixel, die die offene Liste rechts verdeckt (0, wenn sie zu ist). */
  notesInset(): number;
  attach(engine: Engine | null): void;
  attachSelection(selection: Selection | null): void;
};

export function useContents(): Contents {
  const [panel, setPanel] = useState<"contents" | "notes" | null>(null);
  const [engine, attach] = useState<Engine | null>(null);
  const [selection, attachSelection] = useState<Selection | null>(null);
  const toggle = useCallback(() => setPanel((p) => (p === "contents" ? null : "contents")), []);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const toggleNotes = useCallback(() => {
    setNotesFor(null);
    setPanel((p) => (p === "notes" ? null : "notes"));
  }, []);
  const showNotes = useCallback((itemId: string | null) => {
    setNotesFor(itemId);
    setPanel("notes");
  }, []);
  const close = useCallback(() => setPanel(null), []);
  const notesInset = useCallback(() => (panel === "notes" ? NOTES_WIDTH + 2 * NOTES_GAP : 0), [panel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping() || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "KeyI" && !e.shiftKey) {
        e.preventDefault();
        toggle();
      } else if (e.code === "KeyA" && !e.shiftKey) {
        e.preventDefault();
        toggleNotes();
      } else if (e.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, toggleNotes, close]);

  return { open: panel === "contents", notesOpen: panel === "notes", engine, selection, toggle, toggleNotes, notesFor, showNotes, close, notesInset, attach, attachSelection };
}
