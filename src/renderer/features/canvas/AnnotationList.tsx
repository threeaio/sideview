// Liste der Anmerkungen, aufgeklappt am Zähler oben rechts. Je Anmerkung ein Ausschnitt mit ihrer Nummer, die
// Notiz und wo sie sitzt. Ein Klick wählt sie und fährt hin; die Liste bleibt offen, damit man weiterblättern kann
// (Pfeil hoch, Pfeil runter). Enter ändert die Notiz. Über die Zahl an der Marke eines Bildes zeigt sie nur dessen
// Anmerkungen; die Nummern bleiben dieselben wie auf dem Canvas. Ein Klick daneben schließt sie, wie beim Inhaltsverzeichnis.

import { useEffect, useRef, useState } from "react";
import type { Annotation, CanvasState, ImageItem } from "../../../shared/contracts.ts";
import { isTyping } from "./engine/input.ts";
import { imageName, showAnnotation } from "./navigation.ts";
import { regionAt } from "../../../shared/region-at.ts";
import type { Contents } from "./useContents.ts";
import { useThumbnail } from "./useThumbnail.ts";
import { useT, type Translate } from "../../shared/i18n.tsx";

const THUMB = { w: 88, h: 66 };

/** „heute 18:04“, sonst „21.11. 18:04“; englisch „today 6:04 PM“, sonst „Nov 21 6:04 PM“. */
function doneTime(iso: string, { t, lang, locale }: Translate): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const today = new Date().toDateString() === d.toDateString();
  if (today) return t("notes.today", { time });
  const date = lang === "de" ? `${d.getDate()}.${d.getMonth() + 1}.` : d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  return `${date} ${time}`;
}

