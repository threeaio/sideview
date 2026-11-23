// Erweiterungen der Oberfläche: extensions/<name>/renderer.tsx, beim Bauen eingesammelt (siehe src/shared/extensions.ts).
// Ohne Erweiterungen ist die Liste leer.

import type { ComponentType } from "react";

export type ExtensionLayerProps = {
  /** Name des offenen Canvas, sonst null. */
  canvas: string | null;
  /** Zu diesen Bildern fahren, sobald sie im Stand sind. */
  showItems: (ids: string[]) => void;
};

export type RendererExtension = { Layer?: ComponentType<ExtensionLayerProps> };

const modules = import.meta.glob<{ default: RendererExtension }>("../../../extensions/*/renderer.tsx", { eager: true });

export const rendererExtensions: { name: string; extension: RendererExtension }[] = Object.entries(modules)
  .map(([file, mod]) => ({ name: file.split("/").at(-2) ?? file, extension: mod.default }))
  .sort((a, b) => a.name.localeCompare(b.name));
