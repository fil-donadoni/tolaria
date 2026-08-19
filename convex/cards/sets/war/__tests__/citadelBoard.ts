// Shared fixture for the Bolas's Citadel tests (issue #2398).
//
// It lives in its own module (not in either test file) because the coverage is
// split across the two SUITES: the app-suite file `black.test.ts` and the
// bot-suite file `black.bot.test.ts`, which is where the `convex/gre/moves`
// enumeration assertions have to live (`scripts/__tests__/bot-suite-boundary.test.ts`
// — an application test may not import a bot-only module). Duplicating the
// board in both files would let the two suites drift apart silently. Mirrors
// `bng/__tests__/courserBoard.ts`, the same shape for the land half.

import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { PlayerState } from "../../../../gre/state";
import { bolassCitadel } from "../black";

/** A board where p1 optionally controls a Bolas's Citadel and has
 *  `libraryIds` on top of their library, top-first. */
export function citadelBoard(
    libraryIds: string[],
    withCitadel = true,
    playerOverrides: Partial<PlayerState> = {}
) {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: withCitadel
                    ? [
                          makeInstance(bolassCitadel.id, {
                              controllerId: "p1",
                              ownerId: "p1",
                              id: "citadel",
                          }),
                      ]
                    : [],
                library: libraryIds.map((cardId, i) =>
                    makeInstance(cardId, {
                        controllerId: "p1",
                        ownerId: "p1",
                        id: `p1-lib-${i}`,
                        zone: "library",
                    })
                ),
                ...playerOverrides,
            }),
            makePlayer("p2"),
        ],
    });
}
