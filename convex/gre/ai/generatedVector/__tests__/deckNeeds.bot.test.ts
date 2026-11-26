// The generated vector's deck-relative distance columns (ADR 0186, Decisions
// 3 and 4; issue #10856): how far the seat's own list is from what its cards
// require, and what its searches can fetch — on the owner's two reference
// decks, read from the Preset Deck files the lobby seeds.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    getCardByName,
    getDefinition,
    withTemporaryDefinition,
} from "../../../../cards";
import type { CardDefinition, EffectOp } from "../../../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../../../gameProjections";
import { manaValue } from "../../../constants";
import type { CardInstanceState, GameState } from "../../../state";
import type { DeckKnowledgeBySeat } from "../../../deckKnowledge";
import { projectedToGameState } from "../../stateAdapter";
import {
    NEED_MEASURES,
    countOf,
    generatedVector,
    namedEntries,
    requirementShapes,
} from "..";

type PresetFile = {
    decks: { name: string; main: { count: number; name: string }[] }[];
};

const presetFile = (file: string): PresetFile =>
    JSON.parse(
        readFileSync(
            fileURLToPath(
                new URL(`../../../../../data/${file}`, import.meta.url)
            ),
            "utf8"
        )
    ) as PresetFile;

/** A Preset Deck's main deck as card ids — every card of it the catalogue
 *  holds, each id repeated by its count. */
function presetList(file: string, deckName: string): string[] {
    const deck = presetFile(file).decks.find((d) => d.name === deckName);
    if (!deck) throw new Error(`no preset deck "${deckName}" in ${file}`);
    const ids: string[] = [];
    for (const entry of deck.main) {
        let id: string;
        try {
            id = getCardByName(entry.name).id;
        } catch {
            continue;
        }
        for (let i = 0; i < entry.count; i++) ids.push(id);
    }
    return ids;
}

const TRON = presetList("modern-preset-decks.json", "Eldrazi Tron");
const AMULET = presetList(
    "modern-metagame-decks.json",
    "Mono-Green Amulet Titan"
);

const id = (name: string): string => getCardByName(name).id;

const card = (
    name: string,
    zone: "hand" | "battlefield" | "graveyard" | "exile"
): CardInstanceState =>
    makeInstance(id(name), { zone, controllerId: "p1", ownerId: "p1" });

const knows = (list: string[], seat = "p1"): DeckKnowledgeBySeat => [
    { playerId: seat, cardIds: list },
];

const need = (
    state: GameState,
    list: string[] | undefined,
    seat = "p1"
): [string, number][] =>
    namedEntries(
        generatedVector(
            state,
            "p1",
            undefined,
            list ? knows(list, seat) : undefined
        )
    ).filter(([name]) => name.startsWith("need."));

const measure = (
    state: GameState,
    list: string[],
    name: (typeof NEED_MEASURES)[number]
): number =>
    countOf(
        generatedVector(state, "p1", undefined, knows(list)),
        `need.${name}.self`
    );

/** The Tron position of the owner's reference Line: Urza's Power Plant in
 *  play, two Forests for mana, Sylvan Scrying in hand — and Urza's Tower
 *  where `tower` says. */
function tron(tower: "library" | "hand" | "exile"): GameState {
    const hand = [card("Sylvan Scrying", "hand")];
    const exile: CardInstanceState[] = [];
    if (tower === "hand") hand.push(card("Urza's Tower", "hand"));
    if (tower === "exile") exile.push(card("Urza's Tower", "exile"));
    return makeState({
        players: [
            makePlayer("p1", {
                hand,
                battlefield: [
                    card("Urza's Power Plant", "battlefield"),
                    card("Forest", "battlefield"),
                    card("Forest", "battlefield"),
                ],
                exile,
            }),
            makePlayer("p2"),
        ],
    });
}

