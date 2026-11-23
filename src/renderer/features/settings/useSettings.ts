// Einstellungen: offen oder zu, Schlüsselwörter ändern, Kosten lesen. Öffnen über das Menü (Cmd+,) oder per Sprache.

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cleanBaseUrl, cleanKeyword, cleanModel, DEFAULT_SETTINGS, type LanguageSetting, type Settings } from "../../../shared/settings.ts";
import { useT } from "../../shared/i18n.tsx";
import { useVoiceCommands } from "../voice/index.ts";
import { settingsKeys, settingsService } from "./settings-service.ts";

export type KeywordError = "empty" | "too_long" | "taken";
export type BackendError = "bad_url" | "bad_model" | "bad_key" | "key_not_saved";

export function useSettings() {
  const queryClient = useQueryClient();
  const { t, phrases } = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<KeywordError | null>(null);

  useEffect(() => settingsService.onOpen(() => setOpen(true)), []);

  const settings = useQuery({ queryKey: settingsKeys.settings, queryFn: settingsService.get });
  // Kosten frisch bei jedem Öffnen.
  const usage = useQuery({ queryKey: settingsKeys.usage, queryFn: settingsService.usage, enabled: open, staleTime: 0, refetchOnMount: "always" });
  const save = useMutation({
    mutationFn: (next: Settings) => settingsService.save(next),
    onSuccess: (saved) => queryClient.setQueryData(settingsKeys.settings, saved),
  });

  const voiceStatus = useQuery({ queryKey: settingsKeys.voice, queryFn: settingsService.voiceStatus, enabled: open, staleTime: 0, refetchOnMount: "always" });
  const current = settings.data ?? DEFAULT_SETTINGS;
  const keywords = current.keywords;
  const [keyDraft, setKeyDraft] = useState("");
  const [backendDraft, setBackendDraft] = useState<{ baseUrl: string; model: string } | null>(null);
  // Adresse und Modell braucht fast niemand: eingeklappt, außer es ist schon ein Dienst eingetragen.
  const [showBackend, setShowBackend] = useState(false);
  const [backendError, setBackendError] = useState<BackendError | null>(null);
  const setKey = useMutation({
    mutationFn: (key: string | null) => settingsService.setKey(key),
    onSuccess: (ok, key) => {
      if (!ok) return setBackendError("key_not_saved");
      setBackendError(null);
      if (key !== null) setKeyDraft("");
      void queryClient.invalidateQueries({ queryKey: settingsKeys.voice });
    },
  });
  const saveKey = useCallback(() => {
    const key = keyDraft.trim();
    if (!/^[\x21-\x7e]{8,400}$/.test(key) || /["'\\]/.test(key)) return setBackendError("bad_key");
    setKey.mutate(key);
  }, [keyDraft, setKey]);
  const removeKey = useCallback(() => setKey.mutate(null), [setKey]);
  const backend = backendDraft ?? current.decision;
  const saveBackend = useCallback(() => {
    const baseUrl = cleanBaseUrl(backend.baseUrl);
    if (baseUrl === null) return setBackendError("bad_url");
    const model = cleanModel(backend.model);
    if (model === null) return setBackendError("bad_model");
    setBackendError(null);
    setBackendDraft(null);
    save.mutate({ ...current, decision: { baseUrl, model } });
  }, [backend, current, save]);
  const setLanguage = useCallback((language: LanguageSetting) => save.mutate({ ...current, language }), [current, save]);

  const add = useCallback(() => {
    const cleaned = cleanKeyword(draft, keywords);
    if ("error" in cleaned) return setError(cleaned.error);
    setError(null);
    setDraft("");
    save.mutate({ ...current, keywords: [...keywords, { word: cleaned.word, action: "save" }] });
  }, [draft, keywords, save, current]);

  const remove = useCallback(
    (word: string) => save.mutate({ ...current, keywords: keywords.filter((k) => k.word !== word) }),
    [keywords, save, current],
  );

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  useVoiceCommands("settings", {
    commands: open
      ? [
          { id: "einstellungen-schliessen", label: t("cmd.settingsClose.label"), meaning: "Close the settings dialog.", phrases: phrases("cmd.settingsClose.phrases"), run: close },
          { id: "schluesselwort-hinzufuegen", label: t("cmd.addKeyword.label"), meaning: "Add the typed word as a keyword.", phrases: phrases("cmd.addKeyword.phrases"), run: add },
          { id: "sprache-automatisch", label: t("cmd.languageAuto.label"), meaning: "Set the language to follow the system.", phrases: phrases("cmd.languageAuto.phrases"), run: () => setLanguage("auto") },
          { id: "sprache-deutsch", label: t("cmd.languageDe.label"), meaning: "Set the language to German.", phrases: phrases("cmd.languageDe.phrases"), run: () => setLanguage("de") },
          { id: "sprache-englisch", label: t("cmd.languageEn.label"), meaning: "Set the language to English.", phrases: phrases("cmd.languageEn.phrases"), run: () => setLanguage("en") },
          { id: "schluessel-sichern", label: t("cmd.saveKey.label"), meaning: "Save the typed API key for the decision model.", phrases: phrases("cmd.saveKey.phrases"), run: saveKey },
          { id: "schluessel-entfernen", label: t("cmd.removeKey.label"), meaning: "Remove the stored API key for the decision model.", phrases: phrases("cmd.removeKey.phrases"), run: removeKey },
          { id: "anderer-dienst", label: t("cmd.otherService.label"), meaning: "Show the fields for another decision service (address and model).", phrases: phrases("cmd.otherService.phrases"), run: () => setShowBackend(true) },
          { id: "dienst-uebernehmen", label: t("cmd.applyBackend.label"), meaning: "Apply the typed address and model of the decision service.", phrases: phrases("cmd.applyBackend.phrases"), run: saveBackend },
          ...keywords.map((k, i) => ({
            id: `schluesselwort-entfernen-${i + 1}`,
            label: t("cmd.removeKeyword.label", { word: k.word }),
            meaning: `Remove the keyword „${k.word}“.`,
            phrases: phrases("cmd.removeKeyword.phrases", { word: k.word }),
            run: () => remove(k.word),
          })),
        ]
      : [{ id: "einstellungen", label: t("cmd.settings.label"), meaning: "Open the settings: keywords and costs.", phrases: phrases("cmd.settings.phrases"), run: () => setOpen(true) }],
    screen: open ? { description: "The settings dialog is open: keywords that save a dictated note, and the costs of Jev.", state: { settingsOpen: true } } : undefined,
  });

  return {
    open,
    close,
    keywords,
    draft,
    type: (text: string) => {
      setDraft(text);
      setError(null);
    },
    error,
    add,
    remove,
    usage: usage.data ?? null,
    voice: voiceStatus.data ?? null,
    language: current.language,
    setLanguage,
    keyDraft,
    typeKey: (text: string) => {
      setKeyDraft(text);
      setBackendError(null);
    },
    saveKey,
    removeKey,
    backend,
    typeBackend: (patch: Partial<{ baseUrl: string; model: string }>) => {
      setBackendDraft({ ...backend, ...patch });
      setBackendError(null);
    },
    backendChanged: backendDraft !== null,
    backendShown: showBackend || Boolean(current.decision.baseUrl || current.decision.model),
    showBackend: () => setShowBackend(true),
    saveBackend,
    backendError,
  };
}

export type SettingsModel = ReturnType<typeof useSettings>;
