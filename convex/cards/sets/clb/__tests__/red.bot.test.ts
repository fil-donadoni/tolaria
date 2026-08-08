// clb — red card tests, BOT suite (issue #2373).
//
// Gut, True Soul Zealot's attack trigger raises a `sacrifice-permanents`
// PendingChoice — bot-only ground. That module is bot-only, so this case
// cannot live in the sibling `red.test.ts` — `scripts/__tests__/
// bot-suite-boundary.test.ts` fails the application suite when a plain
// `*.test.ts` imports a bot-only module. Everything else about the card
// (definition, GRE resolution, wire format) stays in `red.test.ts`.
//
// This file stays convex-side (`convex/gre/*` only), matching the established
// per-card bot test convention (`sets/bng/__tests__/green.bot.test.ts`,
// `sets/mh2/__tests__/colorless.bot.test.ts`) — neither reaches into
// `src/lib/ai`. The `buildBotView`/`chooseResolution` (ADR 0016 heuristic)
// proof lives in `src/lib/ai/__tests__/gutTrueSoulZealot.bot.test.ts`
// instead, alongside the other resolution-choice integration coverage.
//
// `sacrifice-permanents` has no registered `CHOICE_CANDIDATE_GENERATORS`
// entry (`convex/gre/ai/choiceCandidates.ts`) — it is not (yet) an in-tree
// ISMCTS search node, a PRE-EXISTING gap shared by every other
// `sacrifice-permanents` card (Minsc & Boo included), not something this card
// introduces. `enumerateMoves` therefore surfaces no in-tree Move for it (by
// design — see the comment at its `headChoice` branch, `convex/gre/moves.ts`);
// the driver instead answers it through the ADR 0016 heuristic default,
// proven in the sibling frontend suite. See `docs/findings/` for the
// catalogue-wide follow-up this surfaced.

import { describe, it, expect } from "vitest";
import { gutTrueSoulZealot } from "../red";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack, type GameState } from "../../../../gre/state";
import { emitAttackersDeclaredEvents } from "../../../../gre/phases";
import { enumerateMoves } from "../../../../gre/moves";

function declareAttackers(state: GameState, attackerIds: string[]): void {
    state.phase = "DECLARE_ATTACKERS";
    state.combat = {
        attackerIds,
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: false,
    };
    emitAttackersDeclaredEvents(state);
}

describe("Gut, True Soul Zealot — bot decision surface (ADR 0016, issue #2373)", () => {
    it("enumerateMoves surfaces NO in-tree move (sacrifice-permanents has no ISMCTS generator — a pre-existing, catalogue-wide gap)", () => {
        const gut = makeInstance(gutTrueSoulZealot.id, { id: "gut" });
        const fodder = makeInstance(grizzlyBears.id, { id: "fodder" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gut, fodder] }),
                makePlayer("p2"),
            ],
        });

        declareAttackers(state, [gut.id]);
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0]?.kind).toBe("sacrifice-permanents");

        expect(enumerateMoves(state, "p1")).toEqual([]);
    });
});
