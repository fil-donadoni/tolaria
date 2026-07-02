import { getDefinition } from "@convex/cards";
import type { CardInstance } from "~/types/game";

/**
 * Client-side mirror of the engine's band-eligibility predicates
 * (`convex/gre/banding.ts`, CR 702.21e / 702.22j). The server is authoritative;
 * these helpers only drive the band-formation UI (which attackers show the
 * banding marker and when the "Create band" button enables). Kept here — not
 * imported from `convex/gre/` — to honor the frontend/engine boundary, but the
 * keyword format and quality semantics match the engine exactly.
 */

const BANDS_WITH_OTHER_PREFIX = "bands with other:";

type BandQuality = { kind: "legendary" } | { kind: "name"; name: string };

function parseBandsWithOtherQuality(keyword: string): BandQuality | undefined {
    if (!keyword.startsWith(BANDS_WITH_OTHER_PREFIX)) return undefined;
    const q = keyword.slice(BANDS_WITH_OTHER_PREFIX.length);
    if (q === "legendary") return { kind: "legendary" };
    if (q.startsWith("name=")) return { kind: "name", name: q.slice(5) };
    return undefined;
}

function getBandsWithOtherQualities(c: CardInstance): BandQuality[] {
    const out: BandQuality[] = [];
    for (const kw of c.staticAbilities ?? []) {
        const q = parseBandsWithOtherQuality(kw);
        if (q) out.push(q);
    }
    return out;
}

/** Plain banding keyword (CR 702.21). */
export function hasBanding(c: CardInstance): boolean {
    return c.staticAbilities?.includes("banding") ?? false;
}

/** Any "bands with other [quality]" variant (CR 702.22j). */
export function hasBandsWithOther(c: CardInstance): boolean {
    return (
        c.staticAbilities?.some((kw) =>
            kw.startsWith(BANDS_WITH_OTHER_PREFIX)
        ) ?? false
    );
}

/** Banding or bands-with-other — a creature that can seed a band and shows the
 *  banding marker in the formation panel. */
export function hasBandingLike(c: CardInstance): boolean {
    return hasBanding(c) || hasBandsWithOther(c);
}

function matchesBandQuality(c: CardInstance, quality: BandQuality): boolean {
    const def = getDefinition(c.card.id);
    if (quality.kind === "legendary") {
        return def.supertypes?.includes("Legendary") ?? false;
    }
    return def.name === quality.name;
}

/** Mirror of `isLegalBandComposition` (CR 702.21e / 702.22j). */
export function canFormBand(members: CardInstance[]): boolean {
    if (members.length < 2) return false;
    // CR 702.21e — plain banding.
    const banding = members.filter(hasBanding).length;
    if (banding >= 1 && members.length - banding <= 1) return true;
    // CR 702.22j — bands with other [quality].
    for (const member of members) {
        for (const quality of getBandsWithOtherQualities(member)) {
            if (members.every((m) => matchesBandQuality(m, quality))) {
                return true;
            }
        }
    }
    return false;
}
