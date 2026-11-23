// Einstellungen als Dialog über dem Canvas: Schlüsselwörter und Kosten. Ganz knapp, Esc schließt.
// Tasten im Dialog erreichen das Canvas nicht (sonst löscht Entf eine ausgewählte Anmerkung).

import { useEffect, useRef } from "react";
import { useT } from "../../shared/i18n.tsx";
import { formatUsd } from "./format.ts";
import type { SettingsModel } from "./useSettings.ts";
import "./settings.css";

export function SettingsDialog({ settings }: { settings: SettingsModel }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { t, lang } = useT();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (settings.open && !d.open) d.showModal();
    if (!settings.open && d.open) d.close();
  }, [settings.open]);

  const usage = settings.usage;

  return (
    <dialog
      ref={dialog}
      className="settings"
      aria-labelledby="settings-title"
      onClose={settings.close}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          settings.close();
        }
      }}
      onPointerDown={(e) => {
        // Klick auf den abgedunkelten Rand schließt.
        if (e.target === dialog.current) settings.close();
      }}
    >
      <div className="settings__body">
        <header className="settings__head">
          <h2 id="settings-title" className="settings__title">
            {t("settings.title")}
          </h2>
          <button type="button" className="button button--quiet button--small" data-option="einstellungen-schliessen" onClick={settings.close}>
            {t("settings.close")}
          </button>
        </header>

        <section className="settings__section" aria-labelledby="keywords-title">
          <h3 id="keywords-title" className="settings__heading">
            {t("settings.keywords")}
          </h3>
          <p className="settings__hint">{t("settings.keywordsHint")}</p>
          {settings.keywords.length > 0 ? (
            <ul className="keywords">
              {settings.keywords.map((k, i) => (
                <li key={k.word} className="keyword">
                  <span className="keyword__word">{k.word}</span>
                  <span className="keyword__action">{t(`settings.keywordAction.${k.action}`)}</span>
                  <button type="button" className="button button--quiet button--small" data-option={`schluesselwort-entfernen-${i + 1}`} aria-label={t("settings.removeWord", { word: k.word })} onClick={() => settings.remove(k.word)}>
                    {t("settings.remove")}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <form
            className="keyword-add"
            onSubmit={(e) => {
              e.preventDefault();
              settings.add();
            }}
          >
            <input
              className="field"
              value={settings.draft}
              onChange={(e) => settings.type(e.target.value)}
              placeholder={settings.keywords.length ? t("settings.moreWords") : t("settings.firstWord")}
              aria-label={t("settings.newKeyword")}
              aria-invalid={settings.error !== null}
              spellCheck={false}
            />
            <button type="submit" className="button" data-option="schluesselwort-hinzufuegen">
              {t("settings.add")}
            </button>
          </form>
          {settings.error && <p className="settings__error">{t(`settings.error.${settings.error}`)}</p>}
        </section>

        <section className="settings__section" aria-labelledby="voice-title">
          <h3 id="voice-title" className="settings__heading">
            {t("settings.language")}
          </h3>
          <div className="segmented" role="radiogroup" aria-label={t("settings.language")}>
            {(
              [
                ["auto", t("settings.languageAuto"), "sprache-automatisch"],
                ["de", "Deutsch", "sprache-deutsch"],
                ["en", "English", "sprache-englisch"],
              ] as const
            ).map(([value, label, option]) => (
              <button key={value} type="button" role="radio" aria-checked={settings.language === value} className="segmented__item" data-option={option} onClick={() => settings.setLanguage(value)}>
                {label}
              </button>
            ))}
          </div>
          <p className="settings__hint" data-voice-ready={settings.voice?.speech.ready ? "" : undefined}>
            {!settings.voice
              ? "–"
              : settings.voice.speech.ready
                ? t("settings.voiceReady", { model: settings.voice.speech.model ?? "" })
                : settings.voice.speech.missing.length
                  ? t("settings.voiceMissing", { missing: new Intl.ListFormat(lang, { type: "conjunction" }).format(settings.voice.speech.missing.map((m) => t(`settings.missing.${m}`))) })
                  : t("settings.voiceOff")}
          </p>
        </section>

        <section className="settings__section" aria-labelledby="decision-title">
          <h3 id="decision-title" className="settings__heading">
            {t("settings.decision")}
          </h3>
          <p className="settings__hint">
            {settings.voice?.key === "env" ? t("settings.keyEnv") : settings.voice?.key === "keychain" ? t("settings.keyKeychain") : t("settings.keyNone")}
          </p>
          {settings.voice?.key !== "env" && (
            <form
              className="keyword-add"
              onSubmit={(e) => {
                e.preventDefault();
                settings.saveKey();
              }}
            >
              <input
                className="field"
                type="password"
                value={settings.keyDraft}
                onChange={(e) => settings.typeKey(e.target.value)}
                placeholder={settings.voice?.key === "keychain" ? t("settings.newKey") : t("settings.apiKey")}
                aria-label={t("settings.apiKey")}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="button" data-option="schluessel-sichern">
                {t("settings.saveKey")}
              </button>
              {settings.voice?.key === "keychain" && (
                <button type="button" className="button button--quiet" data-option="schluessel-entfernen" onClick={settings.removeKey}>
                  {t("settings.remove")}
                </button>
              )}
            </form>
          )}
          {!settings.backendShown && (
            <button type="button" className="button button--quiet button--small settings__more" data-option="anderer-dienst" onClick={settings.showBackend}>
              {t("settings.otherService")}
            </button>
          )}
          {settings.backendShown && (
          <form
            className="backend"
            onSubmit={(e) => {
              e.preventDefault();
              settings.saveBackend();
            }}
          >
            <label className="backend__field">
              <span>{t("settings.address")}</span>
              <input className="field" value={settings.backend.baseUrl} onChange={(e) => settings.typeBackend({ baseUrl: e.target.value })} placeholder="https://api.typesafe.ai" spellCheck={false} />
            </label>
            <label className="backend__field">
              <span>{t("settings.model")}</span>
              <input className="field" value={settings.backend.model} onChange={(e) => settings.typeBackend({ model: e.target.value })} placeholder="jev" spellCheck={false} />
            </label>
            {settings.backendChanged && (
              <button type="submit" className="button" data-option="dienst-uebernehmen">
                {t("settings.apply")}
              </button>
            )}
          </form>
          )}
          {settings.backendShown && <p className="settings__hint">{t("settings.backendHint")}</p>}
          {settings.backendError && <p className="settings__error">{t(`settings.error.${settings.backendError}`)}</p>}
        </section>

        {!settings.backend.baseUrl && settings.voice?.key && (
        <section className="settings__section" aria-labelledby="costs-title">
          <h3 id="costs-title" className="settings__heading">
            {t("settings.costs")}
          </h3>
          <dl className="costs">
            <div className="cost">
              <dt>{t("settings.today")}</dt>
              <dd>{usage ? formatUsd(usage.today, lang) : "–"}</dd>
            </div>
            <div className="cost">
              <dt>{t("settings.perDay")}</dt>
              <dd>{usage ? formatUsd(usage.perDay, lang) : "–"}</dd>
            </div>
            <div className="cost">
              <dt>{t("settings.month")}</dt>
              <dd>{usage ? formatUsd(usage.month, lang) : "–"}</dd>
            </div>
          </dl>
          <p className="settings__hint">{t("settings.costsHint")}</p>
        </section>
        )}
      </div>
    </dialog>
  );
}
