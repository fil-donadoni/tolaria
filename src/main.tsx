import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { TooltipProvider } from "~/components/ui/tooltip";
import { AppRouter } from "./router";

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
