// Issue #2420 — the TWO-AUTHORITY invariant for mana payment, swept over a
// board matrix rather than asserted board by board.
//
// `getLegalActions` (the human Cast affordance, via `canPotentiallyPayCost` →
// `coloredCostLeftover`) and `planManaPayment` (the bot's concrete tap plan)
// answer the same question — "can this cost be paid off this board?" — from
// two different models. Three review rounds on this issue each closed the
// disagreement on one board and re-opened it on another, because the two
// models were being patched independently:
//
//   round 1  [Farrelite Priest, Plains] → cast offered, plan null
//   round 2  [Urza, Mox Sapphire]       → cast offered, plan null
//   round 3  [Urza, Mox Sapphire, Mox Jet] → cast offered, plan null
//            [Mox Sapphire, Mox Jet, Urza] → plan taps Sapphire TWICE
//   #3027    [Sol Ring] casting Ankh of Mishra ({2}) → cast offered, plan null
//            [Black Lotus] casting Lord of Atlantis ({U}{U}) → same
//
// A Cast the player cannot pay for parks unpayably in `pendingCast` (the
// #1695 trap `rules.ts` records); a plan that taps one permanent twice is
// valued as legal by the ISMCTS search and then rejected outright by the
// server ("Selected permanent is already tapped", `payTapOtherAbilityCost`).
// Both are one-board-at-a-time bugs, so this file asserts the PROPERTY over
// every subset of a mixed pool, in both permanent orders — order-dependence
// was itself the shape of two of the four regressions above.
//
// The invariants:
//   A. `getLegalActions` offering "cast" ⇒ `planManaPayment` returns a plan.
//   A'. `planManaPayment` returning a plan ⇒ `getLegalActions` offers "cast"
//      — the reverse direction, added by issue #3027, with ONE mechanism
//      excluded and named (see `hasNetZeroManaAbility`). A strict `iff` is
//      not achievable: the census is documented to OVER-approximate
//      ("errs toward showing the Cast button", `canPotentiallyPayCost`), so
//      A is the direction that can be total.
//   B. No plan taps one PHYSICAL permanent twice — across plain entries and
//      `tapOtherIds` alike.
//   C. A `tapOtherFilter` activation never taps its own source (CR 602.1).
//
// Issue #3027 removed the one escape hatch this file used to carry: a
// `KNOWN_MULTI_MANA_DIVERGENCES = 11` budget covering every board whose only
// surplus was a multi-mana source (Sol Ring paying {2}), because
// `planManaPayment` counted one mana per source while the census counted one
// unit per mana. The planner now reads the same quantity and the budget is 0,
// so invariant A is asserted with no exemption at all.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { planManaPayment, type ManaTap } from "../moves";
import { getLegalActions } from "../rules";
import { getInstanceManaCost } from "../../cards";
import { pureGenericManaSubCost } from "../constants";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import type { CardInstanceState, GameState } from "../state";
import {
    ankhOfMishra,
    blackLotus,
    crusade,
    grizzlyBears,
    island,
    islandSanctuary,
    lordOfAtlantis,
    moxJet,
    moxSapphire,
    plains,
    solRing,
} from "../../cards/sets/lea";
import { ornithopter } from "../../cards/sets/atq";
import { farrelitePriest } from "../../cards/sets/fem";
import { urzaLordHighArtificer } from "../../cards/sets/mh1";

/** Mixed pool: the converter (Urza), artifacts it can and cannot usefully tap
 *  (a blue Mox, an off-colour Mox, a colourless rock, a 0/2 with no mana
 *  ability at all), plain lands, the OTHER non-tap shape (Farrelite Priest's
 *  pure `cost.mana`) and — since issue #3027 — a CHOICE-based burst source
 *  (Black Lotus, "Add three mana of any one color") alongside the fixed-burst
 *  Sol Ring. Every regression above lives inside a subset of this pool. */
const POOL = [
    urzaLordHighArtificer,
    moxSapphire,
    moxJet,
    solRing,
    ornithopter,
    island,
    plains,
    farrelitePriest,
    blackLotus,
] as const;

/** Untargeted spells covering a doubled coloured pip, a mixed generic +
 *  coloured cost and a pure generic cost. */
const SPELLS = [
    lordOfAtlantis, // {U}{U}
    crusade, // {W}{W}
    grizzlyBears, // {1}{G}
    islandSanctuary, // {1}{W}
    ankhOfMishra, // {2}
] as const;

function permanent(defId: string, id: string): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
    });
}

function withTurnOf(state: GameState): GameState {
    return {
        ...state,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        stack: [],
    };
}

