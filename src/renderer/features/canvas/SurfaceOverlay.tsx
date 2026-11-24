// HTML-Ebene über den Bildern: Marke je Bild (Name und Zahl der Anmerkungen), Rechtecke mit Nummer und Notiz,
// Entwurf und Notizfeld. Weit weg zeigt nur die Marke die Anmerkungen an; nah kommen Rahmen und Nummern dazu.
// Lage in Weltkoordinaten (data-wx …); useSurface setzt sie im Takt der Kamera auf den Bildschirm.

import { Fragment, useCallback, type CSSProperties } from "react";
import { isPoint, type CanvasState } from "../../../shared/contracts.ts";
import type { WorldRect } from "./engine/camera.ts";
import { imageToWorld, itemWorldRect } from "./engine/geometry.ts";
import { anchorAttrs, attachAttrs, sizeAttrs, titleRoomAttrs, worldAttrs } from "./engine/overlay.ts";
import type { Engine } from "./engine/engine.ts";
import { MarkHandles, annotationTarget, draftTarget, useReshape } from "./MarkHandles.tsx";
import { isPointDraft, type AnnotationEditing } from "./useAnnotationEditing.ts";
import type { Arrange } from "./useArrange.ts";
import { GroupNameEditor } from "./GroupNameEditor.tsx";
import { useT } from "../../shared/i18n.tsx";

