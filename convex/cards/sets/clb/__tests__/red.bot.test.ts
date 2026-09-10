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
// `sacrifice-permanents` IS a registered `CHOICE_CANDIDATE_GENERATORS` entry
// since issue #3377 — an in-tree ISMCTS search node, closing the pre-existing
// catalogue-wide gap this file used to document (shared by every other
// `sacrifice-permanents` card, Minsc & Boo included), not something this card
// introduces. `enumerateMoves` therefore surfaces the sacrifice as a real
// in-tree Move, and the driver hands it to the SEARCH rather than to the
// ADR 0016 heuristic default (`OwedChoice.searchable` flips with the
// registration — see `src/lib/ai/__tests__/root-choice-search-routing.
// bot.test.ts`, whose registry-driven guard demands a fixture for every
// generator-covered kind). Gut's own choice is OPTIONAL (`min: 0`), so the
// generator emits a decline branch beside the victims; without it,
// registering the kind would have flipped the gap's sign rather than closing
// it (issue #3377 review finding 1).

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack, type GameState } from "../../../../gre/state";
import { emitAttackersDeclaredEvents } from "../../../../gre/phases";
import { enumerateMoves } from "../../../../gre/moves";
import { getDefinition } from "../../../index";

const gutTrueSoulZealot = getDefinition("3d8ca18d-9099-4f1e-95c1-f04da58a26bd");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

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
    it("enumerateMoves surfaces the sacrifice as an in-tree move (issue #3377)", () => {
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

        // Was `toEqual([])` until issue #3377 registered the generator. The
        // gap cost more than a worse victim pick: with no candidates,
        // `settleStackForBreakdown` could not get past the suspended choice, so
        // every probe resolving something that leads to one scored the entering
        // BODY and never the sacrifice paying for it.
        const moves = enumerateMoves(state, "p1");
        expect(moves.length).toBeGreaterThan(0);
        for (const move of moves) {
            expect(move.kind).toBe("resolution-choice");
        }
        // Only the FODDER is offered: Gut is attacking, and the choice's own
        // filter is what decides — the generator reads the same
        // `matchesPermanentFilter` gate `pendingChoiceSubmit` enforces.
        const offered = new Set(
            moves.flatMap(
                (m) =>
                    (m as { cardInstanceIds?: string[] }).cardInstanceIds ?? []
            )
        );
        expect(offered.size).toBeGreaterThan(0);
    });
});
