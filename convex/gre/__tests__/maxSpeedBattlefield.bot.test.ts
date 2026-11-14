// CR 702.178a — the Bot offers an ability behind "Max speed —" only while its
// controller's speed is 4, through the same gates the server applies: a stack
// ability through `activationPreconditionViolation` (`enumerateAbilityMoves`),
// a mana ability through the option list its payment planner reads
// (`getManaTapOptionsDetailed` over `manaGateBattlefields`).
//
// The server half is `convex/__tests__/maxSpeedBattlefieldAbility.test.ts`.
import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { compileCard } from "../../oracle/compile";
import type { GameState } from "../state";
import { enumerateMoves } from "../moves";

const REMINDER =
    "Start your engines! (If you have no speed, it starts at 1. It increases once on each of your turns when an opponent loses life. Max speed is 4.)";

function compiled(
    oracle: Parameters<typeof compileCard>[0],
    id: string
): CardDefinition {
    const outcome = compileCard(oracle);
    if (outcome.state !== "ready")
        throw new Error(`${oracle.name} is ${outcome.state}`);
    return { ...outcome.definition, id } as CardDefinition;
}

const CATALYZER = compiled(
    {
        oracleId: "b4d970ed-f332-440c-8c2f-8a8a0191410b",
        name: "Endrider Catalyzer",
        manaCost: "{2}{R}",
        typeLine: "Creature — Human Warrior",
        oracleText: `${REMINDER}\nMax speed — {T}: Add {R}{R}.`,
        power: "3",
        toughness: "3",
        layout: "normal",
    },
    "test-9586-bot-catalyzer"
);

const SKYTECH = compiled(
    {
        oracleId: "9586d000-0000-4000-8000-000000000002",
        name: "Deviant Skytech",
        manaCost: "{1}{W}",
        typeLine: "Enchantment",
        oracleText:
            "Start your engines!\nWhen this enchantment enters, create two 1/1 colorless Thopter artifact creature tokens with flying.\nMax speed — Sacrifice this enchantment: Create two 1/1 colorless Thopter artifact creature tokens with flying.",
        layout: "normal",
    },
    "test-9586-bot-skytech"
);

/** A vanilla {R}{R} creature: castable only off the Catalyzer's mana. */
const RR_CREATURE: CardDefinition = {
    id: "test-9586-bot-rr-creature",
    name: "Test Red Bear",
    rarity: "common",
    oracleText: "",
    manaCost: { R: 2 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
};

function board(
    definition: CardDefinition,
    p1Speed: number,
    hand: readonly string[] = []
): GameState {
    return makeState({
        turn: 5,
        players: [
            makePlayer("p1", {
                speed: p1Speed,
                battlefield: [
                    makeInstance(definition.id, {
                        id: "src",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                hand: hand.map((cardId, i) =>
                    makeInstance(cardId, {
                        id: `hand-${i}`,
                        zone: "hand",
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
}

describe("enumerateMoves — a battlefield ability behind max speed (CR 702.178a)", () => {
    const activations = (p1Speed: number) =>
        withTemporaryDefinition(
            SKYTECH,
            () =>
                enumerateMoves(board(SKYTECH, p1Speed), "p1").filter(
                    (m) =>
                        m.kind === "activate-ability" &&
                        m.cardInstanceId === "src"
                ).length
        );

    it("offers the stack ability at max speed", () => {
        expect(activations(4)).toBeGreaterThan(0);
    });

    it("never offers it below max speed", () => {
        expect(activations(3)).toBe(0);
    });
});

describe("enumerateMoves — a mana ability behind max speed funds a cast only at max speed (CR 702.178a)", () => {
    const casts = (p1Speed: number) =>
        withTemporaryDefinition(CATALYZER, () =>
            withTemporaryDefinition(
                RR_CREATURE,
                () =>
                    enumerateMoves(
                        board(CATALYZER, p1Speed, [RR_CREATURE.id]),
                        "p1"
                    ).filter((m) => m.kind === "cast-spell").length
            )
        );

    it("casts the {R}{R} spell off it at max speed", () => {
        expect(casts(4)).toBeGreaterThan(0);
    });

    it("has no mana for it below max speed", () => {
        expect(casts(3)).toBe(0);
    });
});
