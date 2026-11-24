// Die Fläche: Bilder als Kacheln auf der GPU, darüber die HTML-Ebene mit Rechtecken und Notizen.
// Rendert nur und reicht Gesten an die Hooks weiter.

import { useEffect, useRef, type ReactNode } from "react";
import type { CanvasState } from "../../../shared/contracts.ts";
import type { Stage } from "../../../shared/ipc.ts";
import { GroupLayer } from "./GroupLayer.tsx";
import { dropLabel } from "./image-drop.ts";
import { SurfaceOverlay } from "./SurfaceOverlay.tsx";
import { ToolBar } from "./ToolBar.tsx";
import { UndoToast } from "./UndoToast.tsx";
import { VersionCompare } from "./VersionCompare.tsx";
import { VersionStacks } from "./VersionStacks.tsx";
import { useCompare } from "./useCompare.ts";
import { useArrange } from "./useArrange.ts";
import { useHistory } from "./useHistory.ts";
import { useTool } from "./useTool.ts";
import { useAnnotationEditing } from "./useAnnotationEditing.ts";
import { useCanvasVoice } from "./useCanvasVoice.ts";
import type { Contents } from "./useContents.ts";
import { useImageDrop } from "./useImageDrop.ts";
import { useImageStepper } from "./useImageStepper.ts";
import { useImagePaste } from "./useImagePaste.ts";
import type { ShowRequest } from "./useCanvas.ts";
import { useSurface } from "./useSurface.ts";
import { useSurfaceInput } from "./useSurfaceInput.ts";
import { useT } from "../../shared/i18n.tsx";
import "./canvas.css";

/** `empty`: was ohne offenes Canvas erscheint (die Startansicht mit allen Canvases). */
export function CanvasView({ state: saved, show, contents, stage, reviewing, empty }: { state: CanvasState | null; show: ShowRequest | null; contents: Contents; stage: Stage; reviewing: boolean; empty?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const { t, lang } = useT();
  const glHost = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const history = useHistory(saved?.name ?? "");
  const arrange = useArrange(saved, history);
  // Was zu sehen ist: beim Ziehen die Bilder an ihrer neuen Stelle.
  const state = arrange.view;
  const tool = useTool(reviewing);
  const engine = useSurface(host, glHost, overlay, state, show);
  const editing = useAnnotationEditing(state, history);
  useSurfaceInput(host, engine, state, editing, arrange, tool.tool);
  // Eine gewählte Anmerkung und gewählte Bilder schließen sich aus.
  const { clear } = arrange;
  useEffect(() => {
    if (editing.selected) clear();
  }, [editing.selected, clear]);
  const compare = useCompare(state, history);
  useCanvasVoice(engine, state, editing, contents, compare, arrange);
  const { attach, attachSelection } = contents;
  useEffect(() => attach(engine), [attach, engine]);
  // Die Liste der Anmerkungen in der Kopfzeile zeigt und setzt dieselbe Auswahl.
  // Die Handler ändern sich bei jedem Rendern; über die Referenz bleiben sie aktuell, ohne die Kopfzeile neu zu zeichnen.
  const latest = useRef(editing);
  latest.current = editing;
  const selected = editing.selected;
  useEffect(
    () => attachSelection({ selected, select: (id) => latest.current.select(id), edit: (id) => latest.current.edit(id) }),
    [attachSelection, selected],
  );
  const stepper = useImageStepper(engine, state, Boolean(compare.item));
  const drop = useImageDrop(host, engine, state);
  useImagePaste(host, engine, state);

  return (
    <div className="surface" ref={host} data-stage={stage} data-tool={tool.tool}>
      {/* Unter der Leinwand: Gruppenflächen. Gesetzt wie die HTML-Ebene (useSurface setzt alles unter .surface). */}
      <div className="surface__underlay">{state && <GroupLayer state={state} areas={arrange.areas} target={arrange.dropTarget} slot={arrange.slot} selected={arrange.selection?.kind === "group" ? arrange.selection.id : null} renaming={arrange.renaming} resizing={arrange.resizing} />}
        {state && <VersionStacks state={state} hidden={arrange.covered} selected={arrange.selection?.kind === "items" ? arrange.selection.ids : []} />}
      </div>
      <div className="surface__gl" ref={glHost} />
      <div className="surface__overlay" ref={overlay}>
        {state && <SurfaceOverlay state={state} editing={editing} engine={engine} arrange={arrange} onNotes={contents.showNotes} onCompare={compare.open} />}
      </div>
      <UndoToast undo={history.toast ? { label: history.toast.label, run: () => void history.undo() } : null} />
      {state && !compare.item && <ToolBar tool={tool} arrange={arrange} state={state} history={history} stepper={stepper} />}
      {state && compare.item && <VersionCompare key={compare.item.id} item={compare.item} left={compare.left} compare={compare} annotations={state.annotations} />}
      {!state && empty}
      {state && state.items.length === 0 && (
        <div className="surface__empty-canvas">
          <p>{t("canvas.empty")}</p>
          <p>{t("canvas.emptyHint")}</p>
        </div>
      )}
      {drop && (
        <div className="drop-hint" style={{ translate: `${drop.x}px ${drop.y}px` }}>
          {dropLabel(drop.count, lang)}
        </div>
      )}
    </div>
  );
}
