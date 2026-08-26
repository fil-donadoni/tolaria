// Kicker cost system (CR 702.33 Kicker / CR 702.33e Multikicker, ADR 0079).
//
// A Kicker is an OPTIONAL ADDITIONAL cost (CR 601.2f / 702.33a): it is paid ON
// TOP of the spell's printed cost, unlike an alternative cost (CR 118.9) which
// REPLACES it. That distinction is why this module shares the alternative cost's
// LEG vocabulary (`CostLegs`) but none of its SELECTION helpers — routing a
// Kicker through `getAlternativeCost`/`affordableAlternativeCosts` would make
// paying a Kicker mutually exclusive with paying the card's real cost, which is
// exactly backwards.
//
// Two things this module is the single authority on:
//
//  1. **Plurality.** A card declares `kickers: KickerCost[]` — "Kicker {A}
//     and/or {B}" (the Planeshift Battlemage cycle) is two INDEPENDENTLY payable
//     Kickers on one spell, each with its own intervening-if ETB trigger. Which
//     ones the caster paid is recorded PER ID (`KickerPayments`), never as a bare
//     total: a total can say how many times *a* Kicker was paid but never WHICH
//     of two. Multikicker (CR 702.33e) is therefore a property of ONE Kicker
//     (`KickerCost.multi`), not of the card.
//  2. **The derived total.** `totalKickerCount` is the ONLY way a total is
//     obtained — it is never an independently writable field, so the total and
//     the per-id record cannot drift. Every consumer that only wants a total
//     (`{ kickerCount: true }`, `entersWith.counters` count `"kicker"`, the bot
//     valuers) reads it through here.
import type {
    CardDefinition,
    CardType,
    Color,
    CostLegs,
    KickerCost,
    SpellKickedEvent,
} from "../cards/types";
import type { GameState, PlayerState } from "./state";
import { normalizeManaCost } from "./state";
import {
    buildCostLegsPermanentChoice,
    buildCostLegsHandChoice,
    canPayHandCost,
    canAffordCostLegsPermanents,
} from "./alternativeCost";
import type { SacrificeSelection } from "./sacrificeChoice";

/** CR 702.33 — how many times each of a spell's Kickers was paid as it was cast,
 *  keyed by `KickerCost.id`. An absent/0 entry means that Kicker was not paid.
 *  Snapshotted on the resulting `StackItem` at cast commit and read at
 *  resolution. The SINGLE source of truth for "was this kicked" — every total is
 *  derived from it (`totalKickerCount`), never stored beside it (ADR 0079). */
export type KickerPayments = Record<string, number>;

/** CR 702.33 — the DERIVED total: how many times ANY of the spell's Kickers was
 *  paid (0 = not kicked at all). Backs `SpellContext.getKickerCount()`, the
 *  `{ kickerCount: true }` Effect Script value, `entersWith.counters` count
 *  `"kicker"` and the `wasKicked` permanent snapshot. */
export function totalKickerCount(payments: KickerPayments | undefined): number {
    if (!payments) return 0;
    let total = 0;
    for (const n of Object.values(payments)) {
        if (typeof n === "number" && n > 0) total += n;
    }
    return total;
}

/** CR 702.33 — how many times the NAMED Kicker was paid (0 = not paid). Backs
 *  `SpellContext.getKickerPaidCount()` and the `{ kickerPaid: "<id>" }` value.
 *  Fail-closed on an unknown id: an unrecognised name reads 0, so a mistyped
 *  intervening-if simply never fires rather than throwing mid-resolution. */
export function kickerPaidCount(
    payments: KickerPayments | undefined,
    kickerId: string
): number {
    const n = payments?.[kickerId];
    return typeof n === "number" && n > 0 ? n : 0;
}

/** The card's Kicker with this id, or undefined. */
export function findKicker(
    cardDef: Pick<CardDefinition, "kickers">,
    kickerId: string
): KickerCost | undefined {
    return cardDef.kickers?.find((k) => k.id === kickerId);
}

/** Whether the card has at least one Kicker (CR 702.33). */
export function hasKicker(cardDef: Pick<CardDefinition, "kickers">): boolean {
    return (cardDef.kickers?.length ?? 0) > 0;
}

/** The Kickers the caster actually paid, each with its payment count, in
 *  DECLARATION order (so a two-Kicker card's merged legs are assembled
 *  deterministically). */
