// Lokale Schnittstelle der App für den MCP-Server. Nur 127.0.0.1, jeder Aufruf außer /api/health
// braucht den Zugangsschlüssel aus data/run/api-token. Antworten sind Daten, Fehler sind Codes.

import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { ApiError, RemoveAnnotationsRequest, ResolveRequest, RemoveRequest, RemoveVersionsRequest, CanvasState, OpenRequest, ReviewRequest, ReviewResult } from "../shared/contracts.ts";
import type { CanvasStore } from "./canvas-store.ts";
import { Failure, HTTP_STATUS } from "./failure.ts";
import type { Reviews } from "./reviews.ts";

export type ApiDeps = {
  token: string;
  version: string;
  store: CanvasStore;
  reviews: Reviews;
  /** Die App zeigt die Fläche und zoomt auf den Bereich, falls angegeben. */
  onOpen?: (state: CanvasState, focus: string | null) => void;
  /** Claude hat etwas am Canvas geändert (etwa Anmerkungen erledigt); die Oberfläche zeigt den neuen Stand. */
  onChange?: (state: CanvasState) => void;
  log?: (event: string, data: Record<string, unknown>) => void;
};

const MAX_BODY = 1_000_000;
const MAX_WAIT_MS = 30_000;

export function reviewResult(state: CanvasState, finishedAt: string): ReviewResult {
  return { canvas: state.name, finishedAt, annotations: state.annotations, items: state.items, groups: state.groups };
}

export function createApiServer(deps: ApiDeps): http.Server {
  const { store, reviews, log = () => {} } = deps;
  const expected = Buffer.from(`Bearer ${deps.token}`);

  const authorized = (req: http.IncomingMessage) => {
    const got = Buffer.from(req.headers.authorization ?? "");
    return got.length === expected.length && timingSafeEqual(got, expected);
  };

  return http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const fail = (e: unknown) => {
      const failure = e instanceof Failure ? e : new Failure("internal", String(e));
      const body: ApiError = { error: failure.code, detail: failure.message };
      if (failure.code === "internal") log("api_error", { url: req.url, detail: failure.message });
      send(HTTP_STATUS[failure.code], body);
    };

    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const [api, resource, id, action] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (api !== "api") throw new Failure("not_found", url.pathname);
      if (resource === "health" && req.method === "GET") return send(200, { ok: true, pid: process.pid, version: deps.version });
      if (!authorized(req)) throw new Failure("unauthorized");

      if (resource === "canvases") {
        if (!id && req.method === "GET") return send(200, { canvases: await store.list() });
        if (id && !action && req.method === "GET") {
          const state = await store.get(id);
          if (!state) throw new Failure("not_found", `canvas ${id}`);
          return send(200, state);
        }
        if (id && action === "open" && req.method === "POST") {
          const body = (await readJson(req)) as OpenRequest;
          if (!Array.isArray(body.images)) throw new Failure("bad_request", "images missing");
          const state = await store.open(id, body);
          const focus = body.focus?.trim() || null;
          log("open", { canvas: state.name, images: body.images.length, focus });
          deps.onOpen?.(state, focus);
          return send(200, { canvas: state, focus });
        }
        if (id && action === "remove-annotations" && req.method === "POST") {
          const body = (await readJson(req)) as RemoveAnnotationsRequest;
          if (!Array.isArray(body.refs) || body.refs.length === 0) throw new Failure("bad_request", "refs missing");
          const { state, removed } = await store.removeAnnotations(id, body.refs.map(String));
          log("annotations_removed", { canvas: state.name, removed });
          deps.onChange?.(state);
          return send(200, { canvas: state, removed });
        }
        if (id && action === "resolve-annotations" && req.method === "POST") {
          const body = (await readJson(req)) as ResolveRequest;
          const entries = Array.isArray(body.annotations) ? body.annotations.filter((e) => e && (typeof e.ref === "string" || typeof e.ref === "number")) : [];
          if (entries.length === 0) throw new Failure("bad_request", "annotations missing");
          const { state, resolved } = await store.resolveAnnotations(id, entries.map((e) => ({ ref: String(e.ref), reply: typeof e.reply === "string" ? e.reply : undefined })));
          log("annotations_resolved", { canvas: state.name, resolved });
          deps.onChange?.(state);
          return send(200, { canvas: state, resolved });
        }
        if (id && action === "remove-versions" && req.method === "POST") {
          const body = (await readJson(req)) as RemoveVersionsRequest;
          const versions = Array.isArray(body.versions) ? body.versions.map(Number) : [];
          if (!body.image || versions.length === 0) throw new Failure("bad_request", "image or versions missing");
          const { state, removed } = await store.removeVersions(id, String(body.image), versions.map((n) => n - 1));
          log("versions_removed", { canvas: state.name, item: removed.itemId, versions: removed.versions.length, annotations: removed.annotations.length });
          deps.onChange?.(state);
          return send(200, { canvas: state, removed });
        }
        if (id && action === "remove" && req.method === "POST") {
          const body = (await readJson(req)) as RemoveRequest;
          const images = Array.isArray(body.images) ? body.images.map(String) : [];
          const groups = Array.isArray(body.groups) ? body.groups.map(String) : [];
          if (images.length + groups.length === 0) throw new Failure("bad_request", "images or groups missing");
          const { state, removed, groups: gone } = await store.remove(id, { images, groups });
          log("removed", { canvas: state.name, removed, groups: gone });
          deps.onChange?.(state);
          return send(200, { canvas: state, removed, groups: gone });
        }
        if (id && action === "reviews" && req.method === "POST") {
          const body = (await readJson(req)) as ReviewRequest;
          const state = await store.get(id);
          if (!state) throw new Failure("not_found", `canvas ${id}`);
          const reviewId = reviews.start(state.name, body.prompt?.trim() || null, body.toolUseId ?? null);
          log("review_start", { canvas: state.name, reviewId });
          return send(200, { reviewId });
        }
        if (id && action === "finish" && req.method === "POST") {
          const state = await store.get(id);
          if (!state) throw new Failure("not_found", `canvas ${id}`);
          const finished = reviews.finish(state.name, reviewResult(state, new Date().toISOString()));
          log("review_finish", { canvas: state.name, finished });
          return send(200, { finished });
        }
      }

      if (resource === "reviews" && id) {
        if (req.method === "GET") {
          const waitMs = Math.min(MAX_WAIT_MS, Math.max(0, Number(url.searchParams.get("wait") ?? 0)));
          const status = await reviews.wait(id, waitMs);
          if (!status) throw new Failure("not_found", `review ${id}`);
          return send(200, status);
        }
        if (req.method === "DELETE") {
          const cancelled = reviews.cancel(id, "claude_aborted");
          log("review_cancel", { reviewId: id, cancelled });
          return send(200, { cancelled });
        }
      }
      throw new Failure("not_found", `${req.method} ${url.pathname}`);
    } catch (e) {
      fail(e);
    }
  });
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Failure("bad_request", "body too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Failure("bad_request", "invalid json");
  }
}
