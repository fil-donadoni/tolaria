// The `grantSpellCounterImmunity` Op (CR 611.2c / 101.2) — "Spells you control
// can't be countered this turn" — and the Effect Script the Oracle compiler
// emits for the line that prints it beside a trailing cast gate and a
// "You and permanents you control" grant:
//
//  1. the Op lists its player on `GameState.spellCounterImmunityThisTurn`, so
//     a later counter aimed at that player's spell does nothing, and an
//     opponent's spell stays counterable;
//  2. inside the compiled script, the `if` over `spellsCastThisTurn` (CR
//     601.2i) draws only when an opponent cast a spell of a listed colour,
//     while the immunity and the grants happen either way;
//  3. the permanents the controller controls as the spell resolves gain
//     hexproof from blue (CR 611.2c, 702.11d): an opponent's blue spell can't
//     target them, a red one can;
//  4. the immunity rides the public projection (wire format).
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
import {
    ancestralRecall,
    counterspell,
    unsummon,
} from "../../cards/sets/lea/blue.cards";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import {
    emitSpellCastEvent,
    resolveTopOfStack,
    type GameState,
} from "../state";
import { getLegalTargets, targetingSourceFromCard } from "../rules";
import { projectPublicState } from "../../gameProjections";
import { validateEffectScript } from "../effects/validate";

function freshState(): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [makePlayer("p1"), makePlayer("p2")],
    });
}

function instant(id: string, effects: EffectOp[]): CardDefinition {
    return {
        id,
        name: id,
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Instant"],
        oracleText: "",
        effects,
    };
}

const IMMUNITY = instant("test-grant-spell-counter-immunity", [
    { op: "grantSpellCounterImmunity", player: "controller" },
]);

/** The script the compiler emits for "Draw a card if an opponent has cast a
 *  blue or black spell this turn. Spells you control can't be countered this
 *  turn. You and permanents you control gain hexproof from blue and from black
 *  until end of turn." (`convex/oracle/__tests__/trailingGate.test.ts`). */
const COMPILED_LINE = instant("test-cast-gated-counter-immunity-line", [
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
    { op: "grantSpellCounterImmunity", player: "controller" },
    {
        op: "grantPlayerKeyword",
        player: "controller",
        keyword: "hexproof from blue",
    },
    {
        op: "grantPlayerKeyword",
        player: "controller",
        keyword: "hexproof from black",
    },
    {
        op: "forEach",
        select: {
            set: "permanents",
            zone: "battlefield",
            controller: "controller",
        },
        effects: [
            {
                op: "grantAbility",
                target: { ref: "$each" },
                ability: "hexproof from blue",
                duration: { phase: "end-of-turn" },
            },
            {
                op: "grantAbility",
                target: { ref: "$each" },
                ability: "hexproof from black",
                duration: { phase: "end-of-turn" },
            },
        ],
    },
]);

/** p1 resolves `def`; returns the state. */
function resolved(def: CardDefinition, setup?: (s: GameState) => void) {
    return withTemporaryDefinition(def, () => {
        const state = freshState();
        setup?.(state);
        pushSpell(state, def.id, "p1");
        resolveTopOfStack(state);
        return state;
    });
}

/** `caster`'s Counterspell aimed at `owner`'s Grizzly Bears, resolved. */
function counterBears(state: GameState, owner: string, caster: string) {
    const bears = pushSpell(state, grizzlyBears().id, owner);
    pushSpell(state, counterspell().id, caster, [
        { type: "spell", id: bears.id },
    ]);
    resolveTopOfStack(state);
    return state.stack.map((s) => s.id).includes(bears.id);
}

describe("grantSpellCounterImmunity Op (CR 611.2c / 101.2)", () => {
    it("lists the controller for the rest of the turn", () => {
        expect(resolved(IMMUNITY).spellCounterImmunityThisTurn).toEqual(["p1"]);
    });

    it("a counter aimed at the controller's later spell does nothing", () => {
        expect(counterBears(resolved(IMMUNITY), "p1", "p2")).toBe(true);
    });

    it("an opponent's spell stays counterable", () => {
        expect(counterBears(resolved(IMMUNITY), "p2", "p1")).toBe(false);
    });

    it("validates a player and nothing else", () => {
        const script = (op: unknown) =>
            instant("test-grant-spell-counter-immunity-validate", [
                op,
            ] as EffectOp[]);
        expect(
            validateEffectScript(
                script({ op: "grantSpellCounterImmunity", player: "opponent" })
            )
        ).toEqual([]);
        expect(
            validateEffectScript(script({ op: "grantSpellCounterImmunity" }))
        ).not.toEqual([]);
        expect(
            validateEffectScript(
                script({
                    op: "grantSpellCounterImmunity",
                    player: "controller",
                    spells: { types: ["Creature"] },
                })
            )
        ).not.toEqual([]);
    });

    it("rides the public projection (wire format)", () => {
        const wire = projectPublicState(resolved(IMMUNITY), 1, "p2");
        expect(wire.spellCounterImmunityThisTurn).toEqual(["p1"]);
    });
});

describe("the compiled cast-gated line (CR 608.2c / 601.2i / 611.2c)", () => {
    function withLibraryAndBears(state: GameState): void {
        state.players[0].library = [
            makeInstance(grizzlyBears().id, {
                id: "top",
                controllerId: "p1",
                ownerId: "p1",
            }),
        ];
        state.players[0].battlefield = [
            makeInstance(grizzlyBears().id, {
                id: "bears",
                controllerId: "p1",
                ownerId: "p1",
            }),
        ];
    }

    /** p2 cast `cardId` this turn, then p1 resolves the line. */
    function afterOpponentCast(cardId: string): GameState {
        return resolved(COMPILED_LINE, (state) => {
            withLibraryAndBears(state);
            emitSpellCastEvent(state, pushSpell(state, cardId, "p2"));
            state.stack = [];
        });
    }

    /** May `caster`'s `cardId` spell target p1's Bears? */
    function bearsOffered(state: GameState, cardId: string): boolean {
        const card = makeInstance(cardId, {
            id: "probe",
            controllerId: "p2",
            ownerId: "p2",
        });
        const requirement = (
            cardId === lightningBolt().id ? lightningBolt() : unsummon()
        ).targetRequirement!;
        return getLegalTargets(
            state,
            requirement,
            targetingSourceFromCard(card, true),
            "p2"
        ).some((t) => t.id === "bears");
    }

    it("draws once an opponent cast a blue spell this turn", () => {
        const state = afterOpponentCast(ancestralRecall().id);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["top"]);
    });

    it("draws nothing after a red spell, but still grants the immunity", () => {
        const state = afterOpponentCast(lightningBolt().id);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.spellCounterImmunityThisTurn).toEqual(["p1"]);
        expect(state.players[0].keywordsUntilEndOfTurn).toEqual([
            "hexproof from blue",
            "hexproof from black",
        ]);
    });

    it("the permanents gain hexproof from blue: a blue spell can't target them, a red one can (CR 702.11d)", () => {
        const state = afterOpponentCast(lightningBolt().id);
        expect(bearsOffered(state, unsummon().id)).toBe(false);
        expect(bearsOffered(state, lightningBolt().id)).toBe(true);
    });
});