export function SurfaceOverlay({ state, editing, engine, arrange, onNotes, onCompare }: { state: CanvasState; editing: AnnotationEditing; engine: Engine | null; arrange: Arrange; onNotes(itemId: string): void; onCompare(itemId: string): void }) {
  const { selected, drawing, editor, saving, adjusting } = editing;
  const { t } = useT();
  const chosen = arrange.selection;
  const draftItem = editor?.kind === "new" ? state.items.find((i) => i.id === editor.draft.itemId) : undefined;
  // Liegt gerade ein gezogenes Bild darüber, verschwinden seine Rahmen, sonst lägen sie auf dem gezogenen Bild.
  const shown = state.annotations.flatMap((a, index) => {
    const item = state.items.find((i) => i.id === a.itemId);
    if (!item || arrange.covered.has(item.id)) return [];
    const r = adjusting?.id === a.id ? adjusting.rect : imageToWorld(item, a.rect);
    const isEditing = editor?.kind === "edit" && editor.id === a.id;
    return [{ a, item, r, n: index + 1, isSelected: selected === a.id, isEditing, point: isPoint(a.rect), done: Boolean(a.done) }];
  });
  return (
    <>
      {/* Auswahl beim Anordnen: Saum um jedes gewählte Bild (eine gewählte Gruppe zeigt GroupLayer); Auswahlrechteck beim Ziehen ins Leere. */}
      {chosen?.kind === "items" &&
        state.items
          .filter((i) => chosen.ids.includes(i.id))
          .map((i) => <div key={`sel-${i.id}`} className="item-selected" data-round {...worldAttrs(itemWorldRect(i))} />)}
      {arrange.marquee && <div className="marquee" {...worldAttrs(arrange.marquee)} />}
      {/* Je Bearbeitung neu, damit der Name jedes Mal markiert startet. */}
      {arrange.renaming && <GroupNameEditor key={arrange.renaming} state={state} arrange={arrange} />}
      {state.items.map((item, i) => {
        const r = itemWorldRect(item);
        const mine = state.annotations.filter((a) => a.itemId === item.id);
        // Die Zahl zählt offene; sind alle erledigt, steht ein Haken da.
        const notes = mine.filter((a) => !a.done).length;
        const allDone = mine.length > 0 && notes === 0;
        return (
          <Fragment key={item.id}>
            {item.tiles && <div className="surface-frame" data-round data-under={arrange.covered.has(item.id) || undefined} {...worldAttrs(r)} />}
            {/* Marke über dem Bild links (23.11., vorher auf dem Bild): Name, Fassungen, Zahl der Anmerkungen; die Zahl öffnet
                die Liste nur für dieses Bild. Reicht der Platz über dem Bild nicht (weit rausgezoomt), rückt sie auf das Bild. */}
            <div
              className="surface-title"
              data-under={arrange.covered.has(item.id) || undefined}
              {...anchorAttrs(r.x, r.y)}
              data-ww={r.w}
              {...sizeAttrs({ ...r, h: 0 })}
              {...titleRoomAttrs(Math.min(2, item.versions?.length ?? 0))}
              style={{ "--sheets": Math.min(2, item.versions?.length ?? 0) } as CSSProperties}
            >
              <span className="surface-title__pill" data-obstacle data-item={item.id}>
                <span className="surface-title__text">{item.title}</span>
                {item.versions?.length ? (
                  // Das Stapelzeichen mit der Zahl öffnet den Vergleich der Fassungen.
                  <button
                    type="button"
                    className="surface-title__versions"
                    data-surface-ui
                    data-option={`fassungen-bild-${i}`}
                    title={`${t("count.versions", { count: item.versions.length + 1 })} – ${t("compare.openTitle")}`}
                    onClick={() => onCompare(item.id)}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                      <rect x="1.5" y="3.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M4 1.5h5a1.5 1.5 0 0 1 1.5 1.5v5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                    {item.versions.length + 1}
                  </button>
                ) : null}
                {mine.length > 0 && (
                  <button
                    type="button"
                    className="surface-title__count"
                    data-surface-ui
                    data-option={`anmerkungen-bild-${i}`}
                    data-done={allDone || undefined}
                    title={allDone ? t("notes.allDone") : t("count.openAnnotations", { count: notes })}
                    onClick={() => onNotes(item.id)}
                  >
                    {allDone ? (
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-label={t("notes.doneMark")}>
                        <path d="M2.5 6.4 4.9 8.7 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      notes
                    )}
                  </button>
                )}
              </span>
            </div>
            {!item.tiles && (
              <div className="surface-missing" {...worldAttrs(r)}>
                {t("canvas.missing")}
              </div>
            )}
          </Fragment>
        );
      })}

      {/* Erst alle Rahmen, dann alle Beschriftungen: sonst läge der Rahmen einer späteren Anmerkung über der
          Nummer einer früheren (23.11., „die 50 wird überlagert“). */}
      {shown.map(({ a, item, r, isSelected, isEditing, point, done }) => (
        <Fragment key={a.id}>
          <div className="mark" data-annotation={a.id} data-selected={isSelected || undefined} data-scrim={isSelected || undefined} data-done={done || undefined} data-point={point || undefined} data-nw={item.imageWidth / item.scale} {...worldAttrs(r)} />
          {/* Vor der Beschriftung: Nummer und Knöpfe liegen über den Kantenzonen, die leeren Stellen der
              Beschriftung lassen Klicks zu den Zonen durch. Ein Punkt hat keine Kanten, nur die Nummer zum Verschieben. */}
          {(isSelected || isEditing) && !point && engine && <MarkHandles rect={r} bounds={itemWorldRect(item)} engine={engine} target={annotationTarget(a.id, editing)} />}
        </Fragment>
      ))}
      {shown.map(({ a, item, r, n, isSelected, isEditing, point, done }) =>
        isEditing ? (
          <NoteEditor key={a.id} at={r} editing={editing} />
        ) : (
          <div
            key={a.id}
            className="mark-label"
            data-surface-ui
            data-item={item.id}
            data-selected={isSelected || undefined}
            data-done={done || undefined}
            data-point={point || undefined}
            data-nw={item.imageWidth / item.scale}
            {...attachAttrs(r, "label")}
            // Ein Punkt hat keine Größe; seine Nummer bleibt immer sichtbar.
            {...(point ? {} : sizeAttrs(r))}
            onClick={() => editing.select(a.id)}
            onDoubleClick={() => editing.edit(a.id)}
          >
            {isSelected && engine ? (
              <MovePin n={n} done={done} id={a.id} rect={r} bounds={itemWorldRect(item)} engine={engine} editing={editing} />
            ) : (
              <span className="mark-label__number">
                <PinContent n={n} done={done} />
              </span>
            )}
            {/* Eine Karte neben der Nummer: Notiz und die Antwort des Agenten, gewählt darunter die Knöpfe. */}
            {(isSelected || a.note || a.done?.reply) && (
              <span className="mark-label__note">
                {a.note && <span className="mark-label__text">{a.note}</span>}
                {a.done?.reply && (
                  <span className="mark-label__reply">
                    <span className="mark-label__who">{t("notes.replyBy")}</span> {a.done.reply}
                  </span>
                )}
                {isSelected && (
                  <span className="mark-label__actions">
                    <button
                      type="button"
                      className="button mark-label__action"
                      data-option={done ? "wieder-offen" : "erledigt"}
                      onClick={(e) => {
                        e.stopPropagation();
                        editing.setDone(a.id, !done);
                      }}
                    >
                      {done ? t("canvas.reopen") : t("canvas.markDone")}
                    </button>
                    <button
                      type="button"
                      className="button mark-label__action"
                      data-option="loeschen"
                      onClick={(e) => {
                        e.stopPropagation();
                        editing.remove(a.id);
                      }}
                    >
                      {t("canvas.delete")}
                    </button>
                  </span>
                )}
              </span>
            )}
          </div>
        ),
      )}

      {saving && <div className="mark" {...worldAttrs(saving.rect)} />}
      {drawing && <div className="mark mark--draft" data-scrim {...worldAttrs(drawing.rect)} />}
      {editor?.kind === "new" &&
        (isPointDraft(editor.draft) ? (
          <>
            {/* Neuer Punkt: schon mit der Nummer, die er bekommt. */}
            <div className="mark-label" data-point data-draft {...attachAttrs(editor.draft.rect, "label")}>
              <span className="mark-label__number">{state.annotations.length + 1}</span>
            </div>
            <NoteEditor at={editor.draft.rect} editing={editing} />
          </>
        ) : (
          <>
            <div className="mark mark--draft" data-scrim {...worldAttrs(editor.draft.rect)} />
            {engine && draftItem && <MarkHandles rect={editor.draft.rect} bounds={itemWorldRect(draftItem)} engine={engine} target={draftTarget(editing)} />}
            <NoteEditor at={editor.draft.rect} editing={editing} />
          </>
        ))}
    </>
  );
}

