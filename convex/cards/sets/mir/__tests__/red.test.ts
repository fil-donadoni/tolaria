// MIR — red card behavior tests (ADR 0043 colour split).
//
// Goblin Tinkerer is the first shipped card whose damage SOURCE is an object
// the same resolution has already destroyed ("Destroy target artifact. That
// artifact deals damage equal to its mana value to this creature"), so it is
// the first consumer of the last-known-information leg of
// `dealDamage.source` (CR 113.7a / 608.2h). Nothing catalogue-wide covers it:
// the canned smoke generator skips every `destroy` shape, so without this file
// the card ships with the whole second sentence inert.
import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { type GameState, resolveTopOfStack } from "../../../../gre/state";
import type { TargetSelection } from "../../../types";
import { finalizeTargetSelection } from "../../../../game";
import { getDefinition } from "../../../index";
import { projectPublicState } from "../../../../gameProjections";

const goblinTinkerer = getDefinition("e6529852-8b3e-4a70-a4a1-029e012231c6");
const JAYEMDAE_TOME = "cac8c421-5b92-481d-b2de-560c0231ab58"; // {4}, mana value 4
const BLACK_VISE = "76ac72f8-5b1e-4d67-a796-ef69cde27424"; // {1}, mana value 1
const ABILITY_ID = "goblin-tinkerer-destroy-artifact";

/** Build the `kind: "ability"` PendingTarget exactly as `activateAbility` does
 *  for a targeted ability, with the artifact already chosen, then drive the
 *  real `finalizeTargetSelection` commit path. */
function activateTinkererOn(
    state: GameState,
    tinkererId: string,
    artifactId: string
): void {
    state.pendingTarget = {
        playerId: "p1",
        cardInstanceId: tinkererId,
        targetType: "Artifact",
        count: 1,
        selected: [{ type: "permanent", id: artifactId }] as TargetSelection[],
        kind: "ability",
        abilityId: ABILITY_ID,
    };
    finalizeTargetSelection(state, state.pendingTarget, "p1");
}

function boardWith(artifactCardId: string): GameState {
    const tinkerer = makeInstance(goblinTinkerer.id, {
        id: "tinkerer",
        controllerId: "p1",
        ownerId: "p1",
    });
    const artifact = makeInstance(artifactCardId, {
        id: "art",
        controllerId: "p2",
        ownerId: "p2",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [tinkerer],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
            makePlayer("p2", { battlefield: [artifact] }),
        ],
    });
}

describe("Goblin Tinkerer — destroy an artifact, then take its mana value back (CR 701.8 / 120.1 / 608.2h)", () => {
    it("destroys the artifact AND marks its mana value on the Tinkerer, which dies to a big one", () => {
        const state = boardWith(JAYEMDAE_TOME);
        activateTinkererOn(state, "tinkerer", "art");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);

        // CR 701.8 — the artifact is destroyed.
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "art"
        );
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("art");

        // CR 113.7a / 608.2h — "that artifact" still deals the damage from its
        // last known state, 4 for a mana value of 4. The 1/2 Tinkerer takes
        // lethal and the damage leg's own destroy runs.
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "tinkerer"
        );
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "tinkerer"
        );
    });

    it("a mana value below the Tinkerer's toughness leaves it alive with damage marked — and the mark crosses the wire", () => {
        const state = boardWith(BLACK_VISE);
        activateTinkererOn(state, "tinkerer", "art");
        resolveTopOfStack(state);

        expect(state.players[1].graveyard.map((c) => c.id)).toContain("art");
        const tinkerer = state.players[0].battlefield.find(
            (c) => c.id === "tinkerer"
        );
        // Mana value 1 against toughness 2 — survives, marked.
        expect(tinkerer?.damageMarked).toBe(1);

        // Wire format: the projection must carry the mark, or the client draws
        // an undamaged Tinkerer the server knows is one ping from dying.
        const projected = projectPublicState(state, 1, "p1");
        const projectedTinkerer = projected.players[0].battlefield.find(
            (c) => c.id === "tinkerer"
        );
        expect(projectedTinkerer?.damageMarked).toBe(1);
    });
});
