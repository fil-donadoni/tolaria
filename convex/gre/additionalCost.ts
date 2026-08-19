// Additional-cost resolution (CR 118.8 / 601.2b / 601.2f).
//
// An ADDITIONAL cost is paid AT THE SAME TIME as the spell's mana cost (CR
// 118.8) — never instead of it. That is the whole boundary between this file
// and `alternativeCost.ts`: the `CostLegs` vocabulary there models CR 118.9
// costs paid INSTEAD OF the mana cost (Gush, Force of Will, evoke), while
// `CardDefinition.additionalCosts` models costs paid ALONGSIDE it.
//
// The one shape this file adds is the CASTER-CHOSEN DISJUNCTION — "discard a
// card or pay 3 life" (Bitter Triumph, Bone Shards). CR 601.2b puts that choice
// at ANNOUNCEMENT, before targets (CR 601.2c), before the total cost is locked
// in (CR 601.2f) and before anything is paid (CR 601.2h). It is therefore a
// plain `announceCast` argument (`additionalCostLegId`), exactly like the modal
// mode (`chosenModeId`, CR 700.2) and the chosen alternative cost
// (`alternativeCostId`, CR 118.9) — collected by a client-side picker, NOT a
// server-raised `PendingChoice` (no cast-time choice in this engine is one).
//
// Everything downstream then reads ONE FLAT SPEC: `resolveAdditionalCosts`
// merges the chosen leg's fields onto the declared spec, so the cast pipeline
// (`game.ts`), the legality gate (`rules.ts`) and the Bot's enumerator
// (`moves.ts`) need no `oneOf` branch of their own.

import type {
    AdditionalCostLeg,
    AdditionalCostSpec,
    CostLegs,
} from "../cards/types";
import { matchesPermanentFilter } from "../cards/filters";
import type { PlayerState } from "./state";
import { STATIC_EFFECT_CTX } from "./layers";
import { canPayHandCost } from "./alternativeCost";

/** CR 601.2b — flatten the caster's chosen `oneOf` leg onto the declared spec,
 *  producing the EFFECTIVE additional cost for this cast.
 *
 *  With no `oneOf` this is the identity (minus the absent key), so every
 *  existing card's cost path is byte-identical. With an `oneOf`, the named
 *  leg's own fields win over any same-named base field and `oneOf` itself is
 *  dropped — the result is an ordinary single-leg spec that the rest of the
 *  engine already knows how to pay. An unknown / omitted `chosenLegId` yields
 *  the base spec alone; `announceCast` rejects that case up front (a required
 *  choice was not made), so this fallback is only ever reached by a spec with
 *  no `oneOf` at all. */
export function resolveAdditionalCosts(
    spec: AdditionalCostSpec | undefined,
    chosenLegId: string | undefined
): AdditionalCostSpec | undefined {
    if (!spec) return undefined;
    if (!spec.oneOf || spec.oneOf.length === 0) return spec;
    const flat: AdditionalCostSpec = { ...spec };
    delete flat.oneOf;
    const leg = chosenLegId
        ? spec.oneOf.find((l) => l.id === chosenLegId)
        : undefined;
    if (!leg) return flat;
    // Field-by-field, not a spread of `leg`: `id`/`label` are picker metadata
    // and must never reach the spec, and an explicit projection makes a NEW
    // `AdditionalCostLeg` cost field a compile-visible edit here rather than a
    // silently-dropped cost. `LEG_COST_KEYS` below is the guarded mirror.
    if (leg.discard !== undefined) flat.discard = leg.discard;
    if (leg.payLife !== undefined) flat.payLife = leg.payLife;
    if (leg.sacrificeFilter !== undefined) {
        flat.sacrificeFilter = leg.sacrificeFilter;
    }
    if (leg.exileFilter !== undefined) flat.exileFilter = leg.exileFilter;
    return flat;
}

/** Every COST-bearing key {@link resolveAdditionalCosts} projects off a leg
 *  (i.e. `AdditionalCostLeg` minus its `id`/`label` metadata). Exported purely
 *  so a catalogue guard can fail when the type grows a leg the projection
 *  forgets — the fail-open shape that would otherwise let a declared cost go
 *  unpaid with every test still green. */
export const LEG_COST_KEYS = [
    "discard",
    "payLife",
    "sacrificeFilter",
    "exileFilter",
] as const;

/** The declared `oneOf` legs, or `[]` for a card with no caster-chosen
 *  disjunction. The single read site for "is this a choice at all". */
export function additionalCostLegs(
    spec: AdditionalCostSpec | undefined
): readonly AdditionalCostLeg[] {
    return spec?.oneOf ?? [];
}

