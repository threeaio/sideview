// Canvas wechseln: eine ruhige Karte im oberen Drittel, wie Spotlight. Oben das Feld (Suche oder Name des neuen
// Canvas), darunter die Canvases mit Vorschau, Inhalt und wann zuletzt geändert, unten „Neuer Canvas“.
// Tasten im Dialog erreichen das Canvas nicht.

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CanvasSummary } from "../../../shared/contracts.ts";
import { canvasesKeys, canvasesService } from "./canvases-service.ts";
import { contentsLine, since } from "./format.ts";
import type { CanvasSwitcherModel } from "./useCanvasSwitcher.ts";
import { useT } from "../../shared/i18n.tsx";
import "./canvases.css";

const COVER = { w: 64, h: 44 };

export function CanvasSwitcher({ switcher: s }: { switcher: CanvasSwitcherModel }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const { t } = useT();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (s.open && !d.open) d.showModal();
    if (!s.open && d.open) d.close();
  }, [s.open]);

  // Feld vorn halten, auch nach dem Wechsel in „Neuer Canvas“.
  useEffect(() => {
    if (s.open) field.current?.focus();
  }, [s.open, s.mode]);

  useEffect(() => {
    list.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [s.active]);

  const creating = s.mode === "new";

  return (
    <dialog
      ref={dialog}
      className="switcher"
      aria-label={creating ? t("switcher.new") : t("switcher.switch")}
      onClose={s.close}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          s.back();
        } else if (e.key === "ArrowDown" && !creating) {
          e.preventDefault();
          s.move(1);
        } else if (e.key === "ArrowUp" && !creating) {
          e.preventDefault();
          s.move(-1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          s.confirm();
        }
      }}
      onPointerDown={(e) => {
        if (e.target === dialog.current) s.close();
      }}
    >
      <div className="switcher__field-row" data-mode={s.mode}>
        <svg className="switcher__icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          {creating ? (
            <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          ) : (
            <>
              <circle cx="7" cy="7" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="m10.2 10.2 3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </>
          )}
        </svg>
        <input
          ref={field}
          className="switcher__field"
          value={s.query}
          onChange={(e) => s.setQuery(e.target.value)}
          placeholder={creating ? t("switcher.newName") : t("switcher.search")}
          aria-label={creating ? t("switcher.newName") : t("switcher.search")}
          spellCheck={false}
          autoComplete="off"
        />
        {creating && (
          <button type="button" className="button button--primary button--small" data-option="canvas-anlegen" disabled={s.busy} onClick={() => void s.create()}>
            {t("switcher.create")}
          </button>
        )}
      </div>

      {creating ? (
        <p className="switcher__hint">{t("switcher.hint")}</p>
      ) : (
        <ul className="switcher__list" ref={list} role="listbox" aria-label={t("switcher.list")}>
          {s.canvases.map((c, i) => (
            <CanvasRow key={c.name} c={c} index={i} active={s.active === i} current={c.name === s.current} onHover={() => s.setActive(i)} onChoose={() => void s.choose(c.name)} />
          ))}
          {!s.loading && s.canvases.length === 0 && <li className="switcher__none">{t("switcher.noMatch")}</li>}
          <li role="option" aria-selected={s.active === s.canvases.length}>
            <button
              type="button"
              className="switcher__row switcher__row--new"
              data-active={s.active === s.canvases.length || undefined}
              data-option="neuer-canvas"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onPointerMove={() => s.setActive(s.canvases.length)}
              onClick={() => s.show("new")}
            >
              <span className="switcher__cover switcher__cover--new" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16">
                  <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <span className="switcher__title">{t("switcher.new")}</span>
              <kbd className="switcher__kbd">⌘N</kbd>
            </button>
          </li>
        </ul>
      )}
    </dialog>
  );
}

function CanvasRow({ c, index, active, current, onHover, onChoose }: { c: CanvasSummary; index: number; active: boolean; current: boolean; onHover(): void; onChoose(): void }) {
  const size = Math.round(COVER.w * 2 * (window.devicePixelRatio || 1));
  const { t, lang } = useT();
  const cover = useQuery({
    queryKey: canvasesKeys.cover(c.name, c.cover ?? "", c.updatedAt, size),
    queryFn: () => canvasesService.cover(c.name, c.cover!, size),
    enabled: !!c.cover,
    staleTime: Infinity,
  }).data;
  return (
    <li role="option" aria-selected={active}>
      <button
        type="button"
        className="switcher__row"
        data-active={active || undefined}
        data-option={`canvas-${index + 1}`}
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onPointerMove={onHover}
        onClick={onChoose}
      >
        <span className="switcher__cover">{cover && <img src={cover} alt="" draggable={false} onLoad={(e) => (e.currentTarget.dataset.loaded = "")} />}</span>
        <span className="switcher__text">
          <span className="switcher__title">{c.title}</span>
          <span className="switcher__meta">
            {contentsLine(c, lang)} · {since(c.updatedAt, undefined, lang)}
          </span>
        </span>
        {current && <span className="switcher__current">{t("home.open")}</span>}
      </button>
    </li>
  );
}
