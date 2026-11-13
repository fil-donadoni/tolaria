/**
 * The declared-position deep link, the lane's half (issue #9272, ADR 0180).
 *
 * A game row used to load its declared position through the Debug sheet —
 * open it, Scenarios, search the label, click the row, close it — on every
 * cell, the walk's slowest `position` sub-phase. The seam route
 * `/__uiseam/position` does the same load (`uiSeam.loadPosition`, the sheet's
 * own build and refusals) and lands on the board in one navigation.
 *
 * This module is the PURE part: the URL a load is asked through, and the
 * record the page leaves behind for the next row. Driving the page is
 * `surfaces.ts`'s, beside the walks' other helpers.
 */
import {
    UI_SEAM_POSITION_PARAM,
    UI_SEAM_POSITION_PATH,
    UI_SEAM_POSITION_RECORD_KEY,
    UI_SEAM_UNLESS_AT_PARAM,
    uiSeamUrl,
    type UiSeamPositionRecord,
} from "../../convex/lib/uiSeamNamespace";

/** The last position this lane loaded through the seam, and where it left
 *  the game: the repeat guard of the next load of the same label. */
export interface LoadedPosition {
    label: string;
    gameId: string;
    seq: number;
}

/**
 * The seam URL that loads `label`. When the lane's previous seam load was the
 * SAME label it carries the repeat guard (`<gameId>@<seq>`): the server then
 * rebuilds nothing if that game still stands at that `seq` — consecutive rows
 * on one position pay the position once (issue #9272). A different label, or
 * no earlier load, asks for a plain load.
 */
export function seamPositionPath(
    label: string,
    last: LoadedPosition | undefined
): string {
    const params: Record<string, string> = { [UI_SEAM_POSITION_PARAM]: label };
    if (last && last.label === label) {
        params[UI_SEAM_UNLESS_AT_PARAM] = `${last.gameId}@${last.seq}`;
    }
    return uiSeamUrl(UI_SEAM_POSITION_PATH, params);
}

/**
 * The record the position page stored, read back for `label`. `undefined`
 * when absent, malformed, or about another label — the next load of `label`
 * is then a plain one: slower, never wrong.
 */
export function parsePositionRecord(
    raw: string | null,
    label: string
): (LoadedPosition & { loaded: boolean }) | undefined {
    if (raw === null) return undefined;
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return undefined;
    }
    if (typeof value !== "object" || value === null) return undefined;
    const r = value as Partial<UiSeamPositionRecord>;
    if (
        r.label !== label ||
        typeof r.gameId !== "string" ||
        typeof r.seq !== "number" ||
        !Number.isInteger(r.seq) ||
        typeof r.loaded !== "boolean"
    ) {
        return undefined;
    }
    return { label: r.label, gameId: r.gameId, seq: r.seq, loaded: r.loaded };
}

/** The position page's refusal line (`ui-seam-position.route.tsx`). */
export const SEAM_POSITION_ERROR = '[data-testid="ui-seam-position-error"]';

/** The Limited deck page's refusal line (`ui-seam-limited-deck.route.tsx`). */
export const SEAM_LIMITED_DECK_ERROR =
    '[data-testid="ui-seam-limited-deck-error"]';

/**
 * Page predicate (`page.waitForFunction`) for "the load is over": either the
 * page recorded a load AND the app is on `/game`, or it printed a refusal.
 * The URL alone could pass for a load that never ran — the lane often starts
 * ON `/game` — so the in-place route clears the previous record first
 * (`inAppNavigateSource`). A `goto` needs no clearing: it lands on the seam
 * page, and only that page's own `navigate` puts the app back on `/game`,
 * after it has recorded.
 */
export const POSITION_SETTLED_SOURCE = `(() => {
    if (document.querySelector(${JSON.stringify(SEAM_POSITION_ERROR)})) return true;
    let record = null;
    try { record = window.sessionStorage.getItem(${JSON.stringify(UI_SEAM_POSITION_RECORD_KEY)}); } catch {}
    return record !== null && window.location.pathname === "/game";
})()`;

/** Page source that reads the record (`page.evaluate`; `scripts/` compiles
 *  without `lib.dom`, so the page function is text). */
export const READ_POSITION_RECORD_SOURCE = `(() => { try { return window.sessionStorage.getItem(${JSON.stringify(UI_SEAM_POSITION_RECORD_KEY)}); } catch { return null; } })()`;

/**
 * Page source that routes the ALREADY-LOADED app to `path` without reloading
 * it — after clearing the previous load's record, so the next one read is
 * this load's: a history push plus the `popstate` the router's history listens for —
 * the same signal a Back press sends, so TanStack resolves the new location
 * as an ordinary navigation. A full `page.goto` would boot the bundle, the
 * Convex socket and the sign-in again for a route one click away; the lane
 * takes it only when the page holds no app yet.
 */
export function inAppNavigateSource(path: string): string {
    return `(() => {
        try { window.sessionStorage.removeItem(${JSON.stringify(UI_SEAM_POSITION_RECORD_KEY)}); } catch {}
        const prev = window.history.state;
        const index = prev && typeof prev.__TSR_index === "number" ? prev.__TSR_index + 1 : 0;
        window.history.pushState({ __TSR_index: index }, "", ${JSON.stringify(path)});
        window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    })()`;
}
