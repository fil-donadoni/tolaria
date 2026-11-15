// "if <you | an opponent> control(s) N or more <descriptor>" — the counted
// intervening-if (CR 603.4).
//
//  1. GRAMMAR — both subjects, the count word from one up, the plural noun
//     "or more" takes, and the neighbours the rule refuses.
//  2. COMPILE — Defense of the Heart (an opponent) compiled whole; "one or
//     more Eggs" pinned on a body that compiles (Palani's Hatcher still gaps
//     on its "sacrifice an Egg").
//  3. ENGINE — the opponent gate the compiled condition becomes, run against a
//     raw game state.

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
import type { OracleCard } from "../types";
import { oracleCard, parseContext } from "./oracle.fixture";

const DEFENSE_OF_THE_HEART_TEXT =
    "At the beginning of your upkeep, if an opponent controls three or more creatures, sacrifice this enchantment, search your library for up to two creature cards, put those cards onto the battlefield, then shuffle.";

const DEFENSE_OF_THE_HEART = oracleCard({
    name: "Defense of the Heart",
    manaCost: "{3}{G}",
    typeLine: "Enchantment",
    oracleText: DEFENSE_OF_THE_HEART_TEXT,
    power: undefined,
    toughness: undefined,
});

/** Palani's Hatcher's condition behind a body the compiler reads. */
const EGG_WATCHER_TEXT =
    "At the beginning of combat on your turn, if you control one or more Eggs, create a 3/3 green Dinosaur creature token.";

const EGG_WATCHER = oracleCard({
    name: "Egg Watcher",
    oracleText: EGG_WATCHER_TEXT,
});

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

describe("the counted controls condition (CR 603.4, CR 109.5, CR 102.2)", () => {
    it.each([
        [
            "if an opponent controls three or more creatures",
            {
                player: "opponent",
                filter: { types: ["Creature"] },
                atLeast: 3,
            },
        ],
        [
            "if you control one or more Eggs",
            { player: "you", filter: { subtypes: ["Egg"] }, atLeast: 1 },
        ],
    ])("reads %s with its subject", (span, expected) => {
        const parsed = read(span);
        expect(parsed.ok && parsed.value).toEqual({
            kind: "controls-at-least",
            ...expected,
        });
    });

    it.each([
        ["a singular noun after or more", "if you control one or more Egg"],
        [
            "a verb that does not agree with an opponent",
            "if an opponent control three or more creatures",
        ],
        [
            "a subject outside the two",
            "if a player controls three or more creatures",
        ],
        ["a count below one", "if you control zero or more creatures"],
        [
            "a supertype the gate cannot evaluate (CR 205.4a)",
            "if an opponent controls three or more legendary creatures",
        ],
        [
            "a controller clause inside the descriptor",
            "if an opponent controls three or more creatures you control",
        ],
    ])("refuses %s", (_what, span) => {
        expect(read(span).ok).toBe(false);
    });
});

describe("compiled whole", () => {
    it('"an opponent controls three or more creatures" (Defense of the Heart)', () => {
        expect(compiled(DEFENSE_OF_THE_HEART)).toEqual({
            name: "Defense of the Heart",
            types: ["Enchantment"],
            manaCost: { X: 3, G: 1 },
            oracleText: DEFENSE_OF_THE_HEART_TEXT,
            compiledTriggeredAbilities: [
                {
                    id: "defense-of-the-heart-trigger",
                    oracleText: DEFENSE_OF_THE_HEART_TEXT,
                    head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                    condition: {
                        kind: "controls",
                        player: "opponent",
                        filter: { types: ["Creature"] },
                        atLeast: 3,
                    },
                    effects: [
                        { op: "sacrifice", target: { ref: "$source" } },
                        {
                            op: "choice",
                            kind: "search-library",
                            player: "controller",
                            zone: "library",
                            filter: { type: "Creature" },
                            count: { min: 0, max: 2 },
                            prompt: "Search your library for up to two creature cards.",
                            bind: "$found1",
                        },
                        {
                            op: "moveZone",
                            cards: { ref: "$found1" },
                            player: "controller",
                            from: "library",
                            to: "battlefield",
                        },
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: "controller",
                        },
                    ],
                },
            ],
        });
    });

    it('"you control one or more Eggs" lowers to the singular count', () => {
        expect(compiled(EGG_WATCHER)).toEqual({
            name: "Egg Watcher",
            types: ["Creature"],
            subtypes: ["Bear"],
            manaCost: { X: 1, G: 1 },
            power: 2,
            toughness: 2,
            oracleText: EGG_WATCHER_TEXT,
            compiledTriggeredAbilities: [
                {
                    id: "egg-watcher-trigger",
                    oracleText: EGG_WATCHER_TEXT,
                    head: {
                        kind: "phase",
                        phase: "BEGINNING_OF_COMBAT",
                        scope: "your",
                    },
                    condition: {
                        kind: "controls",
                        filter: { subtypes: ["Egg"] },
                        atLeast: 1,
                    },
                    effects: [
                        {
                            op: "createToken",
                            token: {
                                name: "Dinosaur",
                                types: ["Creature"],
                                subtypes: ["Dinosaur"],
                                power: 3,
                                toughness: 3,
                                colors: ["G"],
                            },
                            controller: "controller",
                        },
                    ],
                },
            ],
        });
    });
});

/**
 * Defense of the Heart's compiled gate, asked against a raw game state where
 * p1 controls the source plus `mine` creatures and p2 controls `theirs`.
 */
function gateOn(mine: number, theirs: number): boolean {
    const definition = {
        ...compiled(DEFENSE_OF_THE_HEART),
        id: "compiled-defense-of-the-heart-5273",
        rarity: "rare" as const,
    };
    const bears = (controllerId: "p1" | "p2", n: number): CardInstanceState[] =>
        Array.from({ length: n }, () =>
            makeInstance(getCardByName("Grizzly Bears").id, { controllerId })
        );
    return withTemporaryDefinition(definition, () => {
        const self = makeInstance(definition.id, { id: "source" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [self, ...bears("p1", mine)] }),
                makePlayer("p2", { battlefield: bears("p2", theirs) }),
            ],
        });
        const ability = resolveCompiledTrigger(
            definition.compiledTriggeredAbilities![0]!
        );
        return ability.interveningIf!(
            { type: "PHASE_BEGIN", phase: "UPKEEP", playerId: "p1" } as never,
            self as unknown as PermanentView,
            state as unknown as TriggerStateView
        );
    });
}

describe("the opponent gate (CR 603.4, CR 102.2)", () => {
    it("holds once the opponent controls three creatures", () => {
        expect(gateOn(0, 2)).toBe(false);
        expect(gateOn(0, 3)).toBe(true);
        expect(gateOn(0, 4)).toBe(true);
    });

    it("never counts the controller's own creatures (CR 109.5)", () => {
        expect(gateOn(3, 0)).toBe(false);
        expect(gateOn(5, 2)).toBe(false);
    });
});
