// Turn-scoped effects a resolved spell leaves with no permanent to carry them
// (CR 611.2a, cleared at CLEANUP by CR 514.2):
//
//  1. "Spells you control can't be countered this turn" (CR 611.2c / 101.2) —
//     `GameState.spellCounterImmunityThisTurn`, read by `counter()`.
//  2. The per-player record of the colours of spells cast this turn (CR
//     601.2i / 202.2) and the `{ spellsCastThisTurn: { of, colors? } }`
//     EffectValue that reads it ("if an opponent has cast a blue or black
//     spell this turn").
//  3. A player's keywords until end of turn, granted by the
//     `grantPlayerKeyword` Op:
//     - hexproof (CR 702.11c), and hexproof from a colour (CR 702.11d);
//     - shroud (CR 702.18a).
//     They are read at every player-target gate: the offered set
//     (`getLegalTargets`), the accepted set (`applyOneTargetSelection`) and
//     the CR 608.2b resolution re-check.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition, EffectOp } from "../../cards/types";
import { lightningBolt } from "../../cards/sets/lea/red.cards";
import { ancestralRecall, counterspell } from "../../cards/sets/lea/blue.cards";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import {
    buildSpellContext,
    emitSpellCastEvent,
    resolveTopOfStack,
    type GameState,
} from "../state";
import { advancePhase, finalizeCleanup } from "../phases";
import { getLegalTargets, targetingSourceFromCard } from "../rules";
import { applyOneTargetSelection } from "../../game";
import { projectPublicState } from "../../gameProjections";
import { compactState, expandState } from "../serialize";
import { validateEffectScript } from "../effects/validate";

function freshState(): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [makePlayer("p1"), makePlayer("p2")],
    });
}

function sorcery(id: string, effects: EffectOp[]): CardDefinition {
    return {
        id,
        name: id,
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Sorcery"],
        oracleText: "",
        effects,
    };
}

/** Runs CR 514.2's turn-based action: "until end of turn" effects end. */
function runCleanup(state: GameState): void {
    state.phase = "CLEANUP";
    finalizeCleanup(state);
}

describe("spells you control can't be countered this turn (CR 611.2c / 101.2)", () => {
    function boardWithBearsAndCounterspell(): GameState {
        const state = freshState();
        // p1's Grizzly Bears on the stack, p2's Counterspell above it.
        const bears = pushSpell(state, grizzlyBears().id, "p1");
        pushSpell(state, counterspell().id, "p2", [
            { type: "spell", id: bears.id },
        ]);
        return state;
    }

    it("a counter aimed at the covered player's spell does nothing", () => {
        const state = boardWithBearsAndCounterspell();
        buildSpellContext(
            state,
            state.stack[0]!
        ).grantSpellCounterImmunityThisTurn("p1");
        resolveTopOfStack(state);
        expect(state.stack.map((s) => s.card.id)).toEqual([grizzlyBears().id]);
    });

    it("covers only the named player's spells", () => {
        const state = boardWithBearsAndCounterspell();
        buildSpellContext(
            state,
            state.stack[0]!
        ).grantSpellCounterImmunityThisTurn("p2");
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
    });

    it("covers a spell cast after the effect began (a rules-modifying effect)", () => {
        const state = freshState();
        state.spellCounterImmunityThisTurn = ["p1"];
        const bears = pushSpell(state, grizzlyBears().id, "p1");
        pushSpell(state, counterspell().id, "p2", [
            { type: "spell", id: bears.id },
        ]);
        resolveTopOfStack(state);
        expect(state.stack.map((s) => s.id)).toEqual([bears.id]);
    });

    it("ends at cleanup (CR 514.2)", () => {
        const state = freshState();
        state.spellCounterImmunityThisTurn = ["p1"];
        runCleanup(state);
        expect(state.spellCounterImmunityThisTurn).toBeUndefined();
    });

    it("survives a stable-point save within the turn", () => {
        const state = freshState();
        state.spellCounterImmunityThisTurn = ["p2"];
        expect(
            expandState(compactState(state)).spellCounterImmunityThisTurn
        ).toEqual(["p2"]);
    });
});

