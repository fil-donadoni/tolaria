// "if no mana was spent to cast it" — the intervening-if of a cast trigger that
// reads how the triggering spell was paid (CR 601.2h, CR 603.4; issue #8591).
//
//  1. GRAMMAR — `conditionRule` reads the clause; its neighbours are refused.
//  2. GOLDEN — Vexing Bauble compiled whole.
//  3. REFUSALS — the clause behind a head that introduced no spell cast.
//  4. ENGINE — the gate reads `SpellCastEvent.manaSpentToCast` and fails
//     closed on an event that does not carry it; the Cast Commit stamps the
//     count, so a free cast is countered and a paid one is not.

import { describe, expect, it } from "vitest";
import { getCardByName, getDefinition } from "../../cards";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import type {
    CompiledTriggeredAbility,
    PermanentView,
    SpellCastEvent,
    TriggerStateView,
} from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { commitCast, type CastCommitPlan } from "../../gre/castCommit";
import { resolveTopOfStack, type GameState } from "../../gre/state";
import { compileCard } from "../compile";
import { conditionRule } from "../grammar/shared/condition";
import type { OracleCard } from "../types";
import { parseContext } from "./oracle.fixture";

const read = (span: string) => conditionRule.run(span, parseContext());

const VEXING_BAUBLE: OracleCard = {
    oracleId: "4514777d-0589-4631-978b-ff244167c176",
    name: "Vexing Bauble",
    manaCost: "{1}",
    typeLine: "Artifact",
    oracleText:
        "Whenever a player casts a spell, if no mana was spent to cast it, counter that spell.\n{1}, {T}, Sacrifice this artifact: Draw a card.",
    layout: "normal",
};

const TRIGGER_LINE =
    "Whenever a player casts a spell, if no mana was spent to cast it, counter that spell.";

describe("no-mana-spent-to-cast condition (CR 601.2h, CR 603.4)", () => {
    it("reads 'if no mana was spent to cast it'", () => {
        const parsed = read("if no mana was spent to cast it");
        expect(parsed.ok && parsed.value).toEqual({
            kind: "no-mana-spent-to-cast",
        });
    });

    it("refuses the neighbours: a positive count, a colour, another referent", () => {
        for (const span of [
            "if mana was spent to cast it",
            "if no mana was spent to cast this spell",
            "if no mana was spent to cast them",
            "if {R} was spent to cast it",
            "if no red mana was spent to cast it",
            "if it wasn't cast or no mana was spent to cast it",
        ])
            expect(read(span).ok, span).toBe(false);
    });
});

describe("golden fixture (CR 601.2h, CR 603.4)", () => {
    it("Vexing Bauble — a cast trigger gated on no mana spent", () => {
        const outcome = compileCard(VEXING_BAUBLE);
        expect(outcome.state).toBe("ready");
        expect(outcome.state !== "unparsed" && outcome.definition).toEqual({
            name: "Vexing Bauble",
            types: ["Artifact"],
            manaCost: { X: 1 },
            oracleText: VEXING_BAUBLE.oracleText,
            activatedAbilities: [
                {
                    id: "vexing-bauble-ability",
                    oracleText:
                        "{1}, {T}, Sacrifice this artifact: Draw a card.",
                    cost: { mana: { X: 1 }, tap: true, sacrifice: true },
                    useStack: true,
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
            compiledTriggeredAbilities: [
                {
                    id: "vexing-bauble-trigger",
                    oracleText: TRIGGER_LINE,
                    head: { kind: "spell-cast", scope: "any" },
                    condition: { kind: "no-mana-spent-to-cast" },
                    effects: [
                        { op: "counter", target: { ref: "$event.spell" } },
                    ],
                },
            ],
        });
    });
});

describe("refusals — 'it' needs a head that introduced the spell", () => {
    it.each([
        "At the beginning of your upkeep, if no mana was spent to cast it, draw a card.",
        "When this creature enters, if no mana was spent to cast it, draw a card.",
    ])("%s", (oracleText) => {
        const outcome = compileCard({
            ...VEXING_BAUBLE,
            name: "Probe Bauble",
            oracleText,
        });
        expect(outcome.state).toBe("unparsed");
    });
});

describe("the compiled gate reads the cast's mana count (CR 601.2h)", () => {
    const descriptor: CompiledTriggeredAbility = {
        id: "probe-no-mana-spent",
        oracleText: "probe",
        head: { kind: "spell-cast", scope: "any" },
        condition: { kind: "no-mana-spent-to-cast" },
        effects: [],
    } as never;

    function gateWith(manaSpentToCast: number | undefined): boolean {
        const source = makeInstance(getCardByName("Vexing Bauble").id, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        const event: SpellCastEvent = {
            type: "SPELL_CAST",
            casterId: "p2",
            spellInstanceId: "spell",
            spellCardId: "x",
            spellTypes: ["Creature"],
            spellSubtypes: [],
            spellColors: [],
            ...(manaSpentToCast !== undefined ? { manaSpentToCast } : {}),
        };
        const ability = resolveCompiledTrigger(descriptor);
        return ability.interveningIf!(
            event,
            source as unknown as PermanentView,
            state as unknown as TriggerStateView
        );
    }

    it("opens on zero, shuts on any mana and on an event without the count", () => {
        expect(gateWith(0)).toBe(true);
        expect(gateWith(1)).toBe(false);
        // An emitter that cannot say (a hand-built event, the Bot's search
        // cast) never reads as "no mana".
        expect(gateWith(undefined)).toBe(false);
    });
});

describe("full path: Cast Commit → SPELL_CAST → Vexing Bauble (CR 601.2h, CR 603.4)", () => {
    /** Vexing Bauble on p1's battlefield; p2 holds Grizzly Bears with `pool`
     *  floating and casts it. */
    function position(pool: Record<string, number>): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(getCardByName("Vexing Bauble").id, {
                            id: "bauble",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    hand: [
                        makeInstance(getCardByName("Grizzly Bears").id, {
                            id: "spell",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                    manaPool: pool,
                }),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            phase: "PRECOMBAT_MAIN",
        });
    }

    function cast(state: GameState, manaCost: Record<string, number>) {
        const plan: CastCommitPlan = {
            casterId: "p2",
            cardInstanceId: "spell",
            cardDef: getDefinition(getCardByName("Grizzly Bears").id),
            manaCost,
            source: { zone: "hand" },
            legs: {},
            record: {},
            mode: {},
            placement: { kind: "announce" },
        };
        expect(commitCast(state, plan)).not.toBeNull();
    }

    it("a spell cast without paying its mana cost is countered", () => {
        const state = position({});
        cast(state, {});
        // CR 603.3 — the trigger sits on the stack above the spell.
        expect(state.stack.map((s) => s.id)).toHaveLength(2);
        expect(state.stack[0]!.id).toBe("spell");
        resolveTopOfStack(state);
        expect(state.stack.some((s) => s.id === "spell")).toBe(false);
        expect(state.players[1]!.graveyard.some((c) => c.id === "spell")).toBe(
            true
        );
    });

    it("a spell paid with mana does not trigger it", () => {
        const state = position({ G: 1, C: 1 });
        cast(state, { G: 1, X: 1 });
        expect(state.stack.map((s) => s.id)).toEqual(["spell"]);
    });
});
