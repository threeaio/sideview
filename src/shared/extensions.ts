// Vertrag für Erweiterungen. Eine Erweiterung ist ein Ordner unter extensions/<name>/ (im öffentlichen Repo leer,
// von Git ausgenommen) mit diesen Dateien, jede optional:
//   main.ts         Hauptprozess: eigene Kanäle zur Oberfläche, Bilder auflegen      → export default MainExtension
//   renderer.tsx    Oberfläche: eine Ebene über dem Canvas                           → export default RendererExtension
//   mcp.ts          MCP-Server: Herkunftsarten, ein Absatz für die Anweisungen       → export default McpExtension
//   glossary.json   Fachbegriffe für whisper, wie config/glossary.json
// Erweiterungen importieren die App über relative Pfade (../../src/...). Kanäle heißen ext:<erweiterung>:<name>.

import type { CanvasState, OriginInput } from "./contracts.ts";
import type { OriginRule } from "./origins.ts";

export type ExtensionChannel = `ext:${string}:${string}`;
export const EXTENSION_CHANNEL = /^ext:[a-z0-9-]+:[a-z0-9-]+$/;

export type PlaceImage = { path: string; title?: string; origin?: OriginInput };

export type MainExtensionContext = {
  /** Kanal für die Oberfläche (bridge.invokeExtension). Fehler gibt man besser als Wert zurück. */
  handle(channel: ExtensionChannel, fn: (...args: unknown[]) => unknown): void;
  log(event: string, data: Record<string, unknown>): void;
  /** Ordner für Daten dieser App (canvases, imports, logs …). */
  dataDir: string;
  /** Bilder auf ein Canvas legen; ohne Canvas auf die „Ablage“. Zeigt das Ergebnis in der Oberfläche. */
  placeImages(canvas: string | null, images: PlaceImage[]): Promise<CanvasState>;
};

export type MainExtension = { register(ctx: MainExtensionContext): void | Promise<void> };

export type McpExtension = {
  /** Eigene Herkunftsarten für Bilder, etwa eine Bildbibliothek. */
  origins?: Record<string, OriginRule>;
  /** Ein Absatz, der an die Anweisungen des MCP-Servers angehängt wird. */
  instructions?: string;
};
