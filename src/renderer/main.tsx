import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App.tsx";
import { LanguageProvider } from "./app/LanguageProvider.tsx";
import "./shared/tokens.css";
import "./shared/ui.css";
import "./app/app.css";

// Die Daten gehören dem Hauptprozess; er meldet Änderungen selbst. Kein Nachladen auf Verdacht.
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </QueryClientProvider>
  </StrictMode>,
);