describe("colours of spells cast this turn (CR 601.2i / 202.2)", () => {
    const UB_SPELL: CardDefinition = {
        ...sorcery("test-cast-colours-ub", []),
        manaCost: { U: 1, B: 1 },
    };

    it("records each cast spell's colours, one entry per spell", () => {
        withTemporaryDefinition(UB_SPELL, () => {
            const state = freshState();
            emitSpellCastEvent(state, pushSpell(state, UB_SPELL.id, "p2"));
            emitSpellCastEvent(
                state,
                pushSpell(state, lightningBolt().id, "p2")
            );
            expect(state.players[1].spellColorsCastThisTurn).toEqual([
                ["U", "B"],
                ["R"],
            ]);
            expect(state.players[0].spellColorsCastThisTurn).toBeUndefined();
        });
    });

    it("resets at the start of the next turn", () => {
        const state = freshState();
        emitSpellCastEvent(state, pushSpell(state, lightningBolt().id, "p1"));
        state.stack = [];
        state.phase = "CLEANUP";
        advancePhase(state);
        expect(state.activePlayerId).toBe("p2");
        expect(state.players[0].spellColorsCastThisTurn).toBeUndefined();
    });

    it("survives a stable-point save within the turn", () => {
        const state = freshState();
        state.players[1].spellColorsCastThisTurn = [["U", "B"], []];
        expect(
            expandState(compactState(state)).players[1].spellColorsCastThisTurn
        ).toEqual([["U", "B"], []]);
    });

    it("counts a multicoloured spell once toward a colour list", () => {
        withTemporaryDefinition(UB_SPELL, () => {
            const state = freshState();
            emitSpellCastEvent(state, pushSpell(state, UB_SPELL.id, "p2"));
            const ctx = buildSpellContext(state, state.stack[0]!);
            expect(ctx.getSpellsCastThisTurn("p2", ["U", "B"])).toBe(1);
            expect(ctx.getSpellsCastThisTurn("p2", ["R"])).toBe(0);
            expect(ctx.getSpellsCastThisTurn("p2")).toBe(1);
        });
    });

    it("a spell counts when it is ANY listed colour; a colourless one never does", () => {
        const state = freshState();
        state.players[1].spellsCastThisTurn = 3;
        state.players[1].spellColorsCastThisTurn = [["U", "R"], [], ["G"]];
        pushSpell(state, lightningBolt().id, "p1");
        const ctx = buildSpellContext(state, state.stack[0]!);
        expect(ctx.getSpellsCastThisTurn("p2", ["U", "B"])).toBe(1);
        expect(ctx.getSpellsCastThisTurn("p2", ["W", "U", "B", "R", "G"])).toBe(
            2
        );
    });
});

describe("{ spellsCastThisTurn: { of, colors } } EffectValue (CR 601.2i)", () => {
    /** "Draw a card if an opponent has cast a blue or black spell this turn." */
    const PROBE = sorcery("test-spells-cast-probe", [
        {
            op: "if",
            predicate: {
                left: {
                    spellsCastThisTurn: { of: "opponent", colors: ["U", "B"] },
                },
                op: "ge",
                right: 1,
            },
            then: [{ op: "draw", player: "controller", count: 1 }],
        },
    ]);

    function withLibrary(state: GameState): GameState {
        state.players[0].library = [
            makeInstance(grizzlyBears().id, {
                id: "top",
                controllerId: "p1",
                ownerId: "p1",
            }),
        ];
        return state;
    }

    it("takes the branch once the opponent cast a spell of a listed colour", () => {
        withTemporaryDefinition(PROBE, () => {
            const state = withLibrary(freshState());
            emitSpellCastEvent(
                state,
                pushSpell(state, ancestralRecall().id, "p2")
            );
            state.stack = [];
            pushSpell(state, PROBE.id, "p1");
            resolveTopOfStack(state);
            expect(state.players[0].hand.map((c) => c.id)).toEqual(["top"]);
        });
    });

    it("skips it for a spell of another colour", () => {
        withTemporaryDefinition(PROBE, () => {
            const state = withLibrary(freshState());
            emitSpellCastEvent(
                state,
                pushSpell(state, lightningBolt().id, "p2")
            );
            state.stack = [];
            pushSpell(state, PROBE.id, "p1");
            resolveTopOfStack(state);
            expect(state.players[0].hand).toHaveLength(0);
        });
    });

    it("validates the colour list", () => {
        const script = (colors: unknown) =>
            sorcery("test-spells-cast-validate", [
                {
                    op: "draw",
                    player: "controller",
                    count: { spellsCastThisTurn: { of: "opponent", colors } },
                },
            ] as unknown as EffectOp[]);
        expect(validateEffectScript(script(["U", "B"]))).toEqual([]);
        expect(validateEffectScript(script([]))).not.toEqual([]);
        expect(validateEffectScript(script(["C"]))).not.toEqual([]);
        expect(validateEffectScript(script(["U", "U"]))).not.toEqual([]);
    });
});

