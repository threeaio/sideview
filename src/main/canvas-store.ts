// Ablage der Flächen als JSON-Canvas-Dateien in data/canvases. Schreibt atomar und je Fläche
// nacheinander, damit Oberfläche und MCP-Server sich nicht gegenseitig überschreiben.

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { imageSizeFromFile } from "image-size/fromFile";
import { paths } from "../shared/config.ts";
import { REPLY_MAX_CHARS, type AnnotationDone } from "../shared/contracts.ts";
import type { Annotation, AnnotationSource, Layout, CanvasState, CanvasSummary, Group, ImageItem, ImageOrigin, OpenRequest, OriginInput, Rect, RemovedItems } from "../shared/contracts.ts";
import { clampRect, defaultTitle, resolveAnnotations, resolveRemoval, emptyCanvas, metaProblem, originProblem, resolveOrigin, uniqueTitle, fromJsonCanvas, placeDropped, placeRight, slugify, stackVersion, summarize, toJsonCanvas, type JsonCanvasFile } from "./canvas-core.ts";
import { Failure } from "./failure.ts";
import { groupArea } from "../shared/groups.ts";
import { clearOf, freeSpot, groupOrigin, groupWidth, itemBox, makeRoom, rowPositions } from "../shared/layout.ts";
import { ensureRegions, knownRegions, loadRegionIndex, pageOrigin } from "./regions.ts";

export type CanvasStore = Awaited<ReturnType<typeof createCanvasStore>>;

/** Abgelegt an einer Stelle, an der schon etwas liegt: an die nächste freie Stelle, nichts liegt übereinander. */
function dropSpot(state: CanvasState, at: { x: number; y: number }, size: { width: number; height: number }) {
  const grouped = (id: string) => state.groups.some((g) => g.itemIds.includes(id));
  const others = [...state.items.filter((i) => !grouped(i.id)).map(itemBox), ...state.groups.flatMap((g) => groupArea(g, state.items) ?? [])];
  return freeSpot({ x: at.x, y: at.y, w: size.width, h: size.height }, others);
}
/**
 * Nach einer Änderung an Gruppen: Jede geänderte Gruppe wird wieder eine Reihe ab ihrem bisherigen Ursprung (eine
 * neue ab ihrem ersten Bild). Eine neue Gruppe aus Bildern, die schon lagen, rückt aus allem anderen heraus; was eine
 * gewachsene Gruppe oder ein größer gewordenes Bild überdeckt, rückt zur Seite. Alles andere bleibt liegen.
 */
function settle(state: CanvasState, before: Map<string, string[]>, changed: Set<string>, stay: string[] = []) {
  const items = () => state.items;
  for (const g of state.groups.filter((x) => changed.has(x.id))) {
    const members = g.itemIds.flatMap((id) => items().find((x) => x.id === id) ?? []);
    if (!members.length) continue;
    const was = (before.get(g.id) ?? []).filter((id) => items().some((x) => x.id === id));
    const origin = groupOrigin({ ...g, itemIds: was.length ? was : [members[0]!.id] }, items())!;
    for (const p of rowPositions(members, origin, groupWidth(g)).positions) Object.assign(items().find((x) => x.id === p.id)!, { x: p.x, y: p.y });
  }
  const live = state.groups.filter((g) => g.itemIds.length > 0);
  for (const g of live) if (changed.has(g.id) && !(before.get(g.id) ?? []).length) state.items = clearOf(state.items, live, g.id);
  state.items = makeRoom(state.items, live, [...live.filter((g) => changed.has(g.id)).map((g) => g.id), ...stay]);
}

export type NewAnnotation = { itemId: string; rect: Rect; note: string; source: AnnotationSource };

