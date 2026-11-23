// Sprechen unten links: zeigt, dass zugehört wird, und danach kurz, was verstanden und getan wurde.
// Bei knapper Wahl stehen die Kandidaten mit Nummern da; „eins“, „zwei“ oder ein Klick wählt.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT, type Translate } from "../../shared/i18n.tsx";
import { useVoice, type VoiceShown } from "./useVoice.ts";
import "./voice.css";

declare global {
  interface Window {
    /** Nur zum Prüfen von außen: eine Aufnahme ohne Mikrofon einspielen. */
    __voice?: { inject(audio: Uint8Array, mime: string): Promise<unknown> };
  }
}

function result(shown: NonNullable<VoiceShown>, t: Translate["t"]) {
  const said = shown.transcript ? t("voice.quote", { text: shown.transcript }) : "";
  if (shown.kind === "done") return { said, did: shown.label };
  if (shown.kind === "dictated") return { said, did: t("voice.dictated") };
  return { said, did: t(`voice.none.${shown.reason}`) };
}

/**
 * Reicht die Sprachleiste bis zur Werkzeugleiste unten in der Mitte, rückt sie eine Zeile höher
 * (22.11.: Bedienelemente überlappen). Gemessen bei jeder Änderung und beim Ändern der Fenstergröße.
 */
function useClearOfToolbar(shown: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [lifted, setLifted] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const bar = document.querySelector('[role="toolbar"]')?.getBoundingClientRect();
      const own = el.getBoundingClientRect();
      setLifted(Boolean(bar && bar.width > 0 && own.width > 0 && own.right > bar.left - 8 && own.left < bar.right + 8));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [shown]);
  return { ref, lifted };
}

export function VoiceControl() {
  const voice = useVoice();
  const { t } = useT();
  const clear = useClearOfToolbar(voice.supported);

  useEffect(() => {
    window.__voice = { inject: voice.inject };
    return () => {
      delete window.__voice;
    };
  }, [voice.inject]);

  if (!voice.supported) return null;
  const shown = voice.shown && result(voice.shown, t);

  return (
    <div ref={clear.ref} className="voice" data-phase={voice.phase} data-lifted={clear.lifted || undefined} aria-live="polite">
      {voice.ask ? (
        <div className="voice__ask">
          <span>{t("voice.which")}</span>
          {voice.ask.candidates.map((c, i) => (
            <button key={c.id} type="button" className="button button--small" data-option={`wahl-${i + 1}`} onClick={() => voice.pick(i)}>
              <span className="voice__number">{i + 1}</span> {c.label}
            </button>
          ))}
        </div>
      ) : null}
      {voice.phase === "listening" ? (
        <div className="voice__pill voice__pill--live">
          {t("voice.listening")}
          <span className="voice__level" style={{ transform: `scaleX(${Math.min(1, voice.level * 6)})` }} />
        </div>
      ) : voice.phase === "thinking" ? (
        <div className="voice__pill">{t("voice.thinking")}</div>
      ) : shown ? (
        <div className="voice__pill" data-kind={voice.shown!.kind}>
          {shown.said && <span className="voice__said">{shown.said}</span>}
          <span className="voice__did">{shown.did}</span>
        </div>
      ) : (
        <button
          type="button"
          className="voice__hint"
          onPointerDown={voice.press}
          onPointerUp={voice.release}
          onPointerLeave={voice.release}
          title={t("voice.hintTitle")}
        >
          {t("voice.hint")}
        </button>
      )}
    </div>
  );
}
