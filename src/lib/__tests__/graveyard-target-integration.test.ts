// Integration: graveyard target → dialog eligibility → selectTarget → resolution
// (issue #314). The project has no convex-test harness, so — like the AI
// resolution-choice integration tests — this drives the SAME pure GRE
// primitives the `selectTarget` mutation and the stack resolver call, in the
// order the dialog triggers them:
//
//   1. The dialog reads `pendingTarget` and computes the eligible graveyards
//      (and their legal cards) with `getEligibleGraveyards` — the client mirror
//      of the server's `getLegalTargets` graveyard branch.
//   2. The chosen card is submitted as a `{ type: "graveyard-card", id,
//      playerId }` target (the unchanged `selectTarget` contract).
//   3. The spell resolves via `resolveTopOfStack`, reanimating the card.
//
// Covers BOTH the single-graveyard (`controller: "you"`, Resurrection) and the
// multi-graveyard (`controller: "any"`, Animate Dead) cases, asserting the
// dialog's eligibility set matches the server's legal targets exactly.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup";
import { resolveTopOfStack } from "@convex/gre/state";
import { getLegalTargets } from "@convex/gre/rules";
import { resurrection, animateDead } from "@convex/cards/sets/lea";
import { grizzlyBears } from "@convex/cards/sets/lea";
import type { GameState } from "@convex/gre/state";
import type { PendingTarget, Player } from "~/types/game";
import { getEligibleGraveyards } from "~/lib/graveyard-targets";

// The frontend Player type and the engine PlayerState differ only in zones the
// dialog never reads (hand/library shapes); `getEligibleGraveyards` touches
// `id`, `name`, and `graveyard` — structurally compatible.
function asPlayers(state: GameState): Player[] {
    return state.players as unknown as Player[];
}

function pendingFor(
    card: typeof resurrection,
    casterId: string
): PendingTarget {
    const req = card.targetRequirement!;
    // `count` may be the literal "X" on a requirement; the pending target
    // carries it resolved. Both fixture cards use a fixed count of 1.
    const count = req.count === "X" ? 1 : req.count;
    return {
        playerId: casterId,
        cardInstanceId: "src",
        targetType: req.type,
        count,
        zone: req.zone,
        controller: req.controller,
        selected: [],
    };
}

describe("graveyard target dialog full path (#314)", () => {
    it("single graveyard (controller: you) — dialog skips choice, picks, resolves", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        // An opponent's creature in their graveyard must NOT be eligible.
        const oppDead = makeInstance(grizzlyBears.id, {
            id: "opp-dead",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2", { graveyard: [oppDead] }),
            ],
        });

        const pending = pendingFor(resurrection, "p1");
        const eligible = getEligibleGraveyards(pending, asPlayers(state), "p1");

        // Exactly one eligible graveyard → the dialog skips the choice step.
        expect(eligible.length).toBe(1);
        expect(eligible[0].playerId).toBe("p1");
        expect(eligible[0].isMine).toBe(true);
        expect(eligible[0].cards.map((c) => c.id)).toEqual(["dead"]);

        // The dialog's eligibility set matches the server's legal targets.
        const legal = getLegalTargets(
            state,
            resurrection.targetRequirement!,
            [],
            "p1"
        );
        expect(legal.map((t) => `${t.playerId}:${t.id}`)).toEqual(["p1:dead"]);

        // Picking the card submits the graveyard-card target and resolves.
        pushSpell(state, resurrection.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        resolveTopOfStack(state);

        const revived = state.players[0].battlefield.find(
            (c) => c.id === "dead"
        );
        expect(revived).toBeDefined();
        expect(revived?.controllerId).toBe("p1");
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "dead"
        );
    });

    it("two graveyards (controller: any) — dialog offers a choice, then picks from the chosen graveyard, resolves", () => {
        const myDead = makeInstance(grizzlyBears.id, {
            id: "my-dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const oppDead = makeInstance(grizzlyBears.id, {
            id: "opp-dead",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [myDead] }),
                makePlayer("p2", { graveyard: [oppDead] }),
            ],
        });

        const pending = pendingFor(animateDead, "p1");
        const eligible = getEligibleGraveyards(pending, asPlayers(state), "p1");

        // Both graveyards hold a legal creature → the choice step is required,
        // viewer's own graveyard first.
        expect(eligible.length).toBe(2);
        expect(eligible[0].isMine).toBe(true);
        expect(eligible[1].isMine).toBe(false);
        expect(eligible.map((g) => g.playerId).sort()).toEqual(["p1", "p2"]);

        // Matches the server's legal targets across both graveyards.
        const legal = getLegalTargets(
            state,
            animateDead.targetRequirement!,
            [],
            "p1"
        );
        expect(legal.map((t) => `${t.playerId}:${t.id}`).sort()).toEqual([
            "p1:my-dead",
            "p2:opp-dead",
        ]);

        // The chooser picks the OPPONENT's graveyard, then the only card in it.
        const chosen = eligible.find((g) => !g.isMine)!;
        expect(chosen.cards.map((c) => c.id)).toEqual(["opp-dead"]);

        pushSpell(state, animateDead.id, "p1", [
            {
                type: "graveyard-card",
                id: "opp-dead",
                playerId: chosen.playerId,
            },
        ]);
        resolveTopOfStack(state);

        // Animate Dead reanimates under the CASTER's control (CR 303.4i).
        const revived = state.players[0].battlefield.find(
            (c) => c.id === "opp-dead"
        );
        expect(revived).toBeDefined();
        expect(revived?.controllerId).toBe("p1");
        const aura = state.players[0].battlefield.find(
            (c) => (c.card as { id?: string }).id === animateDead.id
        );
        expect(aura?.attachedTo).toBe("opp-dead");
    });

    it("single eligible graveyard despite controller: any (only one non-empty) — choice step skipped", () => {
        const myDead = makeInstance(grizzlyBears.id, {
            id: "my-dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [myDead] }),
                makePlayer("p2", { graveyard: [] }),
            ],
        });
        const pending = pendingFor(animateDead, "p1");
        const eligible = getEligibleGraveyards(pending, asPlayers(state), "p1");
        expect(eligible.length).toBe(1);
        expect(eligible[0].playerId).toBe("p1");
    });
});
