// Two `lookDistribute` fields, no new Op:
//
//   - `tapped` — the battlefield keep enters tapped ("put a land card from
//     among them onto the battlefield tapped"). CR 110.5b: a permanent enters
//     untapped unless an effect says otherwise.
//   - `otherwise` — "If you don't, put a card from among them into your
//     hand": when the first keep took nothing, a second choice over the SAME
//     looked-at window puts exactly `take` cards to `otherwise.keepTo`.
//     CR 608.2c: the instructions run in order, the later one reading the
//     earlier one's outcome.
import { describe, it, expect } from "vitest";
import { registerTokenDefinition } from "../../cards";
import type { EffectOp } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { validateEffectScript } from "../effects/validate";
import { projectPublicState } from "../../gameProjections";

const LAND_ID = "test-ldo-land";
const SPELL_ID = "test-ldo-spell";
registerTokenDefinition({
    id: LAND_ID,
    name: LAND_ID,
    rarity: "common",
    manaCost: {},
    types: ["Land"],
});
registerTokenDefinition({
    id: SPELL_ID,
    name: SPELL_ID,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Instant"],
});

/** Planar Genesis's shape: an optional land keep onto the battlefield tapped,
 *  else one card to hand, the rest to a random bottom. */
const LAND_OR_CARD: EffectOp = {
    op: "lookDistribute",
    player: "controller",
    look: 4,
    take: 1,
    keepTo: "battlefield",
    tapped: true,
    filter: { type: "Land" },
    optional: true,
    otherwise: { keepTo: "hand" },
    randomBottom: true,
};

const SCRIPT_ID = "test-ldo-land-or-card";
registerTokenDefinition({
    id: SCRIPT_ID,
    name: SCRIPT_ID,
    rarity: "common",
    manaCost: { G: 1, U: 1 },
    types: ["Instant"],
    effects: [LAND_OR_CARD],
});

function libCard(cardId: string, id: string): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "library",
    });
}

function cast(library: CardInstanceState[]): GameState {
    const state = makeState({
        players: [makePlayer("p1", { library }), makePlayer("p2")],
    });
    pushSpell(state, SCRIPT_ID, "p1");
    expect(resolveTopOfStack(state)).toBeNull();
    return state;
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

describe("lookDistribute `tapped` — onto the battlefield tapped (CR 110.5b)", () => {
    it("a kept land enters tapped, nothing goes to hand, the rest go to the bottom", () => {
        const state = cast([
            libCard(SPELL_ID, "s1"),
            libCard(LAND_ID, "l1"),
            libCard(SPELL_ID, "s2"),
            libCard(SPELL_ID, "s3"),
            libCard(SPELL_ID, "s4"),
        ]);
        const head = state.pendingChoices![0];
        expect(head.keepTo).toBe("battlefield");
        expect(head.eligibleIds).toEqual(["l1"]);
        expect(head.count).toEqual({ min: 0, max: 1 });

        submit(state, ["l1"]);
        // The land was put, so the "if you don't" branch never opens.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        const p1 = state.players[0];
        const land = p1.battlefield.find((c) => c.id === "l1");
        expect(land?.isTapped).toBe(true);
        expect(p1.hand).toHaveLength(0);
        expect(p1.library[0].id).toBe("s4");
        expect(new Set(p1.library.map((c) => c.id))).toEqual(
            new Set(["s1", "s2", "s3", "s4"])
        );
        // Wire format — the opponent's view shows the land tapped.
        const projected = projectPublicState(state, 1, "p2");
        const wire = projected.players[0].battlefield.find(
            (c) => c.id === "l1"
        );
        expect(wire?.isTapped).toBe(true);
    });
});

describe("lookDistribute `otherwise` — if you don't, a card to hand (CR 608.2c)", () => {
    it("declining the land opens a mandatory one-card keep to hand over the same window", () => {
        const state = cast([
            libCard(SPELL_ID, "s1"),
            libCard(LAND_ID, "l1"),
            libCard(SPELL_ID, "s2"),
            libCard(SPELL_ID, "s3"),
            libCard(SPELL_ID, "s4"),
        ]);
        submit(state, []);
        const fallback = state.pendingChoices![0];
        expect(fallback.choiceId).toBe("dig-otherwise");
        expect(fallback.keepTo).toBe("hand");
        expect(fallback.candidateIds).toEqual(["s1", "l1", "s2", "s3"]);
        expect(fallback.eligibleIds).toBeUndefined();
        expect(fallback.count).toEqual({ min: 1, max: 1 });

        submit(state, ["s2"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toEqual(["s2"]);
        expect(p1.battlefield).toHaveLength(0);
        expect(p1.library[0].id).toBe("s4");
        expect(new Set(p1.library.map((c) => c.id))).toEqual(
            new Set(["s1", "l1", "s3", "s4"])
        );
    });

    it("the fallback may take a land into hand, and it does not enter tapped", () => {
        const state = cast([libCard(LAND_ID, "l1"), libCard(SPELL_ID, "s1")]);
        submit(state, []);
        submit(state, ["l1"]);
        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toEqual(["l1"]);
        expect(p1.battlefield).toHaveLength(0);
        expect(p1.library.map((c) => c.id)).toEqual(["s1"]);
    });

    it("with no land in the window, the fallback keep is the only prompt", () => {
        const state = cast([
            libCard(SPELL_ID, "s1"),
            libCard(SPELL_ID, "s2"),
            libCard(SPELL_ID, "s3"),
        ]);
        const only = state.pendingChoices![0];
        expect(only.choiceId).toBe("dig-otherwise");
        expect(only.keepTo).toBe("hand");
        submit(state, ["s3"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toEqual(["s3"]);
        expect(new Set(p1.library.map((c) => c.id))).toEqual(
            new Set(["s1", "s2"])
        );
    });
});

describe("lookDistribute `tapped` / `otherwise` — validator", () => {
    const host = (op: EffectOp) =>
        validateEffectScript({
            id: "test-ldo-validate",
            name: "Test",
            effects: [op],
        } as never);

    it("accepts the land-or-card shape", () => {
        expect(host(LAND_OR_CARD)).toEqual([]);
    });

    it("refuses tapped off the battlefield keep", () => {
        expect(
            host({ ...LAND_OR_CARD, keepTo: "hand" } as EffectOp).join("\n")
        ).toContain('"tapped"');
    });

    it("refuses otherwise without optional, or beside bind / reveal", () => {
        const mandatory = { ...LAND_OR_CARD, optional: false } as EffectOp;
        expect(host(mandatory).join("\n")).toContain("optional: true");
        expect(
            host({ ...LAND_OR_CARD, reveal: "kept" } as EffectOp).join("\n")
        ).toContain('"bind" or "reveal"');
    });

    it("refuses a malformed otherwise", () => {
        expect(
            host({
                ...LAND_OR_CARD,
                otherwise: { keepTo: "graveyard" },
            } as never).length
        ).toBeGreaterThan(0);
    });
});
