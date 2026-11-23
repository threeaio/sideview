// Name des Canvas in der Kopfzeile, darunter aufklappbar das Inhaltsverzeichnis: alle Bilder mit ihren
// Bereichen und der Zahl der Anmerkungen. Eine Auswahl fährt hin und schließt. Jeder Eintrag trägt dieselbe
// data-option wie sein Sprachbefehl.

import { useEffect, useRef } from "react";
import type { CanvasState, Group } from "../../../shared/contracts.ts";
import { imageName, showGroup, showItem, showRegion } from "./navigation.ts";
import type { Contents } from "./useContents.ts";
import { useT } from "../../shared/i18n.tsx";

/**
 * `onCanvases`: leiser Eintrag unten, der zur Liste aller Canvases führt. `onBack`: gesetzt, solange die Liste aller
 * Canvases über diesem Canvas liegt; dann führt ein Klick auf den Namen zurück in den Canvas (23.11., sein Wunsch),
 * statt das Inhaltsverzeichnis zu öffnen.
 */
export function ContentsMenu({ state, contents, onCanvases, onBack }: { state: CanvasState; contents: Contents; onCanvases?: () => void; onBack?: () => void }) {
  const anchor = useRef<HTMLDivElement>(null);
  const { t } = useT();
  const notes = (id: string) => state.annotations.filter((a) => a.itemId === id && !a.done).length;
  const go = (show: () => void) => {
    show();
    contents.close();
  };

  // Ein Klick daneben schließt, wie bei jedem Menü.
  useEffect(() => {
    if (!contents.open) return;
    const outside = (e: PointerEvent) => {
      if (!anchor.current?.contains(e.target as Node)) contents.close();
    };
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [contents.open, contents.close]);

  // Bilder in ihrer Reihenfolge; eine Gruppe steht dort, wo ihr erstes Bild steht, mit allen ihren Bildern darunter.
  const entries: ({ kind: "item"; index: number } | { kind: "group"; group: Group; k: number; members: number[] })[] = [];
  const listed = new Set<string>();
  state.items.forEach((item, i) => {
    const k = state.groups.findIndex((g) => g.itemIds.includes(item.id));
    if (k < 0) return entries.push({ kind: "item", index: i });
    const group = state.groups[k]!;
    if (listed.has(group.id)) return;
    listed.add(group.id);
    entries.push({ kind: "group", group, k, members: state.items.flatMap((x, j) => (group.itemIds.includes(x.id) ? [j] : [])) });
  });

  const itemEntry = (i: number) => {
    const item = state.items[i]!;
    return (
      <li key={item.id}>
        <button type="button" className="contents__entry" data-option={`bild-${i}`} onClick={() => contents.engine && go(() => showItem(contents.engine!, item))}>
          <span className="contents__name">{imageName(item.title)}</span>
          {notes(item.id) > 0 && <span className="contents__count">{notes(item.id)}</span>}
        </button>
        {item.regions.length > 0 && (
          <ol className="contents__list">
            {item.regions.map((region, j) => (
              <li key={j}>
                <button type="button" className="contents__entry contents__entry--region" data-option={`bereich-${i}-${j}`} onClick={() => contents.engine && go(() => showRegion(contents.engine!, item, region))}>
                  <span className="contents__name">{region.label}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </li>
    );
  };

  return (
    <div className="contents" ref={anchor}>
      <button type="button" className="contents__title" data-option="inhalt" aria-expanded={onBack ? undefined : contents.open} aria-haspopup={onBack ? undefined : "true"} onClick={onBack ?? contents.toggle}>
        <span className="contents__name">{state.title}</span>
{!onBack && (
                  <svg className="contents__chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        )}
      </button>
      {contents.open && (
        <nav className="contents__menu" aria-label={t("contents.menu")}>
          <ol className="contents__list">
            {entries.map((entry) =>
              entry.kind === "item" ? (
                itemEntry(entry.index)
              ) : (
                <li key={entry.group.id}>
                  <button type="button" className="contents__entry contents__entry--group" data-option={`gruppe-${entry.k}`} onClick={() => contents.engine && go(() => showGroup(contents.engine!, entry.group, state.items))}>
                    <span className="contents__name">{entry.group.title}</span>
                  </button>
                  <ol className="contents__list contents__list--group">{entry.members.map(itemEntry)}</ol>
                </li>
              ),
            )}
          </ol>
          {onCanvases && (
            <button type="button" className="contents__entry contents__entry--switch" data-option="canvases" onClick={() => go(onCanvases)}>
              <span className="contents__name">{t("contents.allCanvases")}</span>
              <kbd className="contents__kbd">⌘O</kbd>
            </button>
          )}
        </nav>
      )}
    </div>
  );
}
