// "<player> controls more <type> than <you | each other player>" (CR 603.4,
// CR 608.2c, CR 109.5): the comparative member of the CONDITION sub-grammar.
//
//  1. GRAMMAR — the accepted subjects and baselines, and the neighbours the
//     rule refuses rather than guesses at.
//  2. TRIGGER — the compiled intervening-if, run through the real gate: a
//     strict comparison, a tie fails, "that player" is the head's player.
//  3. SPELL — a leading "If an opponent controls more …," gating a resolving
//     spell, decided at resolution.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import { withTemporaryDefinition } from "../../cards/registry";
import type {
    CardDefinition,
    PermanentView,
    TriggerStateView,
} from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import { conditionRule } from "../grammar/shared/condition";
import type { OracleCard } from "../types";
import { oracleCard, parseContext } from "./oracle.fixture";

function compiled(card: OracleCard): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition as CardDefinition;
}

const card = (name: string) => getCardByName(name).id;

describe("grammar (CR 603.4)", () => {
    it.each([
        ["an opponent controls more lands than you", "opponent", "you"],
        [
            "that player controls more lands than each other player",
            "that-player",
            "each-other-player",
        ],
        [
            "a player controls more creatures than each other player",
            "any-player",
            "each-other-player",
        ],
    ])("reads %s", (clause, subject, than) => {
        const parsed = conditionRule.run(`if ${clause}`, parseContext());
        expect(parsed.ok && parsed.value).toMatchObject({
            kind: "controls-more",
            subject,
            than,
        });
    });

    it("reads a subtype count (Thoughtbound Primoc's Wizards)", () => {
        const parsed = conditionRule.run(
            "if a player controls more Wizards than each other player",
            parseContext()
        );
        expect(parsed.ok && parsed.value).toMatchObject({
            filter: { subtypes: ["Wizard"] },
        });
    });

    it.each([
        ["a singular noun", "if an opponent controls more land than you"],
        [
            "an opponent against every other player",
            "if an opponent controls more lands than each other player",
        ],
        ["a player against you", "if a player controls more lands than you"],
        [
            "an unreadable noun",
            "if an opponent controls more frobnitzes than you",
        ],
        ["a different baseline", "if an opponent controls more lands than me"],
    ])("refuses %s", (_what, span) => {
        expect(conditionRule.run(span, parseContext()).ok).toBe(false);
    });
});

describe("the trigger gate (CR 603.4, CR 109.5)", () => {
    function gate(oracleText: string, event: object) {
        const def = {
            ...compiled(
                oracleCard({
                    oracleId: "00000000-0000-0000-0000-000000005257",
                    name: "Compared Source",
                    manaCost: "{W}",
                    typeLine: "Enchantment",
                    oracleText,
                    power: undefined,
                    toughness: undefined,
                })
            ),
            id: "compared-source-5257",
            rarity: "common" as const,
        };
        const ability = resolveCompiledTrigger(
            def.compiledTriggeredAbilities![0]!
        );
        return (lands: Record<string, number>) =>
            withTemporaryDefinition(def, () => {
                const source = makeInstance(def.id, { id: "src" });
                const state = makeState({
                    players: Object.entries(lands).map(([id, n]) =>
                        makePlayer(id, {
                            battlefield: [
                                ...(id === "p1" ? [source] : []),
                                ...Array.from({ length: n }, (_, i) =>
                                    makeInstance(card("Forest"), {
                                        id: `${id}-land-${i}`,
                                    })
                                ),
                            ],
                        })
                    ),
                });
                return ability.interveningIf!(
                    event as never,
                    source as unknown as PermanentView,
                    state as unknown as TriggerStateView
                );
            });
    }

    const UPKEEP = { type: "PHASE_BEGIN", phase: "UPKEEP" };

    it("an opponent with strictly more lands opens it; a tie does not", () => {
        const holds = gate(
            "At the beginning of your upkeep, if an opponent controls more lands than you, you gain 1 life.",
            { ...UPKEEP, activePlayerId: "p1" }
        );
        expect(holds({ p1: 1, p2: 2 })).toBe(true);
        expect(holds({ p1: 2, p2: 2 })).toBe(false);
        expect(holds({ p1: 3, p2: 2 })).toBe(false);
    });

    it("counts only the matching type", () => {
        const holds = gate(
            "At the beginning of your upkeep, if an opponent controls more creatures than you, you gain 1 life.",
            { ...UPKEEP, activePlayerId: "p1" }
        );
        expect(holds({ p1: 0, p2: 5 })).toBe(false);
    });

    it("'that player' is the upkeep's player, beaten by EVERY other player", () => {
        const text =
            "At the beginning of each player's upkeep, if that player controls more lands than each other player, you gain 1 life.";
        const p1Turn = gate(text, { ...UPKEEP, activePlayerId: "p1" });
        const p2Turn = gate(text, { ...UPKEEP, activePlayerId: "p2" });
        expect(p1Turn({ p1: 3, p2: 2, p3: 1 })).toBe(true);
        expect(p1Turn({ p1: 3, p2: 3, p3: 1 })).toBe(false);
        expect(p2Turn({ p1: 3, p2: 2, p3: 1 })).toBe(false);
    });

    it("'a player … than each other player' needs a sole leader", () => {
        const holds = gate(
            "At the beginning of your upkeep, if a player controls more lands than each other player, you gain 1 life.",
            { ...UPKEEP, activePlayerId: "p1" }
        );
        expect(holds({ p1: 1, p2: 3, p3: 2 })).toBe(true);
        expect(holds({ p1: 3, p2: 3, p3: 2 })).toBe(false);
    });

    it("fails closed when the event names no player", () => {
        const holds = gate(
            "At the beginning of each player's upkeep, if that player controls more lands than each other player, you gain 1 life.",
            { type: "PHASE_BEGIN", phase: "UPKEEP" }
        );
        expect(holds({ p1: 5, p2: 1 })).toBe(false);
    });

    it("refuses 'that player' behind a head that names no player", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Unbound",
                manaCost: "{W}",
                typeLine: "Enchantment",
                oracleText:
                    "At the beginning of your upkeep, if that player controls more lands than each other player, you gain 1 life.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("a spell's leading comparison (CR 608.2c)", () => {
    const spell = {
        ...compiled(
            oracleCard({
                oracleId: "00000000-0000-0000-0000-000000005258",
                name: "Compared Spell",
                manaCost: "{W}",
                typeLine: "Sorcery",
                oracleText:
                    "If an opponent controls more creatures than you, you gain 4 life.",
                power: undefined,
                toughness: undefined,
            })
        ),
        id: "compared-spell-5257",
        rarity: "common" as const,
    };

    function lifeGained(mine: number, theirs: number): number {
        return withTemporaryDefinition(spell, () => {
            const bears = (owner: string, n: number) =>
                Array.from({ length: n }, (_, i) =>
                    makeInstance(card("Grizzly Bears"), {
                        id: `${owner}-${i}`,
                    })
                );
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        life: 20,
                        battlefield: bears("a", mine),
                    }),
                    makePlayer("p2", { battlefield: bears("b", theirs) }),
                ],
            });
            pushSpell(state, spell.id, "p1");
            resolveTopOfStack(state);
            return state.players[0]!.life - 20;
        });
    }

    it("does its effect only when the opponent has strictly more", () => {
        expect(lifeGained(1, 2)).toBe(4);
        expect(lifeGained(2, 2)).toBe(0);
        expect(lifeGained(3, 2)).toBe(0);
    });
});
