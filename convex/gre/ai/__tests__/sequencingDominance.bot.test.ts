// CR 601.2f (issue #10645) — a spell cast at full cost is dominated by a pure
// self cost reducer cast first when the reducer then the same spell reaches
// the same board plus the reducer, with no option the spell-first line kept.
// Read through the root enumeration the search uses (`enumerateRootMoves`).

import { describe, expect, it } from "vitest";
import type { GameState } from "../../state";
import type { Move } from "../../moves";
import { enumerateRootMoves } from "../../search";
import { buildBladeState } from "../blade/runner";
import type { BladeScenario } from "../blade/types";
import { instanceIdsForName, seatPlayerId } from "../blade/matcher";

type Card = BladeScenario["spec"]["cards"][number];

function position(mountains: number, hand: string[], extra: Card[] = []) {
    const state = buildBladeState({
        label: "sequencing-dominance",
        spec: {
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            landCount: 0,
            libraryCount: 20,
            cards: [
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: mountains,
                },
                ...hand.map(
                    (name): Card => ({ name, owner: "me", zone: "hand" })
                ),
                ...extra,
            ],
        },
    } as BladeScenario);
    return { state, bot: seatPlayerId(state, "me") };
}

function castsOf(state: GameState, moves: Move[], name: string): Move[] {
    const ids = instanceIdsForName(state, name);
    return moves.filter(
        (m) => m.kind === "cast-spell" && ids.has(m.cardInstanceId)
    );
}

function rootMoves(state: GameState, bot: string) {
    const pruned: Move[] = [];
    const moves = enumerateRootMoves(state, bot, {
        onPruned: (m) => pruned.push(m),
    });
    return { moves, pruned };
}

describe("a spell at full cost is dominated by the cost reducer cast first (issue #10645)", () => {
    it("prunes Gray Ogre when Ruby Medallion then the Ogre casts both on four Mountains", () => {
        const { state, bot } = position(4, ["Ruby Medallion", "Gray Ogre"]);
        const { moves, pruned } = rootMoves(state, bot);
        expect(castsOf(state, moves, "Gray Ogre")).toEqual([]);
        expect(castsOf(state, pruned, "Gray Ogre").length).toBeGreaterThan(0);
        expect(castsOf(state, moves, "Ruby Medallion").length).toBe(1);
    });

    it("prunes the spell the reducer discounts, not the one after which it still casts", () => {
        // Five Mountains: the Giant at {3}{R} leaves one, short of the
        // Medallion; the Ogre at {2}{R} leaves two, and the Medallion still
        // casts after it.
        const { state, bot } = position(5, [
            "Ruby Medallion",
            "Hill Giant",
            "Gray Ogre",
        ]);
        const { moves } = rootMoves(state, bot);
        expect(castsOf(state, moves, "Hill Giant")).toEqual([]);
        expect(castsOf(state, moves, "Gray Ogre").length).toBeGreaterThan(0);
    });

    it("keeps the spell when the mana it leaves still casts the reducer", () => {
        const { state, bot } = position(5, ["Ruby Medallion", "Gray Ogre"]);
        const { moves } = rootMoves(state, bot);
        expect(castsOf(state, moves, "Gray Ogre").length).toBeGreaterThan(0);
    });

    it("keeps the spell when the reducer cannot pay for it after itself", () => {
        // Three Mountains: the Medallion (2) then the Ogre at {1}{R} needs
        // four.
        const { state, bot } = position(3, ["Ruby Medallion", "Gray Ogre"]);
        const { moves } = rootMoves(state, bot);
        expect(castsOf(state, moves, "Gray Ogre").length).toBeGreaterThan(0);
    });

    it("keeps the spell before a symmetric reducer, which discounts the opponent's spells too", () => {
        // Helm of Awakening: "Spells cost {1} less to cast", every player's.
        const { state, bot } = position(4, ["Helm of Awakening", "Gray Ogre"]);
        const { moves } = rootMoves(state, bot);
        expect(castsOf(state, moves, "Gray Ogre").length).toBeGreaterThan(0);
    });
});