describe("grantPlayerKeyword Op — a player's keywords until end of turn (CR 611.2a)", () => {
    function grant(keyword: string): CardDefinition {
        return sorcery(`test-grant-player-keyword-${keyword}`, [
            { op: "grantPlayerKeyword", player: "controller", keyword },
        ]);
    }

    /** p1 resolves a grant of `keyword`; returns the state. */
    function granted(keyword: string): GameState {
        const def = grant(keyword);
        return withTemporaryDefinition(def, () => {
            const state = freshState();
            pushSpell(state, def.id, "p1");
            resolveTopOfStack(state);
            return state;
        });
    }

    /** Is `targetId` in the set `caster`'s `cardId` spell may target? */
    function offered(
        state: GameState,
        cardId: string,
        caster: string,
        targetId: string
    ): boolean {
        const card = makeInstance(cardId, {
            id: "probe",
            controllerId: caster,
            ownerId: caster,
        });
        const requirement = (
            cardId === lightningBolt().id ? lightningBolt() : ancestralRecall()
        ).targetRequirement!;
        return getLegalTargets(
            state,
            requirement,
            targetingSourceFromCard(card, true),
            caster
        ).some((t) => t.type === "player" && t.id === targetId);
    }

    it("puts the keyword on the controller", () => {
        expect(
            granted("hexproof from blue").players[0].keywordsUntilEndOfTurn
        ).toEqual(["hexproof from blue"]);
    });

    it("hexproof from blue bars an opponent's blue spell, not a red one (CR 702.11d)", () => {
        const state = granted("hexproof from blue");
        expect(offered(state, ancestralRecall().id, "p2", "p1")).toBe(false);
        expect(offered(state, lightningBolt().id, "p2", "p1")).toBe(true);
    });

    it("hexproof bars an opponent's spell, never the player's own (CR 702.11c)", () => {
        const state = granted("hexproof");
        expect(offered(state, lightningBolt().id, "p2", "p1")).toBe(false);
        expect(offered(state, ancestralRecall().id, "p1", "p1")).toBe(true);
    });

    it("shroud bars the player's own spell too (CR 702.18a)", () => {
        const state = granted("shroud");
        expect(offered(state, ancestralRecall().id, "p1", "p1")).toBe(false);
    });

    it("the accepted set refuses what the offered set refuses", () => {
        const state = granted("hexproof from blue");
        const recall = makeInstance(ancestralRecall().id, {
            id: "recall",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].hand = [recall];
        state.pendingTarget = {
            playerId: "p2",
            cardInstanceId: recall.id,
            kind: "cast",
            targetType: "player",
            count: 1,
            selected: [],
        };
        expect(() =>
            applyOneTargetSelection(state, "p2", {
                targetType: "player",
                targetId: "p1",
            })
        ).toThrow("Target can't be the target of spells or abilities");
    });

    it("the accepted set still takes the player's own spell under hexproof (CR 702.11c)", () => {
        const state = granted("hexproof");
        const bolt = makeInstance(lightningBolt().id, {
            id: "own-bolt",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].hand = [bolt];
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: bolt.id,
            kind: "cast",
            targetType: "any",
            count: 1,
            selected: [],
        };
        expect(() =>
            applyOneTargetSelection(state, "p1", {
                targetType: "player",
                targetId: "p1",
            })
        ).not.toThrow("Target can't be the target of spells or abilities");
    });

    it("the player's own spell still resolves under their hexproof (CR 608.2b)", () => {
        const state = freshState();
        pushSpell(state, lightningBolt().id, "p1", [
            { type: "player", id: "p1" },
        ]);
        state.players[0].keywordsUntilEndOfTurn = ["hexproof"];
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17);
    });

    it("gained in response, it counters the spell on resolution (CR 608.2b)", () => {
        const state = freshState();
        pushSpell(state, lightningBolt().id, "p2", [
            { type: "player", id: "p1" },
        ]);
        state.players[0].keywordsUntilEndOfTurn = ["hexproof from red"];
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });

    it("ends at cleanup (CR 514.2)", () => {
        const state = granted("shroud");
        runCleanup(state);
        expect(state.players[0].keywordsUntilEndOfTurn).toBeUndefined();
    });

    it("rides the public projection on the player (wire format)", () => {
        const state = granted("hexproof from black");
        const wire = projectPublicState(state, 1, "p2");
        expect(
            wire.players.find((p) => p.id === "p1")?.keywordsUntilEndOfTurn
        ).toEqual(["hexproof from black"]);
    });

    it("survives a stable-point save within the turn", () => {
        const state = granted("hexproof");
        expect(
            expandState(compactState(state)).players[0].keywordsUntilEndOfTurn
        ).toEqual(["hexproof"]);
    });

    it("validates the keyword — an unnamed quality is refused (fail-closed)", () => {
        const script = (keyword: string) =>
            sorcery("test-grant-player-keyword-validate", [
                { op: "grantPlayerKeyword", player: "controller", keyword },
            ]);
        expect(validateEffectScript(script("hexproof from blue"))).toEqual([]);
        expect(validateEffectScript(script("shroud"))).toEqual([]);
        expect(
            validateEffectScript(script("hexproof from artifacts"))
        ).not.toEqual([]);
        expect(validateEffectScript(script("flying"))).not.toEqual([]);
    });
});
