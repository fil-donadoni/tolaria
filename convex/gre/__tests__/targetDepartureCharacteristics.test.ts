// CR 400.7 — an object that changes zones is a new object with no memory of its
// previous existence, so a subtype, colour or supertype another permanent's
// static ability gave it ends when the TARGET leaves, not only when the source
// does. Every departure below goes through the real chokepoint
// (`removePermanentTo`), and the surface reads go through `projectPublicState`.
import { describe, expect, it } from "vitest";
import {
    applyIndefiniteSubtypeSet,
    beginApplyingStaticEffects,
    putReanimatedSetOnBattlefield,
    removePermanentTo,
} from "../state";
import type { CardInstanceState, GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
    wireCharacteristicsOf,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import { getEffectiveColors } from "../../cards/effectiveColors";
import { liveSupertypesOf } from "../../cards/snowReads";
import { projectPublicState } from "../../gameProjections";
import { syncLayers2to5 } from "../layers2to5";
import {
    blackLotus,
    kormusBell,
    swamp,
} from "../../cards/sets/lea/colorless.cards";
import { yavimayaCradleOfGrowth } from "../../cards/sets/mh2/colorless.cards";
import { melting } from "../../cards/sets/ice/red.cards";
import { snowCoveredSwamp } from "../../cards/sets/ice/colorless.cards";

type Departure = "hand" | "library" | "graveyard" | "exile";
const DEPARTURES: Departure[] = ["hand", "library", "graveyard", "exile"];

const ZONE_FIELD = {
    hand: "hand",
    library: "library",
    graveyard: "graveyard",
    exile: "exile",
} as const;

function makeBoard(sourceDefId: string, targetDefId = swamp().id) {
    const a = makeInstance(targetDefId, { id: "target-a" });
    const b = makeInstance(targetDefId, { id: "target-b" });
    const source = makeInstance(sourceDefId, { id: "source-1" });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [a, b, source] }),
            makePlayer("p2"),
        ],
    });
    beginApplyingStaticEffects(state, source);
    return { state, a, b, source };
}

function findIn(
    state: GameState,
    id: string,
    zone: Departure
): CardInstanceState {
    const card = state.players[0][ZONE_FIELD[zone]].find((c) => c?.id === id);
    if (!card) throw new Error(`${id} is not in ${zone}`);
    return card;
}

function onBattlefield(state: GameState, id: string): CardInstanceState {
    const card = state.players[0].battlefield.find((c) => c.id === id);
    if (!card) throw new Error(`${id} is not on the battlefield`);
    return card;
}

/** Puts the bounced card back as the new object CR 400.7 says it is. */
function reenterFromHand(state: GameState, id: string): CardInstanceState {
    const hand = state.players[0].hand;
    const index = hand.findIndex((c) => c?.id === id);
    const [card] = hand.splice(index, 1);
    putReanimatedSetOnBattlefield(state, [{ card, controllerId: "p1" }]);
    return onBattlefield(state, id);
}

