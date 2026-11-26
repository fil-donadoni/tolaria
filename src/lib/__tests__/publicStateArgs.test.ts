// Issue #10896 — one `getPublicState` subscription per seat. The Convex
// client keys a subscription on its serialized arguments, so two callers that
// build `{ gameId, playerId, debugAllActions: false }` and `{ gameId,
// playerId }` for the same seat hold TWO subscriptions, and every save of the
// `gameStates` row re-executes the query (and re-reads the whole row) twice.
//
// Two guards: the helper's shape (the non-debug key carries no flag), and a
// scan proving every `getPublicState` call site in `src/` builds its
// arguments through that helper — the board did not, and that was the bug.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { convexToJson } from "convex/values";
import type { Id } from "@convex/_generated/dataModel";
import { publicStateArgs } from "../public-state-args";

const SRC_ROOT = join(__dirname, "..", "..");
const HELPER = join(SRC_ROOT, "lib", "public-state-args.ts");
const GAME = "g1" as Id<"games">;

/** The client's subscription key for these arguments (the args half of
 *  `serializePathAndArgs`, `convex/browser`). */
function subscriptionKey(args: Record<string, unknown>): string {
    return JSON.stringify(convexToJson(args as never));
}

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            return name === "__tests__" ? [] : sourceFiles(path);
        }
        return /\.tsx?$/.test(name) ? [path] : [];
    });
}

describe("getPublicState arguments (issue #10896)", () => {
    it("the non-debug view has one key, whoever asks", () => {
        expect(subscriptionKey(publicStateArgs(GAME, "p1", false))).toBe(
            subscriptionKey(publicStateArgs(GAME, "p1"))
        );
        expect(publicStateArgs(GAME, "p1")).toEqual({
            gameId: GAME,
            playerId: "p1",
        });
    });

    it("the debug view still sends its flag", () => {
        expect(publicStateArgs(GAME, "p1", true)).toEqual({
            gameId: GAME,
            playerId: "p1",
            debugAllActions: true,
        });
    });

    it("every call site builds its arguments through publicStateArgs", () => {
        const offenders: string[] = [];
        for (const file of sourceFiles(SRC_ROOT)) {
            // The helper names the query only for its argument type.
            if (file === HELPER) continue;
            const lines = readFileSync(file, "utf8").split("\n");
            lines.forEach((line, i) => {
                if (!line.includes("api.game.getPublicState")) return;
                // The arguments follow the reference within the same call:
                // a ternary over "skip" or a one-shot `convex.query`.
                const call = lines.slice(i, i + 4).join("\n");
                if (!call.includes("publicStateArgs(")) {
                    offenders.push(`${relative(SRC_ROOT, file)}:${i + 1}`);
                }
            });
        }
        expect(offenders).toEqual([]);
    });
});
