// Unified permanent-cost choice layer (CR 701.21a / 118.9). Every time a player
// must give up matching permanents they control — as a sacrifice (cost, an
// attack-declaration tax, or an effect; CR 701.21) OR as a "return to hand"
// alternative cost (Gush / Thwart; CR 118.9 / 400.7) — WHICH permanents go is
// the player's choice. This module is the single place those choices are built,
// validated, and executed, so no seam can silently auto-pick a victim
// (`autoResolveFungible` still collapses the choice inline when it isn't a real
// one — a forced count or indistinguishable candidates). The terminal action is
// carried on the selection (`action`, default "sacrifice").
import type { GameState, CardInstanceState, PlayerState } from "./state";
import { getPlayer, removePermanentTo } from "./state";
import type { PermanentFilter } from "../cards/filters";
import { matchesPermanentFilter } from "../cards/filters";
import { STATIC_EFFECT_CTX, getEffectivePower } from "./layers";
import { tryGetDefinition } from "../cards/index";
import { liveSupertypesOf } from "../cards/snowReads";

export type SacrificeRequirement = {
    filter: PermanentFilter;
    count: number;
    /** own-cast additional cost: caller wants the sacrificed permanent's MV /
     *  subtypes back for a stack snapshot (Priest of Yawgmoth, Freyalise
     *  Supplicant). Static/tax sacrifices leave this unset. */
    snapshot?: boolean;
    /** Opt OUT of `autoResolveFungible` for THIS requirement: the pick is always
     *  the payer's explicit choice, never collapsed inline — not even with
     *  exactly one legal permanent or an indistinguishable candidate set,
     *  because a forced pick is still information the payer must see (ADR 0079).
     *  Set by the Kicker leg path (CR 702.33a); omitted everywhere else, so the
     *  historical Arena-UX auto-resolve is unchanged for every existing
     *  producer. */
    explicit?: boolean;
};

export type SacrificeSelection = {
    /** the sacrificing player (CR 701.21a) */
    playerId: string;
    /** banner label — card name / oracle text */
    reason: string;
    requirements: SacrificeRequirement[];
    /** instance ids chosen so far, flat across all requirements */
    picked: string[];
    /** How the chosen permanents leave the battlefield once the choice is
     *  complete. `"sacrifice"` (default, omitted) → owner's graveyard with a
     *  sacrifice cause (CR 701.21). `"return"` → owner's hand, a bounce with no
     *  cause (CR 400.7 / 118.9, the return-N-lands alternative cost). The
     *  build/validate/auto-resolve logic is identical for both; only the
     *  terminal step in `applySacrificeSelection` differs. */
    action?: "sacrifice" | "return";
};

export type SacrificeResult = {
    id: string;
    mv: number;
    subtypes?: string[];
    /** CR 613 layer 7c / 608.2h — effective power captured before the creature
     *  left play (Freyalise Supplicant reads it at resolve). Creatures only. */
    power?: number;
    snapshot: boolean;
};

/** Normalize a set of specs into requirements, dropping count-0 entries. The one
 *  place counts/filters are assembled for a producer. */
export function buildSacrificeRequirements(
    specs: SacrificeRequirement[]
): SacrificeRequirement[] {
    return specs.filter((r) => r.count > 0);
}

/** Matching permanents on the player's battlefield, with effective colours via
 *  the layer system (mirrors buildAdditionalCostPicker) so a `colors` filter
 *  reads the same colour the rest of the engine sees. CR 205.4a (issue #2235)
 *  — `supertypesOf: liveSupertypesOf` resolves a permanent's LIVE snow status
 *  (printed supertypes overlaid by any `setSupertype` mutation) for a
 *  `supertypes`-filtered cost (Whiteout / Sunstone / Glacial Crevasses'
 *  "Sacrifice a snow land"): a `CardInstanceState` never carries a bare
 *  `supertypes` field of its own (only a token spec does), so without this
 *  injected resolver `matchesPermanentFilter`'s `supertypes` branch always
 *  fell through to `[]` and no snow land ever matched here — the up-front
 *  affordability THROW at the mutation's announce step (`game.ts`, which
 *  DOES pass this option) reported the ability as legal to activate, but
 *  every consumer of this candidate list (`autoResolveFungible`'s inline
 *  auto-pick, and `isSacrificeCandidateLegal`'s gate behind the player's own
 *  `selectSacrifice` mutation) then found zero candidates and could never
 *  complete the payment — a supertype-filtered sacrifice cost was
 *  unactivatable end-to-end despite passing its own legality check. */
