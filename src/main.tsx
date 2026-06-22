import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { TooltipProvider } from "~/components/ui/tooltip";
import { AppRouter } from "./router";
import * as Sentry from "@sentry/react";

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
