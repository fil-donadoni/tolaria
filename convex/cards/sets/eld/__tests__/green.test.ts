// Once Upon a Time (ELD, issue #790) — the free-first-spell-this-game
// alternative cost. `digToHand`'s own resolution shape (look 5, keep a
// creature/land, bottom the rest in random order) is already covered by the
// catalogue-wide Effect Script static sweep + auto-generated smoke test (the
// per-Op regime, `.claude/rules/gre-development.md`), so this file focuses on
// what's genuinely NEW about this card: it's the first `alternativeCosts[]`
// entry authored alongside a DSL `effects[]` script rather than `resolve()`,
// and its condition (`first-spell-this-game`) is exercised end-to-end through
// the real cost-collapse + cast-legality + commit path.
import { describe, it, expect } from "vitest";
import { onceUponATime } from "../green";
import { grizzlyBears } from "../../lea/green";
import { forest } from "../../lea/colorless";
import { resolveTopOfStack } from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import {
    getAlternativeCost,
    affordableAlternativeCosts,
} from "../../../../gre/alternativeCost";
import { getLegalActions } from "../../../../gre/rules";
import { tryAutoCommitPendingCast } from "../../../../game";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

function handCard(cardId: string, id: string, controllerId = "p1") {
    return makeInstance(cardId, {
        id,
        controllerId,
        ownerId: controllerId,
        zone: "hand",
    });
}

describe("Once Upon a Time — free alt cost (CR 118.9, issue #790)", () => {
    const inst = handCard(onceUponATime.id, "ouat");

    it("getAlternativeCost resolves the leg-free free-cast variant by id", () => {
        const alt = getAlternativeCost(onceUponATime, "free-first-spell");
        expect(alt).toBeDefined();
        expect(alt?.mana).toBeUndefined();
        expect(alt?.permanent).toBeUndefined();
        expect(alt?.life).toBeUndefined();
        expect(alt?.hand).toBeUndefined();
        expect(alt?.condition).toEqual({ kind: "first-spell-this-game" });
    });

    it("is offered as affordable when the caster hasn't cast a spell this game", () => {
        const state = makeState({
            players: [makePlayer("p1", { hand: [inst] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const alts = affordableAlternativeCosts(state, state.players[0], inst);
        expect(alts.some((a) => a.id === "free-first-spell")).toBe(true);
    });

    it("is NOT offered once the caster has already cast a spell this game", () => {
        const state = makeState({
            players: [makePlayer("p1", { hand: [inst] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.players[0].spellsCastThisGame = 1;
        const alts = affordableAlternativeCosts(state, state.players[0], inst);
        expect(alts.some((a) => a.id === "free-first-spell")).toBe(false);
    });
});

describe("Once Upon a Time — cast legality via the free alt cost (convex/gre/rules.ts)", () => {
    it("'cast' is legal with ZERO mana when it's the caster's first spell this game", () => {
        const inst = handCard(onceUponATime.id, "ouat");
        const state = makeState({
            players: [makePlayer("p1", { hand: [inst] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        // No mana anywhere — only the free alt cost makes this legal.
        const actions = getLegalActions(state, state.players[0], inst);
        expect(actions).toContain("cast");
    });

    it("'cast' is illegal with zero mana once the caster's first spell is spent", () => {
        const inst = handCard(onceUponATime.id, "ouat");
        const state = makeState({
            players: [makePlayer("p1", { hand: [inst] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.players[0].spellsCastThisGame = 1;
        const actions = getLegalActions(state, state.players[0], inst);
        expect(actions).not.toContain("cast");
    });
});

describe("Once Upon a Time — commit + resolution (CR 118.9 / 601.2h, 401.4)", () => {
    // Mirrors dash.test.ts / pitch-cost.test.ts's pattern: this project has no
    // convex-test harness for game.ts mutations (ADR 0001), so the REAL
    // exported commit function is driven directly over a manually-parked
    // `pendingCast` with the mana cost already collapsed to `{}` — the exact
    // shape `announceCast`'s `chosenAltCost.mana ?? {}` produces for a
    // leg-free alternative cost (convex/game.ts).
    function freeCastState(): GameState {
        const ouatInst = handCard(onceUponATime.id, "ouat", "p1");
        // A mix of creatures, a land, and an ineligible instant — "b" (the
        // land, Forest) is the one kept, proving the filter's "Creature or
        // Land" eligibility actually holds for a real land card.
        const libSpec: [string, string][] = [
            ["a", grizzlyBears.id],
            ["b", forest.id],
            ["c", grizzlyBears.id],
            ["d", forest.id],
            ["e", onceUponATime.id],
        ];
        const libCards = libSpec.map(([id, cardId]) =>
            makeInstance(cardId, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [ouatInst], library: libCards }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "ouat",
            manaCost: {},
            tappedLandIds: [],
        };
        return state;
    }

    it("commits for zero mana and stacks the spell", () => {
        const state = freeCastState();
        const committed = tryAutoCommitPendingCast(state, "p1");
        expect(committed).not.toBeNull();
        expect(state.players[0].manaPool).toEqual(expect.objectContaining({}));
        expect(state.stack.some((s) => s.id === "ouat")).toBe(true);
        expect(state.players[0].hand.map((c) => c.id)).not.toContain("ouat");
    });

    it("resolves via digToHand: looks at the top 5, keeps the chosen card, bottoms the rest", () => {
        const state = freeCastState();
        tryAutoCommitPendingCast(state, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-distribute");
        expect(head.candidateIds).toEqual(["a", "b", "c", "d", "e"]);
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["b"],
        });
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toContain("b");
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "a",
            "c",
            "d",
            "e",
        ]);
    });
});

describe("Once Upon a Time — free alt cost survives projectPublicState (wire format)", () => {
    it("'cast' stays legal (via the free alt cost) after projection, with zero mana", () => {
        const inst = handCard(onceUponATime.id, "ouat");
        const state = makeState({
            players: [makePlayer("p1", { hand: [inst] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimCard = projected.players[0].hand[0];
        expect(slimCard).toBeDefined();
        expect(slimCard?.legalActions).toContain("cast");
    });
});