export function sacrificeCandidates(
    state: GameState,
    playerId: string,
    filter: PermanentFilter
): CardInstanceState[] {
    const player = getPlayer(state, playerId);
    return player.battlefield.filter((c) => {
        const view = { ...c, colors: STATIC_EFFECT_CTX.getColors(c) };
        return matchesPermanentFilter(view, filter, {
            selfControllerId: playerId,
            supertypesOf: liveSupertypesOf,
        });
    });
}

/** The first requirement whose picked-count is below its `count`. Picks are
 *  allocated to requirements greedily in order. */
export function nextUnmetRequirement(
    sel: SacrificeSelection
): SacrificeRequirement | undefined {
    let remaining = sel.picked.length;
    for (const req of sel.requirements) {
        if (remaining < req.count) return req;
        remaining -= req.count;
    }
    return undefined;
}

function counterCount(c: CardInstanceState): number {
    const counters = c.counters;
    if (!counters) return 0;
    return Object.values(counters).reduce((a, b) => a + b, 0);
}

function hasAttachments(state: GameState, c: CardInstanceState): boolean {
    for (const p of state.players) {
        for (const other of p.battlefield) {
            if (other.attachedTo === c.id) return true;
        }
    }
    return false;
}

/** Identity key for fungibility: same card, same tapped state, no counters, no
 *  attachments. Two permanents sharing a key are indistinguishable choices.
 *  Exported as `sacrificeIdentityKey` for the bot's move enumerator, which
 *  needs the SAME notion of "the same decision" when it decides how many
 *  victim variants are worth searching over (`activationCostPicks.ts`). */
export function identityKey(state: GameState, c: CardInstanceState): string {
    const cardId = (c.card as { id?: string }).id ?? "?";
    return [
        cardId,
        c.isTapped ? "T" : "U",
        counterCount(c),
        hasAttachments(state, c) ? "A" : "-",
    ].join("|");
}

/** How many of sel.picked are allocated to this specific requirement (by
 *  greedy in-order allocation). */
function countPicksFor(
    sel: SacrificeSelection,
    target: SacrificeRequirement
): number {
    let remaining = [...sel.picked];
    for (const req of sel.requirements) {
        const take = Math.min(req.count, remaining.length);
        const forThis = remaining.slice(0, take);
        remaining = remaining.slice(take);
        if (req === target) return forThis.length;
    }
    return 0;
}

/** Pre-fill `picked` for any requirement whose choice is not meaningful:
 *  candidate count equals (or is below) the required count (forced), or all
 *  candidates are indistinguishable. Matches the Arena-UX auto-resolve house
 *  style (CR 701.21a — still the player's choice, just with a single outcome).
 *  Requirements with a real choice — and any requirement flagged `explicit`
 *  (ADR 0079, the Kicker legs) — are left for the client. */
export function autoResolveFungible(
    state: GameState,
    sel: SacrificeSelection
): void {
    const used = new Set(sel.picked);
    for (const req of sel.requirements) {
        // `break`, not `continue`: picks are allocated to requirements GREEDILY
        // IN ORDER (`countPicksFor`), so pre-filling a LATER requirement while
        // this one is still empty would mis-allocate those picks to this one.
        // Producers therefore declare auto-resolvable requirements FIRST
        // (`buildCostLegsPermanentChoice`), which keeps every historical
        // single-requirement producer's behaviour identical.
        if (req.explicit) break;
        const need = req.count - countPicksFor(sel, req);
        if (need <= 0) continue;
        const cands = sacrificeCandidates(
            state,
            sel.playerId,
            req.filter
        ).filter((c) => !used.has(c.id));
        if (cands.length <= need) {
            for (const c of cands) {
                sel.picked.push(c.id);
                used.add(c.id);
            }
            continue;
        }
        const distinct = new Set(cands.map((c) => identityKey(state, c)));
        if (distinct.size === 1) {
            for (let i = 0; i < need; i++) {
                sel.picked.push(cands[i].id);
                used.add(cands[i].id);
            }
        }
        // else: a real choice remains — leave unresolved for the client.
    }
}