describe("deck-relative distance — Tron (issue #10856)", () => {
    it("reads the three Urza lands' assembled mana as requirements of the list", () => {
        // The Tower, the Mine and the Power Plant each wait for the other
        // two; nothing else in the list waits for a permanent.
        expect(measure(tron("library"), TRON, "requirements")).toBe(3);
    });

    it("the distance is one step shorter once the Tower is fetched, and longer again once it is gone", () => {
        // Each Urza land needs itself and the other two in play: the Power
        // Plant is (0), the Mine is in the library (2), the Tower in the
        // library (2) or in hand (1).
        const before = measure(tron("library"), TRON, "distanceMin");
        const fetched = measure(tron("hand"), TRON, "distanceMin");
        const removed = measure(tron("exile"), TRON, "distanceMin");
        expect(before).toBe(4);
        expect(fetched).toBe(before - 1);
        expect(removed).toBe(before);
        expect(measure(tron("hand"), TRON, "distance3")).toBe(3);
        expect(measure(tron("library"), TRON, "distance3")).toBe(0);
    });

    it("the land tutor in hand can fetch the missing piece, and the seat can pay for it", () => {
        const state = tron("hand");
        expect(measure(state, TRON, "searches")).toBe(1);
        expect(measure(state, TRON, "searchesPayable")).toBe(1);
        expect(measure(state, TRON, "fetchable")).toBe(3);
        expect(measure(state, TRON, "fetchableNow")).toBe(3);
        expect(measure(state, TRON, "findsPiece")).toBe(1);
        // With no Forest the {1}{G} tutor is held, not usable this turn:
        // the Power Plant alone makes one colourless.
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.card.id !== id("Forest")
        );
        expect(measure(state, TRON, "fetchable")).toBe(3);
        expect(measure(state, TRON, "fetchableNow")).toBe(0);
        expect(measure(state, TRON, "searchesPayable")).toBe(0);
    });

    it("the full set in play meets every requirement", () => {
        const state = tron("library");
        state.players[0].battlefield.push(
            card("Urza's Tower", "battlefield"),
            card("Urza's Mine", "battlefield")
        );
        expect(measure(state, TRON, "met")).toBe(3);
        expect(measure(state, TRON, "distanceMin")).toBe(0);
        expect(measure(state, TRON, "fetchable")).toBe(0);
    });
});

