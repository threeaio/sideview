// Name einer Gruppe bearbeiten: Feld an der Stelle des Namens. Enter oder Klick daneben übernimmt, Esc verwirft.
// Nach ⌘G steht es gleich offen, der Name ist markiert, Tippen überschreibt ihn. Per Sprache („Gruppe umbenennen“)
// ersetzt das erste Gesagte den Namen, weiteres hängt an; „sichern“ übernimmt, „verwerfen“ verwirft.

import { useEffect, useRef, useState } from "react";
import type { CanvasState } from "../../../shared/contracts.ts";
import { groupArea } from "../../../shared/groups.ts";
import { anchorAttrs } from "./engine/overlay.ts";
import type { Arrange } from "./useArrange.ts";
import { useT } from "../../shared/i18n.tsx";
import { useVoiceCommands } from "../voice/index.ts";

/** Whisper setzt Satzzeichen ans Ende („Kunden.“), im Namen stören sie. */
const spokenName = (text: string) => text.trim().replace(/[.,!?;:…]+$/u, "").trim();

export function GroupNameEditor({ state, arrange }: { state: CanvasState; arrange: Arrange }) {
  const group = state.groups.find((g) => g.id === arrange.renaming);
  const area = group ? groupArea(group, state.items) : null;
  const [text, setTextState] = useState(group?.title ?? "");
  const current = useRef(text);
  const setText = (next: string) => {
    current.current = next;
    setTextState(next);
  };
  const voiced = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const { t, phrases } = useT();

  useEffect(() => {
    requestAnimationFrame(() => input.current?.select());
  }, []);

  const finish = (save: boolean) => {
    if (done.current || !group) return;
    done.current = true;
    if (save) arrange.rename(group.id, current.current);
    else arrange.cancelRename();
  };
  const append = (spoken: string) => {
    const name = spokenName(spoken);
    if (!name) return;
    setText(voiced.current && current.current ? `${current.current} ${name}` : name);
    voiced.current = true;
  };

  useVoiceCommands("group-name", {
    commands: group
      ? [
          { id: "gruppenname-sichern", label: t("cmd.save.label"), meaning: "Save the new group name.", phrases: phrases("cmd.save.phrases"), whileDictating: true, run: () => finish(true) },
          { id: "gruppenname-verwerfen", label: t("cmd.discard.label"), meaning: "Discard the new group name and keep the old one.", phrases: phrases("cmd.discard.phrases"), whileDictating: true, run: () => finish(false) },
        ]
      : [],
    dictation: group
      ? {
          append,
          commit: async (spoken) => {
            if (spoken) append(spoken);
            finish(true);
          },
        }
      : null,
    screen: group ? { description: `The name field of the group „${group.title}“ is open; what the user says becomes its new name.`, state: { renamingGroup: group.title } } : undefined,
  });

  if (!group || !area) return null;
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
