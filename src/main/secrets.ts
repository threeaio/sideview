// Schlüssel für das Entscheidungsmodell: aus der Umgebung (TYPESAFE_API_KEY) oder aus der macOS-Keychain
// (Dienst „typesafe“, Konto = Benutzer). Nie in einer Datei. Geschrieben wird über `security -i`, damit der
// Schlüssel nicht in der Prozessliste steht.

import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";

export const KEY_SERVICE = "typesafe";
const account = () => os.userInfo().username;

export function readKeychainKey(service = KEY_SERVICE): string | null {
  try {
    return execFileSync("/usr/bin/security", ["find-generic-password", "-w", "-s", service, "-a", account()], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/** Nur druckbare Zeichen ohne Anführungszeichen und Leerraum; so bleibt die Zeile für `security -i` eindeutig. */
export const keyAllowed = (key: string) => /^[\x21-\x7e]{8,400}$/.test(key) && !/["'\\]/.test(key);

export function writeKeychainKey(key: string, service = KEY_SERVICE): boolean {
  if (!keyAllowed(key)) return false;
  const r = spawnSync("/usr/bin/security", ["-i"], { input: `add-generic-password -U -s ${service} -a ${account()} -w "${key}"\n`, encoding: "utf8" });
  return r.status === 0 && readKeychainKey(service) === key;
}

export function deleteKeychainKey(service = KEY_SERVICE): void {
  spawnSync("/usr/bin/security", ["delete-generic-password", "-s", service, "-a", account()], { stdio: "ignore" });
}
