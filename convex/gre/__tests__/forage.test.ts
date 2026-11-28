// Forage (CR 701.61) — the `forage` Op and the "Whenever you forage" head.
//   - GRE unit: the half pick offers only the halves the player can perform
//     in full (CR 701.61a + CR 118.3), the graveyard half exiles three picked
//     cards, the Food half sacrifices a picked Food, "you may" declines, and
//     the boolean binding gates "If you do" (CR 118.12).
//   - Event: FORAGED is queued once the half is performed, and
//     `foragedTrigger` fires for its controller's forage only (CR 109.5).
//   - Wire format: the half pick crosses `projectPublicState` with its
//     options, and the exiled cards are public in exile.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition, EffectOp } from "../../cards/types";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { projectPublicState } from "../../gameProjections";
import {
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

/** "You may forage. If you do, draw a card." — the Op behind its gate. */
const SPELL_ID = "test-forage-spell";
registerTokenDefinition({
    id: SPELL_ID,
    name: "Test Forage Spell",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forage",
            player: "controller",
            optional: true,
            bind: "$foraged",
        },
        {
            op: "if",
            predicate: { binding: "$foraged" },
            then: [{ op: "draw", player: "controller", count: 1 }],
        },
    ] satisfies EffectOp[],
} satisfies CardDefinition);

/** "Forage." — the mandatory action: no decline option. */
const MANDATORY_ID = "test-forage-mandatory";
registerTokenDefinition({
    id: MANDATORY_ID,
    name: "Test Mandatory Forage",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Sorcery"],
    effects: [
        { op: "forage", player: "controller", bind: "$foraged" },
    ] satisfies EffectOp[],
} satisfies CardDefinition);

/** A Food (CR 205.3g — an artifact subtype). */
const FOOD_ID = "test-forage-food";
registerTokenDefinition({
    id: FOOD_ID,
    name: "Test Food",
    rarity: "common",
    types: ["Artifact"],
    subtypes: ["Food"],
} satisfies CardDefinition);

/** An artifact that is not a Food. */
const CLUE_ID = "test-forage-clue";
registerTokenDefinition({
    id: CLUE_ID,
    name: "Test Clue",
    rarity: "common",
    types: ["Artifact"],
    subtypes: ["Clue"],
} satisfies CardDefinition);

/** "Whenever you forage, you gain 2 life." — the compiled head. */
const WATCHER_ID = "test-forage-watcher";
registerTokenDefinition({
    id: WATCHER_ID,
    name: "Test Forage Watcher",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Squirrel"],
    power: 1,
    toughness: 1,
    compiledTriggeredAbilities: [
        {
            id: "test-forage-watcher-trigger",
            oracleText: "Whenever you forage, you gain 2 life.",
            head: { kind: "foraged", scope: "you" },
            effects: [{ op: "gainLife", player: "controller", amount: 2 }],
        },
    ],
} satisfies CardDefinition);

function inst(
    cardId: string,
    id: string,
    zone: CardInstanceState["zone"],
    owner = "p1"
): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone,
    });
}

function graveyard(count: number, owner = "p1"): CardInstanceState[] {
    return Array.from({ length: count }, (_, i) =>
        inst(CLUE_ID, `${owner}-gy${i}`, "graveyard", owner)
    );
}

function board(opts: {
    graveyard?: number;
    foods?: number;
    watcher?: "p1" | "p2";
    opponentFood?: boolean;
}): GameState {
    const p1Battlefield = Array.from({ length: opts.foods ?? 0 }, (_, i) =>
        inst(FOOD_ID, `food${i}`, "battlefield")
    );
    const p2Battlefield: CardInstanceState[] = opts.opponentFood
        ? [inst(FOOD_ID, "p2-food", "battlefield", "p2")]
        : [];
    if (opts.watcher === "p1")
        p1Battlefield.push(inst(WATCHER_ID, "watcher", "battlefield"));
    if (opts.watcher === "p2")
        p2Battlefield.push(inst(WATCHER_ID, "watcher", "battlefield", "p2"));
    return makeState({
        players: [
            makePlayer("p1", {
                graveyard: graveyard(opts.graveyard ?? 0),
                battlefield: p1Battlefield,
                library: [inst(CLUE_ID, "lib0", "library")],
            }),
            makePlayer("p2", { battlefield: p2Battlefield }),
        ],
    });
}

