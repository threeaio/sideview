// Typen der Textkataloge. de.ts ist die Quelle; en.ts muss jeden Schlüssel mit derselben Art von Wert haben.

/** Text, der von einer Zahl abhängt: `{count}` steht für die Zahl. */
export type Plural = { readonly one: string; readonly other: string };

/** Ein Eintrag: Text, Text mit Einzahl und Mehrzahl, oder Sprachphrasen (Wörter für den Namensabgleich im Code). */
export type Entry = string | Plural | readonly string[];

/** Gleicher Schlüsselsatz, Werte nur nach ihrer Art: so fehlt kein englischer Schlüssel, ohne dass tsc es merkt. */
export type MessagesOf<C extends Record<string, Entry>> = {
  readonly [K in keyof C]: C[K] extends readonly string[] ? readonly string[] : C[K] extends string ? string : Plural;
};
