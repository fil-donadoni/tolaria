// Board-derived mana descriptors (issue #5195) — the JSON forms a compiled
// definition carries where the hand-written catalogue used a `manaAmount`
// closure:
//
//   - `manaAmountSource` — "Add {G} for each creature you control" (Gaea's
//     Cradle), "…for each Elf on the battlefield" (Priest of Titania): the
//     ability adds its `manaProduced` unit once per permanent the filter
//     matches when it resolves (CR 107.1, 605.1a). "You control" is the
//     ability's controller (CR 109.5); "on the battlefield" is every player's
//     permanents (CR 109.2).
//   - `manaColorSource.colors: "producesType"` — "one mana of any TYPE that a
//     land you control could produce" (Reflecting Pool): the six types of
//     mana, colourless included (CR 106.1b, 106.7), where the colour read
//     (`"produces"`, Fellwar Stone) drops {C} (CR 202.2).
//
// Plus the two engine rules those descriptors exposed:
//
//   - CR 605.1a — the option list scales EACH mana ability by its OWN count:
//     Cabal Stronghold's "{T}: Add {C}" stays {C} beside its Swamp-counting
//     "{3}, {T}: Add {B}", and its fixed tap is never scaled by that count.
//   - CR 106.7 — "could produce" is what an ability WOULD add if it resolved
//     now: an empty Gaea's Cradle could produce nothing, so a Reflecting Pool
//     beside it gains no {G}.
//
// Definitions are the compiled shapes (pinned against the compiler by
// `convex/oracle/__tests__/manaBoardDerived.test.ts`), registered for the
// test only, so this file depends on neither the compiler nor the packed
// catalogue.

import { describe, expect, it } from "vitest";
import {
    boardDerivedManaChoices,
    getDynamicManaProduced,
    getFixedManaAmount,
    getManaTapOptions,
    getManaTapOptionsDetailed,
    getProducibleColorsOnBoard,
    hasManaAbility,
} from "../constants";
import type { CardInstanceState, GameState } from "../state";
import type { CardDefinition } from "../../cards/types";
import { withTemporaryDefinition } from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { gaeasCradle } from "../../cards/sets/usg/colorless.cards";
import {
    badlands,
    forest,
    island,
    swamp,
} from "../../cards/sets/lea/colorless.cards";
import { grizzlyBears, llanowarElves } from "../../cards/sets/lea/green.cards";
import { fellwarStone } from "../../cards/sets/drk/colorless.cards";

const PRIEST_OF_TITANIA: CardDefinition = {
    id: "test-5195-priest-of-titania",
    name: "Priest of Titania",
    oracleText: "{T}: Add {G} for each Elf on the battlefield.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "priest-of-titania-mana",
            oracleText: "{T}: Add {G} for each Elf on the battlefield.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { G: 1 },
            manaAmountSource: { filter: { subtypes: ["Elf"] } },
        },
    ],
};

const CABAL_STRONGHOLD: CardDefinition = {
    id: "test-5195-cabal-stronghold",
    name: "Cabal Stronghold",
    oracleText:
        "{T}: Add {C}.\n{3}, {T}: Add {B} for each basic Swamp you control.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "cabal-stronghold-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { C: 1 },
        },
        {
            id: "cabal-stronghold-mana-2",
            oracleText: "{3}, {T}: Add {B} for each basic Swamp you control.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: false,
            manaProduced: { B: 1 },
            manaAmountSource: {
                filter: {
                    subtypes: ["Swamp"],
                    supertypes: ["Basic"],
                    controllerRelation: "you",
                },
            },
        },
    ],
};

const REFLECTING_POOL: CardDefinition = {
    id: "test-5195-reflecting-pool",
    name: "Reflecting Pool",
    oracleText:
        "{T}: Add one mana of any type that a land you control could produce.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "reflecting-pool-mana",
            oracleText:
                "{T}: Add one mana of any type that a land you control could produce.",
            cost: { tap: true },
            useStack: false,
            manaChoices: [
                { W: 1 },
                { U: 1 },
                { B: 1 },
                { R: 1 },
                { G: 1 },
                { C: 1 },
            ],
            manaColorSource: {
                filter: { types: ["Land"], controllerRelation: "you" },
                colors: "producesType",
            },
        },
    ],
};