/** The Amulet position: three Forests and one tutor in hand. */
function amulet(tutor: string): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [card(tutor, "hand")],
                battlefield: [
                    card("Forest", "battlefield"),
                    card("Forest", "battlefield"),
                    card("Forest", "battlefield"),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

describe("deck-relative distance — Amulet Titan (issue #10856)", () => {
    it("a tutor whose finds include the payoff reads differently from one whose finds do not", () => {
        // Summoner's Pact finds the list's green creatures, Primeval Titan
        // among them; Sylvan Scrying finds only lands.
        const pact = need(amulet("Summoner's Pact"), AMULET);
        const scrying = need(amulet("Sylvan Scrying"), AMULET);
        expect(pact).not.toEqual(scrying);
        expect(
            measure(amulet("Summoner's Pact"), AMULET, "findsManaValueMax")
        ).toBeGreaterThanOrEqual(
            manaValue(getDefinition(id("Primeval Titan")).manaCost)
        );
        expect(
            measure(amulet("Sylvan Scrying"), AMULET, "findsManaValueMax")
        ).toBe(0);
    });

    it("a tutor whose finds include another tutor reads it, and so does its payability", () => {
        // Tolaria West's transmute finds a mana value 0 card: Summoner's Pact.
        const west = amulet("Tolaria West");
        expect(measure(west, AMULET, "findsSearch")).toBe(1);
        // {1}{U}{U} off three Forests: held, not usable.
        expect(measure(west, AMULET, "searchesPayable")).toBe(0);
        // Every copy of the Pact already seen: nothing left to find.
        west.players[0].graveyard = [
            card("Summoner's Pact", "graveyard"),
            card("Summoner's Pact", "graveyard"),
        ];
        expect(measure(west, AMULET, "findsSearch")).toBe(0);
    });
});

describe("deck-relative distance — what the seat may read (issue #10856)", () => {
    it("a seat with no Deck Knowledge yields zeros, never a guess", () => {
        for (const state of [tron("hand"), amulet("Summoner's Pact")]) {
            expect(need(state, undefined)).toEqual([]);
            // Knowledge of ANOTHER seat's list is not the seat's own.
            expect(need(state, TRON, "p2")).toEqual([]);
            expect(need(state, [])).toEqual([]);
        }
    });

    it("the library is never read: its order and the Brain's projection give the same columns", () => {
        const full = tron("hand");
        // A real library: the list minus what is in play and in hand.
        const placed = new Map<string, number>();
        for (const c of [
            ...full.players[0].battlefield,
            ...full.players[0].hand,
        ]) {
            const cid = String(c.card.id);
            placed.set(cid, (placed.get(cid) ?? 0) + 1);
        }
        const library: CardInstanceState[] = [];
        for (const cid of TRON) {
            const n = placed.get(cid) ?? 0;
            if (n > 0) {
                placed.set(cid, n - 1);
                continue;
            }
            library.push(
                makeInstance(cid, {
                    zone: "library",
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
        }
        full.players[0].library = library;
        const reference = need(full, TRON);
        expect(reference.length).toBeGreaterThan(3);

        const reversed = structuredClone(full);
        reversed.players[0].library.reverse();
        expect(need(reversed, TRON)).toEqual(reference);

        const brain = projectedToGameState(
            projectPublicState(full, 1, "p1"),
            undefined,
            "p1"
        );
        expect(need(brain, TRON)).toEqual(reference);
    });
});

describe("deck-relative distance — the data shapes (issue #10856)", () => {
    const bolt = getDefinition(id("Lightning Bolt"));
    const ARTIFACT = "Ornithopter";

    /** A seat holding `requirer` with `artifacts` Ornithopters in play, and
     *  a list of the requirer and four Ornithopters. */
    function withArtifacts(
        def: CardDefinition,
        artifacts: number,
        requirerZone: "hand" | "battlefield"
    ): { state: GameState; list: string[] } {
        const battlefield = [];
        for (let i = 0; i < artifacts; i++) {
            battlefield.push(card(ARTIFACT, "battlefield"));
        }
        const requirer = makeInstance(def.id, {
            zone: requirerZone,
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: requirerZone === "hand" ? [requirer] : [],
                    battlefield:
                        requirerZone === "battlefield"
                            ? [...battlefield, requirer]
                            : battlefield,
                }),
                makePlayer("p2"),
            ],
        });
        const ornithopter = id(ARTIFACT);
        return {
            state,
            list: [def.id, ornithopter, ornithopter, ornithopter, ornithopter],
        };
    }

    it("a cast condition: each missing artifact is one more step", () => {
        const def: CardDefinition = {
            ...bolt,
            id: "deck-needs-cast-condition",
            castCondition: {
                kind: "control",
                filter: { types: "Artifact" },
                minCount: 2,
                reason: "Cast this spell only if you control two artifacts.",
            },
        };
        withTemporaryDefinition(def, () => {
            expect(requirementShapes(def, [def.id])).toEqual([
                "read.castCondition",
            ]);
            for (const [inPlay, steps] of [
                [0, 4],
                [1, 2],
            ] as const) {
                const { state, list } = withArtifacts(def, inPlay, "hand");
                expect(measure(state, list, "distanceMin")).toBe(steps);
            }
            const { state, list } = withArtifacts(def, 2, "hand");
            expect(measure(state, list, "met")).toBe(1);
        });
    });

    it("a script's count of the controller's battlefield compared with a literal", () => {
        const def: CardDefinition = {
            ...bolt,
            id: "deck-needs-script-count",
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: {
                            count: {
                                zone: "battlefield",
                                controller: "controller",
                                filter: { type: "Artifact" },
                            },
                        },
                        op: "ge",
                        right: 3,
                    },
                    then: [{ op: "draw", count: 1, player: "controller" }],
                } as unknown as EffectOp,
            ],
        };
        withTemporaryDefinition(def, () => {
            expect(requirementShapes(def, [def.id])).toEqual([
                "read.scriptCount",
            ]);
            const { state, list } = withArtifacts(def, 1, "hand");
            // Two more Ornithopters from the library, two steps each.
            expect(measure(state, list, "distanceMin")).toBe(4);
            expect(measure(state, list, "distanceFar")).toBe(1);
        });
    });

    it("a permanent that matches its own count's filter counts itself", () => {
        // "{T}: if you control three or more artifacts, draw a card" on an
        // artifact: with it and two more artifacts in play, the count is met.
        const base = getDefinition(id(ARTIFACT));
        const def: CardDefinition = {
            ...base,
            id: "deck-needs-counts-itself",
            activatedAbilities: [
                {
                    id: "deck-needs-counts-itself-draw",
                    oracleText: "",
                    cost: { tap: true },
                    useStack: true,
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: {
                                    count: {
                                        zone: "battlefield",
                                        controller: "controller",
                                        filter: { type: "Artifact" },
                                    },
                                },
                                op: "ge",
                                right: 3,
                            },
                            then: [
                                { op: "draw", count: 1, player: "controller" },
                            ],
                        } as unknown as EffectOp,
                    ],
                },
            ],
        };
        withTemporaryDefinition(def, () => {
            const met = withArtifacts(def, 2, "battlefield");
            expect(measure(met.state, met.list, "met")).toBe(1);
            const short = withArtifacts(def, 1, "battlefield");
            expect(measure(short.state, short.list, "distanceMin")).toBe(2);
        });
    });

    it("a requirement no copy left can meet is unreachable, never a distance", () => {
        const def: CardDefinition = {
            ...bolt,
            id: "deck-needs-unreachable",
            castCondition: {
                kind: "control",
                filter: { types: "Planeswalker" },
                reason: "Cast this spell only if you control a planeswalker.",
            },
        };
        withTemporaryDefinition(def, () => {
            const { state, list } = withArtifacts(def, 0, "hand");
            expect(measure(state, list, "unreachable")).toBe(1);
            expect(measure(state, list, "distanceMin")).toBe(0);
        });
    });
});