export function paidKickers(
    cardDef: Pick<CardDefinition, "kickers">,
    payments: KickerPayments | undefined
): { kicker: KickerCost; times: number }[] {
    if (!payments) return [];
    const out: { kicker: KickerCost; times: number }[] = [];
    for (const kicker of cardDef.kickers ?? []) {
        const times = kickerPaidCount(payments, kicker.id);
        if (times > 0) out.push({ kicker, times });
    }
    return out;
}

/** CR 702.33 — validate a requested per-Kicker tally against a card and return
 *  the canonical record (`undefined` = not kicked). Throws when:
 *   - a positive count names a Kicker the card does not declare (CR 702.33 — no
 *     such additional cost exists to pay);
 *   - a count is not a non-negative integer;
 *   - a SINGLE (non-Multikicker) Kicker is asked to be paid more than once — only
 *     Multikicker may be paid repeatedly (CR 702.33e);
 *   - a paid Kicker carries an ENERGY leg (CR 122.1). No printed Kicker does, and
 *     the cast pipeline has no energy payment step, so the shape fails CLOSED
 *     rather than silently costing nothing.
 *   - the paid Kickers' permanent legs disagree on their terminal action. The
 *     cast has ONE `SacrificeSelection` slot and the action rides on the
 *     selection, so "sacrifice a land AND return a creature" in one cast is not
 *     expressible; no printed card composes two non-mana Kickers, and failing
 *     closed here beats silently bouncing what should have been sacrificed. */
export function resolveKickerPayments(
    cardDef: CardDefinition,
    requested: KickerPayments | undefined
): KickerPayments | undefined {
    if (!requested) return undefined;
    const canonical: KickerPayments = {};
    for (const [id, raw] of Object.entries(requested)) {
        const n = raw ?? 0;
        if (n === 0) continue;
        if (!Number.isInteger(n) || n < 0) {
            throw new Error("Invalid kicker count");
        }
        const kicker = findKicker(cardDef, id);
        if (!kicker) throw new Error("This spell has no kicker");
        if (!kicker.multi && n > 1) {
            throw new Error("This spell's kicker can only be paid once");
        }
        if (kicker.energy !== undefined) {
            throw new Error("This kicker's cost cannot be paid");
        }
        canonical[id] = n;
    }
    if (Object.keys(canonical).length === 0) return undefined;
    // Reject a mixed sacrifice/return composition up front (see the docstring).
    const actions = new Set(
        paidKickers(cardDef, canonical)
            .map((p) => p.kicker.permanent?.action)
            .filter((a): a is "return" | "sacrifice" => a !== undefined)
    );
    if (actions.size > 1) {
        throw new Error("These kickers' costs cannot be paid together");
    }
    return canonical;
}

/** CR 702.33d + CR 603.2 (issue #1097) — the `SPELL_KICKED` events for ONE
 *  freshly-CAST spell, backing "whenever a player kicks a spell" triggers
 *  (Saproling Infestation, `cards/sets/inv/green.ts`).
 *
 *  ONE EVENT PER KICK, never one per spell. CR 702.33d: a spell with two
 *  Kickers, or with Multikicker, "may be kicked multiple times" — so a
 *  Multikicker paid three times was kicked three times and the trigger fires
 *  three times, as three separate stack objects. `paidKickers` already reports
 *  the per-Kicker tally; this flattens it to one event per payment.
 *
 *  FAIL-CLOSED on two independent axes, both deliberate. Note carefully what
 *  each one does and does NOT buy — the first is narrower than it looks:
 *
 *  1. **Declaration-gated.** The tally is read through `paidKickers`, which
 *     iterates the CARD'S OWN declared `kickers` and looks each id up in the
 *     record — never the record's own keys. So a `kickerPayments` entry naming
 *     an id the card does not declare contributes NOTHING: a mistyped or
 *     foreign key cannot invent a kick.
 *
 *     This does **not** make the function safe against a STALE record. A
 *     leftover snapshot from an EARLIER cast of the same card names that
 *     card's own kicker id, so it passes this gate cleanly. What actually
 *     rules a stale record out is CR 400.7 zone hygiene, enforced in two
 *     independent places: `clearCastKickerSnapshot` at every stack exit to a
 *     recastable zone, and `resetBattlefieldTransientState` (via
 *     `removeFromZone`) at cast-commit. Either one alone is sufficient —
 *     verified by mutation: with BOTH removed, `cast Burst Lightning kicked →
 *     graveyard → Regrowth → recast unkicked` emits a phantom SPELL_KICKED and
 *     hands out a free Saproling; with either one present, it does not.
 *  2. **Cast-gated.** Only the single cast choke point calls this
 *     (`emitSpellCastEvent`, `gre/state.ts`). Two consequences that a
 *     `kickerPayments !== undefined` test could not give:
 *       - A COPY of a kicked spell emits nothing (CR 707.10 — "a copy of a
 *         spell isn't cast"). `cloneSpellOntoStack` deliberately carries
 *         `kickerPayments` onto the copy (CR 707.10 copies "additional or
 *         alternative costs", so the copy IS kicked for `wasKicked` /
 *         `{ kickerPaid }` purposes) but never calls the cast choke point —
 *         nobody paid a kicker for the copy, so nobody kicked it.
 *       - A spell that RESOLVES and snapshots its payments onto the entering
 *         permanent (`CardInstanceState.kickerPayments`, the intervening-if
 *         twin) does not re-emit: resolution is not a cast.
 *
 *  A kicked spell that is COUNTERED later still emitted here — the kick
 *  happened during casting (CR 601.2b/h) and a countered spell was still cast
 *  and still kicked. */
