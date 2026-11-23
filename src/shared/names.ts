// Namen von Flächen als Dateinamen.

/** Name einer Fläche als Dateiname: klein, Bindestriche, keine Pfadzeichen. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "flaeche";
}
