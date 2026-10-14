// Board-derived mana descriptors on the CLIENT (issue #5195, CR 107.1 / 106.7
// / 605.1a). The tap affordance and the mana picker read the same unified
// option list the server resolves an index against (`getManaTapOptions`),
// but they read it off the PROJECTED board: a field the wire drops — a
// subtype the "Elf" filter matches, the supertype "basic Swamp" reads, the
// opponent's battlefield a whole-board count needs — would make the client
// offer what the server refuses, or hide what it accepts.
//
// So every assertion here goes through `projectPublicState` and the client's
// own `card-utils` helpers, never a hand-built instance.

import { describe, expect, it } from "vitest";
import { getManaChoices, hasManaAbility } from "../card-utils";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import { getManaTapOptions } from "@convex/gre/constants";
import type { CardDefinition } from "@convex/cards/types";
import { withTemporaryDefinition } from "@convex/cards/registry";
import { getCardByName } from "@convex/cards";
import type { CardInstanceState } from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";

// The compiled shapes (pinned against the compiler by
// `convex/oracle/__tests__/manaBoardDerived.test.ts`).
const PRIEST_OF_TITANIA: CardDefinition = {
    id: "test-5195-wire-priest-of-titania",
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
    id: "test-5195-wire-cabal-stronghold",
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
    id: "test-5195-wire-reflecting-pool",
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
    id = `wire-${serial++}`
): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
    });
}

/** The board projected for p1, read back as the client reads it: the source
 *  instance `sourceId` and every player's battlefield. */
function projected(
    mine: CardInstanceState[],
    theirs: CardInstanceState[],
    sourceId: string
): {
    source: CardInstance;
    players: { id: string; battlefield: CardInstance[] }[];
} {
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: mine }),
            makePlayer("p2", { battlefield: theirs }),
        ],
    });
    const wire = projectPublicState(state, 1, "p1");
    const players = wire.players.map((p) => ({
        id: p.id,
        battlefield: p.battlefield as unknown as CardInstance[],
    }));
    const source = players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === sourceId)!;
    return { source, players };
}

const id = (name: string) => getCardByName(name).id;

describe("client — a board count read off the projected board (CR 107.1)", () => {
    it("an empty Gaea's Cradle is no tappable source; beside a creature it is", () => {
        const empty = projected(
            [on(id("Gaea's Cradle"), "p1", "cradle")],
            [on(id("Grizzly Bears"), "p2")],
            "cradle"
        );
        expect(hasManaAbility(empty.source, undefined, empty.players)).toBe(
            false
        );

        const live = projected(
            [
                on(id("Gaea's Cradle"), "p1", "cradle"),
                on(id("Grizzly Bears"), "p1"),
            ],
            [],
            "cradle"
        );
        expect(hasManaAbility(live.source, undefined, live.players)).toBe(true);
    });

    it("Priest of Titania counts the opponent's projected Elves (CR 109.2)", () =>
        withDefinitions([PRIEST_OF_TITANIA], () => {
            const { source, players } = projected(
                [on(PRIEST_OF_TITANIA.id, "p1", "priest")],
                [
                    on(id("Llanowar Elves"), "p2"),
                    on(id("Llanowar Elves"), "p2"),
                ],
                "priest"
            );
            expect(hasManaAbility(source, undefined, players)).toBe(true);
            // The very list the client's tap affordance and picker read.
            expect(
                getManaTapOptions(
                    source as unknown as CardInstanceState,
                    source.controllerId,
                    players.map((p) => ({
                        playerId: p.id,
                        battlefield:
                            p.battlefield as unknown as CardInstanceState[],
                    }))
                )
            ).toEqual([{ G: 3 }]);
        }));
});

describe("client — the picker lists each ability at its own count (CR 605.1a)", () => {
    it("Cabal Stronghold offers {C} and {B}{B} over two projected basic Swamps", () =>
        withDefinitions([CABAL_STRONGHOLD], () => {
            const { source, players } = projected(
                [
                    on(CABAL_STRONGHOLD.id, "p1", "stronghold"),
                    on(id("Swamp"), "p1"),
                    on(id("Swamp"), "p1"),
                ],
                [on(id("Swamp"), "p2")],
                "stronghold"
            );
            expect(getManaChoices(source, players)).toEqual([
                { C: 1 },
                { B: 2 },
            ]);
        }));
});

describe("client — any TYPE a land could produce (CR 106.7 / 106.1b)", () => {
    it("Reflecting Pool offers {G} and {C} beside a Forest and a {C} land, nothing from the opponent", () =>
        withDefinitions([REFLECTING_POOL, CABAL_STRONGHOLD], () => {
            const { source, players } = projected(
                [
                    on(REFLECTING_POOL.id, "p1", "pool"),
                    on(id("Forest"), "p1"),
                    on(CABAL_STRONGHOLD.id, "p1"),
                ],
                [on(id("Island"), "p2")],
                "pool"
            );
            expect(getManaChoices(source, players)).toEqual([
                { G: 1 },
                { C: 1 },
            ]);
        }));
});
