import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initTheme } from "./lib/theme";
import "./index.css";

/**
 * The cockpit's Vite entry (ADR 0117, issue #5652): mount the app, and set the
 * theme before the first paint.
 */

// The theme BEFORE the first paint: `data-theme` decides which token block
// wins, and setting it after the render would flash the wrong palette.
initTheme(new URLSearchParams(location.search));

const container = document.getElementById("root");
if (!container) throw new Error("dashboard: no #root in the shell");

createRoot(container).render(<App />);
