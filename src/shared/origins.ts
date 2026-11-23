// Herkunftsarten von Bildern. Eingebaut: figma, web, file, url. Erweiterungen melden eigene an (registerOrigin),
// in jedem Prozess, der sie braucht: die App prüft damit Eingaben, der MCP-Server beschriftet damit die Ausgabe.

export type OriginRule = {
  /** Kurz, für die Ausgabe an das Modell, etwa „Figma frame“. */
  label: string;
  /** Fehlertext für das Modell, wenn `ref` nicht passt, sonst null. */
  check?: (ref: string) => string | null;
};

const BUILT_IN: Record<string, OriginRule> = {
  figma: {
    label: "Figma frame",
    check: (ref) => (/^https:\/\/(www\.)?figma\.com\/(design|file|proto|board|slides)\//.test(ref) ? null : "origin.ref: figma.com address of the frame (with node-id), not the image URL"),
  },
  web: { label: "Website", check: (ref) => (/^https?:\/\//.test(ref) ? null : "origin.ref: http(s) address") },
  file: { label: "File" },
  url: { label: "Image from the web", check: (ref) => (/^https?:\/\//.test(ref) ? null : "origin.ref: http(s) address") },
};

const rules = new Map<string, OriginRule>(Object.entries(BUILT_IN));

/** Name einer Herkunftsart: klein, ohne Leerzeichen. */
export const ORIGIN_KIND = /^[a-z][a-z0-9-]{0,31}$/;

export function registerOrigin(kind: string, rule: OriginRule) {
  if (!ORIGIN_KIND.test(kind)) throw new Error(`origin kind not allowed: ${kind}`);
  rules.set(kind, rule);
}

export const originKinds = () => [...rules.keys()];
export const originLabel = (kind: string) => rules.get(kind)?.label ?? kind;

/** Problem mit Art und Verweis, sonst null. */
export function originKindProblem(kind: string, ref: string): string | null {
  const rule = rules.get(kind);
  if (!rule) return `origin.kind: one of ${originKinds().join(", ")}`;
  return rule.check?.(ref.trim()) ?? null;
}
