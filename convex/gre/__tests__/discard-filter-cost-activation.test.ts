// discard-a-card-matching-<filter> activation cost (CR 602.1 / 118.3, issue
// #901). Integration test for the cost-CHOICE submission path that crosses
// GRE → game.ts → UI, mirroring `sacrificeActivation.test.ts`: the production
// `buildPendingActivation` / `tryAutoCommitPendingActivation` functions are
// imported and driven DIRECTLY from `../../game` (no reimplementation), so a
// divergence in the real commit logic fails this test. The two checks that
// live inline in the `activateAbility` / `selectActivationDiscardCost`
// mutation handlers (not their own exported functions) are mirrored as thin
// local helpers using the same real, exported `handCardMatchesFilter`
// matcher the mutations call.

import { describe, it, expect } from "vitest";
import {
    getPlayer,
    resolveTopOfStack,
    normalizeManaCost,
    type CardInstanceState,
    type GameState,
    type PendingActivation,
} from "../state";
import { getDefinition } from "../../cards";
import { handCardMatchesFilter } from "../alternativeCost";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { buildPendingActivation, tryAutoCommitPendingActivation } from "../../game";
import { survivalOfTheFittest } from "../../cards/sets/exo/green";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { forest } from "../../cards/sets/lea/colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const ABILITY_ID = "survival-of-the-fittest-tutor";

/** Mirror of `activateAbility`'s up-front `discardFilter` payability check +
 *  deferred-payment entry for Survival of the Fittest's ability (no targets,
 *  so this exercises the non-targeted `activateAbility` branch). Builds the
 *  pendingActivation through the REAL `buildPendingActivation` and attempts
 *  the REAL `tryAutoCommitPendingActivation` — mirrors the production
 *  mutation's own call order exactly. */
function activateSurvival(
    state: GameState,
    playerId: string,
    cardInstanceId: string
): PendingActivation {
    const player = getPlayer(state, playerId);
    const card = player.battlefield.find((c) => c.id === cardInstanceId);
    if (!card) throw new Error("Card not on battlefield");
    const def = getDefinition((card.card as { id: string }).id);
    const ability = def.activatedAbilities!.find((a) => a.id === ABILITY_ID)!;

    // CR 602.1 / 118.3 — illegal unless a matching card is in hand.
    if (ability.cost.discardFilter) {
        const candidates = player.hand.filter((c) =>
            handCardMatchesFilter(c, ability.cost.discardFilter!.filter)
        );
        if (candidates.length < ability.cost.discardFilter.count) {
            throw new Error(
                "Not enough matching cards in hand to pay the discard cost"
            );
        }
    }

    const manaCost = ability.cost.mana
        ? normalizeManaCost(ability.cost.mana)
        : undefined;
    const pending = buildPendingActivation({
        playerId,
        cardInstanceId: card.id,
        abilityId: ability.id,
        ability,
        manaCost,
    });
    state.pendingActivation = pending;
    tryAutoCommitPendingActivation(state, playerId);
    return pending;
}

/** Mirror of `selectActivationDiscardCost`: validate the pick(s) against the
 *  filter/hand membership using the real `handCardMatchesFilter`, then record
 *  the pick and attempt commit via the real `tryAutoCommitPendingActivation`. */
function selectDiscardCost(
    state: GameState,
    playerId: string,
    cardInstanceIds: string[]
): void {
    const pa = state.pendingActivation;
    if (!pa) throw new Error("No ability being activated");
    const dc = pa.discardFilterChoice;
    if (!dc) throw new Error("This ability has no discard-a-card cost");
    if (dc.pickedCardIds) throw new Error("Discard cost already paid");
    if (cardInstanceIds.length !== dc.count) {
        throw new Error(`Must discard exactly ${dc.count} card(s)`);
    }
    if (new Set(cardInstanceIds).size !== cardInstanceIds.length) {
        throw new Error("Duplicate card selected for the discard cost");
    }
    const player = getPlayer(state, playerId);
    for (const id of cardInstanceIds) {
        const card = player.hand.find((c) => c.id === id);
        if (!card) throw new Error("Selected card is not in your hand");
        if (!handCardMatchesFilter(card, dc.filter)) {
            throw new Error(
                "Selected card does not match the discard cost filter"
            );
        }
    }
    dc.pickedCardIds = [...cardInstanceIds];
    tryAutoCommitPendingActivation(state, playerId);
}