/** Registers every definition for the duration of `fn`. */
function withDefinitions<T>(defs: readonly CardDefinition[], fn: () => T): T {
    if (defs.length === 0) return fn();
    return withTemporaryDefinition(defs[0], () =>
        withDefinitions(defs.slice(1), fn)
    );
}

let serial = 0;
function on(
    cardId: string,
    controllerId: "p1" | "p2",
    id = `perm-${serial++}`
): CardInstanceState {
    return makeInstance(cardId, { id, controllerId, ownerId: controllerId });
}

function board(
    mine: CardInstanceState[],
    theirs: CardInstanceState[] = []
): GameState {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: mine }),
            makePlayer("p2", { battlefield: theirs }),
        ],
    });
}

const bf = (state: GameState) =>
    state.players.map((p) => ({ playerId: p.id, battlefield: p.battlefield }));

describe("manaAmountSource — a count of permanents the controller controls (CR 107.1 / 109.5)", () => {
    it("Gaea's Cradle adds {G} per creature its controller controls, never the opponent's", () => {
        const cradle = on(gaeasCradle().id, "p1");
        const state = board(
            [cradle, on(grizzlyBears().id, "p1"), on(llanowarElves().id, "p1")],
            [on(grizzlyBears().id, "p2"), on(grizzlyBears().id, "p2")]
        );
        expect(getManaTapOptions(cradle, "p1", bf(state))).toEqual([{ G: 2 }]);
        expect(
            getDynamicManaProduced(cradle, state.players[0].battlefield)
        ).toEqual({ G: 2 });
        expect(
            getFixedManaAmount(cradle, "G", state.players[0].battlefield)
        ).toBe(2);
    });

    it("an empty Gaea's Cradle offers no payment option and is no mana source (CR 605.1a, issue #1889)", () => {
        const cradle = on(gaeasCradle().id, "p1");
        const state = board([cradle], [on(grizzlyBears().id, "p2")]);
        expect(getManaTapOptionsDetailed(cradle, "p1", bf(state))).toEqual([]);
        expect(
            hasManaAbility(cradle, undefined, state.players[0].battlefield)
        ).toBe(false);
    });

    it("a board-blind caller keeps the printed unit as the representative output", () => {
        expect(getManaTapOptions(on(gaeasCradle().id, "p1"))).toEqual([
            { G: 1 },
        ]);
    });
});

describe("manaAmountSource — a count over the whole battlefield (CR 109.2)", () => {
    it("Priest of Titania counts EVERY player's Elves, itself included", () =>
        withDefinitions([PRIEST_OF_TITANIA], () => {
            const priest = on(PRIEST_OF_TITANIA.id, "p1");
            const state = board(
                [
                    priest,
                    on(llanowarElves().id, "p1"),
                    on(grizzlyBears().id, "p1"),
                ],
                [on(llanowarElves().id, "p2"), on(llanowarElves().id, "p2")]
            );
            expect(getManaTapOptions(priest, "p1", bf(state))).toEqual([
                { G: 4 },
            ]);
            expect(
                getDynamicManaProduced(
                    priest,
                    state.players[0].battlefield,
                    undefined,
                    bf(state)
                )
            ).toEqual({ G: 4 });
        }));

    it("without every battlefield the whole-board count has NO answer — never the controller's half", () =>
        withDefinitions([PRIEST_OF_TITANIA], () => {
            const priest = on(PRIEST_OF_TITANIA.id, "p1");
            const state = board(
                [priest],
                [on(llanowarElves().id, "p2"), on(llanowarElves().id, "p2")]
            );
            expect(
                getDynamicManaProduced(priest, state.players[0].battlefield)
            ).toBeNull();
        }));
});

