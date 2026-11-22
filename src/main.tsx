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
import {
    sendableTransaction,
    tracesSamplerFor,
} from "~/lib/diagnostics/tracing";
import {
    SENTRY_DSN,
    SENTRY_TUNNEL_PATH,
} from "~/lib/diagnostics/sentry-tunnel";

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
    dsn: SENTRY_DSN,
    // First-party route (issue #10414): content blockers drop every request
    // to `*.ingest.sentry.io`, so envelopes go to this same-origin path and
    // the host forwards them — a `vercel.json` rewrite in production, the
    // Vite proxy in dev (`~/lib/diagnostics/sentry-tunnel`).
    tunnel: SENTRY_TUNNEL_PATH,
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
    // Which traces are kept (issue #10321): every Brain consult's span and
    // the game route in full, every other route at a fifth, and nothing from
    // a browser driven by automation. No transaction leaves with the
    // session's breadcrumbs, and a consult's is stripped further, of the
    // page URL and the user-agent header the SDK adds to every transaction
    // — `~/lib/diagnostics/tracing`.
    tracesSampler: tracesSamplerFor(import.meta.env.PROD),
    beforeSendTransaction: (event) => sendableTransaction(event),
});

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

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
