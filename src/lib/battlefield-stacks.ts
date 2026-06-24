import type { CardInstance } from "~/types/game";

// ---------------------------------------------------------------------------
// Permanent stacking (PRD #621, issue #622).
//
// Pure, side-effect-free grouping of a single player's battlefield permanents
// into ordered groups. Each group is either a SINGLETON (one permanent) or a
// "permanent stack" (≥1 identical, interchangeable permanents fanned into one
// footprint). This is presentation-only logic — no GRE / backend involvement;
// it runs over already-projected client state.
//
// Naming: always "permanent stack", never bare "stack" — "stack" already means
// the spell stack in MTG / the GRE.
//
// Two permanents stack together IFF they are both "clean" (no altered state,
// see `isAltered`) AND share the same identity key (`identityKey`).
// ---------------------------------------------------------------------------

/** A group of permanents laid out as one footprint on the battlefield.
 *  `members` is always non-empty. A group with a single member is a singleton;
 *  one with ≥2 members is a permanent stack. Members are ordered
 *  untapped-then-tapped, stable by instance id within each segment. */
export interface PermanentGroup {
    /** Stable key for the group — the lead member's instance id. */
    key: string;
    /** True when this group collapses ≥2 identical permanents. */
    isStack: boolean;
    /** Ordered members (untapped first, then tapped). Never empty. */
    members: CardInstance[];
}

/** Identity key: members of one permanent stack must share the same card
 *  (art + name, via `card.card.id`) and the same summoning-sickness flag
 *  (a sick creature reads/plays differently from a ready one). Tapped state and
 *  the mana-committed flag are intentionally EXCLUDED so tapping one land for
 *  mana does not eject it from the stack (PRD #621 "Excluded from the key"). */
function identityKey(card: CardInstance): string {
    const sick = card.isSummoningSick === true ? "1" : "0";
    return `${card.card.id}|${sick}`;
}

/** A permanent is "altered" — and therefore always renders as its own
 *  singleton — when it carries any instance-specific state a player must read
 *  or target precisely (PRD #621 "Altered predicate"). The instant a permanent
 *  is altered it leaves the stack and renders in full.
 *
 *  `hostIds` is the set of permanent ids that are hosts of any aura/equipment
 *  (the key set of the host→attachments map the battlefield already computes).
 */
function isAltered(card: CardInstance, hostIds: ReadonlySet<string>): boolean {
    // Any counters (CR 122) — +1/+1, charge, etc.
    if (card.counters && Object.keys(card.counters).length > 0) return true;
    // Marked combat damage (CR 120.3).
    if ((card.damageMarked ?? 0) > 0) return true;
    // Temporary P/T modifiers (CR 611.1).
    if (card.temporaryPTMods && card.temporaryPTMods.length > 0) return true;
    // It is itself an attachment (an aura/equipment riding on a host, CR 303.4)
    // — handled by the host-overlay path, never a standalone stack member.
    if (card.attachedTo) return true;
    // It is a HOST of an aura/equipment.
    if (hostIds.has(card.id)) return true;
    // Effect-granted abilities (CR 113.1) — aura/anthem grants make it altered.
    if (
        card.grantedActivatedAbilities &&
        card.grantedActivatedAbilities.length > 0
    )
        return true;
    if (card.grantedStaticAbilities && card.grantedStaticAbilities.length > 0)
        return true;
    if (
        card.grantedTriggeredAbilities &&
        card.grantedTriggeredAbilities.length > 0
    )
        return true;
    // Layer 5 color override (CR 305.7, 613.1d).
    if (card.colorOverride && card.colorOverride.length > 0) return true;
    // Copy effect anchor (CR 707.2) — a copy carries a printed identity.
    if (card.copiedFrom) return true;
    // Combat involvement makes the instance individually meaningful (CR 506).
    if (card.isAttacking || card.isBlocking) return true;
    return false;
}

/** Member order inside a permanent stack: untapped first, then tapped, stable
 *  by input position within each segment (PRD #621 "Member order"). Never
 *  interleaved. `order` maps an instance id to its original input index so the
 *  sort is stable and deterministic. */
function orderMembers(
    members: CardInstance[],
    order: ReadonlyMap<string, number>
): CardInstance[] {
    return [...members].sort((a, b) => {
        const at = a.isTapped ? 1 : 0;
        const bt = b.isTapped ? 1 : 0;
        if (at !== bt) return at - bt; // untapped (0) before tapped (1)
        return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
    });
}

/**
 * Group a player's battlefield permanents into ordered singleton / permanent-
 * stack groups.
 *
 * @param permanents       the player's permanents, in the input/layout order
 *                         the battlefield already uses. Attachments (auras /
 *                         equipment) that fold into a host slot should NOT be
 *                         passed here — they are carried by their host. Any that
 *                         are passed (`attachedTo` set) are ejected to
 *                         singletons by the altered predicate regardless.
 * @param attachmentsByHost the host→attachments map the battlefield already
 *                         computes (`attachedAurasByHost`). Only its KEY SET is
 *                         read, to mark hosts as altered. Values are ignored.
 * @returns groups in stable order (by each group's first input member), each
 *          carrying its ordered members. Pure — does not mutate inputs.
 */
export function groupBattlefield(
    permanents: ReadonlyArray<CardInstance>,
    attachmentsByHost: ReadonlyMap<string, ReadonlyArray<CardInstance>>
): PermanentGroup[] {
    const hostIds = new Set(attachmentsByHost.keys());

    // Stable input-position map for deterministic member + group ordering.
    const order = new Map<string, number>();
    permanents.forEach((c, i) => order.set(c.id, i));

    // Bucket clean permanents by identity key; altered permanents become their
    // own singleton group immediately (preserving input order via `entries`).
    type Entry =
        | { kind: "singleton"; card: CardInstance; pos: number }
        | { kind: "stack"; key: string; members: CardInstance[]; pos: number };
    const entries: Entry[] = [];
    const stackByKey = new Map<string, Extract<Entry, { kind: "stack" }>>();

    permanents.forEach((card, i) => {
        if (isAltered(card, hostIds)) {
            entries.push({ kind: "singleton", card, pos: i });
            return;
        }
        const key = identityKey(card);
        const existing = stackByKey.get(key);
        if (existing) {
            existing.members.push(card);
        } else {
            const entry: Extract<Entry, { kind: "stack" }> = {
                kind: "stack",
                key,
                members: [card],
                pos: i,
            };
            stackByKey.set(key, entry);
            entries.push(entry);
        }
    });

    // Group order is stable relative to input: each entry's `pos` is the index
    // of its first member, and `entries` is already built in that order.
    return entries.map((entry) => {
        if (entry.kind === "singleton") {
            return {
                key: entry.card.id,
                isStack: false,
                members: [entry.card],
            };
        }
        const members = orderMembers(entry.members, order);
        return {
            key: members[0].id,
            isStack: members.length > 1,
            members,
        };
    });
}
