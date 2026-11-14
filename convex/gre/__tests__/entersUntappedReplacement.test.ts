// "Lands you control enter untapped" (Spelunking) — a battlefield-scanned
// replacement effect on the entering permanent (CR 614.1d), ordered against
// every "enters tapped" replacement by the entering permanent's controller
// (CR 616.1): applied last, it leaves the land untapped, and the engine takes
// that order without asking. Gatherer's Spelunking ruling extends it to a land
// an effect simply "puts onto the battlefield tapped". A land's "pay or enter
// tapped" prompt (CR 614.12, shock lands) buys nothing under it, so it is not
// raised and nothing is paid.

import { describe, it, expect } from "vitest";
import type { CardDefinition } from "../../cards/types";
import { expandCompiledStatics } from "../../cards/compiledStatics";
import { withTemporaryDefinition } from "../../cards/registry";
import { steamVents } from "../../cards/sets/gpt/colorless.cards";
import { kismet } from "../../cards/sets/leg/white.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { applyPlayLand } from "../playLand";
import {
    createTokenPermanents,
    getPlayer,
    putHandCardOntoBattlefield,
} from "../state";
import { projectPublicState } from "../../gameProjections";

const SOURCE_ID = "test-lands-enter-untapped";
const TAPLAND_ID = "test-enters-tapped-land";

/** An enchantment printing only "Lands you control enter untapped.", built
 *  through the compiled descriptor the grammar will emit (ADR 0054). */
const source: CardDefinition = expandCompiledStatics({
    id: SOURCE_ID,
    name: "Untapped Entry Source",
    types: ["Enchantment"],
    manaCost: { generic: 0 },
    compiledStaticEffects: [
        {
            kind: "enters-untapped-replacement",
            id: "lands-enter-untapped",
            oracleText: "Lands you control enter untapped.",
            filter: { types: ["Land"], controllerRelation: "you" },
        },
    ],
} as CardDefinition);

/** A land printing "This land enters tapped." (CR 614.1d). */
const tapland: CardDefinition = {
    id: TAPLAND_ID,
    name: "Tapped Entry Land",
    types: ["Land"],
    entersTapped: true,
} as CardDefinition;

function withDefs<T>(fn: () => T): T {
    return withTemporaryDefinition(source, () =>
        withTemporaryDefinition(tapland, fn)
    );
}

function sourceFor(controllerId: "p1" | "p2", id = "untapper") {
    return makeInstance(SOURCE_ID, {
        id,
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        types: ["Enchantment"],
    });
}

function boardWith(
    handCardId: string,
    p1Battlefield: ReturnType<typeof makeInstance>[],
    p2Battlefield: ReturnType<typeof makeInstance>[] = []
) {
    const card = makeInstance(handCardId, { id: "land", zone: "hand" });
    const state = makeState({
        players: [
            makePlayer("p1", { hand: [card], battlefield: p1Battlefield }),
            makePlayer("p2", { battlefield: p2Battlefield }),
        ],
    });
    return { state, player: getPlayer(state, "p1") };
}

function enteredLand(state: ReturnType<typeof makeState>) {
    return getPlayer(state, "p1").battlefield.find((c) => c.id === "land");
}

describe("enters-untapped replacement vs the land's own tapped clause (CR 614.1d / 616.1)", () => {
    it("a land printing 'enters tapped' enters UNTAPPED under the replacement", () => {
        withDefs(() => {
            const { state, player } = boardWith(TAPLAND_ID, [sourceFor("p1")]);
            applyPlayLand(state, player, "land");
            expect(enteredLand(state)?.isTapped).toBe(false);
        });
    });

    it("control: with no source the same land enters TAPPED", () => {
        withDefs(() => {
            const { state, player } = boardWith(TAPLAND_ID, []);
            applyPlayLand(state, player, "land");
            expect(enteredLand(state)?.isTapped).toBe(true);
        });
    });

    it("an OPPONENT's source does not reach lands you control ('you control')", () => {
        withDefs(() => {
            const { state, player } = boardWith(
                TAPLAND_ID,
                [],
                [sourceFor("p2")]
            );
            applyPlayLand(state, player, "land");
            expect(enteredLand(state)?.isTapped).toBe(true);
        });
    });

    it("Kismet's opponent-forced tapped entry is outranked too (CR 616.1, controller orders)", () => {
        withDefs(() => {
            const { state, player } = boardWith(
                TAPLAND_ID,
                [sourceFor("p1")],
                [
                    makeInstance(kismet().id, {
                        id: "kismet",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "battlefield",
                    }),
                ]
            );
            applyPlayLand(state, player, "land");
            expect(enteredLand(state)?.isTapped).toBe(false);
        });
    });
});

describe("enters-untapped replacement vs a 'pay or enter tapped' prompt (CR 614.12 / 616.1)", () => {
    it("a played shock land raises NO pay-choice, pays nothing, enters untapped", () => {
        withDefs(() => {
            const { state, player } = boardWith(steamVents().id, [
                sourceFor("p1"),
            ]);
            applyPlayLand(state, player, "land");
            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(enteredLand(state)?.isTapped).toBe(false);
            expect(getPlayer(state, "p1").life).toBe(20);
            expect(getPlayer(state, "p1").landsPlayedThisTurn).toBe(1);
            // The outcome survives the wire projection the client renders.
            const view = projectPublicState(state, 1, "p1");
            const projected = view.players
                .find((p) => p.id === "p1")
                ?.battlefield.find((c) => c.id === "land");
            expect(projected?.isTapped).toBe(false);
        });
    });

    it("a shock land PUT onto the battlefield by an effect raises no pay-choice either", () => {
        withDefs(() => {
            const { state } = boardWith(steamVents().id, [sourceFor("p1")]);
            expect(putHandCardOntoBattlefield(state, "p1", "land")).toBe(true);
            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(enteredLand(state)?.isTapped).toBe(false);
            expect(getPlayer(state, "p1").life).toBe(20);
        });
    });

    it("control: with no source the played shock land still asks", () => {
        withDefs(() => {
            const { state, player } = boardWith(steamVents().id, []);
            applyPlayLand(state, player, "land");
            expect(state.pendingChoices?.[0]?.kind).toBe("land-entry-tapped");
        });
    });
});

describe("enters-untapped replacement vs an effect's 'put onto the battlefield tapped' (Spelunking ruling)", () => {
    it("a land token created tapped enters untapped; a nonland one stays tapped", () => {
        withDefs(() => {
            const { state } = boardWith(TAPLAND_ID, [sourceFor("p1")]);
            const [landToken] = createTokenPermanents(
                state,
                {
                    name: "Forest",
                    types: ["Land"],
                    subtypes: ["Forest"],
                    entersTapped: true,
                },
                "p1"
            );
            const [creatureToken] = createTokenPermanents(
                state,
                {
                    name: "Soldier",
                    types: ["Creature"],
                    subtypes: ["Soldier"],
                    power: 1,
                    toughness: 1,
                    entersTapped: true,
                },
                "p1"
            );
            const bf = getPlayer(state, "p1").battlefield;
            expect(bf.find((c) => c.id === landToken)?.isTapped).toBe(false);
            expect(bf.find((c) => c.id === creatureToken)?.isTapped).toBe(true);
        });
    });
});
