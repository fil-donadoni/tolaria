// ODY (Odyssey) — black behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { innocentBlood, entomb } from "../black";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { refreshExpectedInput } from "../../../../gre/expectedInput";
import { validateEffectScript } from "../../../../gre/effects/validate";
import { projectPublicState } from "../../../../gameProjections";
import { registerTokenDefinition } from "../../..";

const BEAR_ID = "test-odyb-bear";
registerTokenDefinition({
    id: BEAR_ID,
    name: BEAR_ID,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

const bearFor = (owner: string, cid: string) =>
    makeInstance(BEAR_ID, { id: cid, controllerId: owner, ownerId: owner });

// Innocent Blood — "Each player sacrifices a creature of their choice."
// (CR 701.16.) The first DSL card composing a `choice` Op inside a forEach
// construct (ADR 0045, issue #807): the players set iterates in APNAP order
// (CR 101.4), each iteration suspending on a `sacrifice-permanents` Pending
// Choice for the current player and resuming to sacrifice the pick.
describe("Innocent Blood (each player sacrifices a creature — DSL-only choice-inside-forEach, CR 701.16 / 101.4 / issue #807)", () => {
    it("is a {B} sorcery, DSL-only with a valid Effect Script and no targets", () => {
        expect(innocentBlood.manaCost).toEqual({ B: 1 });
        expect(innocentBlood.types).toEqual(["Sorcery"]);
        expect(innocentBlood.targetRequirement).toBeUndefined();
        expect(innocentBlood.resolve).toBeUndefined();
        expect(innocentBlood.resolveSteps).toBeUndefined();
        expect(validateEffectScript(innocentBlood)).toEqual([]);
    });

    it("each player picks and sacrifices one creature, in APNAP order (CR 101.4 / 701.16)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [bearFor("p1", "ibA1"), bearFor("p1", "ibA2")],
                }),
                makePlayer("p2", { battlefield: [bearFor("p2", "ibB1")] }),
            ],
        });
        // p2 casts it; APNAP still starts from the ACTIVE player (p1).
        pushSpell(state, innocentBlood.id, "p2");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended
        let head = state.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.playerId).toBe("p1"); // active player decides first
        expect(head.count).toBe(1);
        expect(head.prompt).toBe(
            "Innocent Blood: choose a creature to sacrifice."
        );
        // CR 608.3 — the sorcery stays on the stack across the wait.
        expect(state.stack.map((s) => s.card.id)).toEqual([innocentBlood.id]);

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["ibA1"],
        });
        // p1's sacrifice landed; now p2 is prompted (CR 101.4 order).
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(["ibA2"]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["ibA1"]);
        head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["ibB1"],
        });
        expect(state.players[1].battlefield).toHaveLength(0);
        // p2's graveyard: the sacrificed bear + the resolved sorcery
        // (cast by p2, CR 608.2k).
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("ibB1");
        expect(state.players[1].graveyard.map((c) => c.card.id)).toContain(
            innocentBlood.id
        );
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("a player with no creatures is skipped — no prompt, no sacrifice (CR 608.2b)", () => {
        const state = makeState({
            players: [
                makePlayer("p1"), // creatureless — never prompted
                makePlayer("p2", { battlefield: [bearFor("p2", "ibOnly")] }),
            ],
        });
        pushSpell(state, innocentBlood.id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["ibOnly"],
        });
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });

    it("resolves cleanly when NO player controls a creature (CR 608.2b)", () => {
        const state = makeState();
        pushSpell(state, innocentBlood.id, "p1");
        expect(resolveTopOfStack(state)).not.toBeNull(); // never suspended
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
    });

    it("indestructible does not prevent the sacrifice (CR 701.16a)", () => {
        const tough = makeInstance(BEAR_ID, {
            id: "ibInd",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["indestructible"],
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [tough] }),
            ],
        });
        pushSpell(state, innocentBlood.id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["ibInd"],
        });
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("ibInd");
    });

    it("wire format: the suspended sacrifice prompt, Expected Input and final board cross the projection", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bearFor("p1", "ibW1")] }),
                makePlayer("p2", { battlefield: [bearFor("p2", "ibW2")] }),
            ],
        });
        pushSpell(state, innocentBlood.id, "p1");
        resolveTopOfStack(state);
        refreshExpectedInput(state); // ADR 0047 persistence-seam refresh
        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.playerId).toBe("p1");
        expect(projected.expectedInput).toEqual({
            kind: "choice",
            playerId: "p1",
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
            choiceKind: "sacrifice-permanents",
        });

        // Complete both iterations, then re-assert on the projected state.
        for (const [pid, pick] of [
            ["p1", "ibW1"],
            ["p2", "ibW2"],
        ] as const) {
            const h = state.pendingChoices![0];
            applyPendingChoiceSubmit(state, {
                playerId: pid,
                stackItemId: h.stackItemId,
                step: h.step,
                choiceId: h.choiceId,
                cardInstanceIds: [pick],
            });
        }
        const done = projectPublicState(state, 1, "p2");
        expect(done.players[0].battlefield).toHaveLength(0);
        expect(done.players[1].battlefield).toHaveLength(0);
        expect(done.players[0].graveyard.map((c) => c.id)).toContain("ibW1");
        expect(done.players[1].graveyard.map((c) => c.id)).toContain("ibW2");
    });
});

describe("Entomb (CR 701.19 / 400.7 / 701.20, issue #677)", () => {
    it("searches for any card and puts it into the graveyard, then shuffles", () => {
        const libBear = makeInstance(BEAR_ID, {
            id: "bearEntomb",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [libBear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, entomb.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["bearEntomb"],
        });
        expect(state.players[0].library).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "bearEntomb"
        );
    });
});