export function buildSpellKickedEvents(
    cardDef: Pick<CardDefinition, "kickers">,
    item: {
        id: string;
        castById: string;
        kickerPayments?: KickerPayments;
        types: ReadonlyArray<CardType>;
        subtypes: ReadonlyArray<string>;
    },
    spellCardId: string,
    spellColors: ReadonlyArray<Color>
): SpellKickedEvent[] {
    const events: SpellKickedEvent[] = [];
    for (const { kicker, times } of paidKickers(cardDef, item.kickerPayments)) {
        for (let i = 0; i < times; i++) {
            events.push({
                type: "SPELL_KICKED",
                casterId: item.castById,
                spellInstanceId: item.id,
                spellCardId,
                kickerId: kicker.id,
                spellTypes: item.types,
                spellSubtypes: item.subtypes,
                spellColors,
            });
        }
    }
    return events;
}

/** CR 702.33a / 601.2f — fold every paid Kicker's MANA leg into a normalized
 *  mana-cost record, mutating it in place. A Multikicker paid N times contributes
 *  its mana leg N times (CR 702.33e). No-op when nothing was kicked. Applied to
 *  the total mana cost BEFORE cost modifiers (CR 601.2f — an additional cost
 *  joins the total, then increases/reductions apply). */
export function foldKickerCosts(
    cost: Record<string, number>,
    cardDef: CardDefinition,
    payments: KickerPayments | undefined
): void {
    for (const { kicker, times } of paidKickers(cardDef, payments)) {
        if (!kicker.mana) continue;
        const per = normalizeManaCost(kicker.mana);
        for (const [sym, amt] of Object.entries(per)) {
            cost[sym] = (cost[sym] ?? 0) + amt * times;
        }
    }
}

/** CR 702.33a / 118.4 — total LIFE owed by the paid Kickers' life legs (Phyrexian
 *  Scuta's "pay 3 life"). A Multikicker paid N times owes N × its life leg. */
export function kickerLifeCost(
    cardDef: CardDefinition,
    payments: KickerPayments | undefined
): number {
    let life = 0;
    for (const { kicker, times } of paidKickers(cardDef, payments)) {
        life += (kicker.life ?? 0) * times;
    }
    return life;
}

/** The paid Kickers' legs expanded to ONE leg per payment (a Multikicker paid N
 *  times contributes its legs N times, CR 702.33e), in declaration order. The
 *  shared input to every non-mana Kicker payment path — pickers and
 *  affordability alike read the same expansion, so the client's Pay gate prices
 *  a Kicker exactly as the server does. */
export function kickerCostLegs(
    cardDef: CardDefinition,
    payments: KickerPayments | undefined
): CostLegs[] {
    const legs: CostLegs[] = [];
    for (const { kicker, times } of paidKickers(cardDef, payments)) {
        for (let i = 0; i < times; i++) legs.push(kicker);
    }
    return legs;
}

