// Life gained or lost this turn (CR 119.3, CR 119.9, CR 603.4) — the Grammar
// Cluster of issue #10350.
//
//  1. GRAMMAR — the trigger heads "whenever you gain life" and "whenever you
//     gain or lose life during your turn", the intervening-if table over the
//     per-turn life tallies, and the static "enters with … if an opponent lost
//     life this turn" entry rider.
//  2. GOLDENS — one real corpus card per accepted form, compiled whole.
//  3. REFUSALS — the neighbours the rules must NOT read.
//  4. ENGINE — the rebuilt abilities fire on the right events, the
//     conditions read the live tallies, and the entry rider reads the board.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import { resolveEntersWithCounters } from "../../cards/entersWith";
import { getEventFieldRow } from "../../cards/eventFields";
import type {
    CompiledTriggeredAbility,
    GameEvent,
    PermanentView,
    TriggerStateView,
} from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { applyEntersWithCounters } from "../../gre/state";
import type { GameState } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { conditionRule } from "../grammar/shared/condition";
import type { OracleCard } from "../types";
import { parseContext } from "./oracle.fixture";

function card(
    name: string,
    oracleId: string,
    manaCost: string,
    typeLine: string,
    oracleText: string,
    pt?: [string, string]
): OracleCard {
    return {
        oracleId,
        name,
        manaCost,
        typeLine,
        oracleText,
        ...(pt !== undefined ? { power: pt[0], toughness: pt[1] } : {}),
        layout: "normal",
    };
}

const AJANIS_PRIDEMATE = card(
    "Ajani's Pridemate",
    "95e94dea-5ac0-4d6f-adec-ca147aee861f",
    "{1}{W}",
    "Creature — Cat Soldier",
    "Whenever you gain life, put a +1/+1 counter on this creature.",
    ["2", "2"]
);
const SANGUINE_BOND = card(
    "Sanguine Bond",
    "73089a39-a2f6-4aa2-a058-e6551475153d",
    "{3}{B}{B}",
    "Enchantment",
    "Whenever you gain life, target opponent loses that much life."
);
const WAX_WANE_WITNESS = card(
    "Wax-Wane Witness",
    "426dbe89-0cbb-4a3b-8812-d9761d063373",
    "{3}{W}",
    "Creature — Bat Cleric",
    "Flying, vigilance\nWhenever you gain or lose life during your turn, this creature gets +1/+0 until end of turn.",
    ["2", "4"]
);
const FLAMECACHE_GECKO = card(
    "Flamecache Gecko",
    "d767463b-0fc9-43fc-a85f-e60f030f9b96",
    "{1}{R}",
    "Creature — Lizard Warlock",
    "When this creature enters, if an opponent lost life this turn, add {B}{R}.\n{1}{R}, Discard a card: Draw a card.",
    ["2", "2"]
);
const CINDERING_CUTTHROAT = card(
    "Cindering Cutthroat",
    "46e8bec0-1a09-4e6e-b78a-7ba161686ca9",
    "{2}{B/R}",
    "Creature — Lizard Assassin",
    "This creature enters with a +1/+1 counter on it if an opponent lost life this turn.\n{1}{B/R}: This creature gains menace until end of turn. (It can't be blocked except by two or more creatures.)",
    ["3", "2"]
);

function definitionOf(oracle: OracleCard) {
    const outcome = compileCard(oracle);
    expect(outcome.state, JSON.stringify(outcome)).toBe("ready");
    return outcome.state === "unparsed" ? undefined : outcome.definition;
}

/** The refusal reason, or null when the line compiled. */
function refusal(oracleText: string): string | null {
    const outcome = compileCard(
        card(
            "Test Card",
            "00000000-0000-0000-0000-000000000000",
            "{1}{G}",
            "Creature — Bear",
            oracleText,
            ["2", "2"]
        )
    );
    return outcome.state === "unparsed"
        ? (outcome.gaps[0]?.reason ?? "unparsed")
        : null;
}

const readCondition = (span: string) => conditionRule.run(span, parseContext());

