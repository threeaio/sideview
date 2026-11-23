// MCP-Server der Fläche: Claude öffnet damit Flächen, legt Bilder auf und wartet auf „Fertig“.
// Läuft je Claude-Sitzung als eigener Prozess über stdio und spricht mit der einen App über localhost.
// stdout gehört dem Protokoll; Meldungen gehen ins Log (data/logs/mcp.jsonl).

import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SLUG } from "../shared/brand.ts";
import { paths } from "../shared/config.ts";
import { REVIEW_WAIT_MS, type ReviewResult } from "../shared/contracts.ts";
import { createLog } from "../shared/log.ts";
import { slugify } from "../shared/names.ts";
import type { McpExtension } from "../shared/extensions.ts";
import { ORIGIN_KIND, registerOrigin } from "../shared/origins.ts";
import { loadExtensions } from "../main/extensions.ts";
import { AppError, createAppClient } from "./app-client.ts";
import { cropAnnotation, previewImage } from "./crops.ts";
import { describeAnnotations, describeCanvas, describeList, describeOpen, describeResult } from "./describe.ts";
import { ImportError, importImage, isRemote } from "./imports.ts";

const log = createLog(path.join(paths.logs(), "mcp.jsonl"));
/** Besprechungen, die ein Aufruf ohne Fortschrittsmeldungen offen gelassen hat, je Canvas. */
const pending = new Map<string, string>();
/** So lange wartet sideview_review ohne Fortschrittsmeldungen höchstens (unter der üblichen Grenze von 60 s). */
const PLAIN_RETURN_MS = Number(process.env.CANVAS_REVIEW_RETURN_MS || 45_000);
const app = createAppClient();

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const failure = (e: unknown) => {
  const code = e instanceof AppError || e instanceof ImportError ? e.code : "internal";
  log("tool_error", { code, detail: String(e) });
  const hint: Record<string, string> = {
    app_not_running: "The Canvas app does not start.",
    image_missing: "An image is missing or is not a readable image.",
    not_found: "This canvas does not exist. sideview_list shows the existing ones.",
    not_https: "Only https addresses.",
    fetch_failed: "The image at this address could not be loaded. Fetch short-lived addresses (Figma) again.",
    not_an_image: "There is no image at this address.",
    too_large: "The image is too large.",
  };
  const text =
    code === "not_found" && String(e).includes("annotation")
      ? "This annotation does not exist. sideview_get shows numbers and ids."
      : code === "not_found" && String(e).includes("remove ")
        ? "Not found unambiguously, nothing was removed. sideview_get shows numbers, ids, titles and groups."
        : hint[code] ?? "Error in the canvas.";
  return { isError: true, content: [{ type: "text" as const, text: `${text} (${code}: ${e instanceof Error ? e.message : String(e)})` }] };
};

async function withCrops(result: Pick<ReviewResult, "annotations" | "items">): Promise<Content[]> {
  const images: Content[] = [];
  for (const a of result.annotations) {
    const item = result.items.find((i) => i.id === a.itemId);
    if (!item) continue;
    try {
      const crop = await cropAnnotation(item, a);
      images.push({ type: "image", data: crop.data, mimeType: crop.mimeType });
    } catch (e) {
      log("crop_error", { annotation: a.id, detail: String(e) });
    }
  }
  return images;
}

async function withPreviews(state: Pick<ReviewResult, "items">): Promise<Content[]> {
  const images: Content[] = [];
  for (const item of state.items) {
    try {
      const p = await previewImage(item);
      images.push({ type: "image", data: p.data, mimeType: p.mimeType });
    } catch (e) {
      log("preview_error", { item: item.id, detail: String(e) });
    }
  }
  return images;
}

/** Name der Fläche aus Titel oder Bildpfad: …/run20-with/shots/desktop.png → run20-with */
function guessName(title: string | undefined, image: string | undefined): string {
  if (title) return slugify(title);
  if (!image) return "canvas";
  const dir = path.dirname(image);
  return slugify(path.basename(dir) === "shots" ? path.basename(path.dirname(dir)) : path.basename(image, path.extname(image)));
}

