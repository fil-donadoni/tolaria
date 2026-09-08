import { lazy, Suspense, useSyncExternalStore } from "react";
import { Shell } from "./components/Shell";
import { ShortcutsSheet } from "./components/ShortcutsSheet";
import { NowView } from "./components/now/NowView";
import { getView, subscribeToView } from "./lib/view";
import { useShortcuts } from "./lib/shortcuts";

/**
 * The dashboard's page (PRD #3148 S0 → S3).
 *
 * S0 reproduced the hand-written shell verbatim so the port could not change
 * anything. S1 replaced the CHROME — header, tabs, theme, the framed section.
 * S2 replaced the NOW view, S3 the HISTORY view, and S4 deleted
 * `scripts/dashboard/` outright. Nothing on this page is resolved by id, and
 * no stylesheet outside `index.css` reaches it.
 *
 * ── HISTORY IS A LAZY ROUTE ───────────────────────────────────────────────
 *
 * `React.lazy` is the React spelling of the `await import("./history-boot.js")`
 * that `scripts/dashboard/main.js` used, and it buys the same thing #2519
 * bought: the store-backed half — the transport, the six cards, the colour
 * seeding — is its own chunk, reached only when History is rendered, so a page
 * load that only wants Now pulls none of it and touches no `telemetry.db`
 * route. A static `import` here would defeat that outright, which is why
 * `telemetry-serve.test.ts` crawls this graph and asserts the edge does not
 * exist.
 *
 * It is rendered inside the (possibly hidden) History panel rather than only
 * when that panel is visible, which preserves the vanilla ORDERING exactly:
 * `main.js` bootstrapped History on every page load, after the Now view had
 * already started polling. So the header's store line fills whichever tab you
 * land on, and switching to History shows data rather than a spinner — while
 * the chunk itself is still fetched separately, after the first paint, and its
 * failure still cannot reach the Now view.
 */
const HistoryView = lazy(() => import("./components/history/HistoryView"));

export function App() {
    const view = useSyncExternalStore(subscribeToView, getView);
    useShortcuts();
    return (
        <>
            <Shell
                view={view}
                now={<NowView />}
                history={
                    <Suspense
                        fallback={
                            <p className="text-muted-foreground text-xs">
                                loading the History view…
                            </p>
                        }
                    >
                        <HistoryView />
                    </Suspense>
                }
            />
            <ShortcutsSheet />
        </>
    );
}
