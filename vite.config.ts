import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Oberfläche der Fläche. Im Fenster per Datei geladen (base "./"), in der Entwicklung über den Dev-Server.
export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  server: { port: 4721, strictPort: true },
  // Lädt von der Platte, nicht übers Netz: three.js in einem Stück ist hier kein Problem.
  build: { outDir: "../../dist/renderer", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