// Extensions (extensions/<name>/mcp.ts): their own origin kinds and one paragraph each for the instructions.
// A broken extension never stops the server; errors go to the log.
const extensionInstructions: string[] = [];
for (const { name, module } of await loadExtensions<McpExtension>("mcp.ts", (name, error) => log("extension_error", { extension: name, detail: String(error) }))) {
  try {
    for (const [kind, rule] of Object.entries(module.origins ?? {})) registerOrigin(kind, rule);
    if (module.instructions?.trim()) extensionInstructions.push(module.instructions.trim());
    log("extension_loaded", { extension: name, origins: Object.keys(module.origins ?? {}) });
  } catch (e) {
    log("extension_error", { extension: name, detail: String(e) });
  }
}

const INSTRUCTIONS =
  "Sideview is the user's tool for material next to this thread: place screenshots and images on a canvas, zoom, frame spots, speak annotations. " +
  "When the user says \"Sideview\" or \"Canvas\", this tool is meant, in any project. " +
  "The user may speak to the canvas in German or English, so annotations can be in either language; answer in the user's language. " +
  "You bring the images: files as paths; websites as full-page screenshots (use the page-shots skill if installed, otherwise any full-page screenshot; regions.json next to the image is read automatically); Figma frames via get_screenshot of the Figma connector (pass the image_url, and the frame's address as origin). " +
  "The canvas remembers each image's origin; sideview_get returns it along with everything else. Before you place a revised version after the user's annotations (from Figma, code or elsewhere), ask whether it should replace the old one (`replaces`) or go next to it as a new version. Do not decide this yourself. The user's answer holds for this thread until they say otherwise. " +
  "Give every image you place a small `meta` object so that you or another thread can find and match it later. What goes in is up to you, per project, e.g. version, project, file or commit, variant. Keep it short, no credentials and no short-lived image URLs. " +
  "From Figma the user usually wants single frames: one image per frame, the frame name as title. If they want something else or it is unclear, make sure every image on the canvas can be recognised by its name. " +
  "If a Figma link points to a section or to several frames, they go on the canvas as a group: one image per frame, the group named like the section (sideview_open with `group`). " +
  "Flow: sideview_open places images and shows the canvas. sideview_review waits until the user says or clicks \"Done\" in the canvas (\"Fertig\" in the German UI) and returns their annotations with crops. When you have implemented an annotation, mark it as resolved with sideview_resolve_annotations and add one sentence on what you did; it stays on the canvas with a check mark. If the user wants an annotation gone, remove it with sideview_remove_annotations. Remove images or whole groups with sideview_remove when the user wants it. " +
  "If several canvases match the user's request, ask which one is meant (sideview_list).";

const server = new McpServer({ name: SLUG, version: "0.1.0" }, { instructions: [INSTRUCTIONS, ...extensionInstructions].join("\n\n") });

