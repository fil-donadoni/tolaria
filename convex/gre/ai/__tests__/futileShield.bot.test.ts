// Issue #5493 — `isFutileShieldMove`: a regeneration shield (CR 701.19a) or a
// prevent-the-next-N shield (CR 615.1a) with no destruction / damage event
// able to reach its permanent before the bot next holds priority is pruned;
// a live threat, or one threat more than the shields already standing, keeps
// the activation.

import { describe, expect, it } from "vitest";
import { buildPositionFromSpec } from "../blade/build";
import type { BladeSetupStep } from "../blade/types";
import { enumerateMoves, type Move } from "../../moves";
import { findPermanent } from "../../lookup";
import { getCardByName } from "../../../cards";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { GameState } from "../../state";
import { isFutileShieldMove } from "../futileShield";

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

describe("isFutileShieldMove — regeneration (CR 701.19a)", () => {
    it("prunes Regenerate against an Aura spell that destroys nothing (CR 608.3)", () => {
        const state = position(TROLL_VS_SPELLS, castAtTroll("Sleeping Potion"));
        const move = onlyActivation(state, 1, "Charging Troll");
        expect(isFutileShieldMove(state, move)).toBe(true);
    });

    it("prunes Regenerate against the Aura's own tap trigger (aiEffects script)", () => {
        const state = position(TROLL_VS_SPELLS, [
            ...castAtTroll("Sleeping Potion"),
            { kind: "resolve-top" },
            { kind: "pass", seat: "me" },
        ]);
        expect(state.stack).toHaveLength(1);
        const move = onlyActivation(state, 1, "Charging Troll");
        expect(isFutileShieldMove(state, move)).toBe(true);
    });

    it("keeps Regenerate against a destroy spell on the stack", () => {
        const state = position(TROLL_VS_SPELLS, castAtTroll("Vindicate"));
        const move = onlyActivation(state, 1, "Charging Troll");
        expect(isFutileShieldMove(state, move)).toBe(false);
    });

    it("prunes a second shield against a single threat", () => {
        const state = position(TROLL_VS_SPELLS, castAtTroll("Vindicate"));
        const move = onlyActivation(state, 1, "Charging Troll");
        findPermanent(state, move.cardInstanceId)!.regenerationShields = 1;
        expect(isFutileShieldMove(state, move)).toBe(true);
    });

    it("prunes a shield a can't-be-regenerated effect makes inapplicable (CR 701.19c)", () => {
        const state = position(TROLL_VS_SPELLS, castAtTroll("Vindicate"));
        const move = onlyActivation(state, 1, "Charging Troll");
        findPermanent(state, move.cardInstanceId)!.cantBeRegeneratedThisTurn =
            true;
        expect(isFutileShieldMove(state, move)).toBe(true);
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
        expect(isFutileShieldMove(state, move)).toBe(true);
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
        expect(isFutileShieldMove(state, move)).toBe(false);
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
        expect(isFutileShieldMove(state, move)).toBe(false);
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
        expect(isFutileShieldMove(state, move)).toBe(true);
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

describe("isFutileShieldMove — prevent the next N damage (CR 615.1a)", () => {
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
        expect(isFutileShieldMove(state, move!)).toBe(true);
    });

    it("keeps a player-targeted shield (damage can reach a player off the stack)", () => {
        const state = position(HEALER);
        const move = activationsOf(state, 0, "Samite Healer").find(
            (m) => m.targets[0]?.type === "player"
        );
        expect(move).toBeDefined();
        expect(isFutileShieldMove(state, move!)).toBe(false);
    });
});
