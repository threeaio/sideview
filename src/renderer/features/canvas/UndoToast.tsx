// Nach dem Löschen unten in der Mitte: „Anmerkung 2 gelöscht · Rückgängig“ oder „Bild gelöscht · Rückgängig“.
// Statt einer Rückfrage: Löschen geht sofort, lässt sich aber eine Weile zurücknehmen (Knopf, Cmd+Z, „rückgängig“).

import { useT } from "../../shared/i18n.tsx";

export function UndoToast({ undo }: { undo: { label: string; run: () => void } | null }) {
  const { t } = useT();
  if (!undo) return null;
  return (
    <div className="undo-toast" data-surface-ui role="status" aria-live="polite">
      <span>{undo.label}</span>
      <button type="button" className="button button--small undo-toast__action" data-option="rueckgaengig" onClick={undo.run}>
        {t("canvas.undo")}
      </button>
    </div>
  );
}
