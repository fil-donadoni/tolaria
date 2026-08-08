// Theros (THS) — green behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { sylvanCaryatid } from "../green";
import { lightningBolt } from "../../lea/red";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import type { TargetRequirement } from "../../../types";
import { isGuardedAgainst } from "../../../../gre/permanentGuard";
import { projectPublicState } from "../../../../gameProjections";

// Lightning Bolt targets "any target" (CR 115) — the real removal spell the
// acceptance test names.
const ANY_REQ: TargetRequirement = lightningBolt.targetRequirement ?? {
    type: "any",
    count: 1,
};

describe("Sylvan Caryatid (Defender, hexproof, {T}: any color, CR 605.1a / 702.11 / 702.3)", () => {
    // CR 702.11b — hexproof: "can't be the target of spells or abilities your
    // opponents control." The controller (p1) still can; only opponents (p2)
    // are barred. Modelled on the shroud `cantBeTargeted` guard, narrowed by
    // the source's controller (issue #958).
    describe("hexproof targeting legality (CR 702.11b)", () => {
        const makeBoard = () => {
            const caryatid = makeInstance(sylvanCaryatid.id, {
                id: "caryatid",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [caryatid] }),
                    makePlayer("p2"),
                ],
            });
            return { state, caryatid };
        };

        it("bars an opponent-controlled source (isGuardedAgainst p2)", () => {
            const { state, caryatid } = makeBoard();
            expect(
                isGuardedAgainst(state, caryatid, "cantBeTargeted", {
                    types: ["Instant"],
                    isSpell: true,
                    controllerId: "p2",
                })
            ).toBe(true);
        });

        it("allows the controller's own source (isGuardedAgainst p1)", () => {
            const { state, caryatid } = makeBoard();
            expect(
                isGuardedAgainst(state, caryatid, "cantBeTargeted", {
                    types: ["Instant"],
                    isSpell: true,
                    controllerId: "p1",
                })
            ).toBe(false);
        });

        it("excludes the caryatid from an opponent's Lightning Bolt targets", () => {
            const { state } = makeBoard();
            const legal = getLegalTargets(
                state,
                ANY_REQ,
                {
                    ...NO_TARGETING_SOURCE,
                    colors: ["R"],
                    types: ["Instant"],
                    isSpell: true,
                },
                "p2",
                undefined
            ).map((t) => t.id);
            expect(legal).not.toContain("caryatid");
        });

        it("offers the caryatid to its own controller's Lightning Bolt", () => {
            const { state } = makeBoard();
            const legal = getLegalTargets(
                state,
                ANY_REQ,
                {
                    ...NO_TARGETING_SOURCE,
                    colors: ["R"],
                    types: ["Instant"],
                    isSpell: true,
                },
                "p1",
                undefined
            ).map((t) => t.id);
            expect(legal).toContain("caryatid");
        });

        // Wire-format guard: the projection strips `card.card` to `{ id }`, so
        // the guard must still resolve hexproof from the registry by id after
        // `projectPublicState` (the class of bug wire tests exist to catch).
        it("hexproof survives the wire-format projection (opponent barred, controller allowed)", () => {
            const { state } = makeBoard();
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "caryatid"
            )!;
            expect(
                isGuardedAgainst(projected, slim, "cantBeTargeted", {
                    isSpell: true,
                    controllerId: "p2",
                })
            ).toBe(true);
            expect(
                isGuardedAgainst(projected, slim, "cantBeTargeted", {
                    isSpell: true,
                    controllerId: "p1",
                })
            ).toBe(false);
        });
    });
});