describe("subtype-add ends with the departing target (CR 400.7, CR 613.1d)", () => {
    it.each(DEPARTURES)(
        "a Swamp sent to %s reads its printed subtypes",
        (zone) => {
            const { state, a } = makeBoard(yavimayaCradleOfGrowth().id);
            expect(a.subtypes).toEqual(["Swamp", "Forest"]);

            removePermanentTo(state, "target-a", zone);

            const gone = findIn(state, "target-a", zone);
            expect(gone.subtypes).toEqual(["Swamp"]);
            expect(gone.grantedSubtypesAdd).toBeUndefined();
        }
    );

    it("a bounced Swamp re-entering after the source left stays printed", () => {
        const { state } = makeBoard(yavimayaCradleOfGrowth().id);
        removePermanentTo(state, "target-a", "hand");
        removePermanentTo(state, "source-1", "graveyard");

        const back = reenterFromHand(state, "target-a");

        expect(back.subtypes).toEqual(["Swamp"]);
        expect(
            wireCharacteristicsOf(state, "target-a").grantedSubtypesAdd
        ).toBeUndefined();
    });

    it("a bounced Swamp re-entering under the live source is affected anew (CR 611.3a)", () => {
        const { state } = makeBoard(yavimayaCradleOfGrowth().id);
        removePermanentTo(state, "target-a", "hand");

        const back = reenterFromHand(state, "target-a");

        expect(back.subtypes).toEqual(["Swamp", "Forest"]);
    });

    it("leaves the other target's grant intact, and it still reverts when the source leaves", () => {
        const { state, b } = makeBoard(yavimayaCradleOfGrowth().id);

        removePermanentTo(state, "target-a", "hand");
        expect(b.subtypes).toEqual(["Swamp", "Forest"]);
        expect(
            wireCharacteristicsOf(state, "target-b").grantedSubtypesAdd
        ).toEqual([
            expect.objectContaining({ subtype: "Forest", auraId: "source-1" }),
        ]);

        removePermanentTo(state, "source-1", "graveyard");
        expect(b.subtypes).toEqual(["Swamp"]);
        expect(findIn(state, "target-a", "hand").subtypes).toEqual(["Swamp"]);
    });

    it("is idempotent when the source leaves first, then the target", () => {
        const { state } = makeBoard(yavimayaCradleOfGrowth().id);
        removePermanentTo(state, "source-1", "graveyard");
        removePermanentTo(state, "target-a", "hand");
        expect(findIn(state, "target-a", "hand").subtypes).toEqual(["Swamp"]);
    });

    it("is idempotent across leave, re-enter, leave", () => {
        const { state } = makeBoard(yavimayaCradleOfGrowth().id);
        removePermanentTo(state, "target-a", "hand");
        reenterFromHand(state, "target-a");
        removePermanentTo(state, "target-a", "hand");
        expect(findIn(state, "target-a", "hand").subtypes).toEqual(["Swamp"]);
    });

    it("a subtype set over a live add reverts to the printed line, not the composed anchor", () => {
        const { state, a } = makeBoard(yavimayaCradleOfGrowth().id);
        applyIndefiniteSubtypeSet(a, ["Island"], 99);
        expect(a.indefiniteSubtypeSet?.restoreSubtypes).toEqual([
            "Swamp",
            "Forest",
        ]);

        removePermanentTo(state, "target-a", "hand");

        expect(findIn(state, "target-a", "hand").subtypes).toEqual(["Swamp"]);
    });

    it.each(DEPARTURES)(
        "a resolved subtype add does not follow a Swamp to %s",
        (zone) => {
            const { state } = makeBoard(blackLotus().id);
            const onBoard = onBattlefield(state, "target-a");
            onBoard.subtypeAddHolds = [{ subtype: "Forest", seq: 99 }];
            syncLayers2to5(state);
            expect(onBoard.subtypes).toContain("Forest");

            removePermanentTo(state, "target-a", zone);

            const gone = findIn(state, "target-a", zone);
            expect(gone.subtypes).toEqual(["Swamp"]);
            expect(gone.subtypeAddHolds).toBeUndefined();
        }
    );

    it("the projected card reads printed subtypes, the other target its grant", () => {
        const { state } = makeBoard(yavimayaCradleOfGrowth().id);
        removePermanentTo(state, "target-a", "hand");

        const view = projectPublicState(state, 1, "p1").players[0];
        const slim = view.hand.find((c) => c?.id === "target-a")!;
        expect(slim.subtypes).toEqual(["Swamp"]);
        expect(
            view.battlefield.find((c) => c.id === "target-b")!.subtypes
        ).toEqual(["Swamp", "Forest"]);
    });
});

describe("color-grant ends with the departing target (CR 400.7, CR 613.1e)", () => {
    it.each(DEPARTURES)(
        "a Swamp sent to %s carries no granted colour",
        (zone) => {
            const { state, a } = makeBoard(kormusBell().id);
            expect(a.grantedColors).toEqual([
                { color: "B", sourceId: "source-1" },
            ]);

            removePermanentTo(state, "target-a", zone);

            const gone = findIn(state, "target-a", zone);
            expect(gone.grantedColors).toBeUndefined();
            expect(getEffectiveColors(gone)).toEqual([]);
        }
    );

    it("a bounced Swamp re-entering after the source left stays colourless", () => {
        const { state } = makeBoard(kormusBell().id);
        removePermanentTo(state, "target-a", "hand");
        removePermanentTo(state, "source-1", "graveyard");

        const back = reenterFromHand(state, "target-a");

        expect(back.grantedColors).toBeUndefined();
        expect(getEffectiveColors(back)).toEqual([]);
    });

    it("leaves the other target's grant intact, and it still reverts when the source leaves", () => {
        const { state, b } = makeBoard(kormusBell().id);

        removePermanentTo(state, "target-a", "hand");
        expect(b.grantedColors).toEqual([{ color: "B", sourceId: "source-1" }]);

        removePermanentTo(state, "source-1", "graveyard");
        expect(b.grantedColors).toBeUndefined();
    });

    it("is idempotent across both orderings", () => {
        const sourceFirst = makeBoard(kormusBell().id);
        removePermanentTo(sourceFirst.state, "source-1", "graveyard");
        removePermanentTo(sourceFirst.state, "target-a", "hand");
        expect(
            findIn(sourceFirst.state, "target-a", "hand").grantedColors
        ).toBeUndefined();

        const reentered = makeBoard(kormusBell().id);
        removePermanentTo(reentered.state, "target-a", "hand");
        reenterFromHand(reentered.state, "target-a");
        removePermanentTo(reentered.state, "target-a", "hand");
        expect(
            findIn(reentered.state, "target-a", "hand").grantedColors
        ).toBeUndefined();
    });

    it("the projected card carries no granted colour", () => {
        const { state } = makeBoard(kormusBell().id);
        removePermanentTo(state, "target-a", "hand");

        const view = projectPublicState(state, 1, "p1").players[0];
        expect(
            view.hand.find((c) => c?.id === "target-a")!.grantedColors
        ).toBeUndefined();
        expect(
            view.battlefield.find((c) => c.id === "target-b")!.grantedColors
        ).toEqual([{ color: "B", sourceId: "source-1" }]);
    });
});

