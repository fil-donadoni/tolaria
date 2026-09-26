/**
 * One census-page load per viewport (issue #4687).
 *
 * WHY. 31 of ~60 surfaces are rows of `/admin/design-system`: the page itself,
 * the GameDialog live demo and the 29 specimen openers of § 16–18. Each walk
 * navigated to the page from scratch — a full load plus settle per specimen,
 * the single largest avoidable cost the phase timings name. The census page is
 * static (no Convex traffic, one `OverlaySpecimens` state per section that
 * mounts ONE specimen at a time), so a walk that finds the page already loaded
 * and EMPTY may press its opener without navigating.
 *
 * THE RESET IS EXPLICIT AND THE CHECK IS FAIL-CLOSED. Every census row declares
 * a `cleanup` that closes the layer it opened (Escape, then the layer's own
 * close control). Whether that worked is not assumed: before reusing the page
 * the walk counts the VISIBLE specimen layers, and one still open — the
 * previous row's, whatever closed it or failed to — means a fresh navigation.
 * A specimen left open therefore cannot leak into the next row's probe count,
 * axe run or screenshot; it can only cost that row a page load.
 *
 * Pure: the decision takes the page's URL and the visible-layer count; the
 * caller reads both from Playwright.
 */

export const CENSUS_PATH = "/admin/design-system";

/** The layer every dialog specimen mounts in, whatever its own seam. */
const DIALOG_LAYER = "[role=dialog]";

/** One selector matching every layer a census specimen can mount: the union
 *  of the specimens' declared `layer`s plus the generic dialog role. */
export function specimenLayerSelector(layers: readonly string[]): string {
    return [...new Set([DIALOG_LAYER, ...layers])].join(", ");
}

export type CensusPageReuse =
    | { reuse: true }
    | { reuse: false; reason: string };

/** Strip query, hash and a trailing slash: the router's own canonical form. */
function canonical(url: string): string {
    return url.replace(/[?#].*$/, "").replace(/\/+$/, "");
}

/**
 * Whether the page the previous row left behind can take this row's opener.
 * `openLayers` is the count of VISIBLE elements matching
 * `specimenLayerSelector`; anything above zero is a leak-in-waiting and the
 * answer is a navigation.
 */
export function censusPageReuse(input: {
    url: string;
    baseUrl: string;
    openLayers: number;
}): CensusPageReuse {
    const want = canonical(`${input.baseUrl}${CENSUS_PATH}`);
    const have = canonical(input.url);
    if (have !== want) {
        return {
            reuse: false,
            reason: `the page is at ${have || "(no url)"}, not ${want}`,
        };
    }
    if (!Number.isInteger(input.openLayers) || input.openLayers < 0) {
        return {
            reuse: false,
            reason: `the open-layer count could not be read (${input.openLayers})`,
        };
    }
    if (input.openLayers > 0) {
        return {
            reuse: false,
            reason: `${input.openLayers} specimen layer(s) still open from the previous row`,
        };
    }
    return { reuse: true };
}