/** Does any paid Kicker owe a PERMANENT leg (CR 702.33a — "sacrifice two
 *  lands", "return a creature you control")? The only leg kind that claims the
 *  cast's single `SacrificeSelection` slot; a mana leg folds into the total and
 *  a life leg into `payLife`, neither of which needs a picker. Returns `true`
 *  whenever a PAID Kicker declares a permanent leg — Magma Burst (`pls/red.ts`,
 *  "Kicker—Sacrifice two lands", issue #1951) is one such card, not
 *  necessarily the only or first one in the catalogue. */
export function hasKickerPermanentLeg(
    cardDef: CardDefinition,
    payments: KickerPayments | undefined
): boolean {
    return kickerCostLegs(cardDef, payments).some(
        (leg) => leg.permanent !== undefined
    );
}

/** CR 601.2f / 601.2h — the cast has exactly ONE permanent-cost selection slot,
 *  and a paid Kicker's permanent leg OR the chosen ALTERNATIVE cost's own
 *  permanent leg (CR 118.9 — Gush's "return two Islands", Fireblast's
 *  "sacrifice two Mountains") claims it. When the cast ALSO owes its own
 *  additional-cost sacrifice — the card's own (CR 601.2f) or a board-wide one
 *  (Drought's "Sacrifice a Swamp", CR 118.8) — one of the two would have to be
 *  dropped, i.e. the spell would reach the stack having silently MISPAID a
 *  cost. Fail CLOSED at announcement instead, exactly as `resolveKickerPayments`
 *  refuses a mixed sacrifice/return composition. `hasKickerPermanentLeg` is no
 *  longer vacuously `false` (Magma Burst, issue #1951, is a permanent-leg
 *  Kicker), so this `throw` branch is reachable in principle — but only for a
 *  card that ALSO owes its own additional-cost sacrifice on top of a
 *  permanent-leg Kicker or alt-cost permanent leg, which no shipped card
 *  combines yet (no permanent-leg alt-cost card carries a black pip for
 *  Drought to key off, issue #1985); merging the two selections remains the
 *  work the first card that needs BOTH at once pays for. */
export function assertKickerPermanentSlotFree(
    cardDef: CardDefinition,
    payments: KickerPayments | undefined,
    ownSacrifice: SacrificeSelection | undefined,
    /** CR 118.9 — the chosen alternative cost, so its OWN permanent leg is
     *  weighed against `ownSacrifice` the same way a Kicker's is. Omitted by
     *  callers that never see an alternative cost (the non-alt commit
     *  branch). */
    altCost?: CostLegs
): void {
    if (!ownSacrifice) return;
    if (!hasKickerPermanentLeg(cardDef, payments) && !altCost?.permanent) {
        return;
    }
    throw new Error(
        "This spell's kicker cost cannot be paid alongside its other additional costs"
    );
}

/** CR 601.2f / 601.2h — the cast's ONE permanent-cost selection, folding the
 *  chosen ALTERNATIVE cost's permanent leg (CR 118.9) and every paid KICKER's
 *  permanent legs (CR 702.33a) into a single explicit pick. Returns `undefined`
 *  when neither contributes a permanent leg.
 *
 *  Kicker requirements are marked `explicit`, so they are NEVER auto-resolved —
 *  not even with exactly one legal permanent (ADR 0079: a forced pick is still
 *  information the caster must see). The alternative cost's own requirement keeps
 *  its historical auto-resolve behaviour untouched. */
export function buildCastPermanentCostChoice(
    state: GameState,
    playerId: string,
    altCost: CostLegs | undefined,
    cardDef: CardDefinition,
    payments: KickerPayments | undefined,
    reason: string
): SacrificeSelection | undefined {
    return buildCostLegsPermanentChoice(
        state,
        playerId,
        [
            ...(altCost ? [{ legs: altCost }] : []),
            ...kickerCostLegs(cardDef, payments).map((legs) => ({
                legs,
                explicit: true,
            })),
        ],
        reason
    );
}

