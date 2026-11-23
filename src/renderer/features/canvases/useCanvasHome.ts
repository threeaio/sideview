// Startansicht, wenn kein Canvas offen ist (6.11.: „die Canvases prominenter darstellen“): alle Canvases
// als Kacheln, das zuletzt geänderte zuerst. Ein Klick oder der Name, gesprochen, öffnet es.

import { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { normalize } from "../../../shared/voice.ts";
import { useT } from "../../shared/i18n.tsx";
import { useVoiceCommands, type VoiceCommand } from "../voice/index.ts";
import { canvasesKeys, canvasesService } from "./canvases-service.ts";

export function useCanvasHome(visible: boolean, onClose?: () => void) {
  const list = useQuery({ queryKey: canvasesKeys.list, queryFn: canvasesService.list, enabled: visible, staleTime: 0, refetchOnMount: "always" });
  const canvases = [...(list.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const open = useCallback((name: string) => void canvasesService.open(name), []);
  const { t, phrases } = useT();

  const commands: VoiceCommand[] = visible
    ? canvases.map((c, i) => ({
        id: `start-canvas-${i + 1}`,
        label: c.title,
        meaning: `Open the canvas „${c.title}“.`,
        phrases: [c.title, c.name.replace(/-/g, " ")].map(normalize),
        run: () => open(c.name),
      }))
    : [];
  if (visible && onClose) commands.push({ id: "start-zurueck", label: t("cmd.homeBack.label"), meaning: "Close the canvas overview and go back to the open canvas.", phrases: phrases("cmd.homeBack.phrases"), run: onClose });
  useVoiceCommands("canvas-home", { commands, screen: { description: visible ? "No canvas is open; the start view lists all canvases." : "", state: { startView: visible } } });

  // Esc führt zurück zum offenen Canvas.
  useEffect(() => {
    if (!visible || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
        return;
      }
      // Tasten des Canvas darunter (Entf, Pfeile, Buchstaben wie A oder M) erreichen es nicht, solange die Übersicht offen ist.
      // Wahltaste und Leertaste bleiben für die Sprache, Kürzel mit ⌘ fürs Menü.
      if (e.metaKey || e.ctrlKey || e.key === "Alt" || e.key === " ") return;
      if (/^(Delete|Backspace|Arrow\w+|Enter|\w)$/.test(e.key)) e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, onClose]);

  return { canvases, loading: list.isPending, open };
}
