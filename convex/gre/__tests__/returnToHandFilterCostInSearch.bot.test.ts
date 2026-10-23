// `cost.returnToHandFilter` on the BOT's paths (CR 602.1a / 118.3) — the
// reachability walk for the leg, as executable claims:
//
//   * REACHABLE — `enumerateMoves` offers the activation only while a matching
//     permanent exists, and names WHICH one in `costPicks.sacrificeIds` (the
//     pick rides the same selection as a sacrifice; `COST_LEG_CLAIMS`).
//   * ANSWERABLE — a real choice (two distinguishable Elves) is searched as
//     separate variants, never collapsed to an arbitrary victim.
//   * PAID — both search entry points bounce the named Elf exactly as the
//     mutation does; a leg the search leaves unpaid is a leg the Bot plays for
//     free (the tree keeps the Elf AND banks the payoff).
//   * NOT PROVABLY A NO-OP — the dominance probe never pays a chosen victim, so
//     it must refuse the move rather than "prove" it dominated.
//
// `applyMoveForSearch` is the greedy 1-ply sandbox and copies,
// `applyMoveInSearch` the ISMCTS tree leaf and mutates in place — different
// code, so both are pinned (the `returnThisToHandCostInSearch` pair).

import { describe, expect, it } from "vitest";
import { getCardByName, preloadDefinitions } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { enumerateMoves } from "../moves";
import type { Move } from "../moves";
import { isProbeEligibleMove } from "../ai/dominance";
import { spendsStandingPermanent } from "../ai/abilityTiming";
import { isDeferrableAction } from "../ai/deferral";
import { getDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardInstanceState, GameState } from "../state";

const ELF = getCardByName("Llanowar Elves").id;
const FOREST = getCardByName("Forest").id;
const SYMBIOTE_ID = "00000000-0000-4000-8000-000065000031";
const BOT = "p1";

preloadDefinitions([
    {
        id: SYMBIOTE_ID,
        name: "Synthetic Bot Symbiote",
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Creature"],
        subtypes: ["Insect"],
        power: 1,
        toughness: 1,
        activatedAbilities: [
            {
                id: "symbiote-gain",
                oracleText:
                    "Return an Elf you control to its owner's hand: You gain 3 life.",
                cost: { returnToHandFilter: { subtypes: ["Elf"] } },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
]);

function inst(
    defId: string,
    id: string,
    extra: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: BOT,
        ownerId: BOT,
        ...extra,
    });
}

/** The Symbiote plus the given permanents; it is the Bot's main phase. */
function botState(others: CardInstanceState[]): GameState {
    return makeState({
        players: [
            makePlayer(BOT, {
                battlefield: [inst(SYMBIOTE_ID, "src"), ...others],
            }),
            makePlayer("p2"),
        ],
    });
}

function symbioteMoves(
    state: GameState
): Extract<Move, { kind: "activate-ability" }>[] {
    return enumerateMoves(state, BOT).filter(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" &&
            m.cardInstanceId === "src" &&
            m.abilityId === "symbiote-gain"
    );
}

const zoneOf = (state: GameState, id: string) => {
    const bot = state.players.find((p) => p.id === BOT)!;
    if (bot.battlefield.some((c) => c.id === id)) return "battlefield";
    if (bot.hand.some((c) => c.id === id)) return "hand";
    if (bot.graveyard.some((c) => c.id === id)) return "graveyard";
    return "elsewhere";
};

describe("cost.returnToHandFilter — enumerateMoves (CR 118.3)", () => {
    it("offers nothing with no Elf to return — a Forest is no payment", () => {
        expect(symbioteMoves(botState([inst(FOREST, "forest")]))).toHaveLength(
            0
        );
    });

    it("searches each distinguishable Elf as its own variant", () => {
        const moves = symbioteMoves(
            botState([
                inst(ELF, "elf-1"),
                inst(ELF, "elf-2", { isTapped: true }),
            ])
        );
        const named = moves.map((m) => m.costPicks?.sacrificeIds ?? []);
        expect(named).toHaveLength(2);
        expect(named.map((ids) => ids.join()).sort()).toEqual([
            "elf-1",
            "elf-2",
        ]);
    });
});

describe("cost.returnToHandFilter — paid in the search (CR 602.1a / 601.2h)", () => {
    const board = () =>
        botState([inst(ELF, "elf-1"), inst(ELF, "elf-2", { isTapped: true })]);
    const moveNaming = (state: GameState, id: string) =>
        symbioteMoves(state).find((m) =>
            (m.costPicks?.sacrificeIds ?? []).includes(id)
        )!;

    it("applyMoveForSearch (1-ply sandbox) bounces the NAMED Elf, leaving the caller intact", () => {
        const state = board();
        const next = applyMoveForSearch(state, BOT, moveNaming(state, "elf-2"));

        expect(zoneOf(next, "elf-2")).toBe("hand");
        expect(zoneOf(next, "elf-1")).toBe("battlefield");
        expect(zoneOf(state, "elf-2")).toBe("battlefield");
    });

    it("applyMoveInSearch (tree leaf) bounces the NAMED Elf in place", () => {
        const state = board();
        applyMoveInSearch(state, BOT, moveNaming(state, "elf-1"));

        expect(zoneOf(state, "elf-1")).toBe("hand");
        expect(zoneOf(state, "elf-2")).toBe("battlefield");
    });
});

describe("cost.returnToHandFilter — the dominance probe refuses it", () => {
    it("is never probe-eligible: the probe pays no chosen victim", () => {
        const state = botState([inst(ELF, "elf-1")]);
        const [move] = symbioteMoves(state);
        expect(move).toBeDefined();
        expect(isProbeEligibleMove(state, BOT, move)).toBe(false);
    });
});

describe("cost.returnToHandFilter — the timing rules read it as giving up a permanent", () => {
    it("spendsStandingPermanent: bouncing ANOTHER permanent spends board presence, like its sacrifice twin", () => {
        const state = botState([inst(ELF, "elf-1")]);
        const source = state.players[0].battlefield.find(
            (c) => c.id === "src"
        )!;
        const ability = getDefinition(SYMBIOTE_ID).activatedAbilities![0];
        expect(spendsStandingPermanent(state, source, ability)).toBe(true);
    });

    it("isDeferrableAction: converting another permanent is never deferred as a free own-side action", () => {
        const state = botState([inst(ELF, "elf-1")]);
        const [move] = symbioteMoves(state);
        expect(move).toBeDefined();
        expect(isDeferrableAction(state, BOT, move)).toBe(false);
    });
});
