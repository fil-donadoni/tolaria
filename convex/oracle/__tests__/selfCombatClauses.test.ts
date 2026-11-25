// Three static frames about the source itself in combat (issue #4580):
//
//   "This creature attacks each combat if able."                (CR 508.1d)
//   "This creature can't attack unless defending player
//    controls an Island."                                       (CR 508.1c)
//   "This creature can't be blocked by blue creatures."         (CR 509.1b)
//
// Per frame: GOLDEN (a real corpus card compiled whole), REFUSALS (the printed
// neighbours stay unparsed), BEHAVIOUR (the compiled definition, registered
// as-is, at the real combat seam), and WIRE for the two the client shows.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import {
    isRequiredAttacker,
    validateAttackerEligibility,
    validateBlockerEligibility,
} from "../../gre/combat";
import type { CardInstanceState, GameState } from "../../gre/state";
import { projectPublicState } from "../../gameProjections";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const ATTACKS = "This creature attacks each combat if able.";
const ISLANDHOME =
    "This creature can't attack unless defending player controls an Island.";
const NO_BLUE = "This creature can't be blocked by blue creatures.";

const URBORG_DRAKE = oracleCard({
    oracleId: "57d93683-8739-49ef-856a-5a70f92d8763",
    name: "Urborg Drake",
    manaCost: "{1}{U}{B}",
    typeLine: "Creature — Drake",
    oracleText: `Flying\n${ATTACKS}`,
    power: "2",
    toughness: "3",
});

const SEA_MONSTER = oracleCard({
    oracleId: "21b07ce7-b4f9-438c-8c09-e624557d62d2",
    name: "Sea Monster",
    manaCost: "{4}{U}{U}",
    typeLine: "Creature — Serpent",
    oracleText: ISLANDHOME,
    power: "6",
    toughness: "6",
});

const MUDBRAWLER_RAIDERS = oracleCard({
    oracleId: "d8863b64-110d-4f6b-9d0e-4662f2b399cb",
    name: "Mudbrawler Raiders",
    manaCost: "{2}{R/G}{R/G}",
    typeLine: "Creature — Goblin Warrior",
    oracleText: NO_BLUE,
    power: "3",
    toughness: "3",
});

function compiled(card: ReturnType<typeof oracleCard>): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition as CardDefinition;
}

/** The compiled definition under a private id, so the hand-written card of the
 *  same name never answers for it. */
function registered(card: ReturnType<typeof oracleCard>, id: string) {
    return { ...compiled(card), id, rarity: "common" } as CardDefinition;
}

function clauseOf(line: string) {
    const parsed = staticSlot.run(line, parseContext());
    if (!parsed.ok || parsed.value.kind !== "static")
        throw new Error(`"${line}" is not a static line`);
    return parsed.value.clause;
}

function refuses(lines: readonly string[]) {
    for (const line of lines)
        it(`REFUSES "${line}"`, () => {
            expect(staticSlot.run(line, parseContext()).ok).toBe(false);
        });
}

