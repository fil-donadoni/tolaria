// Two rules, one issue (#10499):
//  - the anthem frame on the opponents' side — "Creatures your opponents
//    control get -1/-0." (CR 109.5, CR 613.4c);
//  - the look-and-route whose left-over card goes to the graveyard — "Put one
//    of them into your hand and the other into your graveyard." (CR 608.2c).
//
//  1. GOLDEN fixtures — real corpus cards compiled whole, one per printed form.
//  2. REFUSALS — the neighbours each rule must NOT read (ADR 0105 § 2).
//  3. BEHAVIOUR — the compiled debuff through the real layer system and the
//     wire projection.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import { projectPublicState } from "../../gameProjections";
import { getEffectivePower, getEffectiveToughness } from "../../gre/layers";
import { compileCard } from "../compile";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const ANTHEM = "Creatures your opponents control get -1/-0.";
const WAKER = oracleCard({
    name: "Waker of Waves",
    manaCost: "{5}{U}{U}",
    typeLine: "Creature — Whale",
    power: "7",
    toughness: "7",
    oracleText: `${ANTHEM}\n{1}{U}, Discard this card: Look at the top two cards of your library. Put one of them into your hand and the other into your graveyard.`,
});
/** One card kept of two, the other to the graveyard. */
const KEEP_ONE = {
    op: "lookDistribute",
    keepTo: "hand",
    player: "controller",
    look: 2,
    take: 1,
    destination: "graveyard",
} as const;

describe("goldens", () => {
    it("Waker of Waves: the opponents' anthem, and 'one of them'", () => {
        expect(compiled(WAKER)).toEqual({
            name: "Waker of Waves",
            types: ["Creature"],
            subtypes: ["Whale"],
            manaCost: { X: 5, U: 2 },
            power: 7,
            toughness: 7,
            oracleText: WAKER.oracleText,
            compiledStaticEffects: [
                {
                    kind: "pt-buff",
                    filter: {
                        types: ["Creature"],
                        controllerRelation: "opponents",
                    },
                    power: -1,
                    toughness: 0,
                },
            ],
            activatedAbilities: [
                {
                    id: "waker-of-waves-ability",
                    oracleText: WAKER.oracleText.split("\n")[1],
                    cost: { mana: { X: 1, U: 1 }, discardThis: true },
                    activateFromHand: true,
                    useStack: true,
                    effects: [KEEP_ONE],
                },
            ],
        });
    });

    it("Orazca Puzzle-Door: 'one of those cards'", () => {
        const oracleText =
            "{1}, {T}, Sacrifice this artifact: Look at the top two cards of your library. Put one of those cards into your hand and the other into your graveyard.";
        expect(
            compiled(
                oracleCard({
                    name: "Orazca Puzzle-Door",
                    manaCost: "{U}",
                    typeLine: "Artifact",
                    power: undefined,
                    toughness: undefined,
                    oracleText,
                })
            )
        ).toEqual({
            name: "Orazca Puzzle-Door",
            types: ["Artifact"],
            manaCost: { U: 1 },
            oracleText,
            activatedAbilities: [
                {
                    id: "orazca-puzzle-door-ability",
                    oracleText,
                    cost: { mana: { X: 1 }, tap: true, sacrifice: true },
                    useStack: true,
                    effects: [KEEP_ONE],
                },
            ],
        });
    });

    it("Codecracker Hound: the bare 'Put one into your hand'", () => {
        const enters =
            "When this creature enters, look at the top two cards of your library. Put one into your hand and the other into your graveyard.";
        const oracleText = `${enters}\nWarp {2}{U} (You may cast this card from your hand for its warp cost. Exile this creature at the beginning of the next end step, then you may cast it from exile on a later turn.)`;
        expect(
            compiled(
                oracleCard({
                    name: "Codecracker Hound",
                    manaCost: "{2}{U}",
                    typeLine: "Creature — Dog",
                    power: "2",
                    toughness: "1",
                    oracleText,
                })
            )
        ).toEqual({
            name: "Codecracker Hound",
            types: ["Creature"],
            subtypes: ["Dog"],
            manaCost: { X: 2, U: 1 },
            power: 2,
            toughness: 1,
            oracleText,
            staticAbilities: ["warp"],
            compiledTriggeredAbilities: [
                {
                    id: "codecracker-hound-trigger",
                    oracleText: enters,
                    head: { kind: "entered", scope: "self" },
                    effects: [KEEP_ONE],
                },
            ],
            warp: {
                id: "warp",
                description: "Warp {2}{U}",
                mana: { X: 2, U: 1 },
            },
        });
    });

    it("Dark Bargain: two kept of three, the other to the graveyard", () => {
        const oracleText =
            "Look at the top three cards of your library. Put two of them into your hand and the other into your graveyard. Dark Bargain deals 2 damage to you.";
        expect(
            compiled(
                oracleCard({
                    name: "Dark Bargain",
                    manaCost: "{3}{B}",
                    typeLine: "Instant",
                    power: undefined,
                    toughness: undefined,
                    oracleText,
                })
            )
        ).toEqual({
            name: "Dark Bargain",
            types: ["Instant"],
            manaCost: { X: 3, B: 1 },
            oracleText,
            effects: [
                { ...KEEP_ONE, look: 3, take: 2 },
                {
                    op: "dealDamage",
                    amount: 2,
                    to: { player: "controller" },
                },
            ],
        });
    });
});