/** Every subset of `POOL` of size 1..4, each in declaration order AND
 *  reversed — the greedy planner's tie-breaks are index-sensitive, and two of
 *  the four shipped regressions only appeared in one of the two orders. */
function* boards(): Generator<{ label: string; defIds: string[] }> {
    const n = POOL.length;
    for (let mask = 1; mask < 1 << n; mask++) {
        const picked: string[] = [];
        for (let i = 0; i < n; i++) {
            if (mask & (1 << i)) picked.push(POOL[i].id);
        }
        if (picked.length > 4) continue;
        const names = picked.map((id) => POOL.find((d) => d.id === id)!.name);
        yield { label: `[${names.join(", ")}]`, defIds: picked };
        if (picked.length > 1) {
            yield {
                label: `[${[...names].reverse().join(", ")}]`,
                defIds: [...picked].reverse(),
            };
        }
    }
}

/** Every PHYSICAL permanent a plan taps: a plain entry taps its own source, an
 *  `abilityId` entry taps only the permanents it names (CR 602.1 — the
 *  activating source is never tapped by its own `tapOtherFilter` cost). The
 *  same split `applyTapPlan` (applyMove.ts / search.ts / ai/dominance.ts) and
 *  `runTapPlan` (src/lib/ai/executor.ts) apply. */
function tappedPermanentIds(plan: readonly ManaTap[]): string[] {
    const ids: string[] = [];
    for (const tap of plan) {
        if (tap.abilityId) {
            ids.push(...(tap.tapOtherIds ?? []));
            continue;
        }
        ids.push(tap.cardInstanceId);
    }
    return ids;
}

/** True when any untapped permanent carries a mana ability that taps NOTHING
 *  and whose whole cost is generic mana (Farrelite Priest's "{1}: Add {W}").
 *  These boards are the one place invariant A' does NOT hold, and the reason
 *  is on the CENSUS side, in the opposite direction to this file's usual
 *  quarry: `getProducibleManaUnits` (rules.ts) nets such an ability's own
 *  sub-cost out of its produced units (issue #2420 review finding 2, which
 *  stopped a FALSE-POSITIVE Cast button), so a Priest that a real board can
 *  genuinely fund contributes zero units and the census refuses a cast the
 *  planner — and a human — can make.
 *
 *  Measured on `98ed936f4`, i.e. BEFORE issue #3027 touched anything:
 *  `[Mox Sapphire, Mox Jet, Farrelite Priest]` casting Island Sanctuary
 *  ({1}{W}) already returned the three-tap plan
 *  `[sapphire, priest, jet]` while `getLegalActions` returned `[]`. That is a
 *  pre-existing census under-approximation, not a planner regression, and
 *  closing it means revisiting #2420's netting — a different issue.
 *
 *  The exclusion is a NAMED MECHANISM, deliberately not a count: a numeric
 *  budget absorbs the next divergence of a different shape in silence, which
 *  is exactly how the multi-mana one survived three review rounds. Any A'
 *  failure on a board without this shape reds the sweep.
 *  tracked-by: docs/findings/3027-census-nets-fundable-mana-ability-to-zero.md */
function hasNetZeroManaAbility(
    battlefield: readonly CardInstanceState[]
): boolean {
    return battlefield.some((perm) =>
        getEffectiveActivatedAbilities(perm).some(
            ({ ability }) =>
                !ability.useStack &&
                !ability.cost.tap &&
                !ability.cost.tapOtherFilter &&
                (pureGenericManaSubCost(ability.cost.mana ?? {}) ?? 0) > 0
        )
    );
}

