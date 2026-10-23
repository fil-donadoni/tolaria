// "if <player> control(s) no <descriptor>" — the negated controls condition
// (issue #5274, CR 603.4).
//
//  1. GRAMMAR — the three subjects (you / defending player / a player), the
//     verb agreeing with each, the plural noun "no" takes, and the
//     "nontoken" adjective (CR 111.1) the reader learned for Spectral Bears.
//  2. COMPILE — one card per subject compiled whole: Ophiomancer (you) is a
//     real card; the defending-player and a-player bodies in the corpus still
//     gap elsewhere, so their form is pinned on a body that compiles.
//  3. LOWERING — "defending player" refused behind a head that names none.
//  4. ENGINE — the gate the compiled condition becomes, run against a raw
//     game state for each subject.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import { withTemporaryDefinition } from "../../cards/registry";
import type {
    CardDefinition,
    PermanentView,
    TriggerStateView,
} from "../../cards/types";
import type { CardInstanceState } from "../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { compileCard } from "../compile";
import { conditionRule } from "../grammar/shared/condition";
import {
    descriptorRule,
    permanentFilterFromDescriptor,
    sacrificeFilterFromDescriptor,
    staticFilterFromDescriptor,
    targetRequirementFromDescriptor,
} from "../grammar/shared/targetFilter";
import type { OracleCard } from "../types";
import { oracleCard, parseContext } from "./oracle.fixture";

const PERMANENT_TYPES = [
    "Artifact",
    "Battle",
    "Creature",
    "Enchantment",
    "Land",
    "Planeswalker",
];

function compiled(card: OracleCard): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition as CardDefinition;
}

function read(span: string) {
    return conditionRule.run(span, parseContext());
}

describe("the three subjects (CR 603.4, CR 109.5, CR 506.2, CR 102.1)", () => {
    it.each([
        [
            "if you control no Goblins",
            { player: "you", filter: { subtypes: ["Goblin"] } },
        ],
        [
            "if defending player controls no Walls",
            { player: "defending-player", filter: { subtypes: ["Wall"] } },
        ],
        [
            "if a player controls no creatures",
            { player: "a-player", filter: { types: ["Creature"] } },
        ],
    ])("reads %s as a zero count", (span, expected) => {
        const parsed = read(span);
        expect(parsed.ok && parsed.value).toEqual({
            kind: "controls",
            ...expected,
            atMost: 0,
        });
    });

    it.each([
        ["a verb that does not agree with you", "if you controls no Goblins"],
        [
            "a verb that does not agree with a player",
            "if a player control no creatures",
        ],
        ["a singular noun after no", "if you control no Goblin"],
        ["a descriptor the reader cannot parse", "if you control no Clues"],
        [
            "a supertype the gate cannot evaluate (CR 205.4a)",
            "if you control no legendary creatures",
        ],
        ["a subject outside the three", "if an opponent controls no Walls"],
    ])("refuses %s", (_what, span) => {
        expect(read(span).ok).toBe(false);
    });
});

describe('"nontoken" in a descriptor (CR 111.1)', () => {
    it("reads it beside a colour and becomes isToken: false", () => {
        const parsed = read(
            "if defending player controls no black nontoken permanents"
        );
        expect(parsed.ok && parsed.value).toEqual({
            kind: "controls",
            player: "defending-player",
            filter: { types: PERMANENT_TYPES, colors: ["B"], isToken: false },
            atMost: 0,
        });
    });

    it("refuses it twice", () => {
        expect(
            descriptorRule.run("nontoken nontoken creature", parseContext()).ok
        ).toBe(false);
    });

    it("refuses it on a player", () => {
        expect(descriptorRule.run("nontoken player", parseContext()).ok).toBe(
            false
        );
    });

    it("refuses it at every site that does not read it, rather than dropping it", () => {
        const descriptor = descriptorRule.run(
            "nontoken creature",
            parseContext()
        );
        expect(descriptor.ok).toBe(true);
        if (!descriptor.ok) return;
        expect(targetRequirementFromDescriptor(descriptor.value).ok).toBe(
            false
        );
        expect(sacrificeFilterFromDescriptor(descriptor.value).ok).toBe(false);
        expect(
            staticFilterFromDescriptor(descriptor.value, "recomputed").ok
        ).toBe(false);
        expect(permanentFilterFromDescriptor(descriptor.value)).toEqual({
            ok: true,
            value: { types: ["Creature"], isToken: false },
        });
    });
});

const OPHIOMANCER: OracleCard = {
    oracleId: "55eca80c-dcd8-4c2f-aa0f-fb0aec7b80f7",
    name: "Ophiomancer",
    manaCost: "{2}{B}",
    typeLine: "Creature — Human Shaman",
    oracleText:
        "At the beginning of each upkeep, if you control no Snakes, create a 1/1 black Snake creature token with deathtouch.",
    power: "2",
    toughness: "2",
    layout: "normal",
};

/** The defending-player form on a body that compiles. */
const NONTOKEN_ATTACKER = oracleCard({
    name: "Nontoken Watcher",
    oracleText:
        "Whenever this creature attacks, if defending player controls no black nontoken permanents, draw a card.",
});