export function AnnotationList({ state, contents }: { state: CanvasState; contents: Contents }) {
  const open = contents.notesOpen;
  const { t } = useT();
  const selected = contents.selection?.selected ?? null;
  const count = state.annotations.length;
  // Der Zähler nennt die offenen; erledigte bleiben in der Liste, mit Haken.
  const done = state.annotations.filter((a) => a.done).length;
  const openCount = count - done;
  // Beschränkt auf ein Bild, solange es noch Anmerkungen hat.
  const only = contents.notesFor && state.annotations.some((a) => a.itemId === contents.notesFor) ? state.items.find((i) => i.id === contents.notesFor) ?? null : null;
  const shown = state.annotations.map((a, i) => ({ a, n: i + 1 })).filter(({ a }) => !only || a.itemId === only.id);
  const list = useRef<HTMLOListElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  // Vorschaubilder erst holen, wenn die Liste einmal offen war.
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (open) setSeen(true);
  }, [open]);

  const go = (a: Annotation) => {
    const item = state.items.find((i) => i.id === a.itemId);
    contents.selection?.select(a.id);
    if (item && contents.engine) showAnnotation(contents.engine, item, a, contents.notesInset());
  };

  // Blättern mit den Pfeiltasten, solange die Liste offen ist und nichts getippt wird.
  const latest = useRef({ go, shown, selected, contents });
  latest.current = { go, shown, selected, contents };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping() || e.metaKey || e.ctrlKey || e.altKey) return;
      const { go, shown, selected, contents } = latest.current;
      const all = shown.map((s) => s.a);
      if (all.length === 0) return;
      const at = all.findIndex((a) => a.id === selected);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        const next = at < 0 ? (step > 0 ? 0 : all.length - 1) : Math.min(all.length - 1, Math.max(0, at + step));
        go(all[next]!);
      } else if (e.key === "Enter" && at >= 0) {
        e.preventDefault();
        contents.selection?.edit(all[at]!.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Ein Klick daneben schließt, wie beim Inhaltsverzeichnis.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!anchor.current?.contains(e.target as Node)) contents.close();
    };
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [open, contents.close]);

  // Die gewählte Anmerkung bleibt in der Liste sichtbar, auch wenn sie auf dem Canvas gewählt wurde.
  useEffect(() => {
    if (!open || !selected) return;
    list.current?.querySelector(`[data-note="${selected}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open, selected]);

  // Mehrere Bilder mit Anmerkungen: je Bild eine kleine Überschrift, in der Reihenfolge der Nummern.
  const withNotes = new Set(shown.map(({ a }) => a.itemId));
  const titled = withNotes.size > 1;

  return (
    <div className="notes" ref={anchor}>
      <button
        type="button"
        className="notes__trigger"
        data-option="anmerkungen"
        aria-expanded={open}
        aria-controls="notes-panel"
        onClick={contents.toggleNotes}
      >
        <span className="notes__label">{t("count.annotations", { count: openCount })}</span>
        {done > 0 && <span className="notes__done">{t("notes.done", { count: done })}</span>}
        <svg className="notes__chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <section id="notes-panel" className="notes__panel" data-open={open || undefined} aria-label={t("notes.panel")} aria-hidden={!open}>
        {count === 0 ? (
          <div className="notes__empty">
            <p className="notes__empty-title">{t("notes.emptyTitle")}</p>
            <p className="notes__hint">{t("notes.emptyHint")}</p>
          </div>
        ) : (
          <>
            {only && (
              <div className="notes__filter">
                <span className="notes__filter-name">{imageName(only.title)}</span>
                <button type="button" className="notes__filter-all" data-option="alle-anmerkungen" onMouseDown={(e) => e.preventDefault()} onClick={() => contents.showNotes(null)}>
                  {t("notes.all", { count })}
                </button>
              </div>
            )}
            <ol className="notes__list" ref={list}>
              {shown.map(({ a, n }, i) => {
                const item = state.items.find((x) => x.id === a.itemId);
                const first = i === 0 || shown[i - 1]!.a.itemId !== a.itemId;
                return (
                  <li key={a.id} className="notes__row">
                    {titled && first && item && <p className="notes__image">{imageName(item.title)}</p>}
                    <NoteEntry canvas={state.name} a={a} n={n} item={item} titled={titled || only !== null} current={a.id === selected} load={seen} onClick={() => go(a)} />
                  </li>
                );
              })}
            </ol>
            <p className="notes__hint notes__keys">
              <kbd>↑</kbd> <kbd>↓</kbd> {t("notes.keysBrowse")} · <kbd>Enter</kbd> {t("notes.keysEdit")}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function NoteEntry({ canvas, a, n, item, titled, current, load, onClick }: { canvas: string; a: Annotation; n: number; item: ImageItem | undefined; titled: boolean; current: boolean; load: boolean; onClick(): void }) {
  const thumb = useThumbnail(canvas, item, a.rect, THUMB.w * 2, load);
  const i18n = useT();
  const { t } = i18n;
  const region = item ? regionAt(item.regions, a.rect) : null;
  // Ort: Bereich, sonst das Bild (nur, wenn es keine Überschrift je Bild gibt).
  const where = region?.label ?? (!titled && item ? imageName(item.title) : null);
  return (
    <button
      type="button"
      className="note-entry"
      data-note={a.id}
      data-option={`anmerkung-${n}`}
      aria-current={current || undefined}
      // Der Klick nimmt den Fokus nicht: Pfeiltasten und Kürzel gelten weiter dem Canvas.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <span className="note-entry__thumb">
        {thumb && <img className="note-entry__image" src={thumb} alt="" draggable={false} onLoad={(e) => (e.currentTarget.dataset.loaded = "")} />}
      </span>
      <span className="note-entry__pin" data-done={a.done ? "" : undefined}>
        {a.done && (
          <svg className="note-entry__check" width="12" height="12" viewBox="0 0 12 12" aria-label={t("notes.doneMark")}>
            <path d="M2.5 6.4 4.9 8.7 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {n}
      </span>
      <span className="note-entry__text">
        <span className="note-entry__note" data-empty={!a.note || undefined}>
          {a.note || t("notes.noNote")}
        </span>
        {a.done?.reply && (
          <span className="note-entry__reply">
            <span className="note-entry__who">Claude</span> {a.done.reply}
          </span>
        )}
        {(where || a.done) && <span className="note-entry__where">{[where, a.done ? t("notes.doneAt", { when: doneTime(a.done.at, i18n) }) : null].filter(Boolean).join(" · ")}</span>}
      </span>
    </button>
  );
}