describe("life-change trigger heads — goldens (CR 119.9, CR 119.3, CR 603.2)", () => {
    it("Ajani's Pridemate — whenever you gain life", () => {
        expect(sortKeys(definitionOf(AJANIS_PRIDEMATE))).toEqual(
            sortKeys({
                name: "Ajani's Pridemate",
                types: ["Creature"],
                subtypes: ["Cat", "Soldier"],
                manaCost: { X: 1, W: 1 },
                power: 2,
                toughness: 2,
                oracleText: AJANIS_PRIDEMATE.oracleText,
                compiledTriggeredAbilities: [
                    {
                        id: "ajani-s-pridemate-trigger",
                        oracleText: AJANIS_PRIDEMATE.oracleText,
                        head: { kind: "life-gained", scope: "you" },
                        effects: [
                            {
                                op: "counters",
                                action: "add",
                                counter: "+1/+1",
                                target: { ref: "$source" },
                                count: 1,
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("Sanguine Bond — 'that much' is the life gained", () => {
        const outcome = compileCard(SANGUINE_BOND);
        // The `$event.amount` smoke skip is cleared by its GOLDEN_FIXTURES row.
        expect(outcome.state).toBe("ready");
        expect(
            sortKeys(outcome.state === "unparsed" ? null : outcome.definition)
        ).toEqual(
            sortKeys({
                name: "Sanguine Bond",
                types: ["Enchantment"],
                manaCost: { X: 3, B: 2 },
                oracleText: SANGUINE_BOND.oracleText,
                compiledTriggeredAbilities: [
                    {
                        id: "sanguine-bond-trigger",
                        oracleText: SANGUINE_BOND.oracleText,
                        head: { kind: "life-gained", scope: "you" },
                        targetRequirement: {
                            type: "player",
                            count: 1,
                            controller: "opponent",
                        },
                        effects: [
                            {
                                op: "loseLife",
                                player: { target: 0 },
                                amount: { ref: "$event.amount" },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("Wax-Wane Witness — whenever you gain or lose life during your turn", () => {
        const text =
            "Whenever you gain or lose life during your turn, this creature gets +1/+0 until end of turn.";
        expect(sortKeys(definitionOf(WAX_WANE_WITNESS))).toEqual(
            sortKeys({
                name: "Wax-Wane Witness",
                types: ["Creature"],
                subtypes: ["Bat", "Cleric"],
                manaCost: { X: 3, W: 1 },
                power: 2,
                toughness: 4,
                oracleText: WAX_WANE_WITNESS.oracleText,
                staticAbilities: ["flying", "vigilance"],
                compiledTriggeredAbilities: [
                    {
                        id: "wax-wane-witness-trigger",
                        oracleText: text,
                        head: {
                            kind: "life-gained-or-lost",
                            scope: "you",
                            duringYourTurn: true,
                        },
                        effects: [
                            {
                                op: "pump",
                                target: { ref: "$source" },
                                power: 1,
                                toughness: 0,
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("life-changed-this-turn condition (CR 119.3, CR 603.4)", () => {
    it("reads the three printed tally phrases", () => {
        const read = (span: string) => {
            const parsed = readCondition(span);
            return parsed.ok ? parsed.value : null;
        };
        expect(read("if you gained or lost life this turn")).toEqual({
            kind: "life-changed-this-turn",
            player: "you",
            directions: ["gained", "lost"],
            combine: "any",
        });
        expect(read("if you gained and lost life this turn")).toEqual({
            kind: "life-changed-this-turn",
            player: "you",
            directions: ["gained", "lost"],
            combine: "all",
        });
        expect(read("if an opponent lost life this turn")).toEqual({
            kind: "life-changed-this-turn",
            player: "opponent",
            directions: ["lost"],
            combine: "any",
        });
    });

    it("refuses the neighbours: another player, another tense, a negation", () => {
        for (const span of [
            "if a player lost life this turn",
            "if you lost life this turn",
            "if an opponent gained life this turn",
            "if an opponent lost life last turn",
            "if no opponent lost life this turn",
            "if an opponent lost 2 or more life this turn",
        ])
            expect(readCondition(span).ok, span).toBe(false);
    });

    it("Flamecache Gecko — an entered trigger gated on an opponent's loss", () => {
        expect(sortKeys(definitionOf(FLAMECACHE_GECKO))).toEqual(
            sortKeys({
                name: "Flamecache Gecko",
                types: ["Creature"],
                subtypes: ["Lizard", "Warlock"],
                manaCost: { X: 1, R: 1 },
                power: 2,
                toughness: 2,
                oracleText: FLAMECACHE_GECKO.oracleText,
                activatedAbilities: [
                    {
                        id: "flamecache-gecko-ability",
                        oracleText: "{1}{R}, Discard a card: Draw a card.",
                        cost: {
                            mana: { X: 1, R: 1 },
                            discardFilter: { filter: {}, count: 1 },
                        },
                        useStack: true,
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                        ],
                    },
                ],
                compiledTriggeredAbilities: [
                    {
                        id: "flamecache-gecko-trigger",
                        oracleText:
                            "When this creature enters, if an opponent lost life this turn, add {B}{R}.",
                        head: { kind: "entered", scope: "self" },
                        condition: {
                            kind: "life-changed-this-turn",
                            player: "opponent",
                            directions: ["lost"],
                            combine: "any",
                        },
                        effects: [{ op: "addMana", mana: { B: 1, R: 1 } }],
                    },
                ],
            })
        );
    });
});

describe("enters with counters if an opponent lost life (CR 614.1c, CR 119.3)", () => {
    it("Cindering Cutthroat — the entry rider's count is gated on the tally", () => {
        expect(sortKeys(definitionOf(CINDERING_CUTTHROAT))).toEqual(
            sortKeys({
                name: "Cindering Cutthroat",
                types: ["Creature"],
                subtypes: ["Lizard", "Assassin"],
                manaCost: { X: 2, hybrid: [["B", "R"]] },
                power: 3,
                toughness: 2,
                oracleText: CINDERING_CUTTHROAT.oracleText,
                activatedAbilities: [
                    {
                        id: "cindering-cutthroat-ability",
                        oracleText:
                            "{1}{B/R}: This creature gains menace until end of turn.",
                        cost: { mana: { X: 1, hybrid: [["B", "R"]] } },
                        useStack: true,
                        effects: [
                            {
                                op: "grantAbility",
                                target: { ref: "$source" },
                                ability: "menace",
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                ],
                entersWith: {
                    counters: [
                        {
                            type: "+1/+1",
                            count: { ifOpponentLostLifeThisTurn: 1 },
                        },
                    ],
                },
            })
        );
    });
});

describe("refused neighbours stay unparsed (ADR 0105 § 2)", () => {
    it.each([
        // Another player's gain is another head.
        "Whenever an opponent gains life, you draw a card.",
        "Whenever a player gains life, you draw a card.",
        // Both directions without the turn restriction, and one direction
        // with it, are other heads.
        "Whenever you gain or lose life, this creature gets +1/+0 until end of turn.",
        "Whenever you lose life during your turn, this creature gets +1/+0 until end of turn.",
        // "that much" behind the two-event head names no one amount.
        "Whenever you gain or lose life during your turn, you gain that much life.",
        // The entry rider reads a printed count only, and only "an opponent".
        "This creature enters with X +1/+1 counters on it if an opponent lost life this turn.",
        "This creature enters with a +1/+1 counter on it if you lost life this turn.",
        // A static lock, a per-opponent count and a conditional keyword grant
        // need engine surfaces this cluster does not build.
        "Players can't gain life.",
        "Other creatures you control enter with an additional +1/+1 counter on them for each opponent who lost life this turn.",
        "As long as you've lost life this turn, this creature has flying and vigilance.",
        "{1}{R}: Put a +1/+1 counter on this creature. Activate only if an opponent lost life this turn and only once each turn.",
    ])("refuses %s", (text) => {
        expect(refusal(text)).not.toBeNull();
    });
});

// ── Engine ──────────────────────────────────────────────────────────────────

const SOURCE = makeInstance(getCardByName("Grizzly Bears")!.id, {
    id: "src",
    controllerId: "p1",
    ownerId: "p1",
});
const SELF = SOURCE as unknown as PermanentView;

function board(overrides: Partial<GameState> = {}): TriggerStateView {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [SOURCE] }),
            makePlayer("p2"),
        ],
        ...overrides,
    }) as unknown as TriggerStateView;
}

const gained = (playerId: string, amount = 2): GameEvent => ({
    type: "LIFE_GAINED",
    playerId,
    amount,
});
const lost = (playerId: string, amount = 2): GameEvent =>
    ({ type: "LIFE_LOST", playerId, amount, fromDamage: false }) as GameEvent;

function descriptor(
    over: Partial<CompiledTriggeredAbility>
): CompiledTriggeredAbility {
    return {
        id: "probe",
        oracleText: "probe",
        head: { kind: "life-gained", scope: "you" },
        effects: [],
        ...over,
    } as CompiledTriggeredAbility;
}

describe("the rebuilt life-change triggers (CR 119.9, CR 603.2)", () => {
    it("whenever you gain life: the controller's gain, never an opponent's or a loss", () => {
        const ability = resolveCompiledTrigger(descriptor({}));
        expect(ability.event).toBe("LIFE_GAINED");
        const view = board({ activePlayerId: "p2" });
        expect(ability.matches(gained("p1"), SELF, view)).toBe(true);
        expect(ability.matches(gained("p2"), SELF, view)).toBe(false);
        expect(ability.matches(lost("p1"), SELF, view)).toBe(false);
    });

    it("'that much' reads the amount the gain event carries", () => {
        const row = getEventFieldRow("LIFE_GAINED", "amount");
        expect(row?.family).toBe("number");
        expect(row?.resolve(gained("p1", 4))).toBe("4");
    });

    it("gain or lose during your turn: either change, only on the controller's turn", () => {
        const ability = resolveCompiledTrigger(
            descriptor({
                head: {
                    kind: "life-gained-or-lost",
                    scope: "you",
                    duringYourTurn: true,
                },
                maxTriggersPerTurn: 1,
            })
        );
        expect(ability.event).toEqual(["LIFE_GAINED", "LIFE_LOST"]);
        // CR 603.2h — "This ability triggers only once each turn".
        expect(ability.maxTriggersPerTurn).toBe(1);
        const mine = board({ activePlayerId: "p1" });
        const theirs = board({ activePlayerId: "p2" });
        expect(ability.matches(gained("p1"), SELF, mine)).toBe(true);
        expect(ability.matches(lost("p1"), SELF, mine)).toBe(true);
        expect(ability.matches(gained("p1"), SELF, theirs)).toBe(false);
        expect(ability.matches(lost("p1"), SELF, theirs)).toBe(false);
        expect(ability.matches(lost("p2"), SELF, mine)).toBe(false);
    });
});

describe("the compiled life-tally gate (CR 119.3, CR 603.4)", () => {
    function gate(
        condition: CompiledTriggeredAbility["condition"],
        tallies: Pick<GameState, "lifeGainedThisTurn" | "lifeLostThisTurn">
    ): boolean {
        const ability = resolveCompiledTrigger(
            descriptor({
                head: { kind: "entered", scope: "self" },
                condition,
            })
        );
        return ability.interveningIf!(
            { type: "PERMANENT_ENTERED" } as never,
            SELF,
            board(tallies)
        );
    }
    const gainedOrLost = {
        kind: "life-changed-this-turn",
        player: "you",
        directions: ["gained", "lost"],
        combine: "any",
    } as const;
    const gainedAndLost = { ...gainedOrLost, combine: "all" } as const;
    const opponentLost = {
        kind: "life-changed-this-turn",
        player: "opponent",
        directions: ["lost"],
        combine: "any",
    } as const;

    it("'you gained or lost' opens on either of the controller's tallies", () => {
        expect(gate(gainedOrLost, { lifeGainedThisTurn: { p1: 1 } })).toBe(
            true
        );
        expect(gate(gainedOrLost, { lifeLostThisTurn: { p1: 3 } })).toBe(true);
        expect(gate(gainedOrLost, { lifeLostThisTurn: { p2: 3 } })).toBe(false);
        expect(gate(gainedOrLost, {})).toBe(false);
    });

    it("'you gained and lost' needs both of the controller's tallies", () => {
        expect(
            gate(gainedAndLost, {
                lifeGainedThisTurn: { p1: 1 },
                lifeLostThisTurn: { p1: 1 },
            })
        ).toBe(true);
        expect(gate(gainedAndLost, { lifeGainedThisTurn: { p1: 1 } })).toBe(
            false
        );
    });

    it("'an opponent lost' reads the opponents' loss tally, not the controller's", () => {
        expect(gate(opponentLost, { lifeLostThisTurn: { p2: 1 } })).toBe(true);
        expect(gate(opponentLost, { lifeLostThisTurn: { p1: 1 } })).toBe(false);
        expect(gate(opponentLost, { lifeGainedThisTurn: { p2: 1 } })).toBe(
            false
        );
    });
});

describe("the gated entry count reads the board as the permanent enters (CR 614.1c)", () => {
    const declaration = {
        entersWith: {
            counters: [
                { type: "+1/+1", count: { ifOpponentLostLifeThisTurn: 1 } },
            ],
        },
    };

    it("the oracle places the count only when the cast values say so", () => {
        expect(
            resolveEntersWithCounters(declaration, {
                manaSpentToCast: {},
                opponentLostLifeThisTurn: true,
            })
        ).toEqual({ "+1/+1": 1 });
        expect(
            resolveEntersWithCounters(declaration, { manaSpentToCast: {} })
        ).toEqual({});
    });

    it("the GRE applier fills the read from the opponents' loss tally", () => {
        const enter = (lifeLostThisTurn: Record<string, number>) => {
            const entering = makeInstance(getCardByName("Grizzly Bears")!.id, {
                id: "entering",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [entering] }),
                    makePlayer("p2"),
                ],
                lifeLostThisTurn,
            });
            return applyEntersWithCounters(
                entering,
                declaration,
                { manaSpentToCast: {} },
                state
            );
        };
        expect(enter({ p2: 2 })).toEqual({ "+1/+1": 1 });
        // CR 119.3 — the controller's own loss is not an opponent's.
        expect(enter({ p1: 2 })).toEqual({});
        expect(enter({})).toEqual({});
    });
});
