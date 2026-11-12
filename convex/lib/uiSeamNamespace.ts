/**
 * The `check:ui` lane's test-only seam — its ONE namespace (issue #9271,
 * ADR 0179).
 *
 * A lane shortcut — a route or a query parameter that jumps straight to a
 * state instead of clicking through the lobby — lives here or nowhere:
 *
 * - client routes under {@link UI_SEAM_ROUTE_PREFIX}, registered by the router
 *   only under `import.meta.env.DEV` (`src/routes/ui-seam/ui-seam-routes.ts`);
 * - query parameters whose key starts with {@link UI_SEAM_PARAM_PREFIX}, read
 *   only by those routes ({@link pickUiSeamParams});
 * - server functions in ONE module, `convex/uiSeam.ts`, each opening on the
 *   double gate (`convex/lib/uiSeamGate.ts`: local deployment AND lane
 *   account).
 *
 * Every spelling derives from {@link UI_SEAM_MARKER}, which is what makes the
 * production guard possible: `bun run check:bundle` reds when a built asset
 * carries the marker, i.e. when any of this code survived into a production
 * bundle. So this module must stay reachable ONLY from seam code — the
 * dev-only routes, the server seam, the lane (`scripts/ui-gate/`). An
 * ordinary `src/` module importing it puts the marker in production and reds
 * the guard, by design.
 *
 * DELIBERATELY DEPENDENCY-FREE, for the reason `uiGateLaneAccount.ts` gives:
 * the lane's `scripts/` process imports it, and a registered Convex function
 * module would drag gitignored `convex/_generated` in with it.
 */

/** The string every seam spelling carries, and the one the production-bundle
 *  guard greps for. Unusual on purpose: it must never occur in product code
 *  by accident. */
export const UI_SEAM_MARKER = "__uiseam";

// Every spelling below is a PLAIN string literal, never a template built from
// the marker: the bundler cannot prove a template literal free of side effects
// (it may call `toString`), so it keeps the declarations even when nothing
// reads them — and a production build carried the marker with the DEV gate
// intact. `router-ui-seam.test.ts` asserts each one starts with the marker.

/** Every seam route's path starts here. */
export const UI_SEAM_ROUTE_PREFIX = "/__uiseam";

/** Every seam query parameter's key starts here. */
export const UI_SEAM_PARAM_PREFIX = "__uiseam_";

/** The trivial seam route: renders the server seam's echo, proving both
 *  gates end to end without touching any game state. */
export const UI_SEAM_ECHO_PATH = "/__uiseam/echo";

/** The echo route's one parameter: a value the page prints back verbatim. */
export const UI_SEAM_ECHO_PARAM = "__uiseam_echo";

/**
 * The seam's parameters out of a parsed search object: string values under
 * {@link UI_SEAM_PARAM_PREFIX}, nothing else. A seam route's
 * `validateSearch` — so a seam page can never read an ordinary parameter as
 * a shortcut, and a non-string value (TanStack JSON-parses each one) is
 * dropped rather than coerced.
 */
export function pickUiSeamParams(
    search: Record<string, unknown>
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(search)) {
        if (key.startsWith(UI_SEAM_PARAM_PREFIX) && typeof value === "string") {
            out[key] = value;
        }
    }
    return out;
}