function submit(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

function optionIds(state: GameState): string[] | undefined {
    return state.pendingChoices?.[0]?.options?.map((o) => o.id);
}

const handIds = (state: GameState) => state.players[0].hand.map((c) => c.id);
const exileIds = (state: GameState) => state.players[0].exile.map((c) => c.id);

describe("forage Op (CR 701.61a)", () => {
    it("the graveyard half exiles the three picked cards, and 'If you do' runs", () => {
        const state = board({ graveyard: 4 });
        pushSpell(state, SPELL_ID, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0]?.kind).toBe("option-pick");
        expect(optionIds(state)).toEqual(["exile", "decline"]);
        submit(state, ["exile"]);
        const pick = state.pendingChoices![0];
        expect(pick.kind).toBe("choose-graveyard-card");
        expect(pick.count).toBe(3);
        submit(state, ["p1-gy0", "p1-gy2", "p1-gy3"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(exileIds(state).sort()).toEqual(["p1-gy0", "p1-gy2", "p1-gy3"]);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("p1-gy1");
        expect(handIds(state)).toEqual(["lib0"]);
    });

    it("the Food half sacrifices the Food, and 'If you do' runs", () => {
        const state = board({ foods: 1 });
        pushSpell(state, SPELL_ID, "p1");
        resolveTopOfStack(state);
        expect(optionIds(state)).toEqual(["sacrifice", "decline"]);
        submit(state, ["sacrifice"]);
        // CR 701.61a — a lone Food leaves nothing to pick.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "food0"
        );
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("food0");
        expect(handIds(state)).toEqual(["lib0"]);
    });

    it("both halves are offered, in printed order, when both can be performed", () => {
        const state = board({ graveyard: 3, foods: 2 });
        pushSpell(state, SPELL_ID, "p1");
        resolveTopOfStack(state);
        expect(optionIds(state)).toEqual(["exile", "sacrifice", "decline"]);
        submit(state, ["sacrifice"]);
        // Two Foods: the forager picks which one.
        const pick = state.pendingChoices![0];
        expect(pick.kind).toBe("sacrifice-permanents");
        expect(pick.candidateIds).toEqual(["food0", "food1"]);
        submit(state, ["food1"]);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("food1");
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "food0"
        );
    });

    it("a graveyard of exactly three is exiled whole, with no card pick", () => {
        const state = board({ graveyard: 3 });
        pushSpell(state, SPELL_ID, "p1");
        resolveTopOfStack(state);
        submit(state, ["exile"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(exileIds(state).sort()).toEqual(["p1-gy0", "p1-gy1", "p1-gy2"]);
    });

    it("declining moves nothing and the gated draw does not happen", () => {
        const state = board({ graveyard: 3, foods: 1 });
        pushSpell(state, SPELL_ID, "p1");
        resolveTopOfStack(state);
        submit(state, ["decline"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(exileIds(state)).toEqual([]);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "food0"
        );
        expect(handIds(state)).toEqual([]);
    });

    it("CR 118.3 — two graveyard cards and no Food: nothing to forage with, no prompt, no draw", () => {
        const state = board({ graveyard: 2 });
        pushSpell(state, SPELL_ID, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(exileIds(state)).toEqual([]);
        expect(handIds(state)).toEqual([]);
    });

    it("an opponent's Food is not the forager's to sacrifice", () => {
        const state = board({ graveyard: 0, opponentFood: true });
        pushSpell(state, SPELL_ID, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[1].battlefield.map((c) => c.id)).toContain(
            "p2-food"
        );
    });

    it("mandatory forage with one open half performs it with no prompt", () => {
        const state = board({ foods: 1 });
        pushSpell(state, MANDATORY_ID, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("food0");
    });
});

describe("Whenever you forage — FORAGED (CR 701.61a)", () => {
    it("its controller's forage triggers it", () => {
        const state = board({ foods: 1, watcher: "p1" });
        pushSpell(state, MANDATORY_ID, "p1");
        resolveTopOfStack(state);
        processPendingActionTriggers(state);
        const top = state.stack[state.stack.length - 1];
        expect(top?.triggeredAbilityId).toBe("test-forage-watcher-trigger");
    });

    it("CR 109.5 — an opponent's forage does not", () => {
        const state = board({ foods: 1, watcher: "p2" });
        pushSpell(state, MANDATORY_ID, "p1");
        resolveTopOfStack(state);
        processPendingActionTriggers(state);
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "test-forage-watcher-trigger"
            )
        ).toBe(false);
    });

    it("declining to forage is no forage", () => {
        const state = board({ foods: 1, watcher: "p1" });
        pushSpell(state, SPELL_ID, "p1");
        resolveTopOfStack(state);
        submit(state, ["decline"]);
        processPendingActionTriggers(state);
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "test-forage-watcher-trigger"
            )
        ).toBe(false);
    });
});

describe("forage — wire format", () => {
    it("the half pick reaches both viewers with its options; the exiled cards are public", () => {
        const state = board({ graveyard: 4, foods: 1 });
        pushSpell(state, SPELL_ID, "p1");
        resolveTopOfStack(state);
        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            expect(
                projected.pendingChoices?.[0]?.options?.map((o) => o.label)
            ).toEqual([
                "Exile three cards from your graveyard",
                "Sacrifice a Food",
                "Don't forage",
            ]);
        }
        submit(state, ["exile"]);
        submit(state, ["p1-gy0", "p1-gy1", "p1-gy2"]);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[0].exile.map((c) => c.id).sort()).toEqual([
            "p1-gy0",
            "p1-gy1",
            "p1-gy2",
        ]);
    });
});
