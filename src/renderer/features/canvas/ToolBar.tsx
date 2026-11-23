// Werkzeugleiste unten in der Mitte: Auswählen (V) und Markieren (M), daneben, was mit der Auswahl geht.
// Jeder Knopf auch per Sprache.

import type { CanvasState } from "../../../shared/contracts.ts";
import { useT } from "../../shared/i18n.tsx";
import { useVoiceCommands } from "../voice/index.ts";
import type { Arrange } from "./useArrange.ts";
import type { History } from "./useHistory.ts";
import type { Stepper } from "./useImageStepper.ts";
import type { ToolState } from "./useTool.ts";

export function ToolBar({ tool, arrange, state, history, stepper }: { tool: ToolState; arrange: Arrange; state: CanvasState; history: History; stepper: Stepper }) {
  const chosen = arrange.selection;
  const group = chosen?.kind === "group" ? state.groups.find((g) => g.id === chosen.id) : null;
  const count = arrange.selectedIds.length;
  const { t, phrases } = useT();

  useVoiceCommands("tools", {
    commands: [
      { id: "werkzeug-auswaehlen", label: t("cmd.selectTool.label"), meaning: "Switch to the select tool: click, move and delete images and groups.", phrases: phrases("cmd.selectTool.phrases"), run: tool.select },
      { id: "werkzeug-markieren", label: t("cmd.markTool.label"), meaning: "Switch to the mark tool: drag to draw a frame for a note.", phrases: phrases("cmd.markTool.phrases"), run: tool.mark },
      ...(count > 0
        ? [{ id: "auswahl-loeschen", label: t("cmd.deleteSelection.label"), meaning: "Delete the selected images or group.", phrases: phrases("cmd.deleteSelection.phrases"), run: arrange.removeSelected }]
        : []),
      // Rückgängig per Sprache gilt immer dem letzten Schritt, wie Cmd+Z.
      { id: "rueckgaengig", label: t("cmd.undo.label"), meaning: "Undo the last change: a move, a deletion, a group change.", phrases: phrases("cmd.undo.phrases"), run: () => void history.undo() },
      { id: "wiederholen", label: t("cmd.redo.label"), meaning: "Redo the change that was just undone.", phrases: phrases("cmd.redo.phrases"), run: () => void history.redo() },
      ...(chosen?.kind === "items" && count > 0
        ? [{ id: "gruppieren", label: t("cmd.groupImages.label"), meaning: "Group the selected images into a new group.", phrases: phrases("cmd.groupImages.phrases"), run: arrange.groupSelected }]
        : []),
      ...(group ? [{ id: "gruppe-aufloesen", label: t("cmd.ungroup.label"), meaning: "Ungroup the selected group; its images stay.", phrases: phrases("cmd.ungroup.phrases"), run: arrange.ungroupSelected }] : []),
    ],
  });

  return (
    <div className="toolbar" data-surface-ui role="toolbar" aria-label={t("toolbar.label")}>
      <button type="button" className="toolbar__tool" data-option="werkzeug-auswaehlen" aria-pressed={tool.tool === "select"} onClick={tool.select} title={t("toolbar.selectTitle")}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 2.5 12.5 7.6 8.4 8.6 6.3 12.8Z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
        {t("toolbar.select")}
        <kbd>V</kbd>
      </button>
      <button type="button" className="toolbar__tool" data-option="werkzeug-markieren" aria-pressed={tool.tool === "mark"} onClick={tool.mark} title={t("toolbar.markTitle")}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2.5" y="3.5" width="11" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        {t("toolbar.mark")}
        <kbd>M</kbd>
      </button>
      {stepper.total > 1 && (
        <>
          <span className="toolbar__divider" aria-hidden="true" />
          <div className="stepper" role="group" aria-label={t("stepper.label")}>
            <button type="button" className="stepper__button" data-option="voriges-bild" title={t("stepper.previousTitle")} aria-label={t("stepper.previous")} disabled={stepper.at === 1} onClick={stepper.previous}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="stepper__count" aria-live="polite">
              {stepper.at === null ? t("count.images", { count: stepper.total }) : t("stepper.at", { at: stepper.at, total: stepper.total })}
            </span>
            <button type="button" className="stepper__button" data-option="naechstes-bild" title={t("stepper.nextTitle")} aria-label={t("stepper.next")} disabled={stepper.at === stepper.total} onClick={stepper.next}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </>
      )}
      {count > 0 && (
        <>
          <span className="toolbar__divider" aria-hidden="true" />
          <span className="toolbar__info">{group ? group.title : t("count.images", { count })}</span>
          {chosen?.kind === "items" && (
            <button type="button" className="button button--quiet button--small" data-option="gruppieren" onClick={arrange.groupSelected} title={t("toolbar.groupTitle")}>
              {t("toolbar.group")}
            </button>
          )}
          {group && (
            <button type="button" className="button button--quiet button--small" data-option="gruppe-aufloesen" onClick={arrange.ungroupSelected}>
              {t("toolbar.ungroup")}
            </button>
          )}
          <button type="button" className="button button--quiet button--small" data-option="auswahl-loeschen" onClick={() => void arrange.removeSelected()}>
            {t("toolbar.delete")}
          </button>
        </>
      )}
    </div>
  );
}