/** CR 601.2f / 118.5 affordability gate: can the player cover every requirement
 *  from distinct permanents? Greedy reservation across requirements in order. */
export function canAffordSacrifice(
    state: GameState,
    playerId: string,
    requirements: SacrificeRequirement[]
): boolean {
    const reserved = new Set<string>();
    for (const req of requirements) {
        let need = req.count;
        for (const c of sacrificeCandidates(state, playerId, req.filter)) {
            if (need <= 0) break;
            if (reserved.has(c.id)) continue;
            reserved.add(c.id);
            need -= 1;
        }
        if (need > 0) return false;
    }
    return true;
}

/** True when a candidate legally satisfies the next unmet requirement:
 *  matches its filter, on the player's battlefield, not already picked. */
export function isSacrificeCandidateLegal(
    state: GameState,
    sel: SacrificeSelection,
    cardInstanceId: string
): boolean {
    if (sel.picked.includes(cardInstanceId)) return false;
    const req = nextUnmetRequirement(sel);
    if (!req) return false;
    const cands = sacrificeCandidates(state, sel.playerId, req.filter);
    return cands.some((c) => c.id === cardInstanceId);
}

export function isSacrificeSelectionComplete(sel: SacrificeSelection): boolean {
    return nextUnmetRequirement(sel) === undefined;
}

function manaValueOf(c: CardInstanceState): number {
    const cardId = (c.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    if (!def?.manaCost) return 0;
    return Object.values(def.manaCost).reduce<number>(
        (acc, v) => acc + (typeof v === "number" ? v : 0),
        0
    );
}

function pickSnapshotFlags(sel: SacrificeSelection): Map<string, boolean> {
    const flags = new Map<string, boolean>();
    let remaining = [...sel.picked];
    for (const req of sel.requirements) {
        const take = Math.min(req.count, remaining.length);
        for (let i = 0; i < take; i++) {
            flags.set(remaining[i], req.snapshot ?? false);
        }
        remaining = remaining.slice(take);
    }
    return flags;
}

/** Execute the chosen permanent-cost picks. The ONLY place
 *  removePermanentTo(…, "sacrifice") runs for the converted seams. Re-checks
 *  each victim is still on the battlefield (CR 608.2b); a vanished victim is
 *  skipped. Routes to the graveyard with a sacrifice cause (CR 701.21) or —
 *  when `sel.action === "return"` — to the owner's hand as a causeless bounce
 *  (CR 400.7 / 118.9). Returns per-victim MV/subtypes for snapshot-flagged
 *  requirements (return picks never snapshot). */
export function applySacrificeSelection(
    state: GameState,
    sel: SacrificeSelection
): SacrificeResult[] {
    const results: SacrificeResult[] = [];
    const flags = pickSnapshotFlags(sel);
    const isReturn = sel.action === "return";
    for (const id of sel.picked) {
        const player: PlayerState = getPlayer(state, sel.playerId);
        const victim = player.battlefield.find((c) => c.id === id);
        if (!victim) continue; // CR 608.2b — already gone
        const snapshot = flags.get(id) ?? false;
        const subtypes =
            victim.subtypes && victim.subtypes.length > 0
                ? [...victim.subtypes]
                : undefined;
        const power = victim.types.includes("Creature")
            ? getEffectivePower(state, victim)
            : undefined;
        results.push({
            id,
            mv: manaValueOf(victim),
            ...(subtypes ? { subtypes } : {}),
            ...(power !== undefined ? { power } : {}),
            snapshot,
        });
        if (isReturn) {
            removePermanentTo(state, id, "hand");
        } else {
            removePermanentTo(state, id, "graveyard", "sacrifice");
        }
    }
    return results;
}
