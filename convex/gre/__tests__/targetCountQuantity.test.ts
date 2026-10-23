/**
 * CR 601.2c / 107.3 (issue #6526) — `resolveTargetRequirementCount` resolves a
 * `TargetCountQuantity` bound: "in some cases, the number of targets will be
 * defined by the spell's text". The quantity is the Effect Script `count`
 * construct, read over the announcement — `{ target: 0 }` names the pick an
 * earlier group made.
 */
import { describe, expect, it } from "vitest";
import { resolveTargetRequirementCount } from "../state";
import type { TargetCountQuantity } from "../../cards/types";
import { withTemporaryDefinition } from "../../cards";
import {
    REAP_SHAPE,
    REAP_SPELL_ID,
    reapBoard,
} from "../../__tests__/announcedQuantityTargetCount.fixture";

const BLACK_PERMANENTS_OF_TARGET_0: TargetCountQuantity = {
    count: {
        zone: "battlefield",
        controller: { target: 0 },
        filter: { color: "B" },
    },
};

/** The resolver over a board whose spell is registered — the quantity is read
 *  through a `SpellContext` built on the announced card. */
const resolve: typeof resolveTargetRequirementCount = (...args) =>
    withTemporaryDefinition(REAP_SHAPE, () =>
        resolveTargetRequirementCount(...args)
    );

const announcement = (
    blackCount: number,
    priorTargets: { type: "player"; id: string }[]
) => ({
    state: withTemporaryDefinition(REAP_SHAPE, () => reapBoard(blackCount)),
    controllerId: "p1",
    sourceInstanceId: REAP_SPELL_ID,
    priorTargets,
});

describe("resolveTargetRequirementCount — a text-defined bound (CR 601.2c, issue #6526)", () => {
    it("counts the black permanents of the player an earlier group chose", () => {
        expect(
            resolve({ min: 0, max: BLACK_PERMANENTS_OF_TARGET_0 }, undefined, {
                announcement: announcement(2, [{ type: "player", id: "p2" }]),
            })
        ).toEqual({ min: 0, max: 2 });
    });

    it("reads the CHOSEN player, not a fixed seat: p1 controls no black permanent", () => {
        expect(
            resolve({ min: 0, max: BLACK_PERMANENTS_OF_TARGET_0 }, undefined, {
                announcement: announcement(2, [{ type: "player", id: "p1" }]),
            })
        ).toEqual({ min: 0, max: 0 });
    });

    it("stays open without an announcement — the bound is not known yet", () => {
        expect(
            resolve({ min: 0, max: BLACK_PERMANENTS_OF_TARGET_0 }, undefined)
        ).toEqual({ min: 0 });
    });

    it("clamps the bound up to `min`, like an announced X below it", () => {
        expect(
            resolve({ min: 1, max: BLACK_PERMANENTS_OF_TARGET_0 }, undefined, {
                announcement: announcement(0, [{ type: "player", id: "p2" }]),
            })
        ).toEqual({ min: 1, max: 1 });
    });
});
