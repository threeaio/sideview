// Runde Ecken der Bilder, gemeinsam für den Shader (tile-layer) und den Rahmen mit Schatten (overlay).

/** Eckradius auf dem Bildschirm. Erst 26 (36 − 10); gewünscht war etwas weniger (5.11.),
 * jetzt 16 = Kind-Radius der Skala (36 − 20). */
export const IMAGE_RADIUS_PX = 16;
/** Kleine Bilder in der Übersicht: höchstens dieser Anteil der kürzeren Seite. */
const IMAGE_RADIUS_SHARE = 0.08;

/** Radius in Bildschirmpixeln für ein Bild, dessen kürzere Seite `minSideWorld` lang ist. */
export const imageRadiusPx = (minSideWorld: number, zoom: number) => Math.min(IMAGE_RADIUS_PX, minSideWorld * zoom * IMAGE_RADIUS_SHARE);
