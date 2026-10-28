// Castability reader prices the post-modifier cost (CR 601.2f, issue #3727).
//
// CR 601.2f: cost increases are applied to the total cost, and "You can't spend
// mana to cast this spell" (Hogaak) removes every mana source. `canPayCost` /
// `coversCostColors` take a `cast` probe so they read what the gate reads.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import {
    canPayCost,
    castProbeFor,
    coversCostColors,
    manaUnitsFor,
} from "../manaAvailability";
import { getInstanceManaCost } from "../../cards";

const FOREST = getCardByName("Forest").id;
const SWAMP = getCardByName("Swamp").id;
const GIANT_GROWTH = getCardByName("Giant Growth").id; // {G}
const THALIA = getCardByName("Thalia, Guardian of Thraben").id; // noncreature +{1}
const HOGAAK = getCardByName("Hogaak, Arisen Necropolis").id; // can't spend mana

const mk = (cardId: string, id: string, zone: "hand" | "battlefield") =>
    makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone,
    });

describe("castability reader cast probe (CR 601.2f)", () => {
    const build = (forests: number, withThalia: boolean) => {
        const spell = mk(GIANT_GROWTH, "gg", "hand");
        const player = makePlayer("p1", {
            hand: [spell],
            battlefield: [
                ...Array.from({ length: forests }, (_, i) =>
                    mk(FOREST, `f${i}`, "battlefield")
                ),
                ...(withThalia ? [mk(THALIA, "th", "battlefield")] : []),
            ],
        });
        const state = makeState({ players: [player, makePlayer("p2")] });
        return { spell, player, state };
    };

    it("one Forest pays the printed {G} but not the taxed {1}{G}", () => {
        const { spell, player, state } = build(1, true);
        const units = manaUnitsFor(state, player);
        const cost = getInstanceManaCost(spell);
        expect(canPayCost(units, cost, { life: 20 })).toBe(true);
        expect(
            canPayCost(units, cost, {
                life: 20,
                cast: castProbeFor(state, player, spell),
            })
        ).toBe(false);
    });

    it("two Forests pay the taxed cost", () => {
        const { spell, player, state } = build(2, true);
        expect(
            canPayCost(
                manaUnitsFor(state, player),
                getInstanceManaCost(spell),
                {
                    life: 20,
                    cast: castProbeFor(state, player, spell),
                }
            )
        ).toBe(true);
    });

    it("without the tax source the probe changes nothing", () => {
        const { spell, player, state } = build(1, false);
        expect(
            canPayCost(
                manaUnitsFor(state, player),
                getInstanceManaCost(spell),
                {
                    life: 20,
                    cast: castProbeFor(state, player, spell),
                }
            )
        ).toBe(true);
    });

    it("cantSpendManaToCast: no mana source counts, base colours included", () => {
        const hogaak = mk(HOGAAK, "hg", "hand");
        const player = makePlayer("p1", {
            hand: [hogaak],
            battlefield: [
                ...Array.from({ length: 4 }, (_, i) =>
                    mk(SWAMP, `s${i}`, "battlefield")
                ),
                ...Array.from({ length: 3 }, (_, i) =>
                    mk(FOREST, `f${i}`, "battlefield")
                ),
            ],
        });
        const state = makeState({ players: [player, makePlayer("p2")] });
        const units = manaUnitsFor(state, player);
        const cost = getInstanceManaCost(hogaak);
        const cast = castProbeFor(state, player, hogaak);
        expect(canPayCost(units, cost, { life: 20 })).toBe(true);
        expect(canPayCost(units, cost, { life: 20, cast })).toBe(false);
        expect(coversCostColors(units, cost, { life: 20 })).toBe(true);
        expect(coversCostColors(units, cost, { life: 20, cast })).toBe(false);
    });

    it("no GameState: castProbeFor is undefined (printed-cost fallback)", () => {
        const { spell, player } = build(1, true);
        expect(castProbeFor(undefined, player, spell)).toBeUndefined();
    });
});
