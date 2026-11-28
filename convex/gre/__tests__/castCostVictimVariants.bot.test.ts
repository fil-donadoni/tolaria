// Cast-side NON-FUNGIBLE sacrifice victims (ADR 0091 Amendment I, issue
// #10965). A spell whose own script reads the permanent sacrificed to cast it
// (CR 608.2h — Eldritch Evolution's "X is 2 plus the sacrificed creature's mana
// value") resolves differently per victim, so the cast enumerator offers one
// `cast-spell` Move per distinct victim snapshot instead of the single
// cheapest-first plan every other cast keeps (CR 118.8 / 601.2f).
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { enumerateMoves, type Move } from "../moves";
import { definitionMatchesFilter, sacrificedCeiling } from "../alternativeCost";
import {
    MAX_CAST_VICTIM_VARIANTS,
    spellReadsCostSacrifice,
} from "../castCostPicks";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardInstanceState } from "../state";

const BOT = "p2";
const OPP = "p1";

const EVOLUTION = getCardByName("Eldritch Evolution");
const NATURAL_ORDER = getCardByName("Natural Order");
const id = (name: string): string => getCardByName(name).id;

function bf(name: string, instanceId: string): CardInstanceState {
    return makeInstance(id(name), {
        id: instanceId,
        controllerId: BOT,
        ownerId: BOT,
        zone: "battlefield",
    });
}

function castVictims(
    spellId: string,
    battlefield: CardInstanceState[]
): string[][] {
    const state = makeState({
        players: [
            makePlayer(OPP),
            makePlayer(BOT, {
                hand: [
                    makeInstance(spellId, {
                        id: "spell",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "hand",
                    }),
                ],
                battlefield,
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 4, C: 0 },
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        phase: "PRECOMBAT_MAIN",
    });
    return enumerateMoves(state, BOT)
        .filter(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell" && m.cardInstanceId === "spell"
        )
        .map((m) => m.castCostPicks?.sacrificeIds ?? []);
}

describe("non-fungible cast victims (ADR 0091 Amendment I, CR 608.2h)", () => {
    it("reads the snapshot on Eldritch Evolution's script, not on Natural Order's", () => {
        expect(spellReadsCostSacrifice(EVOLUTION)).toBe(true);
        expect(spellReadsCostSacrifice(NATURAL_ORDER)).toBe(false);
    });

    it("a spell reading the victim offers one cast per victim, cheapest first", () => {
        expect(
            castVictims(EVOLUTION.id, [
                bf("Grizzly Bears", "bear"),
                bf("Ornithopter", "thopter"),
            ])
        ).toEqual([["thopter"], ["bear"]]);
    });

    it("two victims the resolution cannot tell apart are one cast", () => {
        expect(
            castVictims(EVOLUTION.id, [
                bf("Grizzly Bears", "bear-a"),
                bf("Grizzly Bears", "bear-b"),
                bf("Ornithopter", "thopter"),
            ])
        ).toEqual([["thopter"], ["bear-a"]]);
    });

    it("a spell that does not read the victim keeps the single cheapest-first cast", () => {
        expect(
            castVictims(NATURAL_ORDER.id, [
                bf("Grizzly Bears", "bear"),
                bf("Craw Wurm", "wurm"),
            ])
        ).toEqual([["bear"]]);
    });

    it(`past ${MAX_CAST_VICTIM_VARIANTS} classes, keeps the cheapest and the largest`, () => {
        const victims = castVictims(EVOLUTION.id, [
            bf("Ornithopter", "mv0"),
            bf("Mons's Goblin Raiders", "mv1"),
            bf("Grizzly Bears", "mv2"),
            bf("Hill Giant", "mv4"),
            bf("Craw Wurm", "mv6"),
        ]);
        expect(victims).toEqual([["mv0"], ["mv1"], ["mv2"], ["mv6"]]);
    });
});

describe("a ceiling that reads the sacrificed permanent (CR 608.2h)", () => {
    const filter = {
        type: "Creature" as const,
        manaValueAtMost: {
            sacrificed: { read: "manaValue" as const, plus: 2 },
        },
    };
    const juggernaut = getCardByName("Juggernaut"); // mana value 4
    const wurm = getCardByName("Craw Wurm"); // mana value 6

    it("is the largest the candidates can make it", () => {
        expect(
            sacrificedCeiling(filter.manaValueAtMost, [
                { manaValue: 0 },
                { manaValue: 2 },
            ])
        ).toBe(4);
        expect(sacrificedCeiling(filter.manaValueAtMost, [])).toBeUndefined();
    });

    it("bounds the definition matcher by the board it is given", () => {
        const board = [{ manaValue: 0 }, { manaValue: 2 }];
        expect(definitionMatchesFilter(juggernaut, filter, "hand", board)).toBe(
            true
        );
        expect(definitionMatchesFilter(wurm, filter, "hand", board)).toBe(
            false
        );
        // Nothing to sacrifice: the cast has no victim, so nothing is found.
        expect(definitionMatchesFilter(juggernaut, filter, "hand", [])).toBe(
            false
        );
    });
});
