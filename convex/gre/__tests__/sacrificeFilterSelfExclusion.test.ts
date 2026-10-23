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
 * There is no choke point to guard instead. The filtered give-up legs
 * (`cost.sacrificeFilter`, `cost.returnToHandFilter` — listed once by
 * `permanentGiveUpCostLegs`, `gre/constants.ts`) are matched by independent
 * payability sites across the server, the bot's move enumerator, the mana
 * option list and the client's affordability gates, each of which builds its
 * OWN `FilterMatchContext` inline — the matcher differs per surface (layered
 * server view vs projected client board), so only the leg list and the count
 * rule are shared. They already drifted once on `selfControllerId` /
 * `supertypesOf` (issues #1209, #2235). This makes "every one of them threads
 * the source id" mechanical instead of a prose norm.
 *
 * Deliberately NOT a whole-repo sweep: only the files where a give-up leg
 * decides whether an activation is legal or offered. A site is recognised by
 * its matcher call sitting inside a `canPayPermanentGiveUpCostLegs(…)` call or
 * a `for (… of permanentGiveUpCostLegs(…)) { … }` loop.
 * The SELECTION path (`gre/sacrificeChoice.ts`, `legalActions.ts`, the client
 * picker) is exempt by construction — it reads a requirement whose filter was
 * already lowered to a concrete `excludeInstanceIds` entry by
 * `resolveExcludeSource` when the selection was built.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Every file that matches an ability's give-up legs to decide whether the
 *  activation is legal (server) or offered (client / bot / mana list). */
const GUARDED_FILES = [
    "convex/gre/activation.ts",
    "convex/gre/constants.ts",
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

/** The index one past the bracket closing the one opened at `open`. */
function closeOf(src: string, open: number): number {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        const ch = src[i];
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") {
            depth--;
            if (depth === 0) return i + 1;
        }
    }
    return src.length;
}

/** The source spans that weigh a give-up leg: every
 *  `canPayPermanentGiveUpCostLegs(…)` call's argument list, and every
 *  `for (… of permanentGiveUpCostLegs(…)) { … }` loop body. */
function giveUpSpans(src: string): [number, number][] {
    const spans: [number, number][] = [];
    const needle = "canPayPermanentGiveUpCostLegs(";
    for (let at = src.indexOf(needle); at !== -1; ) {
        const before = src.slice(Math.max(0, at - 24), at);
        const open = at + needle.length - 1;
        if (!/(function|import|export)\s*$/.test(before)) {
            spans.push([open, closeOf(src, open)]);
        }
        at = src.indexOf(needle, at + needle.length);
    }
    const loop = /for \(const \w+ of permanentGiveUpCostLegs\(/g;
    for (let m = loop.exec(src); m; m = loop.exec(src)) {
        const body = src.indexOf("{", closeOf(src, src.indexOf("(", m.index)));
        spans.push([body, closeOf(src, body)]);
    }
    return spans;
}

/** The matcher calls that weigh an activation-cost give-up leg — the only
 *  ones this guard is about. */
function sacrificeCostCalls(src: string): Call[] {
    const spans = giveUpSpans(src);
    const lineStart = (line: number) =>
        src
            .split("\n")
            .slice(0, line - 1)
            .join("\n").length;
    return calls(src).filter((c) => {
        const at = lineStart(c.line);
        return spans.some(([a, b]) => at >= src.lastIndexOf("\n", a) && at < b);
    });
}

describe("give-up-leg payability threads selfInstanceId (CR 109.2, issue #2367)", () => {
    for (const rel of GUARDED_FILES) {
        it(`${rel} passes ctx.selfInstanceId to every give-up-leg match`, () => {
            const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
            const offenders = sacrificeCostCalls(src).filter(
                (c) => !/\bselfInstanceId\s*:/.test(c.ctxArg)
            );
            expect(
                offenders.map((o) => `${rel}:${o.line} → ctx=${o.ctxArg}`)
            ).toEqual([]);
        });
    }

    // CR 303.4b — `PermanentFilter.hostOfSource` ("Sacrifice enchanted
    // creature", issue #4319) is the same shape one field over: it fails closed
    // without `ctx.selfAttachedToId`, so a payability site that forgets the host
    // silently reports the ability as unactivatable.
    for (const rel of GUARDED_FILES) {
        it(`${rel} passes ctx.selfAttachedToId to every give-up-leg match`, () => {
            const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
            const offenders = sacrificeCostCalls(src).filter(
                (c) => !/\bselfAttachedToId\s*:/.test(c.ctxArg)
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
                `${rel} has no give-up-leg match — drop it from GUARDED_FILES or fix the path`
            ).toBeGreaterThan(0);
        }
    });

    it("the server keeps ONE payability gate, and every entry point calls it", () => {
        // Until issue #3455 the up-front legality scan was DUPLICATED — the
        // same eight lines in `activateAbilityOnState` and in the
        // `pendingActivation` path — and this guard counted `>= 2` because
        // fixing one and not the other was the regression shape. The
        // duplication is GONE: `assertPermanentGiveUpCostAffordable` is the
        // single authority both call, which is strictly stronger than two
        // copies agreeing. So the guard asserts the shape that replaced it —
        // exactly one matcher call, owned by that helper, with every
        // announcement path routed through it.
        //
        // The surface is TWO files since issue #3479: the CR 602 announcement
        // path moved to `convex/gre/activation.ts` (so the browser can replay
        // it — `convex/game.ts` imports `./auth`, which the client bundle may
        // never reach, ADR 0074) and took the gate with it, while
        // `finalizeTargetSelection` stayed behind. Both are read here, because
        // a gate in one file and a hand-rolled copy in the other is exactly
        // the shape this guard exists to refuse.
        const gameSrc = fs.readFileSync(
            path.join(REPO_ROOT, "convex/game.ts"),
            "utf8"
        );
        const activationSrc = fs.readFileSync(
            path.join(REPO_ROOT, "convex/gre/activation.ts"),
            "utf8"
        );
        // Since issue #6500 `finalizeTargetSelection` calls the helper too,
        // so `game.ts` holds NO matcher of its own.
        expect(sacrificeCostCalls(gameSrc).length).toBe(0);
        expect(sacrificeCostCalls(activationSrc).length).toBe(1);
        const gate = activationSrc.slice(
            activationSrc.indexOf(
                "export function assertPermanentGiveUpCostAffordable("
            )
        );
        expect(
            sacrificeCostCalls(gate.slice(0, gate.indexOf("\n}\n")))
        ).toHaveLength(1);
        // The declaration plus the three announcement paths (the STACK
        // activation, the non-stack mana one and `finalizeTargetSelection`),
        // wherever they now live.
        expect(
            (
                (gameSrc + activationSrc).match(
                    /assertPermanentGiveUpCostAffordable\(/g
                ) ?? []
            ).length
        ).toBeGreaterThanOrEqual(4);
    });
});
