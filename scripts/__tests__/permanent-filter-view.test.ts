import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Raw-instance filter guard (issue #1209).
 *
 * `matchesPermanentFilter(card, filter)` takes a `MatchablePermanent`, and a
 * raw `CardInstanceState` — or a slim projected instance — is STRUCTURALLY
 * assignable to one. That is the whole trap: it type-checks, and it is wrong.
 * Three groups of fields a filter reads are DERIVED and never stored on the
 * instance:
 *
 *   * `colors`                                   (CR 202.2 / 613.1d, layer 5)
 *   * `power` / `toughness`                      (CR 613, layer 7a-e)
 *   * `enteredThisTurn` / `controlledSinceTurnStart` (CR 400.7)
 *
 * A raw instance reads `undefined` for all of them, so any clause over them
 * fails CLOSED — and it fails SILENTLY, as an empty candidate list rather than
 * an error. Every symptom of this bug is "the affordance is simply not there":
 *
 *   * Magnetic Mountain's "blue creatures" untap veto matching nothing;
 *   * the pending-choice submit validator rejecting a pick the choice itself
 *     offered;
 *   * (#1209) `enumerateMoves` emitting ZERO activations for Hand of Justice
 *     with four untapped white creatures on the board, and for every
 *     colour-filtered `sacrificeFilter` in the catalogue (Thelonite Monk,
 *     Homarid Spawning Bed, Freyalise Supplicant).
 *
 * The fix is one shared view — `effectivePermanentView`
 * (`convex/gre/permanentView.ts`) server-side, `projectedPermanentView`
 * (`src/lib/ai/bot-view.ts`) over the wire projection. This guard makes that
 * mechanical: on the COST / PAYMENT / MOVE-ENUMERATION path, the first argument
 * of every `matchesPermanentFilter` call must be a view, not a bare instance.
 *
 * Deliberately scoped to the files below rather than the whole repo. The
 * trigger-matching modules (`convex/cards/abilities/triggers/**`) legitimately
 * match an event's subject, whose filters are authored against printed
 * characteristics; widening this guard to them is a separate decision, not a
 * silent side effect of closing #1209.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The cost / payment / move-enumeration path — every place a filter decides
 *  whether a player (or the bot) may pay for, or even be OFFERED, an action. */
const GUARDED_FILES = [
    "convex/game.ts",
    "convex/gre/moves.ts",
    "convex/gre/paymentPicks.ts",
    "convex/gre/activationCostPicks.ts",
    "convex/gre/sacrificeChoice.ts",
    "convex/gre/alternativeCost.ts",
    "convex/gre/rules.ts",
    "src/lib/ai/bot-view.ts",
    "src/lib/ai/selfplay/playGame.ts",
];

/** An argument expression that has been through a layered view. Either a call
 *  to one of the two view helpers, an inline object literal that spreads the
 *  instance and adds the derived fields, or an identifier NAMED for a view. */
const VIEWED_ARGUMENT =
    /^(effectivePermanentView\(|projectedPermanentView\(|\{\s*\.\.\.|[\w$]*[Vv]iew[\w$]*$)/;

/** Extracts the source text of the FIRST argument of each
 *  `matchesPermanentFilter(` call, by scanning forward to the matching comma at
 *  depth 0 (so nested calls / object literals in the argument are handled).
 *  Comment lines inside the argument are stripped before matching. */
function firstArguments(src: string): { line: number; text: string }[] {
    const out: { line: number; text: string }[] = [];
    const needle = "matchesPermanentFilter(";
    let from = 0;
    for (;;) {
        const at = src.indexOf(needle, from);
        if (at === -1) break;
        from = at + needle.length;
        // Skip the declaration/import of the function itself.
        const before = src.slice(Math.max(0, at - 24), at);
        if (/(function|import|export)\s*$|\bfrom\s*$/.test(before)) continue;
        let depth = 0;
        let i = from;
        for (; i < src.length; i++) {
            const ch = src[i];
            if (ch === "(" || ch === "[" || ch === "{") depth++;
            else if (ch === ")" || ch === "]" || ch === "}") {
                if (depth === 0) break;
                depth--;
            } else if (ch === "," && depth === 0) break;
        }
        const raw = src.slice(from, i);
        const text = raw
            .split("\n")
            .map((l) => l.replace(/^\s*\/\/.*$/, ""))
            .join("\n")
            .trim();
        out.push({ line: src.slice(0, at).split("\n").length, text });
        from = i;
    }
    return out;
}

describe("matchesPermanentFilter never sees a raw instance (issue #1209)", () => {
    for (const rel of GUARDED_FILES) {
        it(`${rel} passes a layered view to every filter match`, () => {
            const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
            const offenders = firstArguments(src).filter(
                (a) => !VIEWED_ARGUMENT.test(a.text)
            );
            expect(
                offenders.map((o) => `${rel}:${o.line} → ${o.text}`)
            ).toEqual([]);
        });
    }

    it("guards files that actually contain such a call", () => {
        // A typo'd path, or a call site that moved out of a guarded file, would
        // otherwise make this suite vacuously green.
        for (const rel of GUARDED_FILES) {
            const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
            expect(
                firstArguments(src).length,
                `${rel} has no matchesPermanentFilter call — drop it from GUARDED_FILES or fix the path`
            ).toBeGreaterThan(0);
        }
    });
});