function board(
    mine: CardInstanceState[],
    theirs: CardInstanceState[] = []
): GameState {
    return makeState({
        turn: 3,
        phase: "DECLARE_ATTACKERS",
        players: [
            makePlayer("p1", { battlefield: mine }),
            makePlayer("p2", { battlefield: theirs }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

function perm(
    defId: string,
    id: string,
    controllerId: string,
    extra: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId,
        ownerId: controllerId,
        ...extra,
    });
}

// ── "This creature attacks each combat if able" (CR 508.1d) ────────────────

describe("attacks each combat if able (CR 508.1d)", () => {
    it("Urborg Drake: the whole compiled definition", () => {
        expect(sortKeys(compiled(URBORG_DRAKE))).toEqual(
            sortKeys({
                name: "Urborg Drake",
                types: ["Creature"],
                subtypes: ["Drake"],
                manaCost: { X: 1, U: 1, B: 1 },
                power: 2,
                toughness: 3,
                oracleText: `Flying\n${ATTACKS}`,
                staticAbilities: ["flying"],
                compiledStaticEffects: [
                    {
                        kind: "attack-requirement",
                        id: "urborg-drake-attacks-if-able",
                        oracleText: ATTACKS,
                    },
                ],
            })
        );
    });

    refuses([
        "This creature attacks each combat if able unless you control another Ally.",
        "Enchanted creature attacks each combat if able.",
        "Creatures you control attack each combat if able.",
        "This creature attacks this turn if able.",
        "This creature attacks each combat if able and can't attack its owner.",
    ]);

    const DRAKE = "compiled-urborg-drake";
    const withDrake = <T>(fn: () => T): T =>
        withTemporaryDefinition(registered(URBORG_DRAKE, DRAKE), fn);

    it("is a required attacker while it can attack, and not while it can't", () => {
        withDrake(() => {
            const drake = perm(DRAKE, "drake", "p1");
            expect(isRequiredAttacker(drake, board([drake]))).toBe(true);
            const tapped = perm(DRAKE, "drake", "p1", { isTapped: true });
            expect(isRequiredAttacker(tapped, board([tapped]))).toBe(false);
            const sick = perm(DRAKE, "drake", "p1", { isSummoningSick: true });
            expect(isRequiredAttacker(sick, board([sick]))).toBe(false);
        });
    });

    it("reaches the client: the projected `mustAttack` flag, for both viewers", () => {
        withDrake(() => {
            const drake = perm(DRAKE, "drake", "p1");
            const state = board([drake]);
            for (const viewer of ["p1", "p2"])
                expect(
                    projectPublicState(state, 1, viewer)
                        .players.flatMap((p) => p.battlefield)
                        .find((c) => c.id === "drake")!.mustAttack
                ).toBe(true);
        });
    });
});

// ── "can't attack unless defending player controls an Island" (CR 508.1c) ──

describe("can't attack unless defending player controls a basic land type (CR 508.1c)", () => {
    it("Sea Monster: the whole compiled definition", () => {
        expect(sortKeys(compiled(SEA_MONSTER))).toEqual(
            sortKeys({
                name: "Sea Monster",
                types: ["Creature"],
                subtypes: ["Serpent"],
                manaCost: { X: 4, U: 2 },
                power: 6,
                toughness: 6,
                oracleText: ISLANDHOME,
                compiledStaticEffects: [
                    {
                        kind: "attack-restriction",
                        id: "sea-monster-cant-attack",
                        oracleText: ISLANDHOME,
                        unless: { defenderControlsSubtype: "Island" },
                    },
                ],
            })
        );
    });

    it("reads each basic land type as the argument (Bog Serpent, Gorilla Pack)", () => {
        for (const [phrase, subtype] of [
            ["a Swamp", "Swamp"],
            ["a Forest", "Forest"],
            ["a Mountain", "Mountain"],
        ]) {
            const line = `This creature can't attack unless defending player controls ${phrase}.`;
            expect(clauseOf(line)).toEqual({
                kind: "self-attack-restriction",
                unless: { defenderControlsSubtype: subtype },
                sentence: line,
            });
        }
    });

    refuses([
        "This creature can't attack unless defending player controls a blue permanent.",
        "This creature can't attack unless defending player controls a snow land.",
        "This creature can't attack unless defending player controls a Wall.",
        "This creature can't attack unless you control an Island.",
        "This creature can't attack unless there are five or more Islands on the battlefield.",
        "Enchanted creature can't attack unless defending player controls an Island.",
        "This creature can't attack or block unless defending player controls an Island.",
    ]);

    const MONSTER = "compiled-sea-monster";
    const ISLAND = "compiled-island-land";
    const FOREST = "compiled-forest-land";
    const withBoard = <T>(fn: () => T): T =>
        withTemporaryDefinition(registered(SEA_MONSTER, MONSTER), () =>
            withTemporaryDefinition(land(ISLAND, "Island"), () =>
                withTemporaryDefinition(land(FOREST, "Forest"), fn)
            )
        );
    const land = (id: string, subtype: string) =>
        ({
            id,
            name: subtype,
            rarity: "common",
            types: ["Land"],
            subtypes: [subtype],
        }) as CardDefinition;

    /** Can the monster attack across these lands — engine, then the same
     *  answer off the projected (slim) board the client evaluates. */
    function canAttack(mine: string[], theirs: string[]): boolean {
        const monster = perm(MONSTER, "monster", "p1");
        const state = board(
            [monster, ...mine.map((d, i) => perm(d, `mine-${i}`, "p1"))],
            theirs.map((d, i) => perm(d, `theirs-${i}`, "p2"))
        );
        const engine = validateAttackerEligibility(
            monster,
            state.players[1]!.battlefield,
            state
        ).eligible;
        const projected = projectPublicState(state, 1, "p1");
        const wire = validateAttackerEligibility(
            projected.players[0]!.battlefield.find(
                (c) => c.id === "monster"
            ) as never,
            projected.players[1]!.battlefield as never,
            projected as never
        ).eligible;
        expect(wire).toBe(engine);
        return engine;
    }

    it("attacks only into a defender controlling an Island", () => {
        withBoard(() => {
            expect(canAttack([], [])).toBe(false);
            expect(canAttack([], [FOREST])).toBe(false);
            expect(canAttack([], [FOREST, ISLAND])).toBe(true);
            // The attacker's own Islands do not count.
            expect(canAttack([ISLAND], [FOREST])).toBe(false);
        });
    });
});

// ── "can't be blocked by blue creatures" (CR 509.1b) ───────────────────────

describe("can't be blocked by <colour> creatures (CR 509.1b)", () => {
    it("Mudbrawler Raiders: the static effect the compiler emits", () => {
        expect(compiled(MUDBRAWLER_RAIDERS).compiledStaticEffects).toEqual([
            {
                kind: "block-restriction",
                id: "mudbrawler-raiders-cant-be-blocked-by",
                oracleText: NO_BLUE,
                neverAgainst: { color: "U" },
            },
        ]);
    });

    it("reads each colour word as the argument (CR 105.1)", () => {
        for (const [word, color] of [
            ["white", "W"],
            ["blue", "U"],
            ["black", "B"],
            ["red", "R"],
            ["green", "G"],
        ]) {
            const line = `This creature can't be blocked by ${word} creatures.`;
            expect(clauseOf(line)).toEqual({
                kind: "self-evasion-restriction",
                neverAgainst: { color },
                sentence: line,
            });
        }
    });

    refuses([
        "This creature can't be blocked by black and/or red creatures.",
        "This creature can't be blocked by Walls.",
        "This creature can't be blocked by artifact creatures.",
        "This creature can't be blocked by creatures with flying.",
        "This creature can't be blocked except by blue creatures.",
        "Enchanted creature can't be blocked by blue creatures.",
        "This creature can't be blocked by colorless creatures.",
    ]);

    const RAIDERS = "compiled-mudbrawler-raiders";
    const BEAR = "compiled-green-bear";
    const MERFOLK = "compiled-blue-merfolk";
    const withCreatures = <T>(fn: () => T): T =>
        withTemporaryDefinition(registered(MUDBRAWLER_RAIDERS, RAIDERS), () =>
            withTemporaryDefinition(
                registered(
                    oracleCard({ name: "Green Bear", manaCost: "{1}{G}" }),
                    BEAR
                ),
                () =>
                    withTemporaryDefinition(
                        registered(
                            oracleCard({
                                name: "Gold Merfolk",
                                manaCost: "{G}{U}",
                            }),
                            MERFOLK
                        ),
                        fn
                    )
            )
        );

    /** Attacker and blocker by definition id, on both the engine's board and
     *  the projected one. */
    function canBlock(
        attackerDef: string,
        blockerDef: string,
        blockerExtra: Partial<CardInstanceState> = {}
    ): boolean {
        const attacker = perm(attackerDef, "attacker", "p1");
        const blocker = perm(blockerDef, "blocker", "p2", blockerExtra);
        const state = board([attacker], [blocker]);
        const engine = validateBlockerEligibility(
            attacker,
            blocker,
            [blocker],
            state
        ).eligible;
        const projected = projectPublicState(state, 1, "p2");
        const slim = (id: string) =>
            projected.players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === id) as never;
        const wire = validateBlockerEligibility(
            slim("attacker"),
            slim("blocker"),
            [slim("blocker")],
            projected as never
        ).eligible;
        expect(wire).toBe(engine);
        return engine;
    }

    it("refuses a blue blocker, gold included, and allows any other", () => {
        withCreatures(() => {
            expect(canBlock(RAIDERS, MERFOLK)).toBe(false);
            expect(canBlock(RAIDERS, BEAR)).toBe(true);
            // Attacker-side only: it may still block, and be blocked when the
            // blue creature is the attacker.
            expect(canBlock(MERFOLK, RAIDERS)).toBe(true);
        });
    });

    it("reads the blocker's EFFECTIVE colour (CR 613.1e)", () => {
        withCreatures(() => {
            expect(
                canBlock(RAIDERS, BEAR, {
                    colorOverride: ["U"],
                    colorOverrideSeq: 1,
                })
            ).toBe(false);
            expect(
                canBlock(RAIDERS, MERFOLK, {
                    colorOverride: ["G"],
                    colorOverrideSeq: 1,
                })
            ).toBe(true);
        });
    });
});
