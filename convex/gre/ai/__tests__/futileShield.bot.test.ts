// Issue #5493 — `isFutileThisTurnMove`: a regeneration shield (CR 701.19a) or a
// prevent-the-next-N shield (CR 615.1a) with no destruction / damage event
// able to reach its permanent before the bot next holds priority is pruned;
// a live threat, or one threat more than the shields already standing, keeps
// the activation.

import { describe, expect, it } from "vitest";
import { buildPositionFromSpec } from "../blade/build";
import type { BladeSetupStep } from "../blade/types";
import { enumerateMoves, type Move } from "../../moves";
import { findPermanent } from "../../lookup";
import { getCardByName, tryGetDefinition } from "../../../cards";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import { resolveTopOfStack, type GameState } from "../../state";
import { applyMoveInSearch } from "../../search";
import { CHOICE_CANDIDATE_GENERATORS } from "../choiceCandidates";
import {
    isCostUnlockingLandTypeChange,
    isFutileThisTurnMove,
    isMisdirectedThisTurnMove,
} from "../futileShield";

type Seat = 0 | 1;

function position(spec: ScenarioSpec, setup?: BladeSetupStep[]): GameState {
    return buildPositionFromSpec(spec, setup);
}

function activationsOf(
    state: GameState,
    seat: Seat,
    sourceName: string
): Extract<Move, { kind: "activate-ability" }>[] {
    const pid = state.players[seat].id;
    return enumerateMoves(state, pid).filter(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" &&
            findPermanent(state, m.cardInstanceId)?.card.id ===
                getCardByName(sourceName).id
    );
}

function onlyActivation(state: GameState, seat: Seat, sourceName: string) {
    const moves = activationsOf(state, seat, sourceName);
    expect(moves).toHaveLength(1);
    return moves[0];
}