describe("refusals", () => {
    const look = (count: string, route: string, verb = "Look at") =>
        `${verb} the top ${count} cards of your library. ${route}`;
    it.each([
        // The opponents' side is read by the anthem frame alone.
        "Creatures your opponents control have flying.",
        "Creatures you control your opponents control get -1/-0.",
        "Creature your opponents control get -1/-0.",
        "Creatures with flying your opponents control get -1/-0.",
        "Creatures of the chosen type your opponents control get -1/-1.",
        "Creatures your opponents control enter tapped.",
    ])("static: %s", (oracleText) => {
        expect(
            compileCard(
                oracleCard({
                    typeLine: "Enchantment",
                    power: undefined,
                    toughness: undefined,
                    oracleText,
                })
            ).state
        ).toBe("unparsed");
    });

    it.each([
        // "the other" is exactly ONE card left over.
        look(
            "three",
            "Put one of them into your hand and the other into your graveyard."
        ),
        look(
            "two",
            "Put two of them into your hand and the other into your graveyard."
        ),
        // A pick from a REVEALED window, and a window of announced size.
        look(
            "two",
            "Put one of them into your hand and the other into your graveyard.",
            "Reveal"
        ),
        look(
            "X",
            "Put one of them into your hand and the other into your graveyard."
        ),
        // A routing with no window in front of it.
        "Put one into your hand and the other into your graveyard.",
        "Search your library for two cards. Put one into your hand and the other into your graveyard. Then shuffle.",
    ])("routing: %s", (oracleText) => {
        expect(
            compileCard(
                oracleCard({
                    typeLine: "Sorcery",
                    power: undefined,
                    toughness: undefined,
                    oracleText,
                })
            ).state
        ).toBe("unparsed");
    });
});

describe("behaviour: the compiled debuff (CR 613.4c)", () => {
    const WAKER_ID = "test-compiled-waker";
    const BEAR_ID = "test-compiled-waker-bear";
    const board = () => {
        const mine = makeInstance(BEAR_ID, { id: "mine" });
        const theirs = makeInstance(BEAR_ID, {
            id: "theirs",
            ownerId: "p2",
            controllerId: "p2",
        });
        const waker = makeInstance(WAKER_ID, { id: "waker" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine, waker] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        return { state, mine, theirs, waker };
    };
    const withCards = <T>(fn: () => T): T =>
        withTemporaryDefinition({ ...compiled(WAKER), id: WAKER_ID }, () =>
            withTemporaryDefinition(
                {
                    ...compiled(oracleCard({ name: "Waker Bear" })),
                    id: BEAR_ID,
                },
                fn
            )
        );

    it("shrinks an opponent's creature, never its controller's", () => {
        withCards(() => {
            const { state, mine, theirs, waker } = board();
            expect(getEffectivePower(state, theirs)).toBe(1);
            expect(getEffectiveToughness(state, theirs)).toBe(2);
            expect(getEffectivePower(state, mine)).toBe(2);
            expect(getEffectivePower(state, waker)).toBe(7);
        });
    });

    it("wire format: the debuff survives projectPublicState", () => {
        withCards(() => {
            const { state } = board();
            for (const viewer of ["p1", "p2"]) {
                const projected = projectPublicState(state, 1, viewer);
                const slim = projected.players[1]!.battlefield.find(
                    (c) => c.id === "theirs"
                )!;
                expect(getEffectivePower(projected, slim)).toBe(1);
                const own = projected.players[0]!.battlefield.find(
                    (c) => c.id === "mine"
                )!;
                expect(getEffectivePower(projected, own)).toBe(2);
            }
        });
    });
});
