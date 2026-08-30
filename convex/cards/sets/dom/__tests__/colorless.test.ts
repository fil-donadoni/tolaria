// DOM (Dominaria) — colorless behavior tests (ADR 0043 colour split).
//
// Karn, Scion of Urza (issue #1570, Vintage Cube FREE wave 3). Each loyalty
// ability (CR 606) is pushed on the stack and resolved through the real path
// (`resolveTopOfStack`) — the loyalty-cost payment is exercised in game.ts;
// these tests assert the EFFECTS, mirroring the Jace, the Mind Sculptor harness
// (wwk/blue.test.ts). The +1 exercises the new `lookDistribute` `chooser` /
// `destination: "exile"` / `counters` legs; the −1 exercises the new `moveZone`
// `from: "exile"` cards-shape source; the −2 exercises the shared CDA Construct
// token factory (`constructArtifactsYouControlToken`, issue #2371) with a
// mandatory wire-format P/T assertion.

import { describe, it, expect } from "vitest";
import { karnScionOfUrza } from "../colorless";
import { ornithopter } from "../../atq/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import type { TargetSelection } from "../../../types";

const PLUS1 = "karn-scion-of-urza-plus1";
const MINUS1 = "karn-scion-of-urza-minus1";
const MINUS2 = "karn-scion-of-urza-minus2";

function karnOnBattlefield(loyalty = 5) {
    return makeInstance(karnScionOfUrza.id, {
        id: "karn1",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

/** Pushes one of Karn's loyalty abilities on the stack and resolves it through
 *  the real path (loyalty-cost payment is exercised in game.ts). */
function activate(
    state: GameState,
    abilityId: string,
    targets?: TargetSelection[]
): void {
    const karn = state.players[0].battlefield.find((c) => c.id === "karn1")!;
    state.stack.push({
        ...karn,
        zone: "stack",
        castById: "p1",
        abilityId,
        ...(targets ? { targets } : {}),
    });
    resolveTopOfStack(state);
}

const cards = (owner: "p1" | "p2", ids: string[], zone: "library" | "hand") =>
    ids.map((id) =>
        makeInstance(ornithopter.id, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone,
        })
    );

describe("Karn, Scion of Urza — +1 reveal-2 / opponent-chooses / silver-counter exile (CR 701.20a / 122.1, issue #1570)", () => {
    it("the OPPONENT chooses one to hand; the other is exiled with a silver counter", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [karnOnBattlefield()],
                    library: cards("p1", ["a", "b", "c"], "library"),
                }),
                makePlayer("p2"),
            ],
        });
        activate(state, PLUS1);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-distribute");
        expect(head.destination).toBe("exile");
        // The opponent (p2) chooses from p1's library (chooser ≠ zone owner).
        expect(head.playerId).toBe("p2");
        expect(head.zoneOwnerId).toBe("p1");

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["a"],
        });
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
        const exiled = state.players[0].exile.find((c) => c.id === "b")!;
        expect(exiled).toBeDefined();
        expect(exiled.counters).toEqual({ silver: 1 });
        expect(state.players[0].library.map((c) => c.id)).toEqual(["c"]);
    });
});

describe("Karn, Scion of Urza — −1 silver-counter retrieval (CR 122.1, issue #1570)", () => {
    it("puts a silver-counter card from exile into hand, stripping the counter (CR 122.1e)", () => {
        const silverCard = makeInstance(ornithopter.id, {
            id: "silv",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
            counters: { silver: 1 },
        });
        const plainExiled = makeInstance(ornithopter.id, {
            id: "plain",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [karnOnBattlefield()],
                    exile: [silverCard, plainExiled],
                }),
                makePlayer("p2"),
            ],
        });
        activate(state, MINUS1);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-exile-card");
        expect(head.candidateIds).toEqual(["silv"]);

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["silv"],
        });
        expect(state.players[0].hand.map((c) => c.id)).toContain("silv");
        expect(state.players[0].exile.map((c) => c.id)).toEqual(["plain"]);
        const inHand = state.players[0].hand.find((c) => c.id === "silv")!;
        expect(inHand.counters?.silver).toBeUndefined();
    });
});

describe("Karn, Scion of Urza — −2 Construct token (CR 604.3 CDA, issue #1570)", () => {
    it("creates a 0/0 Construct that counts ITSELF + every artifact you control", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        karnOnBattlefield(),
                        makeInstance(ornithopter.id, {
                            id: "mine",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(ornithopter.id, {
                            id: "theirs",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        activate(state, MINUS2);
        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        expect(token).toBeDefined();
        expect(token.types).toEqual(["Artifact", "Creature"]);
        expect(token.subtypes).toContain("Construct");
        // "mine" (Ornithopter) + the token itself = 2; the opponent's "theirs"
        // is not counted, and Karn is a Planeswalker (not an artifact).
        expect(getEffectivePower(state, token)).toBe(2);
        expect(getEffectiveToughness(state, token)).toBe(2);
    });

    it("wire format — the Construct's CDA P/T survives projectPublicState", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        karnOnBattlefield(),
                        makeInstance(ornithopter.id, {
                            id: "mine",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        activate(state, MINUS2);
        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === token.id
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});
