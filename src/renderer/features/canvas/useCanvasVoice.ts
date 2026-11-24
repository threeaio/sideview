// Was man auf der Fläche sagen kann. Dieselben Handler wie Tasten und Knöpfe: Bereiche anfahren,
// Übersicht, näher und weiter weg, Anmerkungen wählen, ändern und löschen, Notiz diktieren und sichern.

import type { CanvasState } from "../../../shared/contracts.ts";
import { groupArea } from "../../../shared/groups.ts";
import { normalize, numberWords } from "../../../shared/voice.ts";
import { useT } from "../../shared/i18n.tsx";
import { useVoiceCommands, type VoiceCommand } from "../voice/index.ts";
import { panBy } from "./engine/camera.ts";
import type { Engine } from "./engine/engine.ts";
import { contentBounds } from "./engine/geometry.ts";
import { imageName, itemInView, showAnnotation, showGroup, showItem, showRegion } from "./navigation.ts";
import type { AnnotationEditing } from "./useAnnotationEditing.ts";
import type { Arrange } from "./useArrange.ts";
import type { Compare } from "./useCompare.ts";
import type { Contents } from "./useContents.ts";

/** Faktor für „näher“ und „weiter weg“. Stärker als die Tasten, weil man es seltener sagt. */
const VOICE_ZOOM = 1.6;
/** „runter“, „nach links“: so viel des Sichtfensters, wie im Vergleich. */
const VOICE_PAN = 0.6;

/** „heise.de Handy“ spricht man „heise Handy“. */
const withoutDomain = (title: string) => title.replace(/\b([a-z0-9-]+)\.[a-z]{2,6}\b/gi, "$1");

const phrases = (...words: (string | null | undefined)[]) => [...new Set(words.filter((w): w is string => Boolean(w)).map(normalize).filter(Boolean))];

/** Die Gruppe, deren Fläche der Mitte des Fensters am nächsten liegt, etwa in der Übersicht, wo alles zu sehen ist. */
function nearestGroup(engine: Engine, state: CanvasState): string | null {
  const cam = engine.camera();
  const vp = engine.viewport();
  const c = { x: cam.x + vp.w / cam.z / 2, y: cam.y + vp.h / cam.z / 2 };
  let best: { id: string; d: number } | null = null;
  for (const group of state.groups) {
    const r = groupArea(group, state.items);
    if (!r) continue;
    const d = Math.hypot(Math.max(r.x - c.x, 0, c.x - (r.x + r.w)), Math.max(r.y - c.y, 0, c.y - (r.y + r.h)));
    if (!best || d < best.d) best = { id: group.id, d };
  }
  return best?.id ?? null;
}

