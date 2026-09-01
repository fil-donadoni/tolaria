// LCC red — the BOT-suite half of Broadside Bombardiers' Boast coverage
// (CR 702.142a, issue #2375). Separate from `red.test.ts` because it imports
// `gre/moves`, a bot-only module: a plain `*.test.ts` importing one drags it
// into the app suite, which `scripts/__tests__/bot-suite-boundary.test.ts`
// fails the build over.

import { describe, it, expect } from "vitest";
import { broadsideBombardiers } from "../red";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { enumerateMoves } from "../../../../gre/moves";
import type { CardInstanceState, GameState } from "../../../../gre/state";

const BOAST_ID = "broadside-bombardiers-boast-damage";

/** Broadside Bombardiers plus the single legal victim for its "another
 *  creature or artifact" cost (CR 109.2), post-combat on its controller's
 *  turn — the window CR 702.142a opens the boast in. */
function board(): { state: GameState; source: CardInstanceState } {
    const source = makeInstance(broadsideBombardiers.id, {
        id: "bombardiers",
        controllerId: "p1",
        ownerId: "p1",
    });
    const victim = makeInstance(grizzlyBears.id, {
        id: "victim",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [source, victim] }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "POSTCOMBAT_MAIN",
    });
    return { state, source };
}

describe("Broadside Bombardiers — Boast is a bot-visible Move only post-attack (CR 702.142a, issue #2375)", () => {
    // The gate is a DECLARATIVE field precisely so `enumerateAbilityMoves` can
    // read it — a `canActivate` closure is skipped wholesale by that
    // enumerator, which would make Boast structurally invisible to the bot
    // rather than merely gated.
    it("enumerateMoves offers the boast activation only after the source has attacked", () => {
        const { state, source } = board();
        const boastMoves = (s: GameState) =>
            enumerateMoves(s, "p1").filter(
                (m) => m.kind === "activate-ability" && m.abilityId === BOAST_ID
            );

        expect(boastMoves(state)).toHaveLength(0);

        source.hasAttackedThisTurn = true;
        expect(boastMoves(state).length).toBeGreaterThan(0);

        // CR 602.5b — and never a second time in the same turn.
        source.activationsThisTurn = { [BOAST_ID]: 1 };
        expect(boastMoves(state)).toHaveLength(0);
    });
});
