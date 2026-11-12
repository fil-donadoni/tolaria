// The plan a Pool is built toward (issue #9298): the Archetype the Pool holds
// MORE of than its scope would hand it by chance, not the one it holds most
// of. One authority, read by Auto-Build (`autoBuild.ts#choosePlan`) and by
// the Draft Table Audit (`src/lib/limited/draftTableAudit.ts`), so plan share
// always measures the plan the build chose.
//
// Why not raw depth: an Archetype tagged on a quarter of the scope (cube
// `control`) is the deepest in almost every Pool whatever the drafter leaned
// into, while a narrow one (`blink`, 14 of 540 cube cards) can never outnumber
// it. Depth is therefore read as SURPLUS — the Pool's units minus the units a
// Pool of the same size drawn from the scope would hold. A surplus, not a
// ratio: a ratio explodes on the one-card Archetypes a small scope tags,
// while a surplus needs real cards behind it. The settle bar
// (`ARCHETYPE_SETTLE_UNITS`) still reads raw units, so a plan is never a
// handful of cards however rare its tag.

import { ARCHETYPE_SETTLE_UNITS, archetypeLayerWeight } from "./botDrafter";
import type { GetCardProfile } from "./cardProfilesCore";
import { listScopeCards } from "./cardRatingsCore";

/** Per Archetype, the units ONE card of the scope carries on average — the
 *  same weighting as `archetypeCommitment` (an unreviewed Archetype layer at
 *  half weight), divided by the scope's distinct card count. A Pool of `n`
 *  cards drawn from the scope is expected to hold `n × share` units. */
export type ArchetypeScopeShare = ReadonlyMap<string, number>;

/** The scope share over a card list. Pure; distinct ids, an unprofiled card
 *  counts in the denominator (it is a card a Pool can draw) and carries
 *  nothing. `null` when the list is empty. */
export function archetypeScopeShareOf(
    cardIds: readonly string[],
    getCardProfile: GetCardProfile
): ArchetypeScopeShare | null {
    const distinct = [...new Set(cardIds)];
    if (distinct.length === 0) return null;
    const units = new Map<string, number>();
    for (const cardId of distinct) {
        const profile = getCardProfile(cardId);
        if (!profile) continue;
        const weight = archetypeLayerWeight(profile);
        for (const archetype of profile.archetypes) {
            units.set(archetype, (units.get(archetype) ?? 0) + weight);
        }
    }
    const share = new Map<string, number>();
    for (const [archetype, u] of units)
        share.set(archetype, u / distinct.length);
    return share;
}

/** The scope share of an event's pack sources: the union of their cards
 *  (`listScopeCards`, a Draftable Set's sheets or the cube pool). `null` for
 *  sources with no listable cards — the plan then reads raw depth.
 *
 *  Every card counts once, so the expectation is exact for a singleton cube
 *  and an approximation for a Draftable Set, whose packs draw commons more
 *  often than rares (sheet weights are not read). The build and the audit
 *  read the same share, so the approximation never splits them. */
export function archetypeScopeShareForPackSlots(
    packSlots: readonly string[],
    getCardProfile: GetCardProfile
): ArchetypeScopeShare | null {
    const cardIds = [...new Set(packSlots)].flatMap(scopeCardIds);
    return archetypeScopeShareOf(cardIds, getCardProfile);
}

/** A scope's card ids, listed once per process: the list is static checked-in
 *  data (Booster Config sheets, the cube pool), while the profiles read over
 *  it are not and are never cached here. */
const SCOPE_CARD_IDS = new Map<string, readonly string[]>();

function scopeCardIds(slot: string): readonly string[] {
    const key = slot.toLowerCase();
    let ids = SCOPE_CARD_IDS.get(key);
    if (!ids) {
        ids = listScopeCards(slot).map((c) => c.cardId);
        SCOPE_CARD_IDS.set(key, ids);
    }
    return ids;
}

/** Two depths closer than this are a tie, broken by Archetype id: the
 *  expectation is a float product, and rounding noise must not decide. */
const DEPTH_EPSILON = 1e-9;

/** The Pool's plan: among Archetypes at or above the settle bar, the one with
 *  the largest surplus over its scope expectation (`poolCardCount × share`);
 *  with no scope share, the largest raw depth. Ties break by Archetype id.
 *  `null` when no Archetype is settled. A settled Archetype is the plan even
 *  at a negative surplus when every settled one sits below its expectation:
 *  the Pool reached the settle bar, and the least-diluted plan beats none —
 *  as the raw-depth plan did. */
export function choosePlanArchetype(
    commitment: ReadonlyMap<string, number>,
    poolCardCount: number,
    scopeShare: ArchetypeScopeShare | null | undefined
): string | null {
    let best: string | null = null;
    let bestDepth = -Infinity;
    for (const [archetype, units] of [...commitment].sort(([x], [y]) =>
        x.localeCompare(y)
    )) {
        if (units < ARCHETYPE_SETTLE_UNITS) continue;
        const expected = scopeShare
            ? poolCardCount * (scopeShare.get(archetype) ?? 0)
            : 0;
        const depth = units - expected;
        if (depth > bestDepth + DEPTH_EPSILON) {
            best = archetype;
            bestDepth = depth;
        }
    }
    return best;
}
