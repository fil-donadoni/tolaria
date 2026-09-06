import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { TooltipProvider } from "~/components/ui/tooltip";
import { AppRouter } from "./app-router";
import * as Sentry from "@sentry/react";
// Side-effect: hydrates the card-definition registry with the full catalogue
// (~1872 cards). Extracted into a separate chunk by the Vite `manualChunks`
// config — the main bundle drops the set-module tree (~1.63 MB raw / 431 KB
// gzip), and this chunk is cached independently from the app code.
import "@convex/cards/catalogue";
// Start the catalogue fetch at module load, so the ~1 MB artifact download
// overlaps the auth round trip instead of queuing behind it (ADR 0113 §3,
// issue #3053). `CatalogueGate` (`src/router.tsx`) awaits this SAME promise
// singleton and renders nothing that reads the registry until it resolves; a
// rejection is surfaced there with a retry, so it is deliberately not handled
// here.
import { hydrateCatalogue } from "~/lib/catalogueArtifact";

void hydrateCatalogue().catch(() => {
    // Owned by `CatalogueGate`, which surfaces the failure with a retry. This
    // only keeps the eager kick-off from becoming an unhandled rejection in
    // the window before the gate mounts.
});

Sentry.init({
    dsn: "https://82a4e88a462f5637f13141dc3b7a37d9@o4505113193218048.ingest.us.sentry.io/4511609765691393",
    dataCollection: {
        // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
        // https://docs.sentry.io/platforms/javascript/guides/react/configuration/options/#dataCollection
        userInfo: false,
        httpBodies: [],
    },
    // Enable logs to be sent to Sentry
    enableLogs: true,
});

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("/sw-cards.js", { scope: "/" })
            .catch((err) => {
                console.warn("[sw-cards] registration failed", err);
            });
    });
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ConvexAuthProvider client={convex}>
            <TooltipProvider>
                <AppRouter />
            </TooltipProvider>
        </ConvexAuthProvider>
    </StrictMode>
);
