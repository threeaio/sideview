import { useCallback, useEffect, useRef, useState } from "react";
import { AnnotationList, CanvasView, ContentsMenu, showItems, useContents, useCurrentCanvas, useStage } from "../features/canvas/index.ts";
import { CanvasHome, CanvasSwitcher, useCanvasSwitcher } from "../features/canvases/index.ts";
import { ReviewBar, useReview } from "../features/review/index.ts";
import { SettingsDialog, useSettings } from "../features/settings/index.ts";
import { VoiceControl } from "../features/voice/index.ts";
import { useT } from "../shared/i18n.tsx";
import { rendererExtensions } from "./extensions.ts";

export function App() {
  const { state, show } = useCurrentCanvas();
  const { t } = useT();
  const contents = useContents();
  const stage = useStage();
  const settings = useSettings();
  // Startansicht über einem offenen Canvas (⌘O, „alle Canvases“); öffnet sich ein Canvas, geht sie zu.
  const [home, setHome] = useState(false);
  const showHome = useCallback(() => setHome(true), []);
  const closeHome = useCallback(() => setHome(false), []);
  useEffect(() => setHome(false), [state?.name]);
  const switcher = useCanvasSwitcher(state?.name ?? null, showHome);
  // Erweiterungen legen Bilder auf; danach dorthin fahren, sobald sie im Stand sind.
  const latest = useRef(state);
  latest.current = state;
  const engine = contents.engine;
  const placed = useCallback(
    (ids: string[]) =>
      setTimeout(() => {
        if (engine && latest.current) showItems(engine, latest.current.items, ids);
      }, 120),
    [engine],
  );
  // Wartet Claude auf eine Besprechung, wechselt das Canvas auf Markieren.
  const reviewing = useReview(state?.name ?? "").waiting;
  return (
    <div className="app" data-stage={stage}>
      <ReviewBar
        canvas={state}
        inverse={stage === "dark"}
        title={
          state ? (
            // Pfad oben links (22.11.: zur Übersicht nur über das Inhaltsverzeichnis, ganz unten): „Canvases“ führt hin.
            <nav className="crumbs" aria-label={t("app.crumbs")}>
              <button type="button" className="crumbs__home" data-option="canvases" title={t("app.canvasesTitle")} onClick={showHome}>
                {t("app.canvases")}
              </button>
              <span className="crumbs__sep" aria-hidden="true">/</span>
              <ContentsMenu state={state} contents={contents} onCanvases={showHome} onBack={home ? closeHome : undefined} />
            </nav>
          ) : undefined
        }
        end={state ? <AnnotationList state={state} contents={contents} /> : undefined}
      />
      <main>
        <CanvasView state={state} show={show} contents={contents} stage={stage} reviewing={reviewing} empty={<CanvasHome onNew={() => switcher.show("new")} />} />
        {home && state && <CanvasHome onNew={() => switcher.show("new")} current={state.name} onClose={closeHome} />}
      </main>
      <VoiceControl />
      <SettingsDialog settings={settings} />
      <CanvasSwitcher switcher={switcher} />
      {rendererExtensions.map(({ name, extension: { Layer } }) => Layer && <Layer key={name} canvas={state?.name ?? null} showItems={placed} />)}
    </div>
  );
}
