import type { ReactNode } from "react";
import type { CanvasState } from "../../../shared/contracts.ts";
import { useT } from "../../shared/i18n.tsx";
import { useVoiceCommands } from "../voice/index.ts";
import { useReview } from "./useReview.ts";
import "./review.css";

/** `title`: was links in der Leiste steht, etwa der Name des Canvas mit seinem Inhaltsverzeichnis. */
/** `end`: was rechts steht, etwa die Liste der Anmerkungen. */
/** `inverse`: helle Schrift, wenn der Grund darunter dunkel ist; die Leiste schwebt über dem Canvas. */
export function ReviewBar({ canvas, title, end, inverse = false }: { canvas: CanvasState | null; title?: ReactNode; end?: ReactNode; inverse?: boolean }) {
  const review = useReview(canvas?.name ?? "");
  const { t, phrases } = useT();
  const count = canvas?.annotations.length ?? 0;
  useVoiceCommands("review", {
    commands: review.waiting
      ? [{ id: "fertig", label: t("cmd.finish.label"), meaning: "Finish the review: send all annotations to Claude.", phrases: phrases("cmd.finish.phrases"), whileDictating: true, run: review.finish }]
      : [],
    screen: { description: review.waiting ? `Claude is waiting for the user's review${review.prompt ? ` and asked: „${review.prompt}“` : ""}.` : "", state: { claudeWaiting: review.waiting } },
  });

  return (
    <header className="review-bar" data-tone={inverse ? "inverse" : undefined}>
      {/* Auslaufende Unschärfe: drei Lagen nebeneinander, jede stärker und kürzer. */}
      <div className="review-bar__blur" aria-hidden="true">
        <div className="blur-layer" data-layer="1" />
        <div className="blur-layer" data-layer="2" />
        <div className="blur-layer" data-layer="3" />
      </div>
      {title ?? (canvas ? <div className="review-bar__title">{canvas.title}</div> : null)}
      {review.waiting ? (
        <div className="claude-card" data-tone="inverse" aria-live="polite">
          <div className="claude-card__text">
            <span className="claude-card__who">{t("review.waiting")}</span>
            {review.prompt && <span className="claude-card__prompt">{review.prompt}</span>}
          </div>
          <button type="button" className="button button--primary" data-option="fertig" disabled={review.finishing} onClick={review.finish}>
            {t("review.finish")}
          </button>
        </div>
      ) : review.sent ? (
        <div className="claude-card" data-tone="inverse" data-sent aria-live="polite">
          <span className="claude-card__prompt">{t("review.sent")}</span>
        </div>
      ) : (
        <span />
      )}
      {end ?? (canvas ? <span className="review-bar__count">{t("count.annotations", { count })}</span> : <span />)}
    </header>
  );
}
