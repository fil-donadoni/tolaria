// CR 702.51 (issue #1338) — SURFACE test for the Convoke creature dialog,
// driven THROUGH the `projectPublicState` reducer (a hand-built view would mask
// a dropped field, per `.claude/rules/gre-development.md` § Frontend wiring).
//
// `ConvokeCreatureDialog` (src/components/board/convoke-creature-dialog.tsx)
// renders when `pendingCast.convokeCreatureChoice` is present and unpaid, listing
// the caster's untapped creatures and colour-matching them to the hybrid pips.
// Both its inputs — the picker on `pendingCast` and the caster's battlefield
// creatures (with colours derivable from their definitions) — MUST survive the
// wire projection, or the dialog shows nothing / can't validate coverage.

import { describe, expect, it } from "vitest";
import { getCardByName, getDefinition } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { getColorsFromCost } from "@convex/cards/colors";
import { coverColoredAndHybridPips } from "@convex/gre/payWith";
import type { Color } from "@convex/cards/types";
import type { PendingCast } from "@convex/gre/state";

const HOGAAK = getCardByName("Hogaak, Arisen Necropolis").id;
const CRAW_WURM = getCardByName("Craw Wurm").id; // green
const DRUDGE_SKELETONS = getCardByName("Drudge Skeletons").id; // black

describe("convoke dialog affordance survives projectPublicState", () => {
    function parked() {
        const hogaak = makeInstance(HOGAAK, {
            id: "hogaak",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [hogaak],
            battlefield: [
                makeInstance(CRAW_WURM, { id: "cr0", controllerId: "p1" }),
                makeInstance(DRUDGE_SKELETONS, {
                    id: "cr1",
                    controllerId: "p1",
                }),
            ],
        });
        const pendingCast: PendingCast = {
            playerId: "p1",
            cardInstanceId: "hogaak",
            manaCost: { X: 5 },
            tappedLandIds: [],
            convokeCreatureChoice: {
                min: 2,
                max: 2,
                hybridPips: [
                    ["B", "G"],
                    ["B", "G"],
                ],
            },
        };
        return makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
            pendingCast,
        });
    }

    it("the picker and the caster's untapped creatures cross the wire", () => {
        const projected = projectPublicState(parked(), 1, "p1");
        const cc = projected.pendingCast?.convokeCreatureChoice;
        expect(cc?.min).toBe(2);
        expect(cc?.hybridPips).toEqual([
            ["B", "G"],
            ["B", "G"],
        ]);

        const me = projected.players.find((p) => p.id === "p1")!;
        const eligible = me.battlefield.filter(
            (c) => c!.types?.includes("Creature") && c!.isTapped !== true
        );
        expect(eligible.map((c) => c!.id).sort()).toEqual(["cr0", "cr1"]);
    });

    it("the dialog can colour-cover the hybrid pips from the projected creatures", () => {
        const projected = projectPublicState(parked(), 1, "p1");
        const me = projected.players.find((p) => p.id === "p1")!;
        const cc = projected.pendingCast!.convokeCreatureChoice!;
        // Replicate the dialog's coverage check on the PROJECTED state.
        const sources = me.battlefield
            .filter((c) => c!.types?.includes("Creature"))
            .map(
                (c) =>
                    new Set<Color>(
                        getColorsFromCost(getDefinition(c!.card.id).manaCost)
                    )
            );
        expect(
            coverColoredAndHybridPips(
                sources,
                {},
                cc.hybridPips as [Color, Color][]
            )
        ).not.toBeNull();
    });
});
