// Bilder per Adresse: Claude übergibt statt eines Pfads eine https-Adresse, etwa die kurzlebige Adresse eines
// Figma-Frames aus dem Figma-Connector. Der MCP-Server lädt das Bild nach data/imports und gibt den Pfad weiter.
// So braucht die Fläche keinen eigenen Figma-Zugang. Die Adresse ist ein Geheimnis auf Zeit: nie ins Log.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};
/** Obergrenze je Bild; ein ganzseitiger Screenshot hat selten mehr als 30 MB. */
export const MAX_IMPORT_BYTES = 80 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

export const isRemote = (source: string) => /^https:\/\//i.test(source);

/** Endung zum Inhaltstyp; null, wenn es kein Bild ist, das die Fläche lesen kann. */
export function extensionFor(contentType: string | null): string | null {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  return TYPES[type] ?? null;
}

export type ImportErrorCode = "not_https" | "fetch_failed" | "not_an_image" | "too_large";

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, detail: string) {
    super(detail);
    this.code = code;
  }
}

/** Lädt ein Bild und legt es unter seinem Inhalts-Hash ab. Dasselbe Bild zweimal ergibt denselben Pfad. */
export async function importImage(url: string, dir: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!isRemote(url)) throw new ImportError("not_https", "https addresses only");
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new ImportError("fetch_failed", `${host}: ${String(e)}`);
  }
  if (!res.ok) throw new ImportError("fetch_failed", `${host}: HTTP ${res.status}`);
  const ext = extensionFor(res.headers.get("content-type"));
  if (!ext) throw new ImportError("not_an_image", `${host}: ${res.headers.get("content-type")}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_IMPORT_BYTES) throw new ImportError("too_large", `${host}: ${declared} bytes`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportError("too_large", `${host}: ${bytes.length} bytes`);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${createHash("sha1").update(bytes).digest("hex").slice(0, 16)}${ext}`);
  await fs.writeFile(file, bytes);
  return file;
}