/** Inhalt der Nadel: die Nummer, bei erledigten mit Haken davor. */
function PinContent({ n, done }: { n: number; done: boolean }) {
  const { t } = useT();
  return (
    <>
      {done && (
        <svg className="mark-label__check" width="12" height="12" viewBox="0 0 12 12" aria-label={t("notes.doneMark")}>
          <path d="M2.5 6.4 4.9 8.7 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {n}
    </>
  );
}

/** Nummer des ausgewählten Rahmens: daran zieht man den Rahmen an eine andere Stelle. */
function MovePin({ n, done, id, rect, bounds, engine, editing }: { n: number; done: boolean; id: string; rect: WorldRect; bounds: WorldRect; engine: Engine; editing: AnnotationEditing }) {
  const handlers = useReshape(rect, bounds, engine, annotationTarget(id, editing));
  const { t } = useT();
  return (
    <span className="mark-label__number" data-movable title={t("canvas.moveHint")} {...handlers("move")}>
      <PinContent n={n} done={done} />
    </span>
  );
}

/** Notizfeld am Rechteck, immer ganz im Bild. Enter sichert, Shift+Enter bricht um, Esc verwirft. */
function NoteEditor({ at, editing }: { at: WorldRect; editing: AnnotationEditing }) {
  const { t } = useT();
  const focusOnce = useCallback((el: HTMLTextAreaElement | null) => el?.focus({ preventScroll: true }), []);
  return (
    <div className="note-editor" data-surface-ui {...attachAttrs(at, "editor")}>
      <textarea
        className="note-editor__text"
        // Fokus ohne Scrollen: Am Rand würde der Browser sonst die Ebene verschieben.
        ref={focusOnce}
        rows={2}
        onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
        placeholder={t("canvas.notePlaceholder")}
        value={editing.editor?.text ?? ""}
        onChange={(e) => editing.type(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void editing.commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            editing.cancel();
          }
        }}
      />
      <div className="note-editor__actions">
        <button type="button" className="button button--quiet" data-option="verwerfen" onClick={editing.cancel}>
          {t("canvas.discard")}
        </button>
        <button type="button" className="button button--primary" data-option="sichern" onClick={() => void editing.commit()}>
          {t("canvas.save")}
        </button>
      </div>
    </div>
  );
}