export async function createCanvasStore({ dir = paths.canvases(), now = () => new Date().toISOString() } = {}) {
  await fs.mkdir(dir, { recursive: true });
  const regionIndex = await loadRegionIndex();
  const fileOf = (name: string) => path.join(dir, `${slugify(name)}.canvas`);

  /** Bild von der Platte: Größe, Maßstab und Bereiche (page-shots oder Lauf). */
  async function loadImage(abs: string) {
    try {
      await fs.access(abs);
    } catch {
      throw new Failure("image_missing", abs);
    }
    const size = await imageSizeFromFile(abs);
    if (!size.width || !size.height) throw new Failure("image_missing", `no size: ${abs}`);
    const view = await ensureRegions(abs, regionIndex).catch(() => null);
    return { width: size.width, height: size.height, scale: view?.scale ?? 1, regions: view?.regions ?? [] };
  }

  /** Herkunft: von Claude angegeben (in open geprüft), sonst page-shots (Seite und Ansicht), sonst die Datei selbst. */
  async function originOf(abs: string, given: OriginInput | undefined): Promise<ImageOrigin> {
    return resolveOrigin(given, await pageOrigin(abs), abs, now());
  }
  const queues = new Map<string, Promise<unknown>>();

  /** Führt Änderungen an derselben Fläche nacheinander aus. */
  function serial<T>(name: string, job: () => Promise<T>): Promise<T> {
    const key = slugify(name);
    const next = (queues.get(key) ?? Promise.resolve()).then(job, job);
    queues.set(key, next.catch(() => {}));
    return next;
  }

  async function read(name: string): Promise<CanvasState | null> {
    let raw: string;
    try {
      raw = await fs.readFile(fileOf(name), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    const state = fromJsonCanvas(slugify(name), JSON.parse(raw) as JsonCanvasFile);
    const items = await Promise.all(state.items.map(async (item) => ({ ...item, regions: (await knownRegions(item.path, regionIndex))?.regions ?? [] })));
    return { ...state, items };
  }

  async function write(state: CanvasState): Promise<void> {
    const file = fileOf(state.name);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(toJsonCanvas(state), null, 2) + "\n");
    await fs.rename(tmp, file);
  }

  async function mustRead(name: string): Promise<CanvasState> {
    const state = await read(name);
    if (!state) throw new Failure("not_found", `canvas ${slugify(name)}`);
    return state;
  }

  return {
    async list(): Promise<CanvasSummary[]> {
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".canvas"));
      const states = await Promise.all(files.map((f) => read(f.replace(/\.canvas$/, ""))));
      return states
        .flatMap((s) => (s ? [summarize(s)] : []))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    get: read,

    /**
     * Öffnet oder legt eine Fläche an und legt neue Bilder rechts daneben, oder mit `at` dort ab, wo
     * sie hingezogen wurden. Vorhandene Bilder bleiben, wo sie sind.
     */
    open(name: string, req: OpenRequest): Promise<CanvasState> {
      return serial(name, async () => {
        const slug = slugify(name);
        // Angaben erst prüfen, dann ändern: Eine falsche Herkunft soll nichts halb ablegen.
        for (const image of req.images) {
          const problem = (image.origin ? originProblem(image.origin) : null) ?? (image.meta !== undefined ? metaProblem(image.meta) : null);
          if (problem) throw new Failure("bad_request", problem);
        }
        const state = (await read(slug)) ?? emptyCanvas(slug, req.title ?? name, now());
        if (req.title) state.title = req.title;
        // Gruppe nach Namen: vorhandene weiterbenutzen, sonst neu anlegen (bleibt leer weg, falls kein Bild kommt).
        let group: Group | null = null;
        if (req.group?.trim()) {
          const title = req.group.trim();
          group = state.groups.find((g) => g.title.toLowerCase() === title.toLowerCase()) ?? null;
          if (!group) {
            group = { id: randomUUID().slice(0, 8), title, itemIds: [] };
            state.groups.push(group);
          }
        }
        let dropped: ImageItem | null = null;
        /** Mitglieder je Gruppe vorher: Wo sich etwas ändert, wird die Gruppe danach wieder eine Reihe (settle). */
        const before = new Map(state.groups.map((g) => [g.id, [...g.itemIds]]));
        /** Gruppen, in denen ein Bild getauscht wurde: neu als Reihe ordnen, die Größe kann sich geändert haben. */
        const swapped = new Set<Group>();
        /** Getauschte Bilder ohne Gruppe: Was sie jetzt überdecken, rückt zur Seite. */
        const grownFree: string[] = [];
        for (const image of req.images) {
          const abs = path.resolve(image.path);
          if (image.replaces) {
            const target = state.items.find((i) => i.id === image.replaces);
            if (!target) throw new Failure("bad_request", `replaces: no image ${image.replaces}`);
            const loaded = await loadImage(abs);
            const versions = stackVersion(target, abs, now());
            Object.assign(target, {
              ...(versions.length ? { versions } : {}),
              path: abs,
              imageWidth: loaded.width,
              imageHeight: loaded.height,
              scale: loaded.scale,
              regions: loaded.regions,
              origin: await originOf(abs, image.origin),
              ...(image.meta ? { meta: image.meta } : {}),
              ...(image.title?.trim() ? { title: uniqueTitle(image.title.trim(), state.items.filter((i) => i !== target).map((i) => i.title)) } : {}),
            });
            const home = state.groups.find((g) => g.itemIds.includes(target.id));
            if (home) swapped.add(home);
            else grownFree.push(target.id);
            continue;
          }
          const existing = state.items.find((i) => i.path === abs);
          if (existing) {
            // Liegt schon da: neue Angaben übernehmen, sonst nur in die Gruppe nehmen, aus einer anderen heraus.
            if (image.meta) existing.meta = image.meta;
            if (group && !group.itemIds.includes(existing.id)) {
              for (const g of state.groups) g.itemIds = g.itemIds.filter((id) => id !== existing.id);
              group.itemIds.push(existing.id);
            }
            continue;
          }
          const loaded = await loadImage(abs);
          const shown = { width: loaded.width / loaded.scale, height: loaded.height / loaded.scale };
          const item: ImageItem = {
            id: randomUUID().slice(0, 8),
            path: abs,
            title: uniqueTitle(image.title?.trim() || defaultTitle(abs, await pageOrigin(abs)), state.items.map((i) => i.title)),
            origin: await originOf(abs, image.origin),
            ...(image.meta ? { meta: image.meta } : {}),
            imageWidth: loaded.width,
            imageHeight: loaded.height,
            scale: loaded.scale,
            ...(req.at ? dropSpot(state, placeDropped(req.at, shown, dropped), shown) : placeRight(state.items, state.groups, group)),
            regions: loaded.regions,
          };
          state.items.push(item);
          group?.itemIds.push(item.id);
          dropped = item;
        }
        const changed = new Set([...swapped].map((g) => g.id));
        for (const g of state.groups) if (JSON.stringify(g.itemIds) !== JSON.stringify(before.get(g.id) ?? [])) changed.add(g.id);
        settle(state, before, changed, grownFree);
        state.groups = state.groups.filter((g) => g.itemIds.length > 0);
        state.updatedAt = now();
        await write(state);
        return state;
      });
    },

    /**
     * Anordnung setzen: Lage der genannten Bilder, Gruppen ganz ersetzt. Nur vorhandene Bilder zählen, leere Gruppen
     * fallen weg. Bilder, die die Anordnung nicht kennt (Claude hat sie seitdem aufgelegt, etwa während der Nutzer zog oder
     * vor einem Rückgängig), bleiben in ihrer Gruppe; die Gruppe wird wieder eine Reihe.
     */
    applyLayout(name: string, layout: Layout): Promise<void> {
      return serial(name, async () => {
        const state = await mustRead(name);
        for (const m of layout.items) {
          const item = state.items.find((i) => i.id === m.id);
          if (item) Object.assign(item, { x: Math.round(m.x), y: Math.round(m.y) });
        }
        const exists = (id: string) => state.items.some((i) => i.id === id);
        const known = new Set(layout.items.map((m) => m.id));
        const groups = layout.groups.map((g) => ({ ...g, itemIds: g.itemIds.filter(exists) }));
        const before = new Map(groups.map((g) => [g.id, [...g.itemIds]]));
        const changed = new Set<string>();
        for (const g of state.groups) {
          const unknown = g.itemIds.filter((id) => !known.has(id) && !groups.some((x) => x.itemIds.includes(id)));
          if (!unknown.length) continue;
          const home = groups.find((x) => x.id === g.id);
          if (home) home.itemIds.push(...unknown);
          else groups.push({ ...g, itemIds: unknown });
          changed.add(g.id);
        }
        state.groups = groups;
        if (changed.size) settle(state, before, changed);
        state.groups = state.groups.filter((g) => g.itemIds.length > 0);
        state.updatedAt = now();
        await write(state);
      });
    },

    /** Bilder samt ihren Anmerkungen löschen. Gibt zurück, was wegfiel, für „Rückgängig“. */
    removeItems(name: string, ids: string[]): Promise<RemovedItems> {
      return serial(name, async () => {
        const state = await mustRead(name);
        const gone = new Set(ids);
        const removed: RemovedItems = {
          items: state.items.filter((i) => gone.has(i.id)).map(({ tiles: _tiles, ...item }) => item),
          annotations: state.annotations.filter((a) => gone.has(a.itemId)),
          groups: state.groups.filter((g) => g.itemIds.some((id) => gone.has(id))).map((g) => ({ ...g, itemIds: [...g.itemIds] })),
          order: state.items.map((i) => i.id),
        };
        state.items = state.items.filter((i) => !gone.has(i.id));
        state.annotations = state.annotations.filter((a) => !gone.has(a.itemId));
        for (const g of state.groups) g.itemIds = g.itemIds.filter((id) => !gone.has(id));
        state.groups = state.groups.filter((g) => g.itemIds.length > 0);
        state.updatedAt = now();
        await write(state);
        return removed;
      });
    },

    /** Rückgängig: Bilder, Anmerkungen und Gruppen wie vorher. Auch für eine aufgelöste Gruppe (dann ohne Bilder). */
    restoreItems(name: string, removed: RemovedItems): Promise<void> {
      return serial(name, async () => {
        const state = await mustRead(name);
        for (const item of removed.items) if (!state.items.some((i) => i.id === item.id)) state.items.push({ ...item, regions: [] });
        if (removed.order) {
          const rank = new Map(removed.order.map((id, i) => [id, i]));
          // Stabil sortieren: Bilder, die es vorher nicht gab, bleiben hinten in ihrer Reihenfolge.
          state.items = state.items.map((item, i) => ({ item, key: rank.get(item.id) ?? removed.order!.length + i })).sort((a, b) => a.key - b.key).map((x) => x.item);
        }
        for (const a of removed.annotations) if (!state.annotations.some((x) => x.id === a.id)) state.annotations.push(a);
        for (const g of removed.groups) {
          const members = g.itemIds.filter((id) => state.items.some((i) => i.id === id));
          for (const other of state.groups) other.itemIds = other.itemIds.filter((id) => !members.includes(id));
          const existing = state.groups.find((x) => x.id === g.id);
          if (existing) existing.itemIds = [...new Set([...existing.itemIds, ...members])];
          else state.groups.push({ ...g, itemIds: members });
        }
        state.groups = state.groups.filter((g) => g.itemIds.length > 0);
        state.updatedAt = now();
        await write(state);
      });
    },

    addAnnotation(name: string, input: NewAnnotation): Promise<Annotation> {
      return serial(name, async () => {
        const state = await mustRead(name);
        const item = state.items.find((i) => i.id === input.itemId);
        if (!item) throw new Failure("not_found", `item ${input.itemId}`);
        const annotation: Annotation = {
          id: randomUUID().slice(0, 8),
          itemId: item.id,
          rect: clampRect(input.rect, item.imageWidth, item.imageHeight),
          note: input.note.trim(),
          createdAt: now(),
          source: input.source,
        };
        state.annotations.push(annotation);
        state.updatedAt = now();
        await write(state);
        return annotation;
      });
    },

    /** `done`: null öffnet wieder, ein Objekt erledigt (von Hand, ohne Antwort; die Zeit setzt die Ablage). */
    updateAnnotation(name: string, id: string, patch: { note?: string; rect?: Rect; done?: Pick<AnnotationDone, "by" | "reply"> | null }): Promise<Annotation> {
      return serial(name, async () => {
        const state = await mustRead(name);
        const annotation = state.annotations.find((a) => a.id === id);
        const item = state.items.find((i) => i.id === annotation?.itemId);
        if (!annotation || !item) throw new Failure("not_found", `annotation ${id}`);
        if (patch.note !== undefined) annotation.note = patch.note.trim();
        if (patch.rect) annotation.rect = clampRect(patch.rect, item.imageWidth, item.imageHeight);
        if (patch.done === null) delete annotation.done;
        else if (patch.done) annotation.done = { at: now(), by: patch.done.by, ...(patch.done.reply?.trim() ? { reply: patch.done.reply.trim().slice(0, REPLY_MAX_CHARS) } : {}) };
        state.updatedAt = now();
        await write(state);
        return annotation;
      });
    },

    /** Rückgängig nach dem Löschen: dieselbe Anmerkung an ihre alte Stelle, damit die Nummer bleibt. */
    restoreAnnotation(name: string, annotation: Annotation, index: number): Promise<void> {
      return serial(name, async () => {
        const state = await mustRead(name);
        const item = state.items.find((i) => i.id === annotation.itemId);
        if (!item) throw new Failure("not_found", `item ${annotation.itemId}`);
        if (state.annotations.some((a) => a.id === annotation.id)) return;
        const restored = { ...annotation, rect: clampRect(annotation.rect, item.imageWidth, item.imageHeight) };
        state.annotations.splice(Math.max(0, Math.min(index, state.annotations.length)), 0, restored);
        state.updatedAt = now();
        await write(state);
      });
    },

    /**
     * Für Claude: umgesetzte Anmerkungen als erledigt markieren, je mit kurzer Antwort. Über id oder Nummer, gezählt
     * wie auf dem Canvas. Unbekannte Angaben: nichts wird geändert.
     */
    resolveAnnotations(name: string, entries: { ref: string; reply?: string }[]): Promise<{ state: CanvasState; resolved: string[] }> {
      return serial(name, async () => {
        const state = await mustRead(name);
        const { ids, missing } = resolveAnnotations(state.annotations, entries.map((e) => e.ref));
        if (missing.length) throw new Failure("not_found", `annotation ${missing.join(", ")}`);
        const at = now();
        entries.forEach((e) => {
          const { ids: [id] } = resolveAnnotations(state.annotations, [e.ref]);
          const a = state.annotations.find((x) => x.id === id)!;
          const reply = e.reply?.trim().slice(0, REPLY_MAX_CHARS);
          a.done = { at, by: "claude", ...(reply ? { reply } : {}) };
        });
        state.updatedAt = at;
        await write(state);
        return { state, resolved: ids };
      });
    },

    /** Für Claude: Anmerkungen entfernen, die der Nutzer weghaben will, über id oder Nummer. Unbekannte Angaben: nichts wird entfernt. */
    removeAnnotations(name: string, refs: string[]): Promise<{ state: CanvasState; removed: string[] }> {
      return serial(name, async () => {
        const state = await mustRead(name);
        const { ids, missing } = resolveAnnotations(state.annotations, refs);
        if (missing.length) throw new Failure("not_found", `annotation ${missing.join(", ")}`);
        state.annotations = state.annotations.filter((a) => !ids.includes(a.id));
        state.updatedAt = now();
        await write(state);
        return { state, removed: ids };
      });
    },

    /** Für Claude: Bilder oder ganze Gruppen entfernen (siehe resolveRemoval). Unbekannte Angaben: nichts wird entfernt. Gruppen, die Bilder verlieren, rücken zusammen. */
    remove(name: string, refs: { images?: string[]; groups?: string[] }): Promise<{ state: CanvasState; removed: string[]; groups: string[] }> {
      return serial(name, async () => {
        const state = await mustRead(name);
        const { ids, groups, missing } = resolveRemoval(state, refs);
        if (missing.length) throw new Failure("not_found", `remove ${missing.join(", ")}`);
        const gone = new Set(ids);
        const origins = new Map(state.groups.map((g) => [g.id, groupOrigin(g, state.items)]));
        state.items = state.items.filter((i) => !gone.has(i.id));
        state.annotations = state.annotations.filter((a) => !gone.has(a.itemId));
        for (const g of state.groups) {
          if (!g.itemIds.some((id) => gone.has(id))) continue;
          g.itemIds = g.itemIds.filter((id) => !gone.has(id));
          const members = g.itemIds.flatMap((id) => state.items.find((x) => x.id === id) ?? []);
          const origin = origins.get(g.id);
          if (origin) for (const p of rowPositions(members, origin, groupWidth(g)).positions) Object.assign(state.items.find((x) => x.id === p.id)!, { x: p.x, y: p.y });
        }
        state.groups = state.groups.filter((g) => g.itemIds.length > 0);
        state.updatedAt = now();
        await write(state);
        return { state, removed: ids, groups };
      });
    },

    removeAnnotation(name: string, id: string): Promise<void> {
      return serial(name, async () => {
        const state = await mustRead(name);
        const before = state.annotations.length;
        state.annotations = state.annotations.filter((a) => a.id !== id);
        if (state.annotations.length === before) throw new Failure("not_found", `annotation ${id}`);
        state.updatedAt = now();
        await write(state);
      });
    },
  };
}