/** CR 601.2f / 601.2h — the cast's SINGLE permanent-cost selection: trust
 *  what `buildCastPermanentCostChoice` actually produced (the chosen alt
 *  cost's own permanent leg + every paid Kicker's), falling back to the
 *  board-wide/own additional-cost sacrifice (`buildCastSacrificeSelection`'s
 *  `selection` — Drought's "Sacrifice a Swamp", CR 118.8, or the card's own)
 *  ONLY when the former yields nothing. Shared verbatim by all three commit
 *  paths (`finalizeTargetSelection`'s targeted path, `announceCast`'s
 *  no-target alt-cost branch, and its no-target plain/kicker branch) so the
 *  fallback rule can never drift between them again — issue #1985 was
 *  exactly that drift: the alt-cost branch special-cased away the fallback
 *  entirely and dropped `ownSacrifice` unconditionally. A genuine collision
 *  (both legs claim the slot) is rejected upstream, fail-closed, by
 *  `assertKickerPermanentSlotFree` — by the time this runs, at most one side
 *  is non-`undefined` for any composition a real cast can reach. */
export function resolveCastPermanentSelection(
    castPermSel: SacrificeSelection | undefined,
    ownSacrifice: SacrificeSelection | undefined
): SacrificeSelection | undefined {
    return castPermSel ?? ownSacrifice;
}

/** CR 601.2f / 601.2h — the cast's ONE hand-cost picker, folding the chosen
 *  ALTERNATIVE cost's hand leg (CR 118.9 — Force of Will's "exile a blue card"),
 *  every paid KICKER's hand legs (CR 702.33a — Dralnu's Pet's "discard a
 *  creature card") and any further leg the caller supplies into a single
 *  selection. Returns `undefined` when none contributes a hand leg.
 *
 *  `extraLegs` is how every hand cost the CARD DEFINITION does not itself
 *  declare joins: the card's OWN additional cost (CR 118.8 / 701.9 — Bitter
 *  Triumph's "discard a card", via `additionalCostHandLeg`) and the keyword-
 *  derived retrace cost (CR 702.81a — "discard a land card", issue #2358). An
 *  ADDITIONAL cost is paid alongside the mana cost, so its hand leg belongs in
 *  the SAME single picker as the CR 118.9/702.33a ones rather than in a
 *  parallel slot the cast has no room for. Legs concatenate in argument order,
 *  so `CostLegs.hand`'s most-restrictive-requirement-first authoring constraint
 *  extends across them.
 *
 *  `extraLegs` is REQUIRED, deliberately (issue #2358 review): it used to
 *  default to `[]`, and the one cast-commit path that forgot to pass it charged
 *  no retrace discard at all while type-checking clean. A new commit path now
 *  cannot compile without deciding — and the decision it should make is
 *  `castExtraHandCostLegs` (`convex/game.ts`), the single authority on what
 *  belongs in this list. */
export function buildCastHandCostChoice(
    player: PlayerState,
    altCost: CostLegs | undefined,
    cardDef: CardDefinition,
    payments: KickerPayments | undefined,
    castInstanceId: string,
    extraLegs: readonly CostLegs[]
): ReturnType<typeof buildCostLegsHandChoice> {
    return buildCostLegsHandChoice(
        player,
        [
            ...(altCost ? [altCost] : []),
            ...kickerCostLegs(cardDef, payments),
            ...extraLegs,
        ],
        castInstanceId
    );
}

/** CR 702.33a / 601.2f affordability of the paid Kickers' NON-MANA legs, checked
 *  at announcement before the cast is parked: enough matching permanents for
 *  every permanent leg (from DISTINCT permanents), enough life for the life legs
 *  (CR 119.4), and enough matching hand cards for every hand leg. The mana legs
 *  are folded into the spell's total and priced by the ordinary mana path. */
export function canPayKickerLegs(
    state: GameState,
    player: PlayerState,
    cardDef: CardDefinition,
    payments: KickerPayments | undefined,
    castInstanceId: string
): boolean {
    const legs = kickerCostLegs(cardDef, payments);
    if (legs.length === 0) return true;
    if (player.life < kickerLifeCost(cardDef, payments)) return false;
    if (!canAffordCostLegsPermanents(state, player.id, legs)) return false;
    // CR 118.9 hand leg — each leg's requirements must be coverable from
    // DISTINCT hand cards. Checked leg-by-leg against the same greedy the
    // picker uses; a multi-leg composition is exercised by the combined picker
    // at build time, which parks the cast until every requirement is met.
    for (const leg of legs) {
        if (!canPayHandCost(player, leg, castInstanceId)) return false;
    }
    return true;
}