describe("CR 605.1a — each mana ability is scaled by its OWN count (Cabal Stronghold)", () => {
    it("the {C} ability stays {C} beside the Swamp-counting {B} ability; a nonbasic Swamp is not counted", () =>
        withDefinitions([CABAL_STRONGHOLD], () => {
            const stronghold = on(CABAL_STRONGHOLD.id, "p1");
            const state = board([
                stronghold,
                on(swamp().id, "p1"),
                on(swamp().id, "p1"),
                on(badlands().id, "p1"),
            ]);
            const options = getManaTapOptionsDetailed(
                stronghold,
                "p1",
                bf(state)
            );
            expect(options.map((o) => o.mana)).toEqual([{ C: 1 }, { B: 2 }]);
            expect(options.map((o) => o.source)).toEqual([
                { kind: "activated", abilityId: "cabal-stronghold-mana" },
                { kind: "activated", abilityId: "cabal-stronghold-mana-2" },
            ]);
        }));

    it("with no basic Swamp the {C} tap still adds exactly one {C} — the fixed path is never scaled by the other ability's zero", () =>
        withDefinitions([CABAL_STRONGHOLD], () => {
            const stronghold = on(CABAL_STRONGHOLD.id, "p1");
            const state = board([stronghold, on(forest().id, "p1")]);
            const mine = state.players[0].battlefield;
            expect(getManaTapOptions(stronghold, "p1", bf(state))).toEqual([
                { C: 1 },
            ]);
            expect(getDynamicManaProduced(stronghold, mine)).toBeNull();
            expect(getFixedManaAmount(stronghold, "C", mine)).toBe(1);
            expect(hasManaAbility(stronghold, undefined, mine)).toBe(true);
        }));
});

describe('manaColorSource "producesType" — any TYPE a land could produce (CR 106.7 / 106.1b)', () => {
    it("Reflecting Pool offers the colours its controller's lands could produce, never an opponent's", () =>
        withDefinitions([REFLECTING_POOL], () => {
            const pool = on(REFLECTING_POOL.id, "p1");
            const state = board(
                [pool, on(forest().id, "p1"), on(island().id, "p1")],
                [on(swamp().id, "p2")]
            );
            expect(getManaTapOptions(pool, "p1", bf(state))).toEqual([
                { U: 1 },
                { G: 1 },
            ]);
        }));

    it("offers {C} beside a land that taps for colourless — a colour read would not", () =>
        withDefinitions([REFLECTING_POOL, CABAL_STRONGHOLD], () => {
            const pool = on(REFLECTING_POOL.id, "p1");
            const stronghold = on(CABAL_STRONGHOLD.id, "p1");
            const state = board([pool, stronghold, on(forest().id, "p1")]);
            expect(getManaTapOptions(pool, "p1", bf(state))).toEqual([
                { G: 1 },
                { C: 1 },
            ]);
            // CR 202.2 — the same board read for COLOURS (Fellwar Stone's
            // `"produces"`) never offers {C}.
            expect(
                boardDerivedManaChoices(
                    {
                        filter: { types: ["Land"], controllerRelation: "you" },
                        colors: "produces",
                    },
                    pool,
                    "p1",
                    bf(state)
                )
            ).toEqual([{ G: 1 }]);
        }));

    it("two Reflecting Pools alone could produce nothing (CR 106.7)", () =>
        withDefinitions([REFLECTING_POOL], () => {
            const a = on(REFLECTING_POOL.id, "p1");
            const b = on(REFLECTING_POOL.id, "p1");
            const state = board([a, b]);
            expect(getManaTapOptions(a, "p1", bf(state))).toEqual([]);
        }));
});

describe('CR 106.7 — "could produce" reads a scaled ability at its CURRENT count', () => {
    it("an empty Gaea's Cradle could produce no {G}, so a Reflecting Pool beside it gains none", () =>
        withDefinitions([REFLECTING_POOL], () => {
            const pool = on(REFLECTING_POOL.id, "p1");
            const cradle = on(gaeasCradle().id, "p1");
            const state = board([pool, cradle, on(island().id, "p1")]);
            expect(getManaTapOptions(pool, "p1", bf(state))).toEqual([
                { U: 1 },
            ]);
            expect([...getProducibleColorsOnBoard(cradle, bf(state))]).toEqual(
                []
            );
        }));

    it("the same Cradle beside a creature could produce {G}, and the Pool offers it", () =>
        withDefinitions([REFLECTING_POOL], () => {
            const pool = on(REFLECTING_POOL.id, "p1");
            const state = board([
                pool,
                on(gaeasCradle().id, "p1"),
                on(grizzlyBears().id, "p1"),
            ]);
            expect(getManaTapOptions(pool, "p1", bf(state))).toEqual([
                { G: 1 },
            ]);
        }));

    it("an opponent's empty Cradle gives Fellwar Stone no {G} either", () => {
        const stone = on(fellwarStone().id, "p1");
        const state = board([stone], [on(gaeasCradle().id, "p2")]);
        expect(getManaTapOptions(stone, "p1", bf(state))).toEqual([]);
    });
});
