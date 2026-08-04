// Structural census guard: every `debug*` mutation in `convex/game.ts` is
// admin-gated (issue #1679 review finding #2).
//
// Before this guard, `adminAuth.test.ts` only unit-tested the pure
// `isAdminUser` predicate — nothing asserted "every debug mutation calls it".
// That gap is exactly how #1679 happened: `debugBo3Sideboard` got gated by
// #768's convention, but its two siblings (`debugPatchState`,
// `debugResetGame`) — same shape, same client-supplied-`gameId`-only
// selector, same reachability from the Debug panel — were left open until a
// reviewer caught them by hand. A one-at-a-time fix guarantees a fourth.
//
// ENUMERATION is a regex scan of `convex/game.ts`'s SOURCE TEXT for
// `export const debug<Name> = mutation({` — not a hardcoded list of today's
// five. This is the load-bearing property: the NEXT debug mutation anyone
// adds is picked up automatically and must pass the same check, with zero
// edits to this file. (Queries, e.g. `debugListCards`, are intentionally out
// of scope — this guard is about STATE-MUTATING debug endpoints, matching
// the review finding's own wording.)
//
// VERIFICATION traverses the REAL path per CLAUDE.md's "prefer a rule that
// traverses the real path over one that restates the code": for each
// enumerated name, this drives the REGISTERED mutation's own `_handler`
// (same technique as `debugBo3Sideboard.test.ts`) with an UNAUTHENTICATED
// stub `MutationCtx` and a generic `{ gameId: "missing-id" }` args object,
// and asserts it rejects with the admin-gate error — not some other error
// (e.g. "Game not found") that would only surface if the admin check ran
// AFTER a state read. A textual "does the handler source contain the string
// assertIsAdmin" check would pass on a call sitting in the wrong place (e.g.
// after the first read) or in a dead branch; actually invoking the handler
// distinguishes those cases. Every current debug mutation takes `gameId` as
// its first/only required selector and calls `assertIsAdmin` as the FIRST
// statement (CLAUDE.md privileged-mutation convention, issue #768/#1679), so
// a generic `{ gameId }` args object is enough to drive any of them past
// argument access and into the gate — the gate throws before any OTHER
// field is ever read.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import * as gameModule from "../game";
import { makeMutationCtx } from "./gameMutationHarness";

const GAME_TS = path.join(__dirname, "..", "game.ts");

/** Every `export const debug<Name> = mutation({ ... })` binding in
 *  `convex/game.ts`, by SOURCE SCAN — not a hand-maintained list. Queries
 *  (`= query(`) are excluded on purpose; this guard is about mutating debug
 *  endpoints. */
function enumerateDebugMutationNames(): string[] {
    const source = fs.readFileSync(GAME_TS, "utf8");
    const names: string[] = [];
    const re = /export const (debug\w+)\s*=\s*mutation\(/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
        names.push(match[1]);
    }
    return names;
}

type Handler<A, R> = { _handler: (ctx: MutationCtx, args: A) => Promise<R> };

describe("debug* mutation census — admin gate (issue #1679)", () => {
    const names = enumerateDebugMutationNames();

    // Sanity check on the scan itself — if this regresses to 0, the regex
    // broke (a file rename, an export style change) and every case below
    // would vacuously pass by not existing. Guards against shape 2
    // (proof-of-failure rule): a census over an empty list is not a census.
    it("finds at least the known debug mutations (scan sanity)", () => {
        expect(names.length).toBeGreaterThanOrEqual(5);
        expect(names).toEqual(
            expect.arrayContaining([
                "debugPatchState",
                "debugResetGame",
                "debugBo3Sideboard",
                "debugSetupScenario",
                "debugLoadBladeScenario",
            ])
        );
    });

    it.each(enumerateDebugMutationNames())(
        "%s rejects an unauthenticated caller via assertIsAdmin (not some other error)",
        async (name) => {
            const fn = (gameModule as Record<string, unknown>)[name];
            expect(
                fn,
                `convex/game.ts exports \`${name}\` as a mutation binding but ` +
                    `it is not re-exported from the module — update the export`
            ).toBeDefined();

            const stub = makeMutationCtx(null, []);
            const args = { gameId: "missing-id" as unknown as Id<"games"> };

            await expect(
                (fn as Handler<typeof args, unknown>)._handler(stub.ctx, args),
                `\`${name}\` must call assertIsAdmin(ctx) as its FIRST statement — ` +
                    `it rejected with a different error (or didn't reject at all), ` +
                    `meaning either the admin gate is missing or it runs after a ` +
                    `state read/write (issue #1679)`
            ).rejects.toThrow(/admin only/i);
        }
    );
});
