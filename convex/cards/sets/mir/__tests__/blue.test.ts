// Mirage (MIR) — blue behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { flash } from "../blue";
import { fungusaur, grizzlyBears } from "../../lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";

describe("Flash (CR 117.3a / 118.4 / 400.7, issue #1150)", () => {
    it("puts a picked creature onto the battlefield, then keeps it when its reduced mana cost is paid", () => {
        // Fungusaur — {3}{G} (LEA). Reduced by {2} → {1}{G} (generic 3-2=1,
        // the green pip untouched — CR 601.2f).
        const hand = makeInstance(fungusaur.id, {
            id: "handFungusaur",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [hand],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, flash.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the hand pick
        const pickHead = state.pendingChoices![0];
        expect(pickHead.kind).toBe("choose-hand-card");
        expect(pickHead.candidateIds).toEqual(["handFungusaur"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pickHead.stackItemId,
            step: pickHead.step,
            choiceId: pickHead.choiceId,
            cardInstanceIds: ["handFungusaur"],
        });
        // The creature is now on the battlefield; the script suspended again
        // on the mayPay leg.
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "handFungusaur"
        );
        const payHead = state.pendingChoices![0];
        expect(payHead.kind).toBe("may-pay");
        expect(payHead.cost).toEqual({ mana: { G: 1, generic: 1 } });
        // Wire format — the client renders the may-pay prompt off
        // `PublicGameState`, never the fat server state (gre-development.md
        // § Card testing convention: wire format test mandatory for a
        // visible effect).
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingChoices?.[0].cost).toEqual({
            mana: { G: 1, generic: 1 },
        });
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        // Paid → kept on the battlefield, not sacrificed.
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "handFungusaur"
        );
        // Flash itself resolves to the graveyard (CR 608.2k) — the CREATURE
        // is what must NOT be there.
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "handFungusaur"
        );
        expect(state.players[0].manaPool.G).toBe(0);
        expect(state.players[0].manaPool.C).toBe(0);
    });

    it("sacrifices the creature when the reduced cost is declined", () => {
        // Grizzly Bears — {1}{G} (LEA). Reduced by {2} floors the generic
        // portion at {0} (CR 118.9) rather than going negative.
        const hand = makeInstance(grizzlyBears.id, {
            id: "handBears",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [hand] }), makePlayer("p2")],
        });
        pushSpell(state, flash.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        const pickHead = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pickHead.stackItemId,
            step: pickHead.step,
            choiceId: pickHead.choiceId,
            cardInstanceIds: ["handBears"],
        });
        const payHead = state.pendingChoices![0];
        expect(payHead.cost).toEqual({ mana: { G: 1 } }); // floored at {0} generic
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "handBears"
        );
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "handBears"
        );
    });

    it("declining the initial 'you may' (no creature picked) never raises a may-pay prompt", () => {
        const state = makeState(); // empty hand — nothing to put into play
        pushSpell(state, flash.id, "p1");
        expect(resolveTopOfStack(state)).not.toBeNull(); // resolves fully, no suspension
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });
});
