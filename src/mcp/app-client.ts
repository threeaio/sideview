// Transport vom MCP-Server zur App. Startet die App, wenn sie nicht läuft.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { INSTALLED, ROOT, config, paths } from "../shared/config.ts";
import type {
  ApiError,
  ApiErrorCode,
  RemoveAnnotationsResponse,
  RemoveResponse,
  RemoveVersionsResponse,
  ResolveResponse,
  CanvasState,
  CanvasSummary,
  OpenRequest,
  OpenResponse,
  ReviewStatus,
} from "../shared/contracts.ts";

export class AppError extends Error {
  code: ApiErrorCode | "app_not_running";
  constructor(code: ApiErrorCode | "app_not_running", detail?: string) {
    super(detail ?? code);
    this.code = code;
  }
}

export type AppClient = ReturnType<typeof createAppClient>;

export function createAppClient({ baseUrl = `http://127.0.0.1:${config.port}`, launch = launchApp } = {}) {
  async function healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function call<T>(method: string, route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const token = (await fs.readFile(paths.token(), "utf8").catch(() => "")).trim();
    const res = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(60_000),
    });
    const data = (await res.json()) as T | ApiError;
    if (!res.ok) {
      const err = data as ApiError;
      throw new AppError(err.error ?? "internal", err.detail);
    }
    return data as T;
  }

  const enc = encodeURIComponent;

  return {
    async ensureRunning(): Promise<void> {
      if (await healthy()) return;
      launch();
      for (let i = 0; i < 75; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (await healthy()) return;
      }
      throw new AppError("app_not_running", "App did not answer within 15 s");
    },
    list: () => call<{ canvases: CanvasSummary[] }>("GET", "/api/canvases").then((r) => r.canvases),
    get: (name: string) => call<CanvasState>("GET", `/api/canvases/${enc(name)}`),
    open: (name: string, req: OpenRequest) => call<OpenResponse>("POST", `/api/canvases/${enc(name)}/open`, req),
    removeAnnotations: (name: string, refs: string[]) => call<RemoveAnnotationsResponse>("POST", `/api/canvases/${enc(name)}/remove-annotations`, { refs }),
    resolveAnnotations: (name: string, annotations: { ref: string; reply?: string }[]) => call<ResolveResponse>("POST", `/api/canvases/${enc(name)}/resolve-annotations`, { annotations }),
    remove: (name: string, refs: { images?: string[]; groups?: string[] }) => call<RemoveResponse>("POST", `/api/canvases/${enc(name)}/remove`, refs),
    removeVersions: (name: string, image: string, versions: number[]) => call<RemoveVersionsResponse>("POST", `/api/canvases/${enc(name)}/remove-versions`, { image, versions }),
    startReview: (name: string, prompt: string | undefined, toolUseId: string | undefined) =>
      call<{ reviewId: string }>("POST", `/api/canvases/${enc(name)}/reviews`, { prompt, toolUseId }).then((r) => r.reviewId),
    waitReview: (reviewId: string, waitMs: number, signal?: AbortSignal) =>
      call<ReviewStatus>("GET", `/api/reviews/${enc(reviewId)}?wait=${waitMs}`, undefined, signal ?? AbortSignal.timeout(waitMs + 15_000)),
    cancelReview: (reviewId: string) => call<{ cancelled: boolean }>("DELETE", `/api/reviews/${enc(reviewId)}`),
    /** Wie „Fertig“ im Canvas: beendet alle offenen Besprechungen dieses Canvas. */
    finishReview: (name: string) => call<{ finished: string[] }>("POST", `/api/canvases/${enc(name)}/finish`).then((r) => r.finished),
  };
}

/**
 * Startet die Electron-App losgelöst vom MCP-Server, damit sie weiterläuft, wenn die Claude-Sitzung endet.
 * Mit CANVAS_HEADLESS=1 nur die Schnittstelle ohne Fenster (Tests, Rückweg ohne Bildschirm).
 */
export function launchApp(): void {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const headless = process.env.CANVAS_HEADLESS === "1";
  // Aus der installierten App: ihr eigenes Programm (Contents/MacOS/Canvas), das src/electron/main.ts selbst lädt.
  const bundled = INSTALLED && !headless;
  const command = headless ? process.execPath : bundled ? path.join(ROOT, "../../MacOS/Canvas") : (createRequire(import.meta.url)("electron") as string);
  const args = bundled ? [] : [path.join(ROOT, headless ? "src/main/serve.ts" : "src/electron/main.ts")];
  const child = spawn(command, args, { cwd: ROOT, detached: true, stdio: "ignore", env });
  child.unref();
}
