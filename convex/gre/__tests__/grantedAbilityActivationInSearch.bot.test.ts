// The search's own PUSH site discards a granted ability's provenance (issue
// #2468).
//
// `buildActivatedAbilityStackItem` accepts `grantedSourceCardId` (CR 113.1)
// and `resolveTopOfStack` uses it to find the ability's TEMPLATE on the
// GRANTING card's `grantTemplates[]` — every mutation-side commit site
// (`convex/game.ts`) threads it. `applyMoveInSearch`'s own `activate-ability`
// push (`gre/search.ts`) did not: it forwarded `castById` / `abilityId` /
// targets / mode / X only. The ability was resolved through
// `effectiveAbilityOf` (`gre/ai/abilityTiming.ts`), which itself discarded the
// provenance — `.find(...)?.ability` handing back a bare `ActivatedAbility`
// with the wrapper (`EffectiveActivatedAbility`, carrying
// `grantedSourceCardId`) thrown away. Two drop points, not one: fixing only
// the push site would still have nothing to push.
//
// The fix adds `effectiveActivatedAbilityEntryOf` (`gre/ai/abilityTiming.ts`)
// — a sibling of `effectiveAbilityOf` that returns the WRAPPER — and has the
// search's push read the wrapper's `grantedSourceCardId` into the pushed
// item. `effectiveAbilityOf` itself is untouched (and now implemented in
// terms of the sibling): every other caller (`isDeferrableStackAbility` /
// `isPointlessSelfAnimation` / `isSorcerySpeedTrickDump` gates, and
// `applyActivationCostsForSearch`) only ever needed the ability TEMPLATE, not
// its provenance.
//
// Before the fix, resolving the pushed item fell through to
// `resolveTopOfStack`'s "printed ability" branch, looked the id up on the
// SOURCE card's own (empty, for a granted ability) `activatedAbilities`,
// found nothing, and popped the item having done nothing at all — a silent
// no-op. `enumerateMoves` never offers a granted ability as a move at all
// (the separate move-ENUMERATION gap, issue #2469, out of scope here), so
// every move below is hand-built, exactly like the mana-ability fixture in
// `activationPayoffInSearch.bot.test.ts`.
//
// Splinter Twin (`convex/cards/sets/roe/red.ts`) is the fixture: a real
// `grantTemplates` card, granted via the `activated-grant` static-effect
// mechanism (CR 113.1). Nothing under test reads the card's name — the grant
// is materialized directly onto the permanent's `grantedActivatedAbilities`
// (the same field the layer system writes), so the test exercises the
// SEARCH's own resolution of a granted ability without depending on Aura
// layer recomputation being wired into the fixture builder.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { applyMoveInSearch, policyValue } from "../search";
import { resolveTopOfStack } from "../state";
import { cloneGameState } from "../clone";
import { enumerateMoves, type Move } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { CardInstanceState, GameState } from "../state";

const BEAR = getCardByName("Grizzly Bears").id;
const SPLINTER_TWIN = getCardByName("Splinter Twin").id;
const TWIN_ABILITY = "splinter-twin-copy";

function mine(cardId: string, id: string, extra = {}): CardInstanceState {
    return makeInstance(cardId, {
        controllerId: "p1",
        ownerId: "p1",
        id,
        isSummoningSick: false,
        ...extra,
    });
}

/** p1's Grizzly Bears, holding the granted Splinter Twin copy ability exactly
 *  as `getEffectiveActivatedAbilities` reads it — a `grantedActivatedAbilities`
 *  entry naming the granting card's def id (CR 113.1). No Aura instance is on
 *  the battlefield: the grant is the materialized RESULT of one, which is what
 *  the search's own resolution path reads. */
function grantedBearState(): GameState {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    mine(BEAR, "bear", {
                        grantedActivatedAbilities: [
                            {
                                sourceCardId: SPLINTER_TWIN,
                                abilityId: TWIN_ABILITY,
                                auraId: "twin-aura",
                                seq: 1,
                            },
                        ],
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

/** The hand-built `activate-ability` move for the granted ability.
 *  `enumerateMoves` cannot supply this one (issue #2469): it reads only
 *  `def.activatedAbilities`, never `getEffectiveActivatedAbilities`, so a
 *  granted ability is never offered as a move. Asserted below so this file
 *  fails loudly, rather than silently drifting stale, the day #2469 changes
 *  that. */
function grantedMove(): Extract<Move, { kind: "activate-ability" }> {
    return {
        kind: "activate-ability",
        cardInstanceId: "bear",
        abilityId: TWIN_ABILITY,
        targets: [],
        confirmTargets: false,
        tapPlan: [],
    };
}

describe("applyMoveInSearch pushes a GRANTED ability with its provenance (CR 113.1, issue #2468)", () => {
    it("enumerateMoves does not offer the granted ability (issue #2469 — the reason this move is hand-built)", () => {
        const state = grantedBearState();
        const offered = enumerateMoves(state, "p1").some(
            (m) => m.kind === "activate-ability" && m.abilityId === TWIN_ABILITY
        );
        expect(offered).toBe(false);
    });

    it("the pushed stack item carries the granting card's definition id", () => {
        const state = grantedBearState();

        applyMoveInSearch(state, "p1", grantedMove());

        expect(state.stack).toHaveLength(1);
        const item = state.stack[0];
        expect(item.abilityId).toBe(TWIN_ABILITY);
        expect(item.castById).toBe("p1");
        expect(item.grantedSourceCardId).toBe(SPLINTER_TWIN);
        // CR 602.1 — the {T} cost is paid; the SOURCE stays on the
        // battlefield as a snapshot, exactly as a printed ability's push does.
        const source = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(source?.isTapped).toBe(true);
    });

    it("resolving the item actually runs the GRANTED template — a hasty copy joins the battlefield (CR 113.1 / 706.2)", () => {
        const state = grantedBearState();

        applyMoveInSearch(state, "p1", grantedMove());
        expect(state.stack).toHaveLength(1);

        resolveTopOfStack(state);

        expect(state.stack).toHaveLength(0);
        const battlefield = state.players[0].battlefield;
        expect(battlefield).toHaveLength(2);
        const token = battlefield.find((c) => c.id !== "bear");
        expect(token, "the granted copy must actually exist").toBeDefined();
        expect(token!.types).toContain("Creature");
        expect(token!.staticAbilities).toContain("haste");
    });
});

describe("search values a GRANTED ability's payoff (issue #2468)", () => {
    it("activating the granted ability out-scores pass when the granted effect is clearly profitable", () => {
        // No combo annotation involved: `comboAnnotations.ts` is untouched by
        // this fix, and the position is scored on its own material merit — a
        // second 2/2 body joining the battlefield is worth more than nothing.
        const state = grantedBearState();
        const move = grantedMove();
        const pass: Move = { kind: "pass" };

        const probeActivate = cloneGameState(state);
        applyMoveInSearch(probeActivate, "p1", move);
        const activateValue = policyValue(probeActivate, "p1", move);

        const probePass = cloneGameState(state);
        applyMoveInSearch(probePass, "p1", pass);
        const passValue = policyValue(probePass, "p1", pass);

        expect(activateValue).toBeGreaterThan(passValue);
        // The mechanism, not just the number: the copy must actually be on
        // the probed leaf `policyValue` scored, not merely an unresolved item.
        expect(probeActivate.players[0].battlefield).toHaveLength(2);
    });
});
