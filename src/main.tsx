import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { TooltipProvider } from "~/components/ui/tooltip";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ConvexProvider client={convex}>
            <TooltipProvider>
                <App />
            </TooltipProvider>
        </ConvexProvider>
    </StrictMode>
);
