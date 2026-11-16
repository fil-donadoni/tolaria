// The search never writes into the state it was handed (ADR 0000 §4, issue
// #10026).
//
// `cloneGameState` shares every value under `SHARED_KEYS` by reference: the
// card ref and an object's characteristic lists (`types`, `subtypes`,
// `staticAbilities` and their `base*` layer bases). Those values are the
// ORIGINAL's own arrays, reached from every world the search derives from it,
// so one in-place write into them — a `push` in some resolution path instead
// of a reassignment — changes the position the caller still holds, and every
// sibling world with it. A bug of that shape reds nothing else: the search
// swallows engine throws (`catch {}` around its probes) and a corrupted world
// reads as ordinary weak play.
//
// Two guards, one per half of the risk:
//   1. DYNAMIC — every blade `must` position is searched, and the position
//      handed in must come back deep-equal to a snapshot taken before. Catches
//      every write the search actually reaches.
//   2. STATIC — no engine source mutates a shared list in place. Catches the
//      write on a path no position reaches yet (an as-enters choice, a
//      resolve() card).
//
// Lives in a `*.bot.test.ts` file because `convex/gre/search.ts` is a declared
// bot module (`bot-suite-boundary.test.ts` / `BOT_MODULE_EXACT`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SHARED_KEYS } from "../clone";
import { searchWithTrace } from "../search";
import { bladeScenariosForTier } from "../ai/blade/registry";
import {
    bladeDeckKnowledge,
    buildBladeState,
    DEFAULT_BLADE_SEED,
} from "../ai/blade/runner";
import { seatPlayerId } from "../ai/blade/matcher";

/** Enough iterations to expand every root candidate and play out below it;
 *  the guard is about which code paths run, not how well the search plays. */
const ITERATIONS = 10;

describe("search aliasing: the handed state is never written (issue #10026)", () => {
    const scenarios = bladeScenariosForTier("must");

    it("covers the blade must corpus", () => {
        expect(scenarios.length).toBeGreaterThan(0);
    });

    it.each(scenarios.map((s) => [s.label, s] as const))(
        "%s",
        (_label, scenario) => {
            const state = buildBladeState(scenario);
            const before = structuredClone(state);
            const botId = seatPlayerId(state, scenario.bot);
            searchWithTrace(
                state,
                botId,
                { iterations: ITERATIONS },
                DEFAULT_BLADE_SEED,
                bladeDeckKnowledge(state, scenario)
            );
            expect(state).toEqual(before);
        }
    );
});

const ENGINE_ROOTS = ["convex/gre", "convex/cards"];

/** Receivers that hold a FRESH list built inside the function, never a state
 *  object's own: the layer-2-to-5 derivation (`layers2to5.ts`) copies its
 *  type lines out of the instance before it edits them. */
const FRESH_RECEIVERS = new Set(["result"]);

function engineSources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            if (name === "__tests__") continue;
            out.push(...engineSources(path));
        } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
            out.push(path);
        }
    }
    return out;
}

describe("search aliasing: shared lists are replaced, never mutated (issue #10026)", () => {
    it("no engine source writes into a shared list in place", () => {
        const keys = [...SHARED_KEYS].filter((k) => k !== "card").join("|");
        // `<receiver>.<key>` followed by a mutating call, a length write or
        // an element write.
        const write = new RegExp(
            String.raw`(\w+)\??\.(${keys})\s*(?:\.\s*(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\s*\(|\.length\s*=(?!=)|\[[^\]]*\]\s*=(?!=))`,
            "g"
        );
        const root = process.cwd();
        const offenders: string[] = [];
        for (const dir of ENGINE_ROOTS) {
            for (const file of engineSources(join(root, dir))) {
                const lines = readFileSync(file, "utf8").split("\n");
                lines.forEach((line, i) => {
                    const code = line.trim();
                    if (code.startsWith("//") || code.startsWith("*")) return;
                    for (const m of line.matchAll(write)) {
                        if (FRESH_RECEIVERS.has(m[1])) continue;
                        offenders.push(
                            `${relative(root, file)}:${i + 1}: ${line.trim()}`
                        );
                    }
                });
            }
        }
        expect(offenders).toEqual([]);
    });
});
