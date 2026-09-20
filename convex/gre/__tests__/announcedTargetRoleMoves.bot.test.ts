// CR 601.2c (issue #4193) — the Bot's cast enumerator and an ORDERED target
// group.
//
// A group whose announced slots receive different halves of the effect makes
// the ORDER of the picks a decision: kicked Jilt returns slot 0 to its owner's
// hand and deals 2 damage to slot 1, so `[angel, bears]` and `[bears, angel]`
// are two different spells. `combinations` emits each SET once, in board
// order, so the Bot could only ever announce one of the two — the "Move that
// was never enumerated" suspect from `/bot-slice`, not an evaluation gap: no
// weight can pick a line the search never sees.
//
// The symmetric half matters just as much. Permuting every group would
// multiply the move set against `MAX_COMBINATIONS` for nothing — Magma Burst's
// two orderings are the same spell — so this pins that it stays on
// combinations.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { enumerateMoves, type Move } from "../moves";
import type { GameState } from "../state";

type CastMove = Extract<Move, { kind: "cast-spell" }>;

const BOT = "p1";
const OPP = "p2";
const ANGEL = getCardByName("Serra Angel").id;
const BEARS = getCardByName("Grizzly Bears").id;

/** The bot holds `cardName` with five Islands and five Mountains untapped —
 *  enough for any printed cost plus its kicker — and the opponent has a Serra
 *  Angel and a Grizzly Bears out. */
function board(cardName: string): GameState {
    const land = (name: string, i: number) =>
        makeInstance(getCardByName(name).id, {
            id: `${name}-${i}`,
            controllerId: BOT,
            ownerId: BOT,
            zone: "battlefield",
        });
    return makeState({
        players: [
            makePlayer(BOT, {
                hand: [
                    makeInstance(getCardByName(cardName).id, {
                        id: "spell",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    ...[0, 1, 2, 3, 4].map((i) => land("Island", i)),
                    ...[0, 1, 2, 3, 4].map((i) => land("Mountain", i)),
                ],
            }),
            makePlayer(OPP, {
                battlefield: [
                    makeInstance(ANGEL, {
                        id: "angel",
                        controllerId: OPP,
                        ownerId: OPP,
                    }),
                    makeInstance(BEARS, {
                        id: "bears",
                        controllerId: OPP,
                        ownerId: OPP,
                    }),
                ],
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
}

/** Every announced target ORDERING the enumerator offers for the two-target
 *  casts of `spell`, as `"first>second"` strings. */
function orderingsOfTwoTargetCasts(state: GameState): string[] {
    const casts = enumerateMoves(state, BOT).filter(
        (m): m is CastMove =>
            m.kind === "cast-spell" && m.cardInstanceId === "spell"
    );
    return [
        ...new Set(
            casts
                .filter((m) => (m.targets ?? []).length === 2)
                .map((m) => m.targets!.map((t) => t.id).join(">"))
        ),
    ].sort();
}

describe("cast enumeration — an ordered target group offers both assignments (issue #4193)", () => {
    it("kicked Jilt enumerates bounce-the-angel AND bounce-the-bears", () => {
        const orderings = orderingsOfTwoTargetCasts(board("Jilt"));
        expect(orderings).toEqual(["angel>bears", "bears>angel"]);
    });

    it("a symmetric kicked spell keeps ONE ordering per set (Magma Burst)", () => {
        // Its two announced targets both take 3 damage, so a second ordering
        // would be the same announcement scored twice.
        const orderings = orderingsOfTwoTargetCasts(board("Magma Burst"));
        expect(
            orderings.filter((o) => o === "angel>bears" || o === "bears>angel")
                .length
        ).toBe(1);
    });
});
