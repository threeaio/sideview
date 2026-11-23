// Name einer Gruppe bearbeiten: Feld an der Stelle des Namens. Enter oder Klick daneben übernimmt, Esc verwirft.
// Nach ⌘G steht es gleich offen, der Name ist markiert, Tippen überschreibt ihn.

import { useEffect, useRef, useState } from "react";
import type { CanvasState } from "../../../shared/contracts.ts";
import { groupArea } from "../../../shared/groups.ts";
import { anchorAttrs } from "./engine/overlay.ts";
import type { Arrange } from "./useArrange.ts";
import { useT } from "../../shared/i18n.tsx";

export function GroupNameEditor({ state, arrange }: { state: CanvasState; arrange: Arrange }) {
  const group = state.groups.find((g) => g.id === arrange.renaming);
  const area = group ? groupArea(group, state.items) : null;
  const [text, setText] = useState(group?.title ?? "");
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const { t } = useT();

  useEffect(() => {
    requestAnimationFrame(() => input.current?.select());
  }, []);

  if (!group || !area) return null;
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) arrange.rename(group.id, text);
    else arrange.cancelRename();
  };
  return (
    <div className="group-name-editor" data-surface-ui {...anchorAttrs(area.x, area.y)}>
      <input
        ref={input}
        className="group-name-editor__field"
        value={text}
        aria-label={t("canvas.groupName")}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") finish(false);
        }}
      />
    </div>
  );
}