server.registerTool(
  "sideview_list",
  { title: "List canvases", description: "Lists the existing canvases with the number of images and annotations, newest first.", inputSchema: {} },
  async () => {
    try {
      await app.ensureRunning();
      return text(describeList(await app.list()));
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  "sideview_open",
  {
    title: "Open canvas",
    description:
      "Opens a canvas (creates it if new), places images to the right of existing ones and brings the window to the front. " +
      "Images as absolute paths or as https URLs. With `focus` the canvas zooms to a named region (label or alias), e.g. \"Kopf\". " +
      "Websites: take full-page screenshots first and pass those images (use the page-shots skill if installed, otherwise any full-page screenshot; regions.json next to the image is read automatically). " +
      "Figma frames: fetch them with the Figma tool get_screenshot (maxDimension about 2400) and pass its image_url with the frame name as title; the canvas downloads the image itself. " +
      "Origin: for https URLs `origin` is required so the image can be fetched again later; for Figma { kind: \"figma\", ref: frame address with node-id, detail: frame name }, never the image_url. " +
      "For files the canvas derives the origin itself (page-shots: page and view, otherwise the file). " +
      "Updating: with `replaces` (id from sideview_get) the canvas swaps an image in place; position, group, name and annotations stay, the old version is kept as a stack behind it. Without `replaces` the image goes next to it as a new version. Ask the user beforehand which of the two.",
    inputSchema: {
      images: z
        .array(
          z.union([
            z.string(),
            z.object({
              source: z.string(),
              title: z.string().optional(),
              origin: z
                .object({ kind: z.string().regex(ORIGIN_KIND), ref: z.string(), detail: z.string().optional() })
                .optional()
                .describe("Where the image comes from; required for https URLs"),
              replaces: z.string().optional().describe("id of an image on the canvas that is swapped in place"),
              meta: z
                .record(z.string(), z.unknown())
                .optional()
                .describe(
                  "Free-form JSON object so the image can be found and matched later, e.g. { version: 3, project: \"…\", commit: \"…\" }. What goes in is up to you, per project. At most 2000 characters. With `replaces` it replaces the old details; without `meta` they stay. For an image that is already on the canvas (same path) it only sets the details anew.",
                ),
            }),
          ]),
        )
        .describe("Images: absolute path as a string, or { source, title, origin, replaces, meta }; empty to just show an existing canvas"),
      canvas: z.string().optional().describe("Name of the canvas; if omitted, derived from the title or image path"),
      title: z.string().optional().describe("Readable title of the canvas"),
      focus: z.string().optional().describe("Region to zoom to, e.g. \"Kopf\""),
      group: z.string().optional().describe("Group the images go into, e.g. the name of a Figma section; if it exists, they are added to it. Images already on the canvas (same path, see sideview_get) move into a group this way too; it is arranged as a row"),
    },
  },
  async ({ images, canvas, title, focus, group }) => {
    try {
      await app.ensureRunning();
      const resolved = await Promise.all(
        images.map(async (image) => {
          const { source, title: imageTitle, origin, replaces, meta } = typeof image === "string" ? { source: image } : image;
          if (!isRemote(source)) return { path: source, title: imageTitle, origin, replaces, meta };
          // Die Bildadresse selbst ist oft kurzlebig (Figma) und wird nie gespeichert; ohne Herkunft ließe sich das Bild nie neu holen.
          if (!origin) throw new AppError("bad_request", "origin missing: https images need { kind, ref } (Figma: frame address with node-id)");
          const file = await importImage(source, paths.imports());
          log("import", { host: new URL(source).host, file: path.basename(file) });
          return { path: file, title: imageTitle ?? `Image from ${new URL(source).hostname.replace(/^www\./, "")}`, origin, replaces, meta };
        }),
      );
      const firstLocal = images.find((i): i is string => typeof i === "string" && !isRemote(i));
      const name = canvas ? slugify(canvas) : guessName(title, firstLocal);
      const res = await app.open(name, { images: resolved, title, focus, group });
      log("open", { canvas: res.canvas.name, images: images.length, focus: res.focus, group: group ?? null });
      return text(describeOpen(res.canvas, res.focus));
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  "sideview_review",
  {
    title: "Review in the canvas",
    description:
      "Waits until the user says or clicks \"Done\" in the canvas (\"Fertig\" in the German UI) and returns their annotations as text, with region and rectangle. Can take a long time. " +
      "Optional `prompt`: a short question shown in the canvas. " +
      "If it returns that the canvas is still open (clients without progress notifications get this after 45 seconds), call sideview_review again with the same canvas; the review continues. " +
      "When the result arrives, first confirm to the user in one short sentence that it has arrived and that you are looking at it. " +
      "Then fetch the crops with sideview_get (images: true) and only then answer in detail.",
    inputSchema: {
      canvas: z.string().describe("Name of the canvas"),
      prompt: z.string().optional().describe("Short question shown in the canvas"),
    },
  },
  async ({ canvas, prompt }, extra) => {
    const name = slugify(canvas);
    let reviewId: string | null = null;
    try {
      await app.ensureRunning();
      const toolUseId = (extra._meta as Record<string, unknown> | undefined)?.["claudecode/toolUseId"];
      // Ein früherer Aufruf ohne Fortschrittsmeldungen hat die Besprechung offen gelassen: dort weitermachen.
      const resumed = pending.get(name) ?? null;
      pending.delete(name);
      reviewId = resumed ?? (await app.startReview(name, prompt, typeof toolUseId === "string" ? toolUseId : undefined));
      log(resumed ? "review_resume" : "review_start", { canvas: name, reviewId });
      const token = extra._meta?.progressToken;
      const started = Date.now();
      for (let round = 1; ; round++) {
        if (extra.signal.aborted) throw new Error("aborted");
        // Ohne Fortschrittsmeldungen brechen viele Clients nach 60 s ab. Dann vorher zurückkehren; die Besprechung
        // bleibt offen, der nächste Aufruf setzt sie fort.
        const left = token === undefined ? PLAIN_RETURN_MS - (Date.now() - started) : REVIEW_WAIT_MS;
        if (left <= 0) {
          pending.set(name, reviewId);
          log("review_still_open", { canvas: name, reviewId });
          return text(`The canvas "${name}" is still open; the user has not said "Done" yet. Call sideview_review again with the same canvas to keep waiting. Nothing is lost.`);
        }
        const slice = Math.min(REVIEW_WAIT_MS, left);
        let status;
        try {
          status = await app.waitReview(reviewId, slice, AbortSignal.any([extra.signal, AbortSignal.timeout(slice + 15_000)]));
        } catch (e) {
          // Die App wurde neu gestartet und kennt die fortgesetzte Besprechung nicht mehr: neu beginnen.
          if (!resumed || extra.signal.aborted || !(e instanceof AppError && e.code === "not_found")) throw e;
          reviewId = await app.startReview(name, prompt, typeof toolUseId === "string" ? toolUseId : undefined);
          log("review_restart", { canvas: name, reviewId });
          continue;
        }
        if (status.status === "done") {
          log("review_done", { canvas: name, reviewId, annotations: status.result.annotations.length, seconds: Math.round((Date.now() - started) / 1000) });
          return text(describeResult(status.result, (Date.now() - started) / 1000));
        }
        if (status.status === "cancelled") {
          log("review_cancelled", { canvas: name, reviewId, reason: status.reason });
          return text(`The review ended without "Done" (${status.reason}).`);
        }
        if (token !== undefined) {
          const minutes = Math.round((Date.now() - started) / 60_000);
          await extra.sendNotification({
            method: "notifications/progress",
            params: { progressToken: token, progress: round, message: `Canvas ${name} open for ${minutes} min` },
          });
        }
      }
    } catch (e) {
      if (extra.signal.aborted && reviewId) {
        await app.cancelReview(reviewId).catch(() => {});
        log("review_aborted", { canvas: name, reviewId });
        return text("Cancelled.");
      }
      return failure(e);
    }
  },
);

server.registerTool(
  "sideview_get",
  {
    title: "Get canvas state",
    description:
      "Gets the full state of a canvas without waiting: per image the file, size, position on the canvas, group, origin and regions with coordinates; " +
      "plus the annotations with their rectangle in the image and on the canvas. " +
      "With `images: true` the images themselves (downscaled) and crops of the annotations come along as images. " +
      "If the user wants images updated: take the origin from here, fetch again, swap with sideview_open and `replaces`. " +
      "Mark implemented annotations as resolved with sideview_resolve_annotations.",
    inputSchema: {
      canvas: z.string().describe("Name of the canvas"),
      images: z.boolean().optional().describe("Also send the images and crops as images"),
    },
  },
  async ({ canvas, images }) => {
    try {
      await app.ensureRunning();
      const state = await app.get(slugify(canvas));
      const whole = images ? await withPreviews(state) : [];
      const crops = images ? await withCrops(state) : [];
      const note = images
        ? `\nNext come ${whole.length} images in the order above (downscaled), then ${crops.length} crops of the annotations in their order, each with some margin.`
        : "";
      return { content: [{ type: "text" as const, text: `${describeCanvas(state)}${note}` }, ...whole, ...crops] };
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  "sideview_remove_annotations",
  {
    title: "Remove annotations",
    description:
      "Removes annotations from the canvas, only when the user wants them gone. Mark implemented ones as resolved with sideview_resolve_annotations instead. " +
      "Annotations by their number (as on the canvas, \"3\") or their id from sideview_get. Numbers count as before the removal: \"2 and 3\" hits exactly these two, " +
      "afterwards the remaining ones move up. Tell the user which ones you removed.",
    inputSchema: {
      canvas: z.string().describe("Name of the canvas"),
      annotations: z.array(z.union([z.string(), z.number()])).min(1).describe("Numbers or ids of the annotations"),
    },
  },
  async ({ canvas, annotations }) => {
    try {
      await app.ensureRunning();
      const { canvas: state, removed } = await app.removeAnnotations(slugify(canvas), annotations.map(String));
      log("annotations_removed", { canvas: state.name, removed: removed.length });
      return { content: [{ type: "text" as const, text: `${removed.length === 1 ? "1 annotation" : `${removed.length} annotations`} removed. Now:\n${describeAnnotations(state)}` }] };
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  "sideview_resolve_annotations",
  {
    title: "Resolve annotations",
    description:
      "Marks annotations as resolved once you have implemented them. They stay on the canvas, with a check mark and your reply next to them. " +
      "For each annotation its number (as on the canvas, \"3\") or its id from sideview_get, plus `reply`: one short sentence on what you did, e.g. \"Reduced top spacing to 48 px\". " +
      "If any reference is unknown, nothing is changed. Tell the user which ones you resolved.",
    inputSchema: {
      canvas: z.string().describe("Name of the canvas"),
      annotations: z
        .array(z.object({ ref: z.union([z.string(), z.number()]).describe("Number or id"), reply: z.string().max(600).optional().describe("One sentence: what you did") }))
        .min(1)
        .describe("Resolved annotations with reply"),
    },
  },
  async ({ canvas, annotations }) => {
    try {
      await app.ensureRunning();
      const { canvas: state, resolved } = await app.resolveAnnotations(slugify(canvas), annotations.map((a) => ({ ref: String(a.ref), reply: a.reply })));
      log("annotations_resolved", { canvas: state.name, resolved: resolved.length });
      return { content: [{ type: "text" as const, text: `${resolved.length === 1 ? "1 annotation" : `${resolved.length} annotations`} resolved. Now:\n${describeAnnotations(state)}` }] };
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  "sideview_remove",
  {
    title: "Remove images or groups",
    description:
      "Removes images together with their annotations from the canvas, or whole groups with all their images. Only when the user wants it. " +
      "Images by their number or id from sideview_get or by their title; groups by their name. Numbers count as before the removal. " +
      "If any reference is unknown or ambiguous, nothing is removed. Groups that lose images close up. " +
      "The image files stay on disk. Tell the user what you removed.",
    inputSchema: {
      canvas: z.string().describe("Name of the canvas"),
      images: z.array(z.union([z.string(), z.number()])).optional().describe("Numbers, ids or titles of the images"),
      groups: z.array(z.string()).optional().describe("Names of the groups"),
    },
  },
  async ({ canvas, images, groups }) => {
    try {
      if (!images?.length && !groups?.length) return { isError: true, content: [{ type: "text" as const, text: "Nothing given: name images or groups." }] };
      await app.ensureRunning();
      const { canvas: state, removed, groups: gone } = await app.remove(slugify(canvas), { images: images?.map(String), groups });
      log("removed", { canvas: state.name, removed: removed.length, groups: gone.length });
      const what = [gone.length ? `Group${gone.length === 1 ? "" : "s"} ${gone.map((g) => `"${g}"`).join(", ")}` : null, `${removed.length === 1 ? "1 image" : `${removed.length} images`}`].filter(Boolean).join(" with ");
      return { content: [{ type: "text" as const, text: `${what} removed. Now:\n${describeCanvas(state)}` }] };
    } catch (e) {
      return failure(e);
    }
  },
);

log("mcp_start", { pid: process.pid });
await server.connect(new StdioServerTransport());
