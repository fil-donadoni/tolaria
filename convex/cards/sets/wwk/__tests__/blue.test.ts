// wwk (Worldwake) — blue behavior tests (ADR 0043 colour split).
//
// Jace, the Mind Sculptor (issue #1532, Vintage Cube FREE wave 3). Each loyalty
// ability (CR 606) is pushed on the stack and resolved through the real path
// (`resolveTopOfStack`), mirroring the Chandra, Torch of Defiance harness
// (kld/red.test.ts) — the loyalty-cost payment is exercised in game.ts; these
// tests assert the EFFECTS. The +2 exercises the new `scryReorder` `chooser`
// param (fateseal, issue #1532): the CONTROLLER decides top/bottom looking at
// the TARGET player's library, with a mandatory wire-format assertion that the
// peek is exposed to the chooser (not the library owner).

import { describe, it, expect } from "vitest";
import { jaceTheMindSculptor } from "../blue";
import { grizzlyBears, ironrootTreefolk } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import type { TargetSelection } from "../../../types";

const PLUS2 = "jace-the-mind-sculptor-plus2";
const ZERO = "jace-the-mind-sculptor-zero";
const MINUS1 = "jace-the-mind-sculptor-minus1";
const MINUS12 = "jace-the-mind-sculptor-minus12";

function jaceOnBattlefield(loyalty = 3) {
    return makeInstance(jaceTheMindSculptor.id, {
        id: "jace1",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

const cards = (owner: "p1" | "p2", ids: string[], zone: "library" | "hand") =>
    ids.map((id) =>
        makeInstance(ironrootTreefolk.id, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone,
        })
    );

/** Pushes one of Jace's loyalty abilities on the stack and resolves it through
 *  the real path (loyalty-cost payment is exercised in game.ts). */
function activate(
    state: GameState,
    abilityId: string,
    targets?: TargetSelection[]
): void {
    const jace = state.players[0].battlefield.find((c) => c.id === "jace1")!;
    state.stack.push({
        ...jace,
        zone: "stack",
        castById: "p1",
        abilityId,
        ...(targets ? { targets } : {}),
    });
    resolveTopOfStack(state);
}

describe("Jace, the Mind Sculptor — +2 fateseal (CR 701.29, chooser param, issue #1532)", () => {
    function fatesealState() {
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [jaceOnBattlefield()] }),
                makePlayer("p2", {
                    library: cards("p2", ["x", "y", "z"], "library"),
                }),
            ],
        });
    }

    it("raises an order-top choice for the CONTROLLER over the TARGET player's library", () => {
        const state = fatesealState();
        activate(state, PLUS2, [{ type: "player", id: "p2" }]);
        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        // The CONTROLLER (p1) decides; the library belongs to p2 (zoneOwnerId).
        expect(head.playerId).toBe("p1");
        expect(head.zoneOwnerId).toBe("p2");
        expect(head.kind).toBe("order-top");
        expect(head.zone).toBe("library");
        expect(head.candidateIds).toEqual(["x"]); // just the top card
    });

    it("wire format: the peeked top card is exposed to the CONTROLLER, hidden from the library owner", () => {
        const state = fatesealState();
        activate(state, PLUS2, [{ type: "player", id: "p2" }]);
        // Controller p1's view: p2's top card is face-up as libraryPeek.
        const controllerView = projectPublicState(state, 1, "p1");
        expect(controllerView.players[1].libraryPeek?.map((c) => c.id)).toEqual(
            ["x"]
        );
        // The library owner p2 does NOT see their own peeked card (the chooser's
        // private fateseal knowledge).
        const ownerView = projectPublicState(state, 1, "p2");
        expect(ownerView.players[1].libraryPeek).toBeUndefined();
    });

    it("bottoming the card moves the target's top card to the bottom of their library", () => {
        const state = fatesealState();
        activate(state, PLUS2, [{ type: "player", id: "p2" }]);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [], // keep none on top
            secondZoneIds: ["x"], // bottom the top card
        });
        expect(state.players[1].library.map((c) => c.id)).toEqual([
            "y",
            "z",
            "x",
        ]);
    });

    it("keeping the card on top leaves the target's library order unchanged", () => {
        const state = fatesealState();
        activate(state, PLUS2, [{ type: "player", id: "p2" }]);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["x"], // keep on top
            secondZoneIds: [],
        });
        expect(state.players[1].library.map((c) => c.id)).toEqual([
            "x",
            "y",
            "z",
        ]);
    });
});

describe("Jace, the Mind Sculptor — 0 Brainstorm (draw three, put two back)", () => {
    it("draws three then puts two chosen hand cards on top of the library", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [jaceOnBattlefield()],
                    library: cards("p1", ["l1", "l2", "l3", "l4"], "library"),
                }),
                makePlayer("p2"),
            ],
        });
        activate(state, ZERO);
        // Drew l1,l2,l3 → suspended on the put-back (choose-hand-card) choice.
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "l1",
            "l2",
            "l3",
        ]);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-hand-card");
        expect(head.count).toBe(2);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["l1", "l2"], // l2 picked last → ends up on top
        });
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["l3"]);
        // l2 on top, then l1, then l4 (the card that was never drawn).
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "l2",
            "l1",
            "l4",
        ]);
    });
});

describe("Jace, the Mind Sculptor — −1 bounce", () => {
    it("returns the target creature to its owner's hand", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [jaceOnBattlefield()] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        activate(state, MINUS1, [{ type: "permanent", id: "bear1" }]);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["bear1"]);
    });
});

describe("Jace, the Mind Sculptor — −12 ultimate (exile library, shuffle hand in)", () => {
    it("exiles the whole target library, then shuffles the target's hand into their library", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [jaceOnBattlefield(14)],
                }),
                makePlayer("p2", {
                    library: cards("p2", ["x", "y", "z"], "library"),
                    hand: cards("p2", ["h1", "h2"], "hand"),
                }),
            ],
        });
        activate(state, MINUS12, [{ type: "player", id: "p2" }]);
        // The entire former library is exiled.
        expect(state.players[1].exile.map((c) => c.id).sort()).toEqual([
            "x",
            "y",
            "z",
        ]);
        // The hand is now the library (shuffled — order not asserted).
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].library.map((c) => c.id).sort()).toEqual([
            "h1",
            "h2",
        ]);
    });
});