function scenario(overrides: {
    hand?: CardInstanceState[];
    library?: CardInstanceState[];
    manaPool?: Record<string, number>;
}): GameState {
    const survival = makeInstance(survivalOfTheFittest.id, {
        id: "survival-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [survival],
                hand: overrides.hand ?? [],
                library: overrides.library ?? [],
                manaPool: {
                    W: 0,
                    U: 0,
                    B: 0,
                    R: 0,
                    G: 0,
                    C: 0,
                    ...overrides.manaPool,
                },
            }),
            makePlayer("p2"),
        ],
        priorityPlayerId: "p1",
        activePlayerId: "p1",
    });
}

describe("discard-a-card-matching-<filter> activation cost (CR 602.1 / 118.3)", () => {
    it("rejects activation when no matching creature card is in hand", () => {
        const wood = makeInstance(forest.id, {
            id: "forest-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = scenario({ hand: [wood] });
        expect(() =>
            activateSurvival(state, "p1", "survival-1")
        ).toThrow(/discard cost/i);
    });

    it("enters pendingActivation with a discardFilterChoice picker and blocks commit until picked", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = scenario({ hand: [bears], manaPool: { G: 1 } });
        const pa = activateSurvival(state, "p1", "survival-1");
        expect(pa.discardFilterChoice).toEqual({
            filter: { type: "Creature" },
            count: 1,
        });
        // Mana is already covered, but commit is BLOCKED until the pick.
        expect(state.stack).toHaveLength(0);
        expect(state.pendingActivation).toBeDefined();
        expect(
            state.players[0].hand.some((c) => c.id === "bears-1")
        ).toBe(true);
    });

    it("rejects a pick that doesn't match the filter (a land isn't a creature card)", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const wood = makeInstance(forest.id, {
            id: "forest-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = scenario({ hand: [bears, wood], manaPool: { G: 1 } });
        activateSurvival(state, "p1", "survival-1");
        expect(() =>
            selectDiscardCost(state, "p1", ["forest-1"])
        ).toThrow(/filter/i);
    });

    it("discards the chosen creature card and finds a creature card in the library, revealed into hand, CR 701.19/701.20", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const libBears = makeInstance(grizzlyBears.id, {
            id: "lib-bears-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const libForest = makeInstance(forest.id, {
            id: "lib-forest-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = scenario({
            hand: [bears],
            library: [libBears, libForest],
            manaPool: { G: 1 },
        });
        activateSurvival(state, "p1", "survival-1");
        selectDiscardCost(state, "p1", ["bears-1"]);

        // Cost paid at commit: the discarded creature left hand → graveyard,
        // independent of the ability resolving.
        expect(
            state.players[0].hand.some((c) => c.id === "bears-1")
        ).toBe(false);
        expect(
            state.players[0].graveyard.some((c) => c.id === "bears-1")
        ).toBe(true);
        expect(state.stack).toHaveLength(1);

        // The ability is now on the stack; resolving it drives the DSL
        // search-library choice (CR 701.19), which suspends for the pick.
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.candidateIds).toEqual(["lib-bears-1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["lib-bears-1"],
        });

        // Found creature card put into hand (CR 400.7); the non-creature
        // library card was never a candidate and stays in the library.
        expect(
            state.players[0].hand.some((c) => c.id === "lib-bears-1")
        ).toBe(true);
        expect(
            state.players[0].library.some((c) => c.id === "lib-forest-1")
        ).toBe(true);
        expect(state.stack).toHaveLength(0);
    });
});
