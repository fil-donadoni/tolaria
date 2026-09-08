import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initTheme } from "./lib/theme";
import "./index.css";

/**
 * The dashboard's Vite entry (ADR 0117, PRD #3148).
 *
 * S0 moved the BUILD and left every behaviour in `scripts/dashboard/`; S2 and
 * S3 moved the two views; S4 deleted the directory. What is left is what an
 * entry should be — mount the app, and set the theme before the first paint.
 *
 * ── WHAT WENT AWAY, AND WHY IT WAS THERE ──────────────────────────────────
 *
 * `flushSync` and `await import("../scripts/dashboard/main.js")`. The legacy
 * entry was a top-level effectful module: it called `installTooltipEngine` at
 * import time and that resolved its elements with `getElementById`
 * immediately, so the render had to be COMMITTED before the module evaluated —
 * `flushSync` forced that, and the handover had to be a dynamic import because
 * a static one evaluates before this file's first line. With no vanilla module
 * left to hand over to, a concurrent render is simply correct.
 *
 * `import "../scripts/dashboard/dashboard.css"` went with it. It was imported
 * AFTER the Tailwind entry on purpose — its rules are unlayered, so they won
 * over `@layer base` and an un-ported section looked exactly as it had. Every
 * section is ported, so the 1,602 lines it held are 1,602 lines nothing reads.
 */

// The theme BEFORE the first paint: `data-theme` decides which token block
// wins, and setting it after the render would flash the wrong palette.
initTheme(new URLSearchParams(location.search));

const container = document.getElementById("root");
if (!container) throw new Error("dashboard: no #root in the shell");

createRoot(container).render(<App />);
