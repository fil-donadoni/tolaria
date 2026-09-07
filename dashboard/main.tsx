import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initTheme } from "./lib/theme";
import "./index.css";
// The legacy stylesheet, still the whole appearance of both view BODIES
// until S2/S3 port them. Imported AFTER the Tailwind entry on purpose:
// its rules are unlayered, so they win over `@layer base` and the port
// cannot change how an un-ported section looks. It dies with the last
// vanilla module (S4).
import "../scripts/dashboard/dashboard.css";

/**
 * The dashboard's Vite entry (ADR 0117, PRD #3148 S0).
 *
 * S0 moves the BUILD, not the components. The vanilla modules under
 * `scripts/dashboard/` are imported unchanged and still own every behaviour;
 * all this entry does is put their DOM on the page first and then hand over.
 *
 * ORDER IS THE WHOLE POINT. `scripts/dashboard/main.js` is a top-level
 * effectful module: it calls `initTabs` / `startLoopStatusPolling` /
 * `installTooltipEngine` at import time, and each of those resolves its
 * elements with `getElementById` immediately. So the render must be COMMITTED
 * before the module is evaluated:
 *
 * - `flushSync` makes `root.render` synchronous — a concurrent render would
 *   commit after this module's last line, and every one of those lookups would
 *   see `null`.
 * - the legacy entry is reached through `await import(...)`, never a static
 *   `import`, because a static import evaluates BEFORE the first line of this
 *   file and would defeat the flush entirely.
 *
 * `scripts/__tests__/telemetry-serve.test.ts` pins both halves.
 */
// The theme BEFORE the first paint: `data-theme` decides which token block
// wins, and setting it after the render would flash the wrong palette.
initTheme(new URLSearchParams(location.search));

const container = document.getElementById("root");
if (!container) throw new Error("dashboard: no #root in the shell");

flushSync(() => createRoot(container).render(<App />));

await import("../scripts/dashboard/main.js");