describe("a resolved colour change ends with the departing object (CR 400.7, CR 613.1e)", () => {
    it.each(DEPARTURES)(
        "a colour SET does not follow a Swamp to %s",
        (zone) => {
            const { state, a } = makeBoard(blackLotus().id);
            a.colorOverride = ["U"];
            a.temporaryColorOverrides = [{ colors: ["R"] }];
            expect(getEffectiveColors(a)).not.toEqual([]);

            removePermanentTo(state, "target-a", zone);

            const gone = findIn(state, "target-a", zone);
            expect(gone.colorOverride).toBeUndefined();
            expect(gone.temporaryColorOverrides).toBeUndefined();
            expect(getEffectiveColors(gone)).toEqual([]);
        }
    );
});

describe("supertype changes end with the departing target (CR 400.7, CR 613.1d)", () => {
    /** No shipped static ADDS a supertype to another permanent, so the additive
     *  arm of the same `supertype-set` effect runs on a variant of Melting. */
    const snowfall = {
        ...melting(),
        staticEffects: [
            {
                kind: "supertype-set" as const,
                applies: (target: { types: readonly string[] }) =>
                    target.types.includes("Land"),
                add: ["Snow" as const],
            },
        ],
    };

    it.each(DEPARTURES)(
        "a granted Snow does not follow a Swamp to %s",
        (zone) => {
            withTemporaryDefinition(snowfall, () => {
                const { state, a, b } = makeBoard(snowfall.id);
                expect(a.grantedSupertypes).toEqual([
                    { supertype: "Snow", sourceId: "source-1" },
                ]);

                removePermanentTo(state, "target-a", zone);

                const gone = findIn(state, "target-a", zone);
                expect(gone.grantedSupertypes).toBeUndefined();
                expect(liveSupertypesOf(gone)).not.toContain("Snow");
                expect(b.grantedSupertypes).toEqual([
                    { supertype: "Snow", sourceId: "source-1" },
                ]);

                removePermanentTo(state, "source-1", "graveyard");
                expect(b.grantedSupertypes).toBeUndefined();
            });
        }
    );

    it.each(DEPARTURES)(
        "a removed Snow comes back on a card sent to %s",
        (zone) => {
            const { state, a } = makeBoard(melting().id, snowCoveredSwamp().id);
            expect(liveSupertypesOf(a)).not.toContain("Snow");

            removePermanentTo(state, "target-a", zone);

            const gone = findIn(state, "target-a", zone);
            expect(gone.removedSupertypes).toBeUndefined();
            expect(liveSupertypesOf(gone)).toContain("Snow");
        }
    );

    it.each(DEPARTURES)(
        "a resolved supertype change does not follow a Swamp to %s",
        (zone) => {
            const { state } = makeBoard(blackLotus().id);
            const swampOnBoard = onBattlefield(state, "target-a");
            swampOnBoard.supertypeHolds = [{ add: ["Snow"], seq: 99 }];
            syncLayers2to5(state);
            expect(liveSupertypesOf(swampOnBoard)).toContain("Snow");

            removePermanentTo(state, "target-a", zone);

            const gone = findIn(state, "target-a", zone);
            expect(gone.supertypeHolds).toBeUndefined();
            expect(liveSupertypesOf(gone)).not.toContain("Snow");
        }
    );

    it("the projected card reads no granted supertype", () => {
        withTemporaryDefinition(snowfall, () => {
            const { state } = makeBoard(snowfall.id);
            removePermanentTo(state, "target-a", "hand");

            const view = projectPublicState(state, 1, "p1").players[0];
            expect(
                view.hand.find((c) => c?.id === "target-a")!.grantedSupertypes
            ).toBeUndefined();
        });
    });
});
