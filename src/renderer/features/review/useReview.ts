import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { reviewKeys, reviewService } from "./review-service.ts";

/** So lange steht „An Claude geschickt“ nach „Fertig“. */
const SENT_MS = 6000;

/** Wartet Claude auf diese Fläche? Und „Fertig“ dazu, mit kurzer Bestätigung. */
export function useReview(canvas: string) {
  const queryClient = useQueryClient();
  const [sent, setSent] = useState(false);

  useEffect(() => reviewService.onChange((open) => queryClient.setQueryData(reviewKeys.open, open)), [queryClient]);
  useEffect(() => {
    if (!sent) return;
    const timer = setTimeout(() => setSent(false), SENT_MS);
    return () => clearTimeout(timer);
  }, [sent]);

  const open = useQuery({ queryKey: reviewKeys.open, queryFn: reviewService.open });
  const waiting = (open.data ?? []).filter((r) => r.canvas === canvas);
  const finish = useMutation({
    mutationFn: () => reviewService.finish(canvas),
    // Gibt die beendeten Besprechungen zurück; nur wenn Claude wartete, ging etwas an Claude.
    onSuccess: (finished) => setSent(finished.length > 0),
  });

  return {
    waiting: waiting.length > 0,
    sent: sent && waiting.length === 0,
    prompt: waiting.find((r) => r.prompt)?.prompt ?? null,
    finish: () => finish.mutate(),
    finishing: finish.isPending,
  };
}