/** The a-player form on a body that compiles. */
const EMPTY_BOARD_WATCHER = oracleCard({
    name: "Empty Board Watcher",
    typeLine: "Enchantment",
    power: undefined,
    toughness: undefined,
    oracleText:
        "At the beginning of your end step, if a player controls no creatures, draw a card.",
});

describe("compiled whole, one card per subject (CR 603.4)", () => {
    it("Ophiomancer — you control no Snakes", () => {
        const trigger = compiled(OPHIOMANCER).compiledTriggeredAbilities![0]!;
        expect(trigger.head).toEqual({
            kind: "phase",
            phase: "UPKEEP",
            scope: "each",
        });
        expect(trigger.condition).toEqual({
            kind: "controls",
            player: "you",
            filter: { subtypes: ["Snake"] },
            atMost: 0,
        });
    });

    it("defending player lowers to the attacking controller's opponent (CR 506.2)", () => {
        const trigger =
            compiled(NONTOKEN_ATTACKER).compiledTriggeredAbilities![0]!;
        expect(trigger.head).toEqual({ kind: "attacks" });
        expect(trigger.condition).toEqual({
            kind: "controls",
            player: "opponent",
            filter: { types: PERMANENT_TYPES, colors: ["B"], isToken: false },
            atMost: 0,
        });
    });

    it("a player lowers to any player", () => {
        const trigger =
            compiled(EMPTY_BOARD_WATCHER).compiledTriggeredAbilities![0]!;
        expect(trigger.condition).toEqual({
            kind: "controls",
            player: "any-player",
            filter: { types: ["Creature"] },
            atMost: 0,
        });
    });

    it('refuses "defending player" behind a head that names none (CR 506.2)', () => {
        const outcome = compileCard(
            oracleCard({
                oracleText:
                    "At the beginning of your upkeep, if defending player controls no Walls, draw a card.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

const card = (name: string) => getCardByName(name).id;

/**
 * The compiled gate of `source`'s first trigger, asked against a raw game
 * state where p1 controls the source (plus `mine`) and p2 controls `theirs`.
 */
function gateOn(
    source: OracleCard,
    mine: readonly CardInstanceState[],
    theirs: readonly CardInstanceState[]
): boolean {
    const definition = {
        ...compiled(source),
        id: `compiled-${source.name.toLowerCase().replace(/ /g, "-")}-5274`,
        rarity: "common" as const,
    };
    return withTemporaryDefinition(definition, () => {
        const self = makeInstance(definition.id, { id: "source" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [self, ...mine] }),
                makePlayer("p2", { battlefield: [...theirs] }),
            ],
        });
        const ability = resolveCompiledTrigger(
            definition.compiledTriggeredAbilities![0]!
        );
        // CR 508.1 — an attack head's gate reads the declaration that fired
        // it; every other head here is a phase head.
        const event =
            definition.compiledTriggeredAbilities![0]!.head.kind === "attacks"
                ? {
                      type: "ATTACKERS_DECLARED",
                      attackerIds: [self.id],
                      attackingPlayerId: "p1",
                  }
                : { type: "PHASE_BEGIN", phase: "UPKEEP", playerId: "p1" };
        return ability.interveningIf!(
            event as never,
            self as unknown as PermanentView,
            state as unknown as TriggerStateView
        );
    });
}

function permanent(
    name: string,
    controllerId: "p1" | "p2",
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(card(name), { controllerId, ...overrides });
}

describe("the gate, per subject (CR 603.4)", () => {
    it("you: counts the controller's Snakes only (CR 109.5)", () => {
        const snake = (controllerId: "p1" | "p2") =>
            permanent("Grizzly Bears", controllerId, { subtypes: ["Snake"] });
        expect(gateOn(OPHIOMANCER, [], [])).toBe(true);
        expect(gateOn(OPHIOMANCER, [snake("p1")], [])).toBe(false);
        expect(gateOn(OPHIOMANCER, [], [snake("p2")])).toBe(true);
    });

    it("defending player: the opponent's black nontoken permanents (CR 506.2, CR 111.1)", () => {
        const knight = permanent("Black Knight", "p2");
        const blackToken = permanent("Black Knight", "p2", { isToken: true });
        expect(gateOn(NONTOKEN_ATTACKER, [], [])).toBe(true);
        expect(gateOn(NONTOKEN_ATTACKER, [], [knight])).toBe(false);
        expect(gateOn(NONTOKEN_ATTACKER, [], [blackToken])).toBe(true);
        expect(
            gateOn(NONTOKEN_ATTACKER, [permanent("Black Knight", "p1")], [])
        ).toBe(true);
    });

    it("a player: holds when either player controls no creatures (CR 102.1)", () => {
        const bears = (controllerId: "p1" | "p2") =>
            permanent("Grizzly Bears", controllerId);
        expect(gateOn(EMPTY_BOARD_WATCHER, [bears("p1")], [bears("p2")])).toBe(
            false
        );
        expect(gateOn(EMPTY_BOARD_WATCHER, [bears("p1")], [])).toBe(true);
        expect(gateOn(EMPTY_BOARD_WATCHER, [], [bears("p2")])).toBe(true);
    });
});
