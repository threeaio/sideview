// Zustand der Fläche nach Herkunft getrennt: Inhalt aus dem Hauptprozess (Query-Cache),
// Name der aktuellen Fläche in der Adresse (#name), Zeige-Wunsch von Claude als kurzlebiger Zustand.

import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OpenedEvent } from "../../../shared/ipc.ts";
import { canvasKeys, canvasService } from "./canvas-service.ts";

const subscribeHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const readHash = () => decodeURIComponent(window.location.hash.slice(1));

/** Claude hat die Fläche geöffnet: alles zeigen und, falls genannt, auf den Bereich fahren. */
export type ShowRequest = { region: string | null; nonce: number };

export function useCurrentCanvas() {
  const name = useSyncExternalStore(subscribeHash, readHash);
  const queryClient = useQueryClient();
  const [show, setShow] = useState<ShowRequest | null>(null);

  useEffect(() => {
    const opened = ({ state, focus }: OpenedEvent) => {
      queryClient.setQueryData(canvasKeys.detail(state.name), state);
      window.location.hash = encodeURIComponent(state.name);
      setShow({ region: focus, nonce: Date.now() });
    };
    const offOpened = canvasService.onOpened(opened);
    // Öffnet Claude die Fläche, während das Fenster noch lädt, geht das Ereignis verloren. Deshalb einmal nachfragen.
    if (readHash() === "") void canvasService.current().then((last) => last && opened(last));
    const offChanged = canvasService.onChanged((state) => queryClient.setQueryData(canvasKeys.detail(state.name), state));
    return () => {
      offOpened();
      offChanged();
    };
  }, [queryClient]);

  const query = useQuery({
    queryKey: canvasKeys.detail(name),
    queryFn: () => canvasService.get(name),
    enabled: name !== "",
  });

  return { name, state: query.data ?? null, show };
}
