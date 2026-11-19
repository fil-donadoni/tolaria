import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { TooltipProvider } from "~/components/ui/tooltip";
import { AppRouter } from "./app-router";
import { router } from "./router";
import * as Sentry from "@sentry/react";
import { installConsoleRing } from "~/lib/diagnostics/console-ring";
import { installNetworkRing } from "~/lib/diagnostics/network-ring";
import { sampleStorageFacts } from "~/lib/diagnostics/environment";

// Client diagnostics (issue #3256), installed as early as a module can run.
// All three are bounded, client-only rings that reach a maintainer ONLY when a
// reporter files a bug report and consents to the disclosure (issue #3255) —
// nothing here sends anything anywhere on its own.
//
// Before `Sentry.init` on purpose: the SDK wraps the console too, and wrapping
// first means this ring sees the call the app made rather than whatever the
// instrumentation left of it. Both wrappers chain; neither replaces.
installConsoleRing();
installNetworkRing(import.meta.env.VITE_CONVEX_URL);
void sampleStorageFacts();

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
    // Tracing (issue #10214): page loads and route navigations, named by
    // TanStack Router's parameterised route (`/game/$gameId`, not the id).
    // Production builds only — the local dev server must not spend the
    // free-tier span quota (ADR 0139 § 4). `tracePropagationTargets` stays
    // the default (same origin): Convex is cross-origin and runs no Sentry
    // SDK, so a `sentry-trace` header on its requests buys nothing and risks
    // a CORS preflight failure.
    integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 0,
});

// No `beforeunload` "unsaved changes" prompt (issue #10229): Convex's default
// blocks leaving while ANY request is in flight — the game-end Verdict judge
// keeps an action in flight for minutes, so leaving a game asked the browser.
// Nothing the app sends is unsaved user work; leaving is always app navigation.
const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL, {
    unsavedChangesWarning: false,
});

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("/sw-cards.js", { scope: "/" })
            // Re-sample once the registration has settled: the sample taken at
            // module load necessarily predates it, and "no service worker" is
            // exactly the wrong thing for a report about missing card images to
            // say (issue #3256).
            .then(() => sampleStorageFacts())
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
