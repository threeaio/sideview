// Grund unter den Screenshots: hell oder dunkel, umgeschaltet im Menü „Ansicht“.
// Die Wahl merkt sich die Oberfläche; ohne Speicher gilt hell.

import { useEffect, useState } from "react";
import type { Stage } from "../../../shared/ipc.ts";
import { canvasService } from "./canvas-service.ts";

const KEY = "canvas.stage";

function read(): Stage {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function useStage(): Stage {
  const [stage, setStage] = useState<Stage>(read);
  useEffect(
    () =>
      canvasService.onStage((next) => {
        setStage(next);
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // ohne Speicher gilt die Wahl bis zum Neuladen
        }
      }),
    [],
  );
  return stage;
}

