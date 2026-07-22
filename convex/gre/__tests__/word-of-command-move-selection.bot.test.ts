// Move-selection path for a Bot holding Word of Command (PRD #575 / slice 6
// #581, ADR 0037). When the Bot is the Acting Player it must be able to (a)
// enumerate casting Word of Command at its opponent as a legal macro-move and
// (b) have the root selector pick that cast when it is the better line.
//
// Deterministic by construction — a single crafted scenario plus a synthetic
// search root with hand-set edge statistics, NOT self-play (project convention:
// single preset scenarios + deterministic `selectRootMove` unit tests over
// stochastic self-play; see search.test.ts free-development tie-break tests).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";
import { enumerateMoves } from "../moves";
import type { Move } from "../moves";
import { selectRootMove, type Edge, type Node } from "../search";

const WORD_OF_COMMAND = getCardByName("Word of Command").id; // {B}{B} instant
const SWAMP = getCardByName("Swamp").id;
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id;

const BOT = "p2";
const HUMAN = "p1";

/** A precombat-main position where the Bot (`p2`) holds Word of Command and has
 *  two Swamps to pay {B}{B}; the human holds a card so WoC has a hand to look
 *  at. The Bot has priority — its decision point. */
function seed(): GameState {
    const woc = makeInstance(WORD_OF_COMMAND, {
        id: "bot-woc",
        controllerId: BOT,
        ownerId: BOT,
        zone: "hand",
    });
    const s1 = makeInstance(SWAMP, {
        id: "bot-swamp-1",
        controllerId: BOT,
        ownerId: BOT,
        zone: "battlefield",
    });
    const s2 = makeInstance(SWAMP, {
        id: "bot-swamp-2",
        controllerId: BOT,
        ownerId: BOT,
        zone: "battlefield",
    });
    const humanCard = makeInstance(GRIZZLY_BEARS, {
        id: "human-bears",
        controllerId: HUMAN,
        ownerId: HUMAN,
        zone: "hand",
    });
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        players: [
            makePlayer(HUMAN, { hand: [humanCard] }),
            makePlayer(BOT, { hand: [woc], battlefield: [s1, s2] }),
        ],
    });
}

describe("Word of Command — Bot move-selection path (#581, ADR 0037)", () => {
    it("enumerates casting Word of Command at the opponent as a legal macro-move", () => {
        const state = seed();
        const moves = enumerateMoves(state, BOT);
        const wocCasts = moves.filter(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell" && m.cardInstanceId === "bot-woc"
        );
        expect(wocCasts.length).toBeGreaterThan(0);
        // CR 115 — "target opponent": the only legal target is the human, and
        // the Bot pays {B}{B} from its two Swamps (no illegal/unpayable move).
        for (const cast of wocCasts) {
            expect(cast.targets).toEqual([{ type: "player", id: HUMAN }]);
            expect(cast.tapPlan).toHaveLength(2);
        }
    });

    it("the root selector picks the Word of Command cast when it is the better line", () => {
        const state = seed();
        const wocCast = enumerateMoves(state, BOT).find(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "bot-woc"
        );
        if (!wocCast) throw new Error("WoC cast not enumerated");
        const pass: Move = { kind: "pass" };

        // Synthetic root: the WoC cast has a strictly higher mean reward than
        // pass, so the deterministic root selection must return it (no tie-break
        // ambiguity — WoC is not a free mana source).
        const root = rootOf([
            { move: pass, meanReward: 0.5, meanMargin: 0 },
            { move: wocCast, meanReward: 0.85, meanMargin: 300 },
        ]);
        const chosen = selectRootMove(root, [pass, wocCast], state, BOT);
        expect(chosen.kind).toBe("cast-spell");
        expect(
            (chosen as Extract<Move, { kind: "cast-spell" }>).cardInstanceId
        ).toBe("bot-woc");
    });
});

/** Build a search root with one edge per move and hand-set edge statistics
 *  (mirrors search.test.ts `rootOf`). 100 visits per edge keeps the robust-child
 *  selector well past its confidence floor. */
function rootOf(
    edges: { move: Move; meanReward: number; meanMargin: number }[]
): Node {
    const children = new Map<string, Edge>();
    edges.forEach((e, i) => {
        const visits = 100;
        children.set(`${e.move.kind}:${i}`, {
            move: e.move,
            key: `${e.move.kind}:${i}`,
            mover: BOT,
            node: { children: new Map() },
            visits,
            totalReward: e.meanReward * visits,
            totalMargin: e.meanMargin * visits,
            avail: visits,
        });
    });
    return { children };
}