/** CR 701.9 / 601.2f — the additional cost's DISCARD leg expressed in the
 *  shared {@link CostLegs} hand vocabulary, so it flows through the SAME cast
 *  hand-cost picker (`buildCostLegsHandChoice` → `PendingCast
 *  .alternativeCostHandChoice`), the SAME greedy affordability
 *  (`canPayHandCost`), the SAME submit boundary
 *  (`selectCastAlternativeHandCost`), the SAME bot pick realisation
 *  (`paymentPicks.ts`) and the SAME board UI as every CR 118.9 hand leg.
 *  Reusing the vocabulary rather than adding a parallel one is the whole
 *  reason the discard leg needs no new PendingCast field, mutation or
 *  component. `undefined` when the spec pays no cards from hand. */
export function additionalCostHandLeg(
    spec: AdditionalCostSpec | undefined
): CostLegs | undefined {
    const d = spec?.discard;
    if (!d || d.count <= 0) return undefined;
    return {
        hand: {
            action: "discard",
            requirements: [{ filter: d.filter ?? {}, count: d.count }],
        },
    };
}

/** CR 601.2h — "unpayable costs can't be paid": whether this FLAT (already
 *  `oneOf`-resolved) additional cost can be paid in full right now.
 *
 *  Reads every leg the spec can carry:
 *   - `sacrificeFilter` / `exileFilter` — at least one matching permanent, seen
 *     through the layer system's effective colours (CR 613), so a `colors`
 *     clause reads what the rest of the engine reads and never fails closed;
 *   - `payLife` — CR 119.4, you can't pay more life than you have;
 *   - `discard` — CR 701.9, enough DISTINCT matching cards in hand, excluding
 *     the cast card itself (CR 601.2a — it is on the stack by then).
 *
 *  `payXLife` and `xFromOpponentGraveyard` are deliberately absent: the first
 *  is a caster-chosen X that is always payable at X = 0, the second is computed
 *  by the engine and paid by nobody. `flashbackExileFromGraveyard` has its own
 *  gate (`hasPayableFlashbackCost`), scoped to a graveyard cast. */
export function canPayAdditionalCostSpec(
    player: PlayerState,
    spec: AdditionalCostSpec | undefined,
    castInstanceId: string
): boolean {
    if (!spec) return true;
    const filter = spec.sacrificeFilter ?? spec.exileFilter;
    if (filter) {
        const ok = player.battlefield.some((c) =>
            matchesPermanentFilter(
                { ...c, colors: STATIC_EFFECT_CTX.getColors(c) },
                filter,
                { selfControllerId: player.id }
            )
        );
        if (!ok) return false;
    }
    if ((spec.payLife ?? 0) > player.life) return false;
    const handLeg = additionalCostHandLeg(spec);
    if (handLeg && !canPayHandCost(player, handLeg, castInstanceId)) {
        return false;
    }
    return true;
}

/** CR 601.2b — the subset of a card's `oneOf` legs the caster can actually pay
 *  right now. `[]` for a card with no disjunction (callers treat that as "no
 *  choice to make", NOT as "unpayable" — see {@link canPayAnyAdditionalCost}).
 *
 *  THE single authority the picker (client), the legality gate (`rules.ts`) and
 *  the Bot's enumerator (`moves.ts`) all read, so a leg one of them offers is
 *  exactly a leg `announceCast` accepts. */
export function payableAdditionalCostLegs(
    player: PlayerState,
    spec: AdditionalCostSpec | undefined,
    castInstanceId: string
): AdditionalCostLeg[] {
    return additionalCostLegs(spec).filter((leg) =>
        canPayAdditionalCostSpec(
            player,
            resolveAdditionalCosts(spec, leg.id),
            castInstanceId
        )
    );
}

/** CR 601.2h / 118.8 — whether the caster can pay this card's additional cost
 *  AT ALL: for a disjunction, at least one leg is payable; otherwise the single
 *  declared spec is payable. `getLegalActions` (`gre/rules.ts`) suppresses
 *  "cast" on a false, which is what stops the Bot enumerating — and
 *  `assertLegalAction` stops a client announcing — a cast that could never be
 *  paid for. */
export function canPayAnyAdditionalCost(
    player: PlayerState,
    spec: AdditionalCostSpec | undefined,
    castInstanceId: string
): boolean {
    if (!spec) return true;
    if (spec.oneOf && spec.oneOf.length > 0) {
        return (
            payableAdditionalCostLegs(player, spec, castInstanceId).length > 0
        );
    }
    return canPayAdditionalCostSpec(player, spec, castInstanceId);
}
