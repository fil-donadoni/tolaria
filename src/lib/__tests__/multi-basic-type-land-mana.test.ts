// CR 305.6 — the client tap surface for a land with two or more basic land
// types (issue #5623): a typed dual carries no printed mana ability, so the
// board must read its intrinsic abilities off the PROJECTED subtypes — a
// tappable source, a {T} activation, and a {B}-or-{R} prompt. GRE and game.ts
// halves: `convex/gre/__tests__/multiBasicTypeLandMana.test.ts`.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import type { CardInstanceState } from "@convex/gre/state";
import {
    getManaChoices,
    hasIntrinsicLandMana,
    manaActivationRequiresTap,
} from "../card-utils";
import type { CardInstance } from "../../types/game";

const BADLANDS = "717f6d10-9144-4ade-9ac6-a481cc66b875"; // Land — Swamp Mountain

describe("client tap surface through the wire projection (CR 305.6)", () => {
    function slimBadlands(): { slim: CardInstance; players: CardInstance[][] } {
        const badlands = makeInstance(BADLANDS, {
            id: "badlands",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [badlands] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "badlands"
        ) as unknown as CardInstance;
        return {
            slim,
            players: projected.players.map(
                (p) => p.battlefield as unknown as CardInstance[]
            ),
        };
    }

    it("is a tappable mana source paying {T} with no printed ability", () => {
        const { slim } = slimBadlands();
        expect(hasIntrinsicLandMana(slim)).toBe(true);
        expect(manaActivationRequiresTap(slim)).toBe(true);
    });

    it("prompts for {B} or {R}", () => {
        const { slim, players } = slimBadlands();
        expect(
            getManaChoices(slim, [
                { id: "p1", battlefield: players[0] },
                { id: "p2", battlefield: players[1] },
            ])
        ).toEqual([{ B: 1 }, { R: 1 }]);
    });

    it("keeps both subtypes on the slim instance", () => {
        const { slim } = slimBadlands();
        expect((slim as unknown as CardInstanceState).subtypes).toEqual([
            "Swamp",
            "Mountain",
        ]);
    });
});
