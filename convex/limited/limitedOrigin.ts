// Limited Origin (ADR 0106 §6, issue #5393): what a Limited deck was built
// FROM, as a canonical key — event kind + the event's Pack Source sets —
// copied onto the deck row when it is saved from an event (`userDecks.create`)
// and never resolved through the event again, so it survives the event's
// deletion. Its label is DERIVED from the key here, never stored.
//
// The key is built from the event's `packSlots`, not from the Pack Source
// catalogue key: an event stores only its per-pack sets (legacy events
// predate the catalogue), and two events drawing the same sets in the same
// order are the same origin whichever catalogue entry created them. Sets are
// deduplicated (pack COUNT is deliberately excluded) and keep pack order — a
// block sequence is drafted INV → PLS → APC, and the label reads in that
// order. Pure and catalogue-free (only the cube's identity and set names), so
// the client derives the same label from the same key (ADR 0074).
import { setName } from "../cards/setMeta";
import {
    CUBE_DISPLAY_NAME,
    CUBE_ORIGIN_SEGMENT,
    CUBE_SOURCE_KEY,
    isCubeSource,
} from "./cubeSource";
import type { LimitedEventType } from "./eventTypes";

/** The event fields a Limited Origin is derived from. */
export interface LimitedOriginSource {
    type: LimitedEventType;
    packSlots: readonly string[];
}

const SOURCE_SEPARATOR = "+";

const TYPE_LABEL: Record<LimitedEventType, string> = {
    draft: "Draft",
    sealed: "Sealed",
};

function isLimitedEventType(value: string): value is LimitedEventType {
    return value === "draft" || value === "sealed";
}

/** One Pack Source's key segment: the cube's `cube:<slug>`, else the set
 *  code, lower-cased. */
function originSegment(source: string): string {
    return isCubeSource(source) ? CUBE_ORIGIN_SEGMENT : source.toLowerCase();
}

/** The Pack Source a key segment names — the inverse of `originSegment`. */
function segmentSource(segment: string): string {
    return segment === CUBE_ORIGIN_SEGMENT ? CUBE_SOURCE_KEY : segment;
}

/** The canonical Limited Origin key of an event: `draft:cube:vintage`,
 *  `sealed:lea`, `draft:inv+pls+apc`. */
export function limitedOriginKey(event: LimitedOriginSource): string {
    const segments = [...new Set(event.packSlots.map(originSegment))];
    return `${event.type}:${segments.join(SOURCE_SEPARATOR)}`;
}

/** A key split back into its event kind and Pack Sources (in pack order), or
 *  `null` for a string that is not a Limited Origin key. */
export function parseLimitedOrigin(
    key: string
): { type: LimitedEventType; sources: string[] } | null {
    const colon = key.indexOf(":");
    if (colon < 0) return null;
    const type = key.slice(0, colon);
    if (!isLimitedEventType(type)) return null;
    const rest = key.slice(colon + 1);
    const sources =
        rest === "" ? [] : rest.split(SOURCE_SEPARATOR).map(segmentSource);
    return { type, sources };
}

/** The display name of one Pack Source: the cube's own label, or the set's
 *  full name (`setName` falls back to the upper-cased code for a set with no
 *  registered name yet). */
export function packSourceName(source: string): string {
    return isCubeSource(source) ? CUBE_DISPLAY_NAME : setName(source);
}

/** The label a player sees for an origin — "Vintage Cube Draft", "Limited
 *  Edition Alpha Sealed", "Invasion / Planeshift / Apocalypse Draft" — or
 *  `null` for a malformed key. A source-less key degrades to the bare kind
 *  rather than a dangling separator. */
export function limitedOriginLabel(key: string): string | null {
    const origin = parseLimitedOrigin(key);
    if (origin === null) return null;
    const type = TYPE_LABEL[origin.type];
    if (origin.sources.length === 0) return type;
    return `${origin.sources.map(packSourceName).join(" / ")} ${type}`;
}
