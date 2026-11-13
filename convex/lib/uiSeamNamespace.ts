/**
 * The `check:ui` lane's test-only seam — its ONE namespace (issue #9271,
 * ADR 0180).
 *
 * A lane shortcut — a route or a query parameter that jumps straight to a
 * state instead of clicking through the lobby — lives here or nowhere:
 *
 * - client routes under {@link UI_SEAM_ROUTE_PREFIX}, registered by the router
 *   only under `import.meta.env.DEV` (`src/lib/uiSeam/ui-seam-routes.ts`);
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

/** The declared-position deep link (issue #9272): loads a `debugScenarios`
 *  row into the lane's own solo game (`uiSeam.loadPosition`), then routes to
 *  the board — the Debug sheet's Scenarios load in one navigation. */
export const UI_SEAM_POSITION_PATH = "/__uiseam/position";

/** The position deep link's label: the `debugScenarios` row to load. */
export const UI_SEAM_POSITION_PARAM = "__uiseam_position";

/** The position deep link's repeat guard, `<gameId>@<seq>`: the game and
 *  `seq` an earlier load of the SAME label returned. That game still standing
 *  at that `seq` means nothing was saved since, so the position is not rebuilt
 *  (`uiSeam.loadPosition`). */
export const UI_SEAM_UNLESS_AT_PARAM = "__uiseam_unless_at";

/** The `sessionStorage` key the position page records its last load under,
 *  `{ label, gameId, seq, loaded }` — how the lane learns the guard to pass
 *  back as {@link UI_SEAM_UNLESS_AT_PARAM} on the next row's load. */
export const UI_SEAM_POSITION_RECORD_KEY = "__uiseam_position_record";

/** What the position page stores under {@link UI_SEAM_POSITION_RECORD_KEY}. */
export interface UiSeamPositionRecord {
    label: string;
    gameId: string;
    seq: number;
    loaded: boolean;
}

/** The Limited deck deep link (issue #9272): saves the lane's seat of a
 *  Limited fixture as a Limited deck (`uiSeam.saveLimitedFixtureDeck`), then
 *  routes to the Limited Deck Archive — a saved deck without driving the
 *  builder. */
export const UI_SEAM_LIMITED_DECK_PATH = "/__uiseam/limited-deck";

/** The Limited deck deep link's fixture: the event `label` whose seat is
 *  saved. */
export const UI_SEAM_FIXTURE_PARAM = "__uiseam_fixture";

/** The Limited deck deep link's deck name. */
export const UI_SEAM_DECK_NAME_PARAM = "__uiseam_deck_name";

/**
 * A seam URL: `path` plus each parameter as a JSON STRING literal. TanStack
 * JSON-parses every search value, so a bare `12` or `true` would arrive as a
 * number or a boolean and {@link pickUiSeamParams} would drop it; quoted, it
 * arrives as the string it was. The lane builds every seam URL here, so the
 * encoding has one author.
 */
export function uiSeamUrl(
    path: string,
    params: Record<string, string>
): string {
    const query = Object.entries(params)
        .map(
            ([key, value]) =>
                `${encodeURIComponent(key)}=${encodeURIComponent(JSON.stringify(value))}`
        )
        .join("&");
    return query ? `${path}?${query}` : path;
}
