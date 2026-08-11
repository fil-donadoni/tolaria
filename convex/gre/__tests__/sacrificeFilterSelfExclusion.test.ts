import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * `cost.sacrificeFilter` payability guard (issue #2367).
 *
 * `PermanentFilter.excludeSource` (CR 109.2 — "Sacrifice ANOTHER artifact")
 * carries no instance id of its own: a card definition's `sacrificeFilter` is a
 * static object shared by every instance of the card, so the source is supplied
 * at MATCH time via `FilterMatchContext.selfInstanceId`. The matcher fails
 * CLOSED without it — which is the safe direction (the ability reads as
 * unactivatable rather than self-payable), but it is still wrong, and it is
 * wrong SILENTLY: the affordance simply never appears, on whichever surface
 * forgot.
 *
 * There is no choke point to guard instead. `cost.sacrificeFilter` is read by
 * ~5 independent payability sites across the server, the bot's move enumerator
 * and the client's two affordability gates, each of which builds its OWN
 * `FilterMatchContext` inline; they already drifted once on `selfControllerId`
 * / `supertypesOf` (issues #1209, #2235). This makes "every one of them threads
 * the source id" mechanical instead of a prose norm.
 *
 * Deliberately NOT a whole-repo sweep: only the files where a
 * `cost.sacrificeFilter` decides whether an activation is legal or offered.
 * The SELECTION path (`gre/sacrificeChoice.ts`, `legalActions.ts`, the client
 * picker) is exempt by construction — it reads a requirement whose filter was
 * already lowered to a concrete `excludeInstanceIds` entry by
 * `resolveExcludeSource` when the selection was built.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Every file that matches an ability's `cost.sacrificeFilter` to decide
 *  whether the activation is legal (server) or offered (client / bot). */
const GUARDED_FILES = [
    "convex/game.ts",
    "convex/gre/moves.ts",
    "src/lib/card-utils.ts",
];

const CALL_NAMES = ["matchesPermanentFilter(", "matchesEnginePermanentFilter("];

type Call = { line: number; filterArg: string; ctxArg: string };

/** Extracts `matchesPermanentFilter` / `matchesEnginePermanentFilter` calls
 *  along with their 2nd (filter) and 3rd (context) arguments, splitting on
 *  depth-0 commas so nested calls and object literals survive. Comment-only
 *  lines inside an argument are stripped before matching, so a `selfInstanceId`
 *  mentioned in prose cannot vouch for a call that doesn't pass it. */
function calls(src: string): Call[] {
    const out: Call[] = [];
    for (const needle of CALL_NAMES) {
        let from = 0;
        for (;;) {
            const at = src.indexOf(needle, from);
            if (at === -1) break;
            from = at + needle.length;
            const before = src.slice(Math.max(0, at - 24), at);
            // Skip the function's own declaration / import / re-export.
            if (/(function|import|export)\s*$|\bfrom\s*$/.test(before))
                continue;
            // `matchesEnginePermanentFilter(` also ends with the shorter
            // needle's text, so avoid counting it twice.
            if (
                needle === "matchesPermanentFilter(" &&
                src.slice(Math.max(0, at - 6), at + needle.length) ===
                    `Engine${needle}`
            ) {
                continue;
            }
            const args: string[] = [];
            let depth = 0;
            let start = from;
            let i = from;
            for (; i < src.length; i++) {
                const ch = src[i];
                if (ch === "(" || ch === "[" || ch === "{") depth++;
                else if (ch === ")" || ch === "]" || ch === "}") {
                    if (depth === 0) {
                        args.push(src.slice(start, i));
                        break;
                    }
                    depth--;
                } else if (ch === "," && depth === 0) {
                    args.push(src.slice(start, i));
                    start = i + 1;
                }
            }
            const strip = (raw: string | undefined) =>
                (raw ?? "")
                    .split("\n")
                    .map((l) => l.replace(/^\s*\/\/.*$/, ""))
                    .join("\n")
                    .trim();
            out.push({
                line: src.slice(0, at).split("\n").length,
                filterArg: strip(args[1]),
                ctxArg: strip(args[2]),
            });
            from = i;
        }
    }
    return out;
}

/** The calls whose FILTER argument is an ability's activation-cost sacrifice
 *  filter — the only ones this guard is about. */
function sacrificeCostCalls(src: string): Call[] {
    return calls(src).filter((c) =>
        /\bcost\.sacrificeFilter\b/.test(c.filterArg)
    );
}

describe("cost.sacrificeFilter payability threads selfInstanceId (CR 109.2, issue #2367)", () => {
    for (const rel of GUARDED_FILES) {
        it(`${rel} passes ctx.selfInstanceId to every sacrificeFilter match`, () => {
            const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
            const offenders = sacrificeCostCalls(src).filter(
                (c) => !/\bselfInstanceId\s*:/.test(c.ctxArg)
            );
            expect(
                offenders.map((o) => `${rel}:${o.line} → ctx=${o.ctxArg}`)
            ).toEqual([]);
        });
    }

    it("guards files that actually contain such a call (never vacuously green)", () => {
        for (const rel of GUARDED_FILES) {
            const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
            expect(
                sacrificeCostCalls(src).length,
                `${rel} has no cost.sacrificeFilter match — drop it from GUARDED_FILES or fix the path`
            ).toBeGreaterThan(0);
        }
    });

    it("both convex/game.ts activation branches are covered, not just one", () => {
        // The up-front legality gate is duplicated: `activateAbilityOnState`
        // and the `pendingActivation` path carry the SAME eight-line scan.
        // Fixing one and not the other is the specific regression shape here.
        const src = fs.readFileSync(
            path.join(REPO_ROOT, "convex/game.ts"),
            "utf8"
        );
        expect(sacrificeCostCalls(src).length).toBeGreaterThanOrEqual(2);
    });
});
