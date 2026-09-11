// Class level bars (CR 716.2a, issue #3234) on the CLIENT surface: the
// zone-listing helper the UI actually renders from, driven over a REAL
// `projectPublicState` projection rather than a hand-built view
// (gre-development.md § Frontend wiring analysis / § Proof-of-failure).
//
// CR 716.2a admits exactly ONE bar at any moment — the one for level+1 — so an
// ungated menu would show every bar of a Class at once and only the server's
// throw would say no. The driving field is `CardInstanceState.classLevel`,
// which `slimCard` has to carry intact: it is deliberately NOT a counter
// (CR 716.4 / 711.7), so nothing else on the wire stands in for it, and a
// dropped field would read as CR 716.2d's default level 1 forever — the level-2
// bar offered on a level-3 Class, the level-3 bar never offered at all.
//
// Lives on the `src/` side of the project boundary because a file in the convex
// project may not import `src/**`; the engine-side halves of the same rule
// (`assertActivationTimingLegal`, `enumerateMoves`) are asserted in
// `convex/cards/sets/blb/__tests__/blue.test.ts` and
// `convex/gre/__tests__/classLevel.bot.test.ts`.

import { describe, it, expect } from "vitest";
import { stormchasersTalent } from "@convex/cards/sets/blb/blue";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { getStackAbilities } from "../card-utils";
import type { CardInstance } from "~/types/game";
import type { GameState } from "@convex/gre/state";

describe("Stormchaser's Talent — class level affordance over the wire (CR 716.2a)", () => {
    const board = (classLevel?: number) => {
        const talent = makeInstance(stormchasersTalent.id, {
            id: "talent",
            controllerId: "p1",
            ownerId: "p1",
            ...(classLevel === undefined ? {} : { classLevel }),
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [talent] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
    };

    const listed = (s: GameState) => {
        const projected = projectPublicState(s, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c?.id === "talent"
        ) as CardInstance;
        return getStackAbilities(slim, s.phase).map((a) => a.id);
    };

    it("CR 716.2d — an unlevelled Class offers only the level-2 bar", () => {
        expect(listed(board())).toEqual(["class-level-2"]);
    });

    it("CR 716.2a — at level 2 the spent bar is gone and the level-3 bar is offered", () => {
        expect(listed(board(2))).toEqual(["class-level-3"]);
    });

    it("CR 716.2a — at the top level no bar is offered", () => {
        expect(listed(board(3))).toEqual([]);
    });

    it("CR 716.2a / 307.5 — no bar is offered outside a main phase", () => {
        const state = board();
        state.phase = "DECLARE_BLOCKERS";
        expect(listed(state)).toEqual([]);
    });
});