export function useCanvasVoice(engine: Engine | null, state: CanvasState | null, editing: AnnotationEditing, contents: Contents, compare: Compare, arrange: Arrange) {
  const { t, phrases: say, lang } = useT();
  const commands: VoiceCommand[] = [];

  // Im Vergleich der Fassungen gelten nur dessen Befehle (VersionCompare).
  if (engine && state && !compare.item) {
    const zoomBy = (factor: number) => {
      const cam = engine.camera();
      const vp = engine.viewport();
      const w = vp.w / cam.z / factor;
      const h = vp.h / cam.z / factor;
      const cx = cam.x + vp.w / cam.z / 2;
      const cy = cam.y + vp.h / cam.z / 2;
      void engine.fit({ x: cx - w / 2, y: cy - h / 2, w, h }, { padding: 0, maxZoom: 8 });
    };
    const panView = (dx: number, dy: number) => {
      const vp = engine.viewport();
      void engine.flyTo(panBy(engine.camera(), -dx * vp.w * VOICE_PAN, -dy * vp.h * VOICE_PAN));
    };
    commands.push(
      {
        id: "uebersicht",
        label: t("cmd.overview.label"),
        meaning: "Show everything on the canvas at once (overview).",
        phrases: say("cmd.overview.phrases"),
        run: () => {
          const bounds = contentBounds(state.items, state.groups);
          if (bounds) void engine.fit(bounds, { padding: 64, maxZoom: 1 });
        },
      },
      {
        id: "inhalt",
        label: t(contents.open ? "cmd.contentsClose.label" : "cmd.contents.label"),
        meaning: contents.open ? "Close the table of contents of the canvas." : "Open the table of contents: a list of all images and regions on the canvas.",
        phrases: say(contents.open ? "cmd.contentsClose.phrases" : "cmd.contents.phrases"),
        run: contents.toggle,
      },
      {
        id: "anmerkungen",
        label: t(contents.notesOpen ? "cmd.notesClose.label" : "cmd.notes.label"),
        meaning: contents.notesOpen ? "Close the list of annotations." : "Open the list of all annotations on the canvas, with their notes.",
        phrases: say(contents.notesOpen ? "cmd.notesClose.phrases" : "cmd.notes.phrases"),
        run: contents.toggleNotes,
      },
      { id: "naeher", label: t("cmd.zoomIn.label"), meaning: "Zoom in a step.", phrases: say("cmd.zoomIn.phrases"), run: () => zoomBy(VOICE_ZOOM) },
      { id: "weiter-weg", label: t("cmd.zoomOut.label"), meaning: "Zoom out a step.", phrases: say("cmd.zoomOut.phrases"), run: () => zoomBy(1 / VOICE_ZOOM) },
      { id: "runter", label: t("cmd.compareDown.label"), meaning: "Move the view down a step (scroll down).", phrases: say("cmd.compareDown.phrases"), run: () => panView(0, 1) },
      { id: "hoch", label: t("cmd.compareUp.label"), meaning: "Move the view up a step (scroll up).", phrases: say("cmd.compareUp.phrases"), run: () => panView(0, -1) },
      { id: "nach-links", label: t("cmd.panLeft.label"), meaning: "Move the view to the left a step.", phrases: say("cmd.panLeft.phrases"), run: () => panView(-1, 0) },
      { id: "nach-rechts", label: t("cmd.panRight.label"), meaning: "Move the view to the right a step.", phrases: say("cmd.panRight.phrases"), run: () => panView(1, 0) },
    );

    // Jedes Bild über seinen Namen: „zeig mir heise Handy“. Namen sind je Fläche eindeutig (canvas-store).
    state.items.forEach((item, i) => {
      const name = imageName(item.title);
      commands.push({
        id: `bild-${i}`,
        label: name,
        meaning: `Fly to and show the whole image „${item.title}“.`,
        phrases: phrases(name, withoutDomain(name)),
        run: () => showItem(engine, item),
      });
      // Die Zahl an der Marke des Bildes: Liste nur mit seinen Anmerkungen.
      if (state.annotations.some((a) => a.itemId === item.id))
        commands.push({
          id: `anmerkungen-bild-${i}`,
          label: t("cmd.imageNotes.label", { name }),
          meaning: `Open the list of annotations, showing only those on the image „${item.title}“.`,
          phrases: say("cmd.imageNotes.phrases", { name, short: withoutDomain(name) }),
          run: () => contents.showNotes(item.id),
        });
    });
    // Fassungen: je Bild mit früheren Fassungen über seinen Namen, ohne Namen das Bild im Blick.
    const versioned = state.items.filter((item) => item.versions?.length);
    state.items.forEach((item, i) => {
      if (!item.versions?.length) return;
      const name = imageName(item.title);
      commands.push({
        id: `fassungen-bild-${i}`,
        label: t("cmd.compareImage.label", { name }),
        meaning: `Compare the versions of the image „${item.title}“ side by side: an earlier one left, the current one right.`,
        phrases: say("cmd.compareImage.phrases", { name, short: withoutDomain(name) }),
        run: () => compare.open(item.id),
      });
    });
    if (versioned.length)
      commands.push({
        id: "fassungen-vergleichen",
        label: t("cmd.compare.label"),
        meaning: "Compare the versions of the image in view (or the only image with earlier versions) side by side.",
        phrases: say("cmd.compare.phrases"),
        run: () => {
          const seen = itemInView(engine, state.items);
          compare.open((versioned.find((item) => item.id === seen) ?? versioned[0]!).id);
        },
      });
    if (contents.notesOpen && contents.notesFor)
      commands.push({ id: "alle-anmerkungen", label: t("cmd.allNotes.label"), meaning: "Show all annotations in the list again, not only those of one image.", phrases: say("cmd.allNotes.phrases"), run: () => contents.showNotes(null) });

    // Jede Gruppe über ihren Namen: „Mostly Air“ oder „Gruppe Mostly Air“ („group Mostly Air“).
    state.groups.forEach((group, k) => {
      const name = group.title.toLowerCase();
      commands.push({
        id: `gruppe-${k}`,
        label: group.title,
        meaning: `Fly to and show the whole group „${group.title}“ with all its images.`,
        phrases: say("cmd.group.phrases", { name }),
        run: () => showGroup(engine, group, state.items),
      });
    });

    // Gruppe umbenennen: über ihren Namen, oder ohne Namen die gewählte, die im Blick oder die einzige.
    // Danach steht das Feld offen; Gesagtes ersetzt den Namen, „sichern“ übernimmt (GroupNameEditor).
    if (!arrange.renaming) {
      const rename = (groupId: string) => {
        const group = state.groups.find((g) => g.id === groupId);
        if (group) showGroup(engine, group, state.items);
        arrange.startRename(groupId);
      };
      state.groups.forEach((group, k) => {
        const name = group.title.toLowerCase();
        commands.push({
          id: `gruppe-umbenennen-${k}`,
          label: t("cmd.renameGroup.label", { name: group.title }),
          meaning: `Rename the group „${group.title}“: open its name field.`,
          phrases: say("cmd.renameGroup.phrases", { name }),
          run: () => rename(group.id),
        });
      });
      if (state.groups.length)
        commands.push({
          id: "gruppe-umbenennen",
          label: t("cmd.renameGroupHere.label"),
          meaning: "Rename the selected group, or the group in view (nearest to the middle): open its name field.",
          phrases: say("cmd.renameGroupHere.phrases"),
          run: () => {
            const chosen = arrange.selection?.kind === "group" ? arrange.selection.id : null;
            const seen = itemInView(engine, state.items);
            const target = chosen ?? state.groups.find((g) => seen && g.itemIds.includes(seen))?.id ?? nearestGroup(engine, state);
            if (target) rename(target);
          },
        });
    }

    const several = state.items.length > 1;
    state.items.forEach((item, i) =>
      item.regions.forEach((region, j) => {
        const where = several ? ` (${imageName(item.title)})` : "";
        commands.push({
          id: `bereich-${i}-${j}`,
          label: `${region.label}${where}`,
          meaning:
            `Fly to and show the ${region.kind === "head" ? "top (head) of the page" : region.kind === "foot" ? "footer of the page" : "section"} „${region.label}“ of the image „${item.title}“.` +
            (region.aliases.length ? ` Keywords: ${region.aliases.join(", ")}.` : ""),
          phrases: phrases(region.label, region.heading, ...region.aliases),
          // Die Kamera bewegt sich ohne neues Rendern; deshalb erst beim Sprechen nachsehen.
          prefer: several ? () => itemInView(engine, state.items) === item.id : undefined,
          run: () => showRegion(engine, item, region),
        });
      }),
    );

    state.annotations.forEach((a, index) => {
      const item = state.items.find((x) => x.id === a.itemId);
      const n = index + 1;
      commands.push({
        id: `anmerkung-${n}`,
        label: t("cmd.annotation.label", { n }),
        meaning: `Select annotation number ${n}${a.note ? ` („${a.note.slice(0, 80)}“)` : ""} and show it.`,
        phrases: phrases(...numberWords(n, lang).flatMap((w) => say("cmd.annotation.phrases", { w }))),
        run: () => {
          editing.select(a.id);
          if (item) showAnnotation(engine, item, a, contents.notesInset());
        },
      });
    });

    if (editing.selected && !editing.editor) {
      const id = editing.selected;
      commands.push(
        { id: "loeschen", label: t("cmd.delete.label"), meaning: "Delete the selected annotation.", phrases: say("cmd.delete.phrases"), run: () => editing.remove(id) },
        { id: "aendern", label: t("cmd.edit.label"), meaning: "Edit the note of the selected annotation.", phrases: say("cmd.edit.phrases"), run: () => editing.edit(id) },
      );
      const done = Boolean(state.annotations.find((a) => a.id === id)?.done);
      commands.push(
        done
          ? { id: "wieder-offen", label: t("cmd.reopen.label"), meaning: "Mark the selected annotation as open again (not done).", phrases: say("cmd.reopen.phrases"), run: () => editing.setDone(id, false) }
          : { id: "erledigt", label: t("cmd.markDone.label"), meaning: "Mark the selected annotation as done (resolved).", phrases: say("cmd.markDone.phrases"), run: () => editing.setDone(id, true) },
      );
    }

    if (editing.editor) {
      commands.push(
        { id: "sichern", label: t("cmd.save.label"), meaning: "Save the note.", phrases: say("cmd.save.phrases"), whileDictating: true, run: () => editing.commit() },
        { id: "verwerfen", label: t("cmd.discard.label"), meaning: "Discard the note.", phrases: say("cmd.discard.phrases"), whileDictating: true, run: () => editing.cancel() },
      );
    }
  }

  const selectedIndex = state?.annotations.findIndex((a) => a.id === editing.selected) ?? -1;
  useVoiceCommands("canvas", {
    commands,
    dictation: editing.editor ? { append: editing.append, commit: editing.commit } : null,
    screen: {
      description:
        `A canvas with full-page screenshots of websites. The user looks at them with Claude, zooms into regions, draws rectangles with notes, and finally says „${t("review.finish")}“ to send the notes to Claude.`,
      state: {
        images: state?.items.map((i) => ({ title: i.title, regions: i.regions.map((r) => r.label) })) ?? [],
        annotations: state?.annotations.map((a, i) => ({ number: i + 1, note: a.note, done: Boolean(a.done) })) ?? [],
        selectedAnnotation: selectedIndex >= 0 ? selectedIndex + 1 : null,
        noteFieldOpen: Boolean(editing.editor),
      },
    },
  });
}
