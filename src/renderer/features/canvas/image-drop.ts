// Reine Regeln fürs Ablegen von Dateien auf der Fläche. Ohne DOM, damit sie testbar bleiben.

import { t } from "../../../shared/i18n/index.ts";
import type { Language } from "../../../shared/settings.ts";

/** Formate, die die Kacheln (sharp) lesen können. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/tiff"]);
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|avif|tiff?)$/i;

/** Beim Ziehen kennt der Browser nur den Typ, noch keinen Namen. */
export const isImageType = (type: string) => IMAGE_TYPES.has(type.toLowerCase());

/** Beim Loslassen: Typ oder, falls der fehlt, die Endung. */
export const isImageFile = (file: { type: string; name: string }) => isImageType(file.type) || IMAGE_EXTENSIONS.test(file.name);

/** Hinweis beim Ziehen. */
export function dropLabel(count: number, lang: Language = "de"): string {
  return t(lang, "canvas.drop", { count });
}
