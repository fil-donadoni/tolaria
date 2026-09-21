// Per-card behaviour tests for APC blue cards (`convex/cards/sets/apc/blue.ts`).
//
// Whirlpool Warrior is a HAND-TAIL card (issue #4358): its activated half sits
// below the grammar floor, so it is written by hand and owes the test the
// compiler's generated smoke scenario would otherwise have given it. Two
// claims fail silently without one:
//
//   * CR 121.1 — "draws that many" is the hand size read BEFORE the cards
//     move. A recount after the move reads an emptied hand and draws nothing,
//     which looks exactly like a card that simply shuffles the hand away.
//   * "EACH player … draws that many": the count is PER PLAYER, so a single
//     shared count would still empty and refill both hands — only a board
//     where the two hands differ in size can tell the two readings apart.
//
// The activated half's outcome is visible on the board, so the wire-format
// assertion through `projectPublicState` is mandatory (convex/CLAUDE.md
// § Card testing convention).

import { describe, expect, it } from "vitest";
import { getDefinition } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

// Resolved through the REGISTRY SEAM by id, never by name (`getCardByName`
// reads a registry `preloadDefinitions` never writes).
const WHIRLPOOL_WARRIOR = getDefinition("01f891ca-4e6a-4710-b1cf-5dabb5e1ad93");
const BEAR = getDefinition("0ddb98e8-13fe-4786-83f7-b72c56db135a");

function cards(
    owner: string,
    ids: string[],
    zone: CardInstanceState["zone"]
): CardInstanceState[] {
    return ids.map((id) =>
        makeInstance(BEAR.id, { id, controllerId: owner, ownerId: owner, zone })
    );
}

function warriorOnBattlefield(): CardInstanceState {
    return makeInstance(WHIRLPOOL_WARRIOR.id, {
        id: "warrior",
        controllerId: "p1",
        ownerId: "p1",
    });
}

/** Push an ability of `source` onto the stack with its cost assumed already
 *  paid (mirrors the post-`activateAbility` / post-trigger state) and resolve
 *  it. `abilityId` names an activated ability, `triggeredAbilityId` a trigger. */
function resolveAbility(
    state: GameState,
    source: CardInstanceState,
    key: { abilityId?: string; triggeredAbilityId?: string }
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        ...key,
        ...(key.triggeredAbilityId ? { triggerSourceId: source.id } : {}),
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("Whirlpool Warrior — shuffle the hand back and redraw (CR 121.1, issue #3807)", () => {
    it("the ETB trigger redraws exactly the hand it shuffled away", () => {
        const warrior = warriorOnBattlefield();
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [warrior],
                    hand: cards("p1", ["h1", "h2", "h3"], "hand"),
                    library: cards(
                        "p1",
                        ["l1", "l2", "l3", "l4", "l5"],
                        "library"
                    ),
                }),
                makePlayer("p2"),
            ],
        });

        resolveAbility(state, warrior, {
            triggeredAbilityId: "whirlpool-warrior-etb-redraw",
        });

        // A recount after the move would draw 0 and leave the hand empty.
        expect(state.players[0].hand).toHaveLength(3);
        expect(state.players[0].library).toHaveLength(5);
        expect(
            [...state.players[0].hand, ...state.players[0].library]
                .map((c) => c.id)
                .sort()
        ).toEqual(["h1", "h2", "h3", "l1", "l2", "l3", "l4", "l5"]);
    });

    it("the activated ability gives EACH player back their OWN hand size, on the board and on the wire", () => {
        const warrior = warriorOnBattlefield();
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [warrior],
                    hand: cards("p1", ["a1", "a2"], "hand"),
                    library: cards("p1", ["a3", "a4", "a5", "a6"], "library"),
                }),
                makePlayer("p2", {
                    hand: cards("p2", ["b1", "b2", "b3", "b4"], "hand"),
                    library: cards("p2", ["b5", "b6"], "library"),
                }),
            ],
        });

        resolveAbility(state, warrior, {
            abilityId: "whirlpool-warrior-each-player-redraw",
        });

        // The two counts differ, so a single shared count cannot produce both.
        expect(state.players[0].hand).toHaveLength(2);
        expect(state.players[0].library).toHaveLength(4);
        expect(state.players[1].hand).toHaveLength(4);
        expect(state.players[1].library).toHaveLength(2);
        // Nobody drew from anybody else's library.
        for (const c of [...state.players[0].hand, ...state.players[0].library])
            expect(c.id.startsWith("a")).toBe(true);
        for (const c of [...state.players[1].hand, ...state.players[1].library])
            expect(c.id.startsWith("b")).toBe(true);

        // The projection is what the client renders: an opponent's hand is a
        // list of nulls and a library is a count, so a redraw that never
        // reached the wire would show as an emptied board.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand).toHaveLength(2);
        expect(projected.players[0].library.count).toBe(4);
        expect(projected.players[1].hand).toHaveLength(4);
        expect(projected.players[1].library.count).toBe(2);
    });
});
