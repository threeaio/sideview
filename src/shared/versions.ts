// Frühere Fassungen eines Bildes, reiner Kern für Hauptprozess und Oberfläche. Eine Fassung galt bis zu ihrem
// `replacedAt`; eine Anmerkung gehört zu der Fassung, die galt, als sie entstand. Gelöscht wird eine Fassung
// deshalb mit ihren Anmerkungen (23.11.: „Fassung löschen gerne auch direkt machen“), sonst rutschten sie auf die
// nächste Fassung, auf der sie nie gemacht wurden.

import type { Annotation, ImageItem, ImageVersion, RemovedVersions } from "./contracts.ts";

/** Index der Fassung, die zum Zeitpunkt `createdAt` galt; `versions.length` ist die aktuelle. */
export function versionIndexAt(createdAt: string, versions: readonly Pick<ImageVersion, "replacedAt">[]): number {
  const at = Date.parse(createdAt);
  const k = versions.findIndex((v) => at < Date.parse(v.replacedAt));
  return k === -1 ? versions.length : k;
}

const withVersions = (item: ImageItem, versions: ImageVersion[]): ImageItem => {
  const { versions: _old, ...rest } = item;
  return versions.length ? { ...rest, versions } : rest;
};

/** Frühere Fassungen löschen (Indizes in `item.versions`), samt den Anmerkungen, die auf ihnen entstanden. */
export function takeVersions(item: ImageItem, annotations: readonly Annotation[], indices: readonly number[]): { item: ImageItem; annotations: Annotation[]; removed: RemovedVersions } {
  const versions = item.versions ?? [];
  const gone = new Set(indices.filter((i) => Number.isInteger(i) && i >= 0 && i < versions.length));
  const isGone = (a: Annotation) => a.itemId === item.id && gone.has(versionIndexAt(a.createdAt, versions));
  return {
    item: withVersions(item, versions.filter((_, i) => !gone.has(i))),
    annotations: annotations.filter((a) => !isGone(a)),
    removed: {
      itemId: item.id,
      versions: [...gone].sort((a, b) => a - b).map((index) => ({ index, version: versions[index]! })),
      annotations: annotations.filter(isGone),
    },
  };
}

/** Rückgängig: die Fassungen wieder an ihre alte Stelle, die Anmerkungen dazu. */
export function putVersions(item: ImageItem, annotations: readonly Annotation[], removed: RemovedVersions): { item: ImageItem; annotations: Annotation[] } {
  const versions = [...(item.versions ?? [])];
  for (const { index, version } of removed.versions) {
    if (!versions.some((v) => v.path === version.path && v.replacedAt === version.replacedAt)) versions.splice(Math.min(index, versions.length), 0, version);
  }
  const known = new Set(annotations.map((a) => a.id));
  return { item: withVersions(item, versions), annotations: [...annotations, ...removed.annotations.filter((a) => !known.has(a.id))] };
}
