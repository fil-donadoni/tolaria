// `cost.exileFilter` on the BOT's paths (CR 602.1a / 118.3 / 701.13a) — the
// reachability walk for the leg, as executable claims, on City of Shadows'
// "{T}, Exile a creature you control: Put a storage counter on this land.":
//
//   * REACHABLE — `enumerateMoves` offers the activation only while a matching
//     permanent exists, and names WHICH one in `costPicks.sacrificeIds` (the
//     pick rides the same selection as a sacrifice; `COST_LEG_CLAIMS`).
//   * PAID — both search entry points exile the named creature exactly as the
//     mutation does; a leg the search leaves unpaid is a leg the Bot plays for
//     free (the tree keeps the creature AND banks the counter).
//   * NOT PROVABLY A NO-OP — the dominance probe never pays a chosen victim, so
//     it must refuse the move rather than "prove" it dominated.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { enumerateMoves } from "../moves";
import type { Move } from "../moves";
import { isProbeEligibleMove } from "../ai/dominance";
import { spendsStandingPermanent } from "../ai/abilityTiming";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardInstanceState, GameState } from "../state";

const CITY = getCardByName("City of Shadows").id;
const ELF = getCardByName("Llanowar Elves").id;
const FOREST = getCardByName("Forest").id;
const STORE = "city-of-shadows-store";
const BOT = "p1";

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

/** City of Shadows plus the given permanents; it is the Bot's main phase. */
function botState(others: CardInstanceState[]): GameState {
    return makeState({
        players: [
            makePlayer(BOT, {
                battlefield: [inst(CITY, "city"), ...others],
            }),
            makePlayer("p2"),
        ],
    });
}

function storeMoves(
    state: GameState
): Extract<Move, { kind: "activate-ability" }>[] {
    return enumerateMoves(state, BOT).filter(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" &&
            m.cardInstanceId === "city" &&
            m.abilityId === STORE
    );
}

const zoneOf = (state: GameState, id: string) => {
    const bot = state.players.find((p) => p.id === BOT)!;
    if (bot.battlefield.some((c) => c.id === id)) return "battlefield";
    if (bot.exile.some((c) => c.id === id)) return "exile";
    if (bot.graveyard.some((c) => c.id === id)) return "graveyard";
    return "elsewhere";
};

describe("cost.exileFilter — enumerateMoves (CR 118.3)", () => {
    it("offers nothing with no creature to exile — a Forest is no payment", () => {
        expect(storeMoves(botState([inst(FOREST, "forest")]))).toHaveLength(0);
    });

    it("searches each distinguishable creature as its own variant", () => {
        const moves = storeMoves(
            botState([
                inst(ELF, "elf-1"),
                inst(ELF, "elf-2", { isTapped: true }),
            ])
        );
        const named = moves.map((m) => m.costPicks?.sacrificeIds ?? []);
        expect(named.map((ids) => ids.join()).sort()).toEqual([
            "elf-1",
            "elf-2",
        ]);
    });
});

describe("cost.exileFilter — paid in the search (CR 602.2b / 701.13a)", () => {
    const board = () =>
        botState([inst(ELF, "elf-1"), inst(ELF, "elf-2", { isTapped: true })]);
    const moveNaming = (state: GameState, id: string) =>
        storeMoves(state).find((m) =>
            (m.costPicks?.sacrificeIds ?? []).includes(id)
        )!;

    it("applyMoveForSearch (1-ply sandbox) exiles the NAMED creature, leaving the caller intact", () => {
        const state = board();
        const next = applyMoveForSearch(state, BOT, moveNaming(state, "elf-2"));

        expect(zoneOf(next, "elf-2")).toBe("exile");
        expect(zoneOf(next, "elf-1")).toBe("battlefield");
        expect(zoneOf(state, "elf-2")).toBe("battlefield");
    });

    it("applyMoveInSearch (tree leaf) exiles the NAMED creature in place", () => {
        const state = board();
        applyMoveInSearch(state, BOT, moveNaming(state, "elf-1"));

        expect(zoneOf(state, "elf-1")).toBe("exile");
        expect(zoneOf(state, "elf-2")).toBe("battlefield");
    });
});

describe("cost.exileFilter — the dominance probe and timing rules", () => {
    it("is never probe-eligible: the probe pays no chosen victim", () => {
        const state = botState([inst(ELF, "elf-1")]);
        const [move] = storeMoves(state);
        expect(move).toBeDefined();
        expect(isProbeEligibleMove(state, BOT, move)).toBe(false);
    });

    it("spendsStandingPermanent: exiling ANOTHER permanent spends board presence", () => {
        const state = botState([inst(ELF, "elf-1")]);
        const source = state.players[0].battlefield.find(
            (c) => c.id === "city"
        )!;
        const ability = getCardByName(
            "City of Shadows"
        ).activatedAbilities!.find((a) => a.id === STORE)!;
        expect(spendsStandingPermanent(state, source, ability)).toBe(true);
    });
});
