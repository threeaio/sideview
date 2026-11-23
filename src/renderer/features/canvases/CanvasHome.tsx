// Startansicht ohne offenes Canvas: Kacheln mit Vorschau, Name, Inhalt und letzter Änderung; vorne „Neuer Canvas“.

import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CanvasSummary } from "../../../shared/contracts.ts";
import { canvasesKeys, canvasesService } from "./canvases-service.ts";
import { contentsLine, since } from "./format.ts";
import { useCanvasHome } from "./useCanvasHome.ts";
import { useT } from "../../shared/i18n.tsx";
import "./canvases.css";

const COVER_W = 280;

/** `current`, `onClose`: über einem offenen Canvas (⌘O); Esc oder die Kachel des offenen Canvas führen zurück. */
export function CanvasHome({ onNew, current = null, onClose }: { onNew(): void; current?: string | null; onClose?: () => void }) {
  const home = useCanvasHome(true, onClose);
  const { t } = useT();
  const choose = (name: string) => (name === current ? onClose?.() : home.open(name));
  return (
    // data-surface-ui: Rollen und Klicks gehören der Startansicht, nicht der Fläche darunter.
    <div className="home" data-surface-ui data-layer={onClose ? "" : undefined}>
      <div className="home__inner">
        <p className="home__title">{home.canvases.length ? t("home.title") : t("home.none")}</p>
        <p className="home__hint">{t("home.hint")}</p>
        <ul className="home__grid">
          <li>
            <button type="button" className="home-tile home-tile--new" data-option="neuer-canvas" onClick={onNew}>
              <span className="home-tile__cover home-tile__cover--new" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 16 16">
                  <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <span className="home-tile__title">{t("home.new")}</span>
              <span className="home-tile__meta">⌘N</span>
            </button>
          </li>
          {home.canvases.map((c, i) => (
            <Tile key={c.name} c={c} index={i} current={c.name === current} onOpen={() => choose(c.name)} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function Tile({ c, index, current, onOpen }: { c: CanvasSummary; index: number; current: boolean; onOpen(): void }) {
  const size = Math.round(COVER_W * (window.devicePixelRatio || 1));
  const { t, lang } = useT();
  const cover = useQuery({
    queryKey: canvasesKeys.cover(c.name, c.cover ?? "", c.updatedAt, size),
    queryFn: () => canvasesService.cover(c.name, c.cover!, size),
    enabled: !!c.cover,
    staleTime: Infinity,
  }).data;
  return (
    <li className="home__item" style={{ "--i": index } as CSSProperties}>
      <button type="button" className="home-tile" data-option={`start-canvas-${index + 1}`} onClick={onOpen}>
        <span className="home-tile__cover">{cover && <img src={cover} alt="" draggable={false} onLoad={(e) => (e.currentTarget.dataset.loaded = "")} />}</span>
        <span className="home-tile__title">{c.title}</span>
        <span className="home-tile__meta">
          {current ? `${t("home.open")} · ` : ""}
          {contentsLine(c, lang)} · {since(c.updatedAt, undefined, lang)}
        </span>
      </button>
    </li>
  );
}
