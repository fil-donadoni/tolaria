// Bot REACHABILITY for a spell whose announced target is a STACK OBJECT
// filtered by a property of THAT object's own targets (issue #2708).
//
// Why this needs its own test. A card the Bot cannot enumerate is a card the
// Bot never plays, and nothing else in the tree goes red for it: the app suite
// proves the target FILTER admits the ability (that is
// `convex/cards/sets/inv/__tests__/blue.test.ts`), never that `enumerateMoves`
// ever offers the cast; the `blade` receipt fires on `BOT_GLOBS`, which
// `cards/sets/**` never touches; and the valuation censuses cover Ops, not
// cast variants. The one thing that would notice is a deterministic assertion
// on the enumerator, which is this file.
//
// The seam is also the one most likely to fail SILENTLY here: the requirement
// is `type: "spell"`, so the candidate list comes from `getLegalTargets`'
// stack branch rather than the battlefield scan every other cast uses, and it
// then passes through `spellStackKind` (CR 602 / 603 — an ABILITY, not a
// spell) and `spellTargetsPermanentFilter`. Any one of the three dropping the
// candidate yields no move at all, which reads exactly like "the bot chose to
// pass".
//
// The blade entry for this position ("reachability: counters an opponent's
// land-targeting activation with Teferi's Response") sits at `stretch`: the
// MOVE is enumerated — asserted below — but the search still prefers passing,
// a valuation gap recorded on that entry's `beyondBudget`. Reachability and
// preference are separate claims and only the first is made here.

import { describe, expect, it } from "vitest";
import { enumerateMoves } from "../moves";
import { icyManipulator, island } from "../../cards/sets/lea/colorless";
import { forest } from "../../cards/sets/lea/colorless";
import { teferisResponse } from "../../cards/sets/inv/blue";
import { grizzlyBears } from "../../cards/sets/lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";

/** p1 (the bot) holds Teferi's Response and priority; p2's Icy Manipulator
 *  activation is already on the stack, targeting the permanent named by
 *  `abilityTarget`. Two Islands untapped for the {1}{U}. */
function board(opts: { abilityTarget: "myLand" | "myBear" | "theirLand" }): {
    state: GameState;
    responseId: string;
    abilityStackId: string;
} {
    const state = makeState({
        players: [
            makePlayer("p1", {
                life: 20,
                hand: [
                    makeInstance(teferisResponse.id, {
                        id: "response",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                battlefield: [
                    makeInstance(island.id, {
                        id: "isle1",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(island.id, {
                        id: "isle2",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(forest.id, {
                        id: "myLand",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(grizzlyBears.id, {
                        id: "myBear",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                life: 20,
                battlefield: [
                    makeInstance(icyManipulator.id, {
                        id: "icy",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                    makeInstance(forest.id, {
                        id: "theirLand",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
    state.priorityPlayerId = "p1";
    const source = state.players[1].battlefield.find((c) => c.id === "icy")!;
    // The same stack-item shape `buildActivatedAbilityStackItem` produces: a
    // clone of the source, so the item id IS the source permanent's id
    // (CR 113.7a).
    state.stack.push({
        ...source,
        zone: "stack",
        castById: "p2",
        abilityId: "icy-manipulator-tap",
        targets: [{ type: "permanent", id: opts.abilityTarget }],
    });
    return { state, responseId: "response", abilityStackId: "icy" };
}

const castsResponseAt = (state: GameState, stackItemId: string) =>
    enumerateMoves(state, "p1").some(
        (m) =>
            m.kind === "cast-spell" &&
            m.cardInstanceId === "response" &&
            (m.targets ?? []).some(
                (t) => t.type === "spell" && t.id === stackItemId
            )
    );

describe("stack-object target reachability (issue #2708)", () => {
    it("enumerates the cast against an opponent's ability targeting a land the bot controls", () => {
        const { state, abilityStackId } = board({ abilityTarget: "myLand" });
        expect(castsResponseAt(state, abilityStackId)).toBe(true);
    });

    it("enumerates NO cast when the ability targets a non-land the bot controls", () => {
        const { state, abilityStackId } = board({ abilityTarget: "myBear" });
        expect(castsResponseAt(state, abilityStackId)).toBe(false);
    });

    it("enumerates NO cast when the ability targets a land the OPPONENT controls", () => {
        const { state, abilityStackId } = board({ abilityTarget: "theirLand" });
        expect(castsResponseAt(state, abilityStackId)).toBe(false);
    });

    it("offers no cast at all with an empty stack — the requirement has no candidate", () => {
        const { state } = board({ abilityTarget: "myLand" });
        state.stack = [];
        expect(
            enumerateMoves(state, "p1").some(
                (m) =>
                    m.kind === "cast-spell" && m.cardInstanceId === "response"
            )
        ).toBe(false);
    });
});
