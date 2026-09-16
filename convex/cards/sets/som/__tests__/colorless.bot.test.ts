// Scars of Mirrodin (SOM) — colorless Bot reachability (issue #3244).
//
// Myr Battlesphere's attack trigger raises a "tap any number of untapped Myr"
// `choose-permanents` choice (CR 118.12). The seam that must answer it is the
// `choose-permanents` candidate generator (issue #3545): these tests drive it
// on the card's REAL suspended choice and apply every emitted answer through
// the search's own move applier, so a candidate the submit path would reject
// (a tapped Myr, the attacking Battlesphere itself) is a throw, not a quiet
// worse branch.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    createTokenPermanents,
    getPlayer,
    resolveTopOfStack,
    type GameState,
} from "../../../../gre/state";
import {
    collectTriggers,
    placeTriggersOnStack,
} from "../../../../gre/triggers";
import { CHOICE_CANDIDATE_GENERATORS } from "../../../../gre/ai/choiceCandidates";
import { applyMoveInSearch } from "../../../../gre/search";
import { cloneGameState } from "../../../../gre/clone";
import type { CardType, GameEvent } from "../../../types";
import { getDefinition } from "../../../index";

const generate = CHOICE_CANDIDATE_GENERATORS["choose-permanents"]!;

/** p1's Battlesphere attacks p2's Karn with three untapped Myr and one tapped
 *  Myr at home; the trigger is resolved up to its choice. */
function suspendedAtTheTapChoice(): GameState {
    const battlesphere = getDefinition("b0ae94ed-7314-470b-baba-f2f58bbc894a");
    const karn = getDefinition("07a3d9e8-8597-498b-869c-cff79e0df516"); // Karn, Scion of Urza
    const state = makeState({
        phase: "DECLARE_ATTACKERS" as GameState["phase"],
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(battlesphere.id, {
                        id: "sphere",
                        isTapped: true,
                        isAttacking: true,
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(karn.id, {
                        id: "karn",
                        controllerId: "p2",
                        ownerId: "p2",
                        counters: { loyalty: 5 },
                    }),
                ],
            }),
        ],
    });
    const myrSpec = {
        name: "Myr",
        types: ["Artifact", "Creature"] as CardType[],
        subtypes: ["Myr"],
        power: 1,
        toughness: 1,
    };
    createTokenPermanents(state, myrSpec, "p1", 4);
    getPlayer(state, "p1").battlefield.find(
        (c) => c.isToken && !c.isTapped
    )!.isTapped = true;
    state.combat = {
        attackerIds: ["sphere"],
        attackTargets: { sphere: "karn" },
        confirmed: true,
        blockersConfirmed: false,
        blockerAssignments: {},
    };
    placeTriggersOnStack(
        state,
        collectTriggers(state, [
            {
                type: "ATTACKERS_DECLARED",
                attackingPlayerId: "p1",
                attackerIds: ["sphere"],
            } as GameEvent,
        ])
    );
    resolveTopOfStack(state);
    return state;
}

describe("Myr Battlesphere — the Bot answers the tap-X choice (CR 118.12)", () => {
    it("offers X = 0 and X = every untapped Myr, and nothing it could not legally tap", () => {
        const state = suspendedAtTheTapChoice();
        const choice = state.pendingChoices![0];
        expect(choice.kind).toBe("choose-permanents");
        const candidates = generate(state, choice);
        const sizes = candidates.map((c) =>
            c.move.kind === "resolution-choice"
                ? (c.move.cardInstanceIds ?? []).length
                : -1
        );
        expect(sizes).toContain(0);
        expect(Math.max(...sizes)).toBe(3);
        const untapped = new Set(
            getPlayer(state, "p1")
                .battlefield.filter((c) => c.isToken && !c.isTapped)
                .map((c) => c.id)
        );
        for (const c of candidates) {
            if (c.move.kind !== "resolution-choice") continue;
            for (const id of c.move.cardInstanceIds ?? []) {
                expect(untapped.has(id)).toBe(true);
            }
        }
    });

    it("every emitted answer applies, and the full tap removes three loyalty from the attacked planeswalker", () => {
        const state = suspendedAtTheTapChoice();
        const choice = state.pendingChoices![0];
        const candidates = generate(state, choice);
        let fullTapLoyalty: number | undefined;
        for (const c of candidates) {
            const probe = cloneGameState(state);
            applyMoveInSearch(probe, "p1", c.move);
            expect(probe.pendingChoices ?? []).toHaveLength(0);
            if (
                c.move.kind === "resolution-choice" &&
                (c.move.cardInstanceIds ?? []).length === 3
            ) {
                fullTapLoyalty = getPlayer(probe, "p2").battlefield.find(
                    (p) => p.id === "karn"
                )?.counters?.loyalty;
                expect(getPlayer(probe, "p2").life).toBe(20);
            }
        }
        expect(fullTapLoyalty).toBe(2);
    });
});
