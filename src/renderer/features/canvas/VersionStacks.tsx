// Frühere Fassungen als Stapel hinter dem Bild (22.11.: „dass sie als Stapel abgelegt sind, erstmal sichtbar
// ist, dass da mehrere existieren“). Zwei Blätter höchstens, nach rechts oben versetzt. Vergleichen: VersionCompare.tsx.
// Ist das Bild gewählt, wachsen die Blätter um den Auswahlsaum mit (23.11.: sonst ungleiche Abstände und Radien).
// Liegt unter der Leinwand wie die Gruppen; die Bilder decken die Blätter bis auf den Versatz.

import type { CSSProperties } from "react";
import type { CanvasState } from "../../../shared/contracts.ts";
import { itemWorldRect } from "./engine/geometry.ts";
import { worldAttrs } from "./engine/overlay.ts";

export function VersionStacks({ state, hidden, selected }: { state: CanvasState; hidden: Set<string>; selected: string[] }) {
  return (
    <>
      {state.items
        .filter((item) => item.versions?.length && item.tiles && !hidden.has(item.id))
        .map((item) => (
          <div key={item.id} className="version-stack" data-round data-versions={item.versions!.length + 1} data-selected={selected.includes(item.id) || undefined} {...worldAttrs(itemWorldRect(item))}>
            {Array.from({ length: Math.min(2, item.versions!.length) }, (_, k) => (
              <div key={k} className="version-stack__sheet" style={{ "--k": k + 1 } as CSSProperties} />
            ))}
          </div>
        ))}
    </>
  );
}
