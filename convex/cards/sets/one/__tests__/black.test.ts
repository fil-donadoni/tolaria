// ONE — per-card behavior tests for black cards in
// `convex/cards/sets/one/black.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { sheoldredsEdict } from "../black";
import { grizzlyBears } from "../../lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type { GameState, StackItem } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";

/** Answers the head pending choice with `picks` (permanent ids for the
 *  sacrifice pick). Drives the staged-resume resolution forward. */
function answer(state: GameState, picks: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: picks,
    });
}

/** Pushes Sheoldred's Edict with its mode ALREADY locked — mirroring the
 *  cast-time flow (CR 601.2b–c / 700.2c): `announceCast` writes `chosenModeId`
 *  onto the stack item before the spell hits the stack. */
function pushEdict(state: GameState, modeId: string): StackItem {
    const item = pushSpell(state, sheoldredsEdict.id, "p1", []);
    item.chosenModeId = modeId;
    return item;
}

describe("Sheoldred's Edict (ONE, {1}{B} modal instant — CR 700.2)", () => {
    it("picks its mode at CAST, not at resolution (CR 601.2b–c, issue #1274)", () => {
        // The mode lives on the cast-time `modes` framework — no card-level
        // resolve() and no card-level `optionChoice` Op (both of which would
        // put the spell on the stack with its mode hidden).
        expect(sheoldredsEdict.resolve).toBeUndefined();
        expect(sheoldredsEdict.resolveSteps).toBeUndefined();
        expect(sheoldredsEdict.effects).toBeUndefined();
        expect(sheoldredsEdict.modes?.map((m) => m.id)).toEqual([
            "nontoken-creature",
            "creature-token",
            "planeswalker",
        ]);
        // No mode targets (CR 700.2d) — "of their choice" is the sacrificing
        // player's resolution-time choice (CR 608.2), not a target.
        for (const mode of sheoldredsEdict.modes!) {
            expect(mode.targetRequirement).toBeUndefined();
            expect(mode.oracleText).toContain("Each opponent sacrifices");
        }
    });

    it("mode 1 — the opponent sacrifices a nontoken creature of their choice (CR 701.16)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const token = makeInstance(grizzlyBears.id, {
            id: "token",
            controllerId: "p2",
            ownerId: "p2",
            isToken: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear, token] }),
            ],
        });
        pushEdict(state, "nontoken-creature");
        resolveTopOfStack(state);

        // The sacrifice choice belongs to the OPPONENT (CR 701.16a), and only
        // the nontoken creature is a candidate (`isToken: false`, issue #920).
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        expect(head.zone).toBe("battlefield");
        expect(head.filter).toMatchObject({
            types: "Creature",
            isToken: false,
        });

        answer(state, ["bear"]);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "token",
        ]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["bear"]);
        expect(state.stack).toHaveLength(0);
    });

    it("mode 2 — only creature TOKENS are candidates (isToken filter, issue #920)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const token = makeInstance(grizzlyBears.id, {
            id: "token",
            controllerId: "p2",
            ownerId: "p2",
            isToken: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear, token] }),
            ],
        });
        pushEdict(state, "creature-token");
        resolveTopOfStack(state);

        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        expect(head.filter).toMatchObject({
            types: "Creature",
            isToken: true,
        });
        answer(state, ["token"]);

        // The token is sacrificed and ceases to exist (CR 704.5d) — the
        // nontoken bear survives.
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual(["bear"]);
        expect(state.stack).toHaveLength(0);
    });

    it("mode 2 — no legal candidate is a no-op, not a stuck choice (CR 608.2b)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushEdict(state, "creature-token");
        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual(["bear"]);
        expect(state.stack).toHaveLength(0);
    });

    it("mode 3 — the chosen mode is the only one that runs (the creatures are untouched)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushEdict(state, "planeswalker");
        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual(["bear"]);
    });
});
