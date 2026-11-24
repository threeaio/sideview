// Fassungsvergleich (23.11.: „Bau den Fassungsvergleich nebeneinander, ohne Schieberegler“). Deckt die Fläche:
// links eine frühere Fassung, rechts die aktuelle, beide in derselben Breite, eine Kamera für beide. Jede Hälfte
// zeigt die Anmerkungen, die auf ihrer Fassung entstanden sind. Unten die Leiste: Bild, ältere und neuere Fassung
// links, Fassung löschen, Schließen. Esc schließt, Pfeil links und rechts blättern links, Shift+1 zeigt wieder den Anfang,
// Löschtaste löscht die Fassung links (mit Rückgängig).

import { Fragment, useEffect, useRef } from "react";
import { isPoint, type Annotation, type ImageItem } from "../../../shared/contracts.ts";
import { normalize, numberWords } from "../../../shared/voice.ts";
import { useT } from "../../shared/i18n.tsx";
import { useVoiceCommands } from "../voice/index.ts";
import { isTyping } from "./engine/input.ts";
import { attachAttrs, sizeAttrs, worldAttrs } from "./engine/overlay.ts";
import { doneTime } from "./AnnotationList.tsx";
import { imageName } from "./navigation.ts";
import type { Compare } from "./useCompare.ts";
import { useComparePanes } from "./useComparePanes.ts";
import { annotationRect, compareWidth, sheetIndexOf, sheetRect, sheetsOf, type Sheet } from "./version-compare.ts";

/** Faktor für „näher“ und „weiter weg“, wie auf dem Canvas. */
const VOICE_ZOOM = 1.6;
const KEY_ZOOM = 1.25;

const phrases = (...words: (string | null | undefined)[]) => [...new Set(words.filter((w): w is string => Boolean(w)).map(normalize).filter(Boolean))];

const usePane = () => ({ root: useRef<HTMLDivElement>(null), gl: useRef<HTMLDivElement>(null), ghost: useRef<HTMLDivElement>(null) });