describe("mana payment authorities agree (issue #2420)", () => {
    it("every board the Cast affordance admits has a concrete tap plan, and no plan taps one permanent twice", () => {
        const disagreements: string[] = [];
        const reverseDisagreements: string[] = [];
        const doubleTaps: string[] = [];
        const selfTaps: string[] = [];
        let castsOffered = 0;
        let plansBuilt = 0;

        for (const board of boards()) {
            const battlefield = board.defIds.map((defId, i) =>
                permanent(defId, `perm${i}`)
            );
            for (const spellDef of SPELLS) {
                const spell = makeInstance(spellDef.id, {
                    id: "spell",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "hand",
                });
                const player = makePlayer("p1", {
                    hand: [spell],
                    battlefield: battlefield.map((c) => ({ ...c })),
                });
                const state = withTurnOf(makeState({ players: [player] }));
                const live = state.players[0];
                // None of `SPELLS` has a variable {X} or a hybrid pip, so
                // the printed cost record IS the normalised cost
                // `enumerateCastMoves` plans against.
                const printed = getInstanceManaCost(spell) ?? {};
                const cost: Record<string, number> = {};
                for (const [k, v] of Object.entries(printed)) {
                    if (typeof v === "number") cost[k] = v;
                }
                const plan = planManaPayment(state, live, cost);
                const offersCast = getLegalActions(
                    state,
                    live,
                    live.hand[0]
                ).includes("cast");
                const where = `${board.label} casting ${spellDef.name}`;

                if (offersCast) castsOffered++;
                // INVARIANT A — the #1695 trap. No exemption since issue
                // #3027: the planner reads the census's own quantity.
                if (offersCast && plan === null) {
                    disagreements.push(`${where}: cast offered, plan null`);
                }
                // INVARIANT A' — the other direction (issue #3027). A plan the
                // Bot can execute that the human is not offered is a Cast
                // button wrongly withheld.
                if (
                    !offersCast &&
                    plan !== null &&
                    !hasNetZeroManaAbility(player.battlefield)
                ) {
                    reverseDisagreements.push(
                        `${where}: plan built, no cast offered`
                    );
                }
                if (plan === null) continue;
                plansBuilt++;
                // INVARIANT B — one physical permanent, one tap.
                const tapped = tappedPermanentIds(plan);
                if (new Set(tapped).size !== tapped.length) {
                    doubleTaps.push(`${where}: ${tapped.join(",")}`);
                }
                // INVARIANT C — CR 602.1.
                for (const tap of plan) {
                    if (tap.tapOtherIds?.includes(tap.cardInstanceId)) {
                        selfTaps.push(`${where}: ${tap.cardInstanceId}`);
                    }
                }
            }
        }

        expect(disagreements).toEqual([]);
        expect(reverseDisagreements).toEqual([]);
        expect(doubleTaps).toEqual([]);
        expect(selfTaps).toEqual([]);
        // The sweep must actually reach both authorities — a matrix that
        // offered no cast and built no plan would satisfy the three
        // assertions above vacuously.
        expect(castsOffered).toBeGreaterThan(50);
        expect(plansBuilt).toBeGreaterThan(50);
    });

    // A converter/`cost.mana` realisation costs a SECOND source; a plain tap
    // does not. The greedy's "first index wins" tie-break used to spend both
    // when either alone would do (measured on this branch before
    // `planOptionRank`: `[Farrelite Priest, Plains]` paying {W} returned
    // `[Plains, Priest]` — two permanents for one white).
    it("pays {W} off [Farrelite Priest, Plains] with the Plains alone, never by burning it to fund the Priest", () => {
        const battlefield = [
            permanent(farrelitePriest.id, "priest"),
            permanent(plains.id, "plains"),
        ];
        const player = makePlayer("p1", { battlefield });
        const state = withTurnOf(makeState({ players: [player] }));
        const plan = planManaPayment(state, state.players[0], { W: 1 });
        expect(plan).toEqual([{ cardInstanceId: "plains" }]);
    });

    // The two boards review round 3 measured, pinned by their concrete plans
    // in BOTH orders so a future greedy tie-break change cannot silently
    // reintroduce either half of the defect.
    it.each([
        [
            "Sapphire first",
            [moxSapphire.id, moxJet.id, urzaLordHighArtificer.id],
        ],
        ["Urza first", [urzaLordHighArtificer.id, moxSapphire.id, moxJet.id]],
    ])(
        "[Urza, Mox Sapphire, Mox Jet] pays {U}{U} with Sapphire's own tap plus Urza tapping Jet (%s)",
        (_label, defIds) => {
            const battlefield = defIds.map((defId, i) =>
                permanent(defId, `perm${i}`)
            );
            const player = makePlayer("p1", { battlefield });
            const state = withTurnOf(makeState({ players: [player] }));
            const plan = planManaPayment(state, state.players[0], { U: 2 });
            expect(plan).not.toBeNull();

            const sapphireId = battlefield[defIds.indexOf(moxSapphire.id)].id;
            const jetId = battlefield[defIds.indexOf(moxJet.id)].id;
            const urzaId =
                battlefield[defIds.indexOf(urzaLordHighArtificer.id)].id;

            // Sapphire taps for its OWN {U}; Urza taps Jet for the second.
            expect(plan).toContainEqual({ cardInstanceId: sapphireId });
            expect(plan).toContainEqual({
                cardInstanceId: urzaId,
                abilityId: "urza-lha-mana",
                tapOtherIds: [jetId],
            });
            // Urza itself is never tapped by its own cost (CR 602.1), and no
            // permanent is spent twice.
            const tapped = tappedPermanentIds(plan!);
            expect(tapped).not.toContain(urzaId);
            expect(new Set(tapped).size).toBe(tapped.length);
        }
    );
});