const TROLL_VS_SPELLS: ScenarioSpec = {
    cards: [
        {
            name: "Charging Troll",
            owner: "opp",
            zone: "battlefield",
            summoningSick: false,
        },
        { name: "Sleeping Potion", owner: "me", zone: "hand" },
        { name: "Vindicate", owner: "me", zone: "hand" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 4,
    landCount: 8,
    libraryCount: 20,
};

function castAtTroll(card: string): BladeSetupStep[] {
    return [{ kind: "cast", card, by: "me", target: "Charging Troll" }];
}

describe("isFutileThisTurnMove — regeneration (CR 701.19a)", () => {
    it("prunes Regenerate against an Aura spell that destroys nothing (CR 608.3)", () => {
        const state = position(TROLL_VS_SPELLS, castAtTroll("Sleeping Potion"));
        const move = onlyActivation(state, 1, "Charging Troll");
        expect(isFutileThisTurnMove(state, move)).toBe(true);
    });

    it("prunes Regenerate against the Aura's own tap trigger (aiEffects script)", () => {
        const state = position(TROLL_VS_SPELLS, [
            ...castAtTroll("Sleeping Potion"),
            { kind: "resolve-top" },
            { kind: "pass", seat: "me" },
        ]);
        expect(state.stack).toHaveLength(1);
        const move = onlyActivation(state, 1, "Charging Troll");
        expect(isFutileThisTurnMove(state, move)).toBe(true);
    });

    it("keeps Regenerate against a destroy spell on the stack", () => {
        const state = position(TROLL_VS_SPELLS, castAtTroll("Vindicate"));
        const move = onlyActivation(state, 1, "Charging Troll");
        expect(isFutileThisTurnMove(state, move)).toBe(false);
    });

    it("prunes a second shield against a single threat", () => {
        const state = position(TROLL_VS_SPELLS, castAtTroll("Vindicate"));
        const move = onlyActivation(state, 1, "Charging Troll");
        findPermanent(state, move.cardInstanceId)!.regenerationShields = 1;
        expect(isFutileThisTurnMove(state, move)).toBe(true);
    });

    it("prunes a shield a can't-be-regenerated effect makes inapplicable (CR 701.19c)", () => {
        const state = position(TROLL_VS_SPELLS, castAtTroll("Vindicate"));
        const move = onlyActivation(state, 1, "Charging Troll");
        findPermanent(state, move.cardInstanceId)!.cantBeRegeneratedThisTurn =
            true;
        expect(isFutileThisTurnMove(state, move)).toBe(true);
    });

    it("prunes Regenerate in the bot's own main phase with an empty stack", () => {
        const state = position({
            cards: [
                {
                    name: "Charging Troll",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            landCount: 2,
            libraryCount: 20,
        });
        const move = onlyActivation(state, 0, "Charging Troll");
        expect(isFutileThisTurnMove(state, move)).toBe(true);
    });

    it("keeps Regenerate on lethal damage already marked (CR 704.5g)", () => {
        const state = position({
            cards: [
                {
                    name: "Charging Troll",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    damageMarked: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            landCount: 2,
            libraryCount: 20,
        });
        const move = onlyActivation(state, 0, "Charging Troll");
        expect(isFutileThisTurnMove(state, move)).toBe(false);
    });

    it("keeps Regenerate on a blocker in combat before damage (CR 510.4)", () => {
        const state = position({
            cards: [
                {
                    name: "Charging Troll",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Craw Wurm",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_BLOCKERS",
            activePlayer: "opp",
            priority: "me",
            combat: {
                attackers: ["Craw Wurm"],
                confirmed: true,
                blockers: [{ blocker: "Charging Troll", blocking: [0] }],
                blockersConfirmed: true,
            },
            turn: 4,
            landCount: 2,
            libraryCount: 20,
        });
        const move = onlyActivation(state, 0, "Charging Troll");
        expect(isFutileThisTurnMove(state, move)).toBe(false);
    });

    it("prunes a GRANTED Regenerate with no threat (Zombie Master's grant)", () => {
        const state = position({
            cards: [
                { name: "Zombie Master", owner: "me", zone: "battlefield" },
                {
                    name: "Scathe Zombies",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            landCount: 2,
            libraryCount: 20,
        });
        const move = onlyActivation(state, 0, "Scathe Zombies");
        expect(isFutileThisTurnMove(state, move)).toBe(true);
    });

    it("is wired into the root enumeration's dominance prune", () => {
        const state = position(TROLL_VS_SPELLS, castAtTroll("Sleeping Potion"));
        const pid = state.players[1].id;
        const pruned = enumerateMoves(state, pid, {
            pruneDominatedNoOps: true,
        });
        expect(pruned.some((m) => m.kind === "activate-ability")).toBe(false);
    });
});

describe("isFutileThisTurnMove — prevent the next N damage (CR 615.1a)", () => {
    const HEALER: ScenarioSpec = {
        cards: [
            {
                name: "Samite Healer",
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 4,
        landCount: 2,
        libraryCount: 20,
    };

    it("prunes a creature-targeted shield with no damage threat", () => {
        const state = position(HEALER);
        const move = activationsOf(state, 0, "Samite Healer").find(
            (m) => m.targets[0]?.type === "permanent"
        );
        expect(move).toBeDefined();
        expect(isFutileThisTurnMove(state, move!)).toBe(true);
    });

    it("keeps a player-targeted shield (damage can reach a player off the stack)", () => {
        const state = position(HEALER);
        const move = activationsOf(state, 0, "Samite Healer").find(
            (m) => m.targets[0]?.type === "player"
        );
        expect(move).toBeDefined();
        expect(isFutileThisTurnMove(state, move!)).toBe(false);
    });
});

// Issue #6905 — the same prune over this-turn tap activations: a prevention
// shield or an until-end-of-turn P/T change that no event can consume, and a
// sign-respecting target (CR 611.2, CR 615.1a, CR 510.1a).
describe("this-turn tap activations (Samite Pilgrim, Dega Disciple)", () => {
    const LANDS: ScenarioSpec["cards"] = [
        { name: "Plains", owner: "me", zone: "battlefield" },
        { name: "Mountain", owner: "me", zone: "battlefield" },
        { name: "Swamp", owner: "me", zone: "battlefield" },
    ];
    const HELPERS: ScenarioSpec["cards"] = [
        {
            name: "Samite Pilgrim",
            owner: "me",
            zone: "battlefield",
            summoningSick: false,
        },
        {
            name: "Dega Disciple",
            owner: "me",
            zone: "battlefield",
            summoningSick: false,
        },
        ...LANDS,
    ];

    function targeting(
        state: GameState,
        source: string,
        target: string,
        abilityId?: string
    ) {
        return activationsOf(state, 0, source).find(
            (m) =>
                (abilityId === undefined || m.abilityId === abilityId) &&
                m.targets[0]?.type === "permanent" &&
                findPermanent(state, m.targets[0].id)?.card.id ===
                    getCardByName(target).id
        );
    }

    function pruned(state: GameState): Move[] {
        return enumerateMoves(state, state.players[0].id, {
            pruneDominatedNoOps: true,
        });
    }

    const MAIN: ScenarioSpec = {
        cards: [
            ...HELPERS,
            {
                name: "Charging Troll",
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
            {
                name: "Craw Wurm",
                owner: "opp",
                zone: "battlefield",
                summoningSick: false,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 4,
        landCount: 0,
        libraryCount: 20,
    };

    it("prunes every Pilgrim / Disciple activation in a quiet main phase", () => {
        const state = position(MAIN);
        const offered = [
            ...activationsOf(state, 0, "Samite Pilgrim"),
            ...activationsOf(state, 0, "Dega Disciple"),
        ];
        expect(offered.length).toBeGreaterThan(0);
        expect(offered.every((m) => isFutileThisTurnMove(state, m))).toBe(true);
        const kept = pruned(state).filter((m) => m.kind === "activate-ability");
        const keptSources = kept.map(
            (m) =>
                findPermanent(
                    state,
                    (m as { cardInstanceId: string }).cardInstanceId
                )?.card.name
        );
        expect(keptSources).not.toContain("Samite Pilgrim");
        expect(keptSources).not.toContain("Dega Disciple");
    });

    const BLOCKED: ScenarioSpec = {
        cards: [
            ...HELPERS,
            {
                name: "Charging Troll",
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
            {
                name: "Craw Wurm",
                owner: "opp",
                zone: "battlefield",
                summoningSick: false,
            },
        ],
        phase: "DECLARE_BLOCKERS",
        activePlayer: "opp",
        priority: "me",
        combat: {
            attackers: ["Craw Wurm"],
            confirmed: true,
            blockers: [{ blocker: "Charging Troll", blocking: [0] }],
            blockersConfirmed: true,
        },
        turn: 4,
        landCount: 0,
        libraryCount: 20,
    };

    it("shields its own blocker facing lethal damage, never the attacker", () => {
        const state = position(BLOCKED);
        const own = targeting(state, "Samite Pilgrim", "Charging Troll")!;
        const theirs = targeting(state, "Samite Pilgrim", "Craw Wurm")!;
        expect(isFutileThisTurnMove(state, own)).toBe(false);
        expect(isMisdirectedThisTurnMove(state, own, state.players[0].id)).toBe(
            false
        );
        expect(
            isMisdirectedThisTurnMove(state, theirs, state.players[0].id)
        ).toBe(true);
        const kept = pruned(state).filter(
            (m) =>
                m.kind === "activate-ability" && m.abilityId === own.abilityId
        );
        expect(kept).toEqual([own]);
    });

    const UNBLOCKED: ScenarioSpec = {
        ...BLOCKED,
        activePlayer: "me",
        cards: [
            ...HELPERS,
            {
                name: "Charging Troll",
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
            {
                name: "Craw Wurm",
                owner: "opp",
                zone: "battlefield",
                summoningSick: false,
            },
        ],
        combat: {
            attackers: ["Charging Troll"],
            confirmed: true,
            blockers: [],
            blockersConfirmed: true,
        },
    };

    it("does not shield an unblocked attacker nothing can damage (CR 510.1)", () => {
        const state = position(UNBLOCKED);
        const own = targeting(state, "Samite Pilgrim", "Charging Troll")!;
        expect(isFutileThisTurnMove(state, own)).toBe(true);
    });

    it("keeps the shield before blockers are confirmed", () => {
        const state = position({
            ...UNBLOCKED,
            phase: "DECLARE_ATTACKERS",
            combat: {
                attackers: ["Charging Troll"],
                confirmed: true,
                blockers: [],
                blockersConfirmed: false,
            },
        });
        const own = targeting(state, "Samite Pilgrim", "Charging Troll")!;
        expect(isFutileThisTurnMove(state, own)).toBe(false);
    });

    it("pumps its own blocked attacker, never shrinks it or pumps the blocker", () => {
        const state = position({
            ...BLOCKED,
            activePlayer: "me",
            cards: [
                ...HELPERS,
                {
                    name: "Charging Troll",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Craw Wurm",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            combat: {
                attackers: ["Charging Troll"],
                confirmed: true,
                blockers: [{ blocker: "Craw Wurm", blocking: [0] }],
                blockersConfirmed: true,
            },
        });
        const me = state.players[0].id;
        const plus = "dega-disciple-ability-2";
        const minus = "dega-disciple-ability";
        const ownPlus = targeting(
            state,
            "Dega Disciple",
            "Charging Troll",
            plus
        )!;
        const ownMinus = targeting(
            state,
            "Dega Disciple",
            "Charging Troll",
            minus
        )!;
        const oppPlus = targeting(state, "Dega Disciple", "Craw Wurm", plus)!;
        const oppMinus = targeting(state, "Dega Disciple", "Craw Wurm", minus)!;
        expect(isFutileThisTurnMove(state, ownPlus)).toBe(false);
        expect(isMisdirectedThisTurnMove(state, ownPlus, me)).toBe(false);
        expect(isMisdirectedThisTurnMove(state, ownMinus, me)).toBe(true);
        expect(isMisdirectedThisTurnMove(state, oppPlus, me)).toBe(true);
        expect(isMisdirectedThisTurnMove(state, oppMinus, me)).toBe(false);
    });

    it("keeps a pump that can lower toughness (CR 704.5f)", () => {
        const state = position({
            cards: [
                {
                    name: "Minion of Tevesh Szat",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            landCount: 2,
            libraryCount: 20,
        });
        const move = targeting(
            state,
            "Minion of Tevesh Szat",
            "Grizzly Bears"
        )!;
        expect(isFutileThisTurnMove(state, move)).toBe(false);
        expect(
            isMisdirectedThisTurnMove(state, move, state.players[0].id)
        ).toBe(false);
    });

    it("keeps a power pump while blocks are still open (CR 509.1b)", () => {
        const state = position({
            cards: [
                {
                    name: "Wall of Fire",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                {
                    name: "Craw Wurm",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "DECLARE_ATTACKERS",
            activePlayer: "opp",
            priority: "me",
            combat: {
                attackers: ["Craw Wurm"],
                confirmed: true,
                blockers: [],
                blockersConfirmed: false,
            },
            turn: 4,
            libraryCount: 20,
        });
        const moves = activationsOf(state, 0, "Wall of Fire");
        expect(moves.length).toBeGreaterThan(0);
        expect(moves.some((m) => isFutileThisTurnMove(state, m))).toBe(false);
    });

    it("keeps a mana-only pump: it can be made later at the same price", () => {
        const state = position({
            cards: [
                {
                    name: "Blazing Rootwalla",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Mountain", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            landCount: 0,
            libraryCount: 20,
        });
        const moves = activationsOf(state, 0, "Blazing Rootwalla");
        expect(moves.length).toBeGreaterThan(0);
        expect(moves.some((m) => isFutileThisTurnMove(state, m))).toBe(false);
    });
});

// Issue #6915 — the stack threat bound stops counting objects that provably
// cannot destroy or damage the shielded permanent: the bot's own pending
// regeneration (CR 701.19a) counts as a shield already granted.
describe("isFutileThisTurnMove — pending shields on the stack (issue #6915)", () => {
    const FAMILIAR: ScenarioSpec = {
        cards: [
            {
                name: "Nightscape Familiar",
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
            { name: "Swamp", owner: "me", zone: "battlefield" },
            { name: "Swamp", owner: "me", zone: "battlefield" },
            { name: "Lightning Bolt", owner: "opp", zone: "hand" },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 4,
        landCount: 0,
        libraryCount: 20,
        manaPool: { me: { B: 2 }, opp: { R: 1 } },
    };

    function withPriority(state: GameState, seat: Seat): GameState {
        state.priorityPlayerId = state.players[seat].id;
        return state;
    }

    it("prunes a second activation with only its own regeneration on the stack", () => {
        const state = withPriority(
            position(FAMILIAR, [
                { kind: "activate", card: "Nightscape Familiar" },
            ]),
            0
        );
        expect(state.stack).toHaveLength(1);
        const move = onlyActivation(state, 0, "Nightscape Familiar");
        expect(isFutileThisTurnMove(state, move)).toBe(true);
    });

    it("keeps Regenerate against lethal burn aimed at the creature", () => {
        const state = withPriority(
            position({ ...FAMILIAR, activePlayer: "opp", priority: "opp" }, [
                {
                    kind: "cast",
                    card: "Lightning Bolt",
                    by: "opp",
                    target: "Nightscape Familiar",
                },
            ]),
            0
        );
        const move = onlyActivation(state, 0, "Nightscape Familiar");
        expect(isFutileThisTurnMove(state, move)).toBe(false);
    });

    it("prunes a second shield once one is pending against the single burn", () => {
        const state = withPriority(
            position({ ...FAMILIAR, activePlayer: "opp", priority: "opp" }, [
                {
                    kind: "cast",
                    card: "Lightning Bolt",
                    by: "opp",
                    target: "Nightscape Familiar",
                },
                { kind: "activate", card: "Nightscape Familiar" },
            ]),
            0
        );
        expect(state.stack).toHaveLength(2);
        const move = onlyActivation(state, 0, "Nightscape Familiar");
        expect(isFutileThisTurnMove(state, move)).toBe(true);
    });

    it("keeps a second shield when the burn sits above the pending one (CR 608.1)", () => {
        const state = withPriority(
            position(FAMILIAR, [
                { kind: "activate", card: "Nightscape Familiar" },
                {
                    kind: "cast",
                    card: "Lightning Bolt",
                    by: "opp",
                    target: "Nightscape Familiar",
                },
            ]),
            0
        );
        expect(state.stack).toHaveLength(2);
        const move = onlyActivation(state, 0, "Nightscape Familiar");
        expect(isFutileThisTurnMove(state, move)).toBe(false);
    });

    it("keeps a land-type change while a card in hand can grant landwalk", () => {
        const state = position({
            cards: [
                {
                    name: "Reef Shaman",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Island", owner: "me", zone: "battlefield" },
                {
                    name: "Swamp",
                    owner: "opp",
                    zone: "battlefield",
                    tapped: true,
                },
                { name: "River Merfolk", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            landCount: 0,
            libraryCount: 20,
        });
        const moves = activationsOf(state, 0, "Reef Shaman");
        expect(moves.length).toBeGreaterThan(0);
        expect(moves.some((m) => isFutileThisTurnMove(state, m))).toBe(false);
    });

    it("prunes Regenerate against a land-type change on the stack (CR 305.7)", () => {
        const state = withPriority(
            position(
                {
                    ...FAMILIAR,
                    cards: [
                        ...FAMILIAR.cards,
                        {
                            name: "Reef Shaman",
                            owner: "opp",
                            zone: "battlefield",
                            summoningSick: false,
                        },
                        { name: "Forest", owner: "opp", zone: "battlefield" },
                    ],
                    activePlayer: "opp",
                    priority: "opp",
                },
                [
                    {
                        kind: "activate",
                        card: "Reef Shaman",
                        controller: "opp",
                        target: "Forest",
                    },
                ]
            ),
            0
        );
        expect(state.stack).toHaveLength(1);
        const move = onlyActivation(state, 0, "Nightscape Familiar");
        expect(isFutileThisTurnMove(state, move)).toBe(true);
    });
});

// Issue #6915 — an until-end-of-turn land-type change (CR 305.7) is pruned
// when nothing can use the new type before the bot next holds priority.
describe("isFutileThisTurnMove — land-type changes (CR 305.7, issue #6915)", () => {
    const SHAMAN = {
        name: "Reef Shaman",
        owner: "me",
        zone: "battlefield",
        summoningSick: false,
    } as const;

    function landTargets(state: GameState) {
        return activationsOf(state, 0, "Reef Shaman");
    }

    function keptTargetNames(state: GameState): string[] {
        return landTargets(state)
            .filter((m) => !isFutileThisTurnMove(state, m))
            .map((m) => {
                const slot = m.targets[0];
                const land =
                    slot?.type === "permanent"
                        ? findPermanent(state, slot.id)
                        : undefined;
                const name =
                    land && tryGetDefinition(land.card.id as string)?.name;
                const seat =
                    land?.controllerId === state.players[0].id ? "me" : "opp";
                return `${seat}:${name}`;
            });
    }

    const MAIN: ScenarioSpec = {
        cards: [
            SHAMAN,
            { name: "Island", owner: "me", zone: "battlefield" },
            { name: "Island", owner: "me", zone: "battlefield" },
            { name: "Merfolk of the Pearl Trident", owner: "me", zone: "hand" },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 4,
        landCount: 0,
        libraryCount: 20,
    };

    it("prunes every target in the bot's main phase with no consumer", () => {
        const state = position(MAIN);
        expect(landTargets(state).length).toBeGreaterThan(0);
        expect(keptTargetNames(state)).toEqual([]);
    });

    it("prunes the opponent's tapped lands on the opponent's turn", () => {
        const state = position({
            ...MAIN,
            cards: [
                ...MAIN.cards,
                {
                    name: "Swamp",
                    owner: "opp",
                    zone: "battlefield",
                    tapped: true,
                },
                {
                    name: "Swamp",
                    owner: "opp",
                    zone: "battlefield",
                    tapped: true,
                },
            ],
            activePlayer: "opp",
            priority: "me",
        });
        expect(landTargets(state).length).toBeGreaterThan(2);
        expect(keptTargetNames(state)).toEqual([]);
    });

    it("keeps an opponent's untapped land: its mana changes before the bot's next priority", () => {
        const state = position({
            ...MAIN,
            cards: [
                ...MAIN.cards,
                { name: "Swamp", owner: "opp", zone: "battlefield" },
            ],
        });
        expect(keptTargetNames(state)).toEqual(["opp:Swamp"]);
    });

    it("keeps the bot's own untapped land when the new colour unlocks a spell in hand", () => {
        const state = position({
            ...MAIN,
            cards: [
                ...MAIN.cards,
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
            ],
        });
        expect(keptTargetNames(state)).toEqual(["me:Island", "me:Island"]);
    });

    it("keeps every target while a landwalker can still attack", () => {
        const state = position({
            ...MAIN,
            cards: [
                ...MAIN.cards,
                {
                    name: "Bog Wraith",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
        });
        expect(keptTargetNames(state)).toHaveLength(landTargets(state).length);
    });

    it("keeps every target while a permanent reads land types", () => {
        const state = position({
            ...MAIN,
            cards: [
                ...MAIN.cards,
                {
                    name: "Kird Ape",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
        });
        expect(keptTargetNames(state)).toHaveLength(landTargets(state).length);
    });

    it("keeps every target while anything is on the stack", () => {
        const state = position(
            {
                ...MAIN,
                cards: [
                    ...MAIN.cards,
                    { name: "Lightning Bolt", owner: "opp", zone: "hand" },
                ],
                activePlayer: "opp",
                priority: "opp",
                manaPool: { opp: { R: 1 } },
            },
            [{ kind: "cast", card: "Lightning Bolt", by: "opp", target: "me" }]
        );
        state.priorityPlayerId = state.players[0].id;
        expect(state.stack).toHaveLength(1);
        expect(keptTargetNames(state)).toHaveLength(landTargets(state).length);
    });
});

// Issue #7267 — a land-type change (CR 305.7) that makes a held cost payable is
// spent on that cast this turn: it is not a deferrable activation, and the
// inert types at its mode choice are dominated by the one that pays.
describe("land-type change that unlocks a held cost (CR 305.6, CR 305.7, issue #7267)", () => {
    const WITH_BEARS: ScenarioSpec = {
        cards: [
            {
                name: "Reef Shaman",
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
            { name: "Island", owner: "me", zone: "battlefield" },
            { name: "Island", owner: "me", zone: "battlefield" },
            { name: "Grizzly Bears", owner: "me", zone: "hand" },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 4,
        landCount: 0,
        libraryCount: 20,
    };

    it("reads the Island retype as cost-unlocking while the green spell is held", () => {
        const state = position(WITH_BEARS);
        const moves = activationsOf(state, 0, "Reef Shaman");
        expect(moves.length).toBeGreaterThan(0);
        expect(
            moves.every((m) => isCostUnlockingLandTypeChange(state, m))
        ).toBe(true);
    });

    it("reads no retype as cost-unlocking once the spell is already payable", () => {
        const state = position({
            ...WITH_BEARS,
            cards: [
                ...WITH_BEARS.cards.filter((c) => c.name !== "Grizzly Bears"),
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
            ],
        });
        const moves = activationsOf(state, 0, "Reef Shaman");
        expect(moves.length).toBeGreaterThan(0);
        expect(moves.some((m) => isCostUnlockingLandTypeChange(state, m))).toBe(
            false
        );
    });

    it("offers only the type that pays the held cost at the mode choice", () => {
        const state = position(WITH_BEARS);
        const [move] = activationsOf(state, 0, "Reef Shaman");
        applyMoveInSearch(state, state.players[0].id, move);
        resolveTopOfStack(state);
        const choice = state.pendingChoices?.[0];
        expect(choice?.kind).toBe("option-pick");
        const kept = CHOICE_CANDIDATE_GENERATORS["option-pick"]!(
            state,
            choice!
        );
        expect(kept.map((c) => c.key)).toEqual([
            `option-pick:${choice!.options!.find((o) => o.landTypeMode === "Forest")!.id}`,
        ]);
    });
});
