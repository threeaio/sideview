// Gruppen unter den Bildern: getönte Fläche mit Rand um ihre Bilder, der Name links darüber. Beim Ziehen hebt sich
// die Zielgruppe hervor, ihre Fläche umfasst die Lücke, und die Lücke zeigt, wo das Bild landet. Gewählt: Schatten
// und dieselbe leichte Tönung, kein Saum (5.11.).
// Am rechten Rand ein Griff für die Breite, sichtbar an der gewählten Gruppe und beim Ziehen (20.11.).
// Liegt unter der Leinwand (die Bilder decken die Fläche), in Weltkoordinaten wie die HTML-Ebene.

import type { CanvasState } from "../../../shared/contracts.ts";
import { groupArea, type Area } from "../../../shared/groups.ts";
import type { Box } from "../../../shared/layout.ts";
import { anchorAttrs, sizeAttrs, worldAttrs } from "./engine/overlay.ts";

export function GroupLayer({ state, areas, target, slot, selected, renaming, resizing }: { state: CanvasState; areas: Record<string, Area>; target: string | null; slot: Box | null; selected: string | null; renaming: string | null; resizing: string | null }) {
  return (
    <>
      {state.groups.map((group) => {
        const area = areas[group.id] ?? groupArea(group, state.items);
        if (!area) return null;
        return (
          <div key={group.id} className="surface-group-wrap" data-group={group.id}>
            <div className="surface-group" data-round data-target={target === group.id || undefined} data-selected={selected === group.id || undefined} {...worldAttrs(area)} />
            <div className="surface-group__label" data-editing={renaming === group.id || undefined} {...anchorAttrs(area.x, area.y)} data-ww={area.w} {...sizeAttrs({ ...area, h: 0 })}>
              <span className="surface-group__name">{group.title}</span>
            </div>
            {(selected === group.id || resizing === group.id) && <div className="surface-group__grip" data-active={resizing === group.id || undefined} {...anchorAttrs(area.x + area.w, area.y + area.h / 2)} />}
          </div>
        );
      })}
      {slot && <div className="drop-slot" data-round {...worldAttrs(slot)} />}
    </>
  );
}
