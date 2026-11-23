// The consult path (issue #10470, ADR 0185): what was played between two of
// the Bot's consults, named as the search's own tree keys — and every doubt
// that breaks it, so the Worker drops its kept tree rather than walk it along
// a path that did not happen.

import { beforeEach, describe, expect, it } from "vitest";
import { projectPublicState } from "@convex/gameProjections";
import { moveKey } from "@convex/gre/search";
import { buildPositionFromSpec } from "@convex/gre/ai/blade/build";
import { seatPlayerId } from "@convex/gre/ai/blade/matcher";
import {
    breakConsultPath,
    noteBotMove,
    noteHumanCall,
    noteHumanView,
    startConsultPath,
    takeConsultPath,
} from "../consult-path";

const GAME = "game-1";

/** The opponent's upkeep, `priority` holding priority. */
function upkeep(priority: "me" | "opp") {
    return buildPositionFromSpec({
        cards: [
            { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            { name: "Hill Giant", owner: "opp", zone: "battlefield" },
        ],
        phase: "UPKEEP",
        turn: 4,
        activePlayer: "opp",
        priority,
        landCount: 0,
        libraryCount: 5,
    });
}

function position() {
    const botTurn = upkeep("me");
    const humanTurn = upkeep("opp");
    const botId = seatPlayerId(botTurn, "me");
    const humanId = seatPlayerId(botTurn, "opp");
    return {
        botId,
        humanId,
        botView: projectPublicState(botTurn, 3, botId),
        humanView: projectPublicState(humanTurn, 4, humanId),
    };
}

const PASS = moveKey({ kind: "pass" });

describe("the consult path", () => {
    let p: ReturnType<typeof position>;
    beforeEach(() => {
        p = position();
        startConsultPath(GAME, p.botId);
    });

    const humanPass = () =>
        noteHumanCall(GAME, {
            name: "game:passPriority",
            args: { gameId: GAME, playerId: p.humanId },
        });

    it("names the Bot's move and the human's, in order, as tree keys", async () => {
        noteBotMove(GAME, p.botView, { kind: "pass" });
        noteHumanView(GAME, p.humanView, p.humanId);
        humanPass();
        expect(await takeConsultPath(GAME)).toEqual([
            { seat: p.botId, key: PASS },
            { seat: p.humanId, key: PASS },
        ]);
        // A fresh path for the decisions after this consult.
        expect(await takeConsultPath(GAME)).toEqual([]);
    });

    it("ignores the Bot's own calls", async () => {
        noteHumanView(GAME, p.humanView, p.humanId);
        noteHumanCall(GAME, {
            name: "game:passPriority",
            args: { gameId: GAME, playerId: p.botId },
        });
        humanPass();
        expect(await takeConsultPath(GAME)).toEqual([
            { seat: p.humanId, key: PASS },
        ]);
    });

    it("breaks on a human call with no decision open", async () => {
        humanPass();
        expect(await takeConsultPath(GAME)).toBeNull();
    });

    it("breaks on a human decision that moved on with no call of theirs", async () => {
        noteHumanView(GAME, p.humanView, p.humanId);
        noteBotMove(GAME, p.botView, { kind: "pass" });
        expect(await takeConsultPath(GAME)).toBeNull();
    });

    it("breaks on calls that realise no move", async () => {
        noteHumanView(GAME, p.humanView, p.humanId);
        noteHumanCall(GAME, {
            name: "game:passUntilAction",
            args: { gameId: GAME, playerId: p.humanId },
        });
        expect(await takeConsultPath(GAME)).toBeNull();
    });

    it("breaks when the driver says so, and starts whole again after", async () => {
        noteBotMove(GAME, p.botView, { kind: "pass" });
        breakConsultPath(GAME);
        expect(await takeConsultPath(GAME)).toBeNull();
        noteBotMove(GAME, p.botView, { kind: "pass" });
        expect(await takeConsultPath(GAME)).toEqual([
            { seat: p.botId, key: PASS },
        ]);
    });

    it("says nothing for another game", async () => {
        noteBotMove("other", p.botView, { kind: "pass" });
        expect(await takeConsultPath("other")).toBeNull();
        expect(await takeConsultPath(GAME)).toEqual([]);
    });
});
