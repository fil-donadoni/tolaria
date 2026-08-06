// Shared fixture for the Courser of Kruphix tests.
//
// It lives in its own module (not in either test file) because the coverage is
// split across the two SUITES: the app-suite file `green.test.ts` and the
// bot-suite file `green.bot.test.ts`, which is where the `convex/gre/moves`
// enumeration assertions have to live (`scripts/__tests__/bot-suite-boundary.test.ts`
// — an application test may not import a bot-only module). Duplicating the
// board in both files would let the two suites drift apart silently.

import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { courserOfKruphix } from "../green";

/** A board where p1 optionally controls a Courser and has `libraryIds` on top
 *  of their library, top-first. */
export function courserBoard(
    libraryIds: string[],
    withCourser = true,
    playerOverrides: Parameters<typeof makePlayer>[1] = {}
) {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: withCourser
                    ? [
                          makeInstance(courserOfKruphix.id, {
                              controllerId: "p1",
                              ownerId: "p1",
                              id: "courser",
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
