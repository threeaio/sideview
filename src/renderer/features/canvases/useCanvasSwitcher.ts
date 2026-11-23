// Canvas wechseln oder neu anlegen. Öffnet über das Menü „Ablage“ (Cmd+O, Cmd+N), den Eintrag im Inhaltsverzeichnis
// oder per Sprache. Tippen filtert, Pfeile wählen, Enter öffnet. „Neuer Canvas“ macht aus dem Suchfeld das Namensfeld.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CanvasSummary } from "../../../shared/contracts.ts";
import { normalize } from "../../../shared/voice.ts";
import { useVoiceCommands, type VoiceCommand } from "../voice/index.ts";
import { canvasesKeys, canvasesService } from "./canvases-service.ts";
import { matches } from "./format.ts";
import { useT } from "../../shared/i18n.tsx";

export type SwitcherMode = "list" | "new";

/** `onList`: wohin „alle Canvases“ führt (⌘O, Sprache); seit 6.11. die Startansicht. */
export function useCanvasSwitcher(current: string | null, onList: () => void) {
  const [open, setOpen] = useState(false);
  const { t, phrases: say } = useT();
  const [mode, setMode] = useState<SwitcherMode>("list");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);

  const show = useCallback((next: SwitcherMode) => {
    setMode(next);
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => canvasesService.onOpenList(onList), [onList]);
  useEffect(() => canvasesService.onNew(() => show("new")), [show]);

  // Frisch bei jedem Öffnen: Claude kann inzwischen Canvases angelegt haben.
  const list = useQuery({ queryKey: canvasesKeys.list, queryFn: canvasesService.list, enabled: open, staleTime: 0, refetchOnMount: "always" });
  const canvases: CanvasSummary[] = useMemo(() => (list.data ?? []).filter((c) => matches(c, query)), [list.data, query]);
  // Die Zeile „Neuer Canvas“ steht unter der Liste und ist mit den Pfeilen erreichbar.
  const rows = canvases.length + 1;

  useEffect(() => {
    setActive((a) => Math.min(a, rows - 1));
  }, [rows]);

  // Beim Öffnen ist das nächste andere Canvas vorgewählt: Wer die Liste öffnet, will meist woandershin.
  const preset = useRef(false);
  useEffect(() => {
    if (!open) preset.current = false;
    else if (!preset.current && list.data) {
      preset.current = true;
      const other = list.data.findIndex((c) => c.name !== current);
      setActive(other < 0 ? 0 : other);
    }
  }, [open, list.data, current]);

  const choose = useCallback(
    async (name: string) => {
      setOpen(false);
      if (name !== current) await canvasesService.open(name);
    },
    [current],
  );

  const create = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await canvasesService.create(query);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }, [busy, query]);

  const move = useCallback((step: number) => setActive((a) => Math.min(rows - 1, Math.max(0, a + step))), [rows]);

  const confirm = useCallback(() => {
    if (mode === "new") return void create();
    const pick = canvases[active];
    if (pick) void choose(pick.name);
    else show("new");
  }, [mode, canvases, active, choose, create, show]);

  /** Esc: aus dem Anlegen zurück in die Liste, sonst schließen. */
  const back = useCallback(() => {
    if (mode === "new") {
      setMode("list");
      setQuery("");
    } else close();
  }, [mode, close]);

  const phrases = (...p: string[]) => p.map(normalize);
  const commands: VoiceCommand[] = [
    { id: "canvases", label: t("cmd.canvases.label"), meaning: "Show the list of all canvases to switch to another one.", phrases: say("cmd.canvases.phrases"), run: onList },
    { id: "neuer-canvas", label: t("cmd.newCanvas.label"), meaning: "Create a new, empty canvas.", phrases: say("cmd.newCanvas.phrases"), run: () => show("new") },
  ];
  if (open && mode === "list")
    canvases.forEach((c, i) =>
      commands.push({ id: `canvas-${i + 1}`, label: c.title, meaning: `Open the canvas „${c.title}“.`, phrases: phrases(c.title, c.name.replace(/-/g, " ")), run: () => void choose(c.name) }),
    );
  if (open) commands.push({ id: "canvases-schliessen", label: t("cmd.closeCanvases.label"), meaning: "Close the canvas list.", phrases: say("cmd.closeCanvases.phrases"), run: close });
  useVoiceCommands("canvases", { commands, screen: { description: open ? "The list of canvases is open." : "", state: { canvasListOpen: open } } });

  /** Tippen filtert; die Auswahl springt auf den ersten Treffer. */
  const type = useCallback((q: string) => {
    setQuery(q);
    setActive(0);
  }, []);

  return { open, mode, query, setQuery: type, active, setActive, canvases, loading: list.isPending, current, busy, show, close, back, move, confirm, choose, create };
}

export type CanvasSwitcherModel = ReturnType<typeof useCanvasSwitcher>;
