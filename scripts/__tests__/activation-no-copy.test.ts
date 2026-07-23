/**
 * The `activateAbility` mutation keeps NO copy of the activation path
 * (issue #1491, ADR 0070 §4).
 *
 * The whole rules body of CR 602 activation was lifted out of the mutation
 * into `activateAbilityOnState` (`convex/game.ts`) so the blade suite's
 * engine-real `activate` setup step calls the SAME code a live game runs.
 * That is only worth anything while there is exactly one implementation:
 * re-inlining any part of it beside the call recreates the silent-divergence
 * class ADR 0070 §4 exists to prevent — the setup step and the mutation would
 * drift, and the bot would be measured on a position the server cannot
 * produce.
 *
 * A behavioural test cannot see a copy; only a reader can. So this guard reads
 * the source. It lives under `scripts/__tests__` rather than `convex/__tests__`
 * because the Convex runtime lint forbids Node builtins (`node:fs`) inside
 * `convex/`. Its behavioural sibling is
 * `convex/__tests__/activateAbilityOnState.test.ts`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
);

/** The `activateAbility` mutation's source text, from its declaration to the
 *  `});` that closes it. */
function activateAbilityMutationSource(): string {
    const source = readFileSync(
        path.join(REPO_ROOT, "convex/game.ts"),
        "utf-8"
    );
    const start = source.indexOf("export const activateAbility = mutation(");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("\n});", start);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe("activateAbility mutation — single implementation (ADR 0070 §4)", () => {
    it("delegates to the extracted `activateAbilityOnState`", () => {
        expect(activateAbilityMutationSource()).toContain(
            "activateAbilityOnState(state, args)"
        );
    });

    it("holds no activation rules logic of its own", () => {
        const body = activateAbilityMutationSource();
        // A second implementation of the path would have to re-derive at least
        // one of these. Any of them reappearing in the mutation means the copy
        // is back.
        for (const token of [
            "pendingActivation",
            "pendingTarget",
            "payManaCost",
            "activatedAbilities",
            "cost.sacrifice",
            "getLegalTargets",
            "state.stack.push",
        ]) {
            expect(body).not.toContain(token);
        }
    });
});