export function VersionCompare({ item, left, compare, annotations }: { item: ImageItem; left: number; compare: Compare; annotations: Annotation[] }) {
  const t = useT();
  const a = usePane();
  const b = usePane();
  const panes = useRef<[typeof a, typeof b]>([a, b]).current;
  const all = sheetsOf(item);
  const sheets: [Sheet, Sheet] = [all[left]!, all[all.length - 1]!];
  const width = compareWidth(item);
  const view = useComparePanes(panes, sheets, width);
  const older = left > 0;
  const newer = left < all.length - 2;

  // Tasten, solange der Vergleich offen ist. Im Capture, damit die Fläche darunter sie nicht auch bekommt.
  const latest = useRef({ compare, view, older, newer });
  latest.current = { compare, view, older, newer };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const { compare: c, view: v } = latest.current;
      const mod = e.metaKey || e.ctrlKey;
      let used = true;
      if (e.key === "Escape") c.close();
      else if (mod && (e.key === "=" || e.key === "+")) v.zoomBy(KEY_ZOOM);
      else if (mod && e.key === "-") v.zoomBy(1 / KEY_ZOOM);
      else if (mod || e.altKey) used = false;
      else if (e.key === "ArrowLeft") c.step(-1);
      else if (e.key === "ArrowRight") c.step(1);
      else if (e.key === "ArrowDown" || e.key === "PageDown") v.scroll(1);
      else if (e.key === "ArrowUp" || e.key === "PageUp") v.scroll(-1);
      else if (e.shiftKey && e.code === "Digit1") v.reset();
      else if (e.key === "Delete" || e.key === "Backspace") void c.removeLeft();
      // Was auf der Fläche darunter etwas ändern würde (Werkzeug, Bearbeiten), hier nicht.
      else used = ["KeyV", "KeyM", "Enter", "Digit2"].includes(e.code);
      if (used) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const numbered = annotations.map((an, i) => ({ an, n: i + 1 })).filter(({ an }) => an.itemId === item.id);
  const current = all.length - 1;

  // Links eine frühere Fassung über ihre Nummer: „Fassung zwei“.
  const byNumber = all.slice(0, current).map((sheet, i) => ({
    id: `vergleich-fassung-${sheet.n}`,
    label: t.t("cmd.compareVersion.label", { n: sheet.n }),
    meaning: `On the left, show version ${sheet.n} of ${sheet.total} of the image.`,
    phrases: phrases(...numberWords(sheet.n, t.lang).flatMap((w) => t.phrases("cmd.compareVersion.phrases", { w }))),
    run: () => compare.show(i),
  }));
  // Bereiche der aktuellen Fassung: beide Hälften fahren hin, wie auf dem Canvas.
  const regions = item.regions.map((region, j) => ({
    id: `vergleich-bereich-${j}`,
    label: region.label,
    meaning: `In both versions, go to the ${region.kind === "head" ? "top (head) of the page" : region.kind === "foot" ? "footer of the page" : "section"} „${region.label}“.` + (region.aliases.length ? ` Keywords: ${region.aliases.join(", ")}.` : ""),
    phrases: phrases(region.label, region.heading, ...region.aliases),
    run: () => view.show(annotationRect(region.rect, sheets[1], width)),
  }));
  // Anmerkungen über ihre Nummer; liegt sie auf einer anderen früheren Fassung, kommt die nach links.
  const notes = numbered.map(({ an, n }) => ({
    id: `vergleich-anmerkung-${n}`,
    label: t.t("cmd.annotation.label", { n }),
    meaning: `Go to annotation number ${n}${an.note ? ` („${an.note.slice(0, 80)}“)` : ""}, on the version it was made on.`,
    phrases: phrases(...numberWords(n, t.lang).flatMap((w) => t.phrases("cmd.annotation.phrases", { w }))),
    run: () => {
      const index = sheetIndexOf(an, item);
      if (index < current && index !== left) compare.show(index);
      view.show(annotationRect(an.rect, all[index]!, width), { padding: 96, maxZoom: 4 });
    },
  }));

  useVoiceCommands("compare", {
    commands: [
      ...byNumber,
      ...regions,
      ...notes,
      { id: "vergleich-schliessen", label: t.t("cmd.compareClose.label"), meaning: "Close the comparison of versions and return to the canvas.", phrases: t.phrases("cmd.compareClose.phrases"), run: compare.close },
      ...(older ? [{ id: "aeltere-fassung", label: t.t("cmd.compareOlder.label"), meaning: "On the left, show the next older version of the image.", phrases: t.phrases("cmd.compareOlder.phrases"), run: () => compare.step(-1) }] : []),
      ...(newer ? [{ id: "neuere-fassung", label: t.t("cmd.compareNewer.label"), meaning: "On the left, show the next newer earlier version of the image.", phrases: t.phrases("cmd.compareNewer.phrases"), run: () => compare.step(1) }] : []),
      { id: "fassung-loeschen", label: t.t("cmd.compareDelete.label"), meaning: "Delete the earlier version shown on the left, with the annotations made on it.", phrases: t.phrases("cmd.compareDelete.phrases"), run: () => void compare.removeLeft() },
      { id: "vergleich-anfang", label: t.t("cmd.overview.label"), meaning: "Show both versions from the top again, in full width.", phrases: t.phrases("cmd.overview.phrases"), run: view.reset },
      { id: "vergleich-naeher", label: t.t("cmd.zoomIn.label"), meaning: "Zoom in a step on both versions.", phrases: t.phrases("cmd.zoomIn.phrases"), run: () => view.zoomBy(VOICE_ZOOM) },
      { id: "vergleich-runter", label: t.t("cmd.compareDown.label"), meaning: "Scroll both versions down a step.", phrases: t.phrases("cmd.compareDown.phrases"), run: () => view.scroll(1) },
      { id: "vergleich-hoch", label: t.t("cmd.compareUp.label"), meaning: "Scroll both versions up a step.", phrases: t.phrases("cmd.compareUp.phrases"), run: () => view.scroll(-1) },
      { id: "vergleich-weiter-weg", label: t.t("cmd.zoomOut.label"), meaning: "Zoom out a step on both versions.", phrases: t.phrases("cmd.zoomOut.phrases"), run: () => view.zoomBy(1 / VOICE_ZOOM) },
    ],
    screen: {
      description: `Two versions of the image „${item.title}“ side by side: an earlier one on the left, the current one on the right. Zooming and scrolling move both.`,
      state: { comparing: item.title, left: sheets[0].n, right: sheets[1].n, versions: all.length, regions: item.regions.map((r) => r.label), annotations: numbered.map(({ an, n }) => ({ number: n, note: an.note })) },
    },
  });


  return (
    <div className="compare" data-surface-ui data-ready={view.ready || undefined} role="region" aria-label={t.t("compare.label")}>
      {[a, b].map((pane, k) => {
        const sheet = sheets[k]!;
        const index = all.indexOf(sheet);
        const marks = numbered.filter(({ an }) => sheetIndexOf(an, item) === index);
        return (
          <div key={k} className="compare__pane" ref={pane.root} data-camera>
            <div className="compare__gl" ref={pane.gl} />
            <div className="compare__overlay">
              {sheet.tiles && <div className="surface-frame" data-round {...worldAttrs(sheetRect(sheet, width))} />}
              {marks.map(({ an, n }) => {
                const r = annotationRect(an.rect, sheet, width);
                const point = isPoint(an.rect);
                return (
                  <Fragment key={an.id}>
                    <div className="mark" data-done={an.done ? "" : undefined} data-point={point || undefined} {...worldAttrs(r)} />
                    <div className="mark-label" data-done={an.done ? "" : undefined} data-point={point || undefined} {...attachAttrs(r, "label")} {...(point ? {} : sizeAttrs(r))}>
                      <span className="mark-label__number">{n}</span>
                      {an.note && (
                        <span className="mark-label__note">
                          <span className="mark-label__text">{an.note}</span>
                        </span>
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </div>
            {!sheet.tiles && <p className="compare__missing">{t.t("compare.missing")}</p>}
            <div className="compare__label" data-compare-ui>
              <span className="compare__version">{t.t("compare.sheet", { n: sheet.n, total: sheet.total })}</span>
              <span className="compare__when">{sheet.current ? t.t("compare.current") : sheet.replacedAt ? doneTime(sheet.replacedAt, t) : ""}</span>
            </div>
            <div className="compare__ghost" ref={pane.ghost} aria-hidden="true" />
          </div>
        );
      })}
      <div className="toolbar compare__bar" data-compare-ui role="toolbar" aria-label={t.t("compare.label")}>
        <span className="toolbar__info compare__title">{imageName(item.title)}</span>
        {all.length > 2 && (
          <>
            <span className="toolbar__divider" aria-hidden="true" />
            <div className="stepper" role="group">
              <button type="button" className="stepper__button" data-option="aeltere-fassung" title={`${t.t("compare.older")} (←)`} aria-label={t.t("compare.older")} disabled={!older} onClick={() => compare.step(-1)}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <span className="stepper__count">{t.t("compare.sheet", { n: sheets[0].n, total: sheets[0].total })}</span>
              <button type="button" className="stepper__button" data-option="neuere-fassung" title={`${t.t("compare.newer")} (→)`} aria-label={t.t("compare.newer")} disabled={!newer} onClick={() => compare.step(1)}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </>
        )}
        <span className="toolbar__divider" aria-hidden="true" />
        <button type="button" className="toolbar__tool" data-option="fassung-loeschen" title={t.t("compare.deleteTitle", { n: sheets[0].n })} onClick={() => void compare.removeLeft()}>
          {t.t("compare.delete")}
          <kbd>⌫</kbd>
        </button>
        <span className="toolbar__divider" aria-hidden="true" />
        <button type="button" className="toolbar__tool" data-option="vergleich-schliessen" onClick={compare.close}>
          {t.t("compare.close")}
          <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  );
}
