/**
 * Blade LINES as a Verdict source (ADR 0186 Decision 9) — `verdictsFromLine`
 * in `verdicts/registrySource.ts`. No search runs here: the lowering walks the
 * Line's own expected moves, and the gate (`blade-lines.spec.ts`) is separate.
 */

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../../cards";
import { decidingPlayer } from "../../../search";
import { buildVerdictState } from "../../verdicts/position";
import {
    lineDecisionLabel,
    verdictsFromLine,
    verdictsFromLines,
} from "../../verdicts/registrySource";
import { lineEntryProblems } from "../line";
import { BLADE_LINES } from "../lines";
import { seatPlayerId } from "../matcher";
import type { BladeLine } from "../types";

const LINE = BLADE_LINES[0];

describe("blade Lines — registry integrity", () => {
    it("every Line is well formed and uniquely labelled", () => {
        for (const line of BLADE_LINES) {
            expect(lineEntryProblems(line), line.label).toEqual([]);
        }
        const labels = BLADE_LINES.map((l) => l.label);
        expect(new Set(labels).size).toBe(labels.length);
    });

    it("a stretch Line owes its cause, a must Line carries none", () => {
        expect(lineEntryProblems({ ...LINE, tier: "stretch" })).toEqual([
            "a `stretch` Line writes the cause it cannot be followed yet",
        ]);
        expect(lineEntryProblems({ ...LINE, cause: "horizon" })).toEqual([
            "a `must` Line is followed, so it carries no cause",
        ]);
    });
});

describe("blade Lines — one Verdict per Bot decision", () => {
    it("every decision is a Verdict or a gap, never dropped", () => {
        for (const line of BLADE_LINES) {
            const out = verdictsFromLine(line);
            expect(out.verdicts.length + out.gaps.length, line.label).toBe(
                line.steps.length
            );
        }
        const all = verdictsFromLines();
        expect(all.verdicts.length + all.gaps.length).toBe(
            BLADE_LINES.reduce((n, l) => n + l.steps.length, 0)
        );
    });

    it("every Line is executable: its expected moves, played in order, reach its last decision", () => {
        // A `build` or `no-match` gap is a walk the engine refused part-way
        // (an illegal move, a reply nothing matched, a pick the generator
        // never offers): the Line would test a position nobody reaches.
        for (const line of BLADE_LINES) {
            const stopped = verdictsFromLine(line).gaps.filter(
                (g) => g.reason === "build" || g.reason === "no-match"
            );
            expect(
                stopped.map((g) => `${g.label}: ${g.detail ?? g.reason}`),
                line.label
            ).toEqual([]);
        }
    });

    it("lowers each decision at the position the Line reached, the expected move right", () => {
        const out = verdictsFromLine(LINE);
        expect(out.verdicts.map((v) => v.id)).toEqual([
            `line:${LINE.label}#1`,
            `line:${LINE.label}#2`,
        ]);
        // The last decision has one legal move: a gap, named, not a Verdict.
        expect(out.gaps).toEqual([
            expect.objectContaining({
                label: lineDecisionLabel(LINE, 2),
                reason: "unconstraining",
            }),
        ]);

        const [hold, answer] = out.verdicts;
        expect(hold.setup ?? []).toEqual([]);
        expect(hold.answer.kind).toBe("right");
        if (hold.answer.kind === "right") {
            expect(
                hold.answer.rightIndexes.map(
                    (i) => hold.candidates[i].description
                )
            ).toEqual([expect.stringMatching(/pass/i)]);
        }

        // The second decision replays the Bot's pass and the opponent's
        // Shock, and rebuilds to a decision of the Bot's with the Shock on
        // the stack.
        expect(answer.setup).toEqual(
            expect.arrayContaining([
                { kind: "move", seat: "me", move: { kind: "pass" } },
                {
                    kind: "move",
                    seat: "opp",
                    move: {
                        kind: "cast-spell",
                        card: "Shock",
                        target: "Grizzly Bears",
                    },
                },
            ])
        );
        const state = buildVerdictState(answer);
        expect(decidingPlayer(state)).toBe(seatPlayerId(state, "me"));
        expect(state.stack.map((s) => s.card.id)).toContain(
            getCardByName("Shock").id
        );
        expect(answer.answer.kind).toBe("right");
        if (answer.answer.kind === "right") {
            expect(
                answer.answer.rightIndexes.map(
                    (i) => answer.candidates[i].description
                )
            ).toEqual([expect.stringContaining("Giant Growth")]);
        }
    });

    it("a decision the Line cannot play, and every one after it, is a gap", () => {
        const broken: BladeLine = {
            ...LINE,
            steps: LINE.steps.map((step, i) =>
                i === 1
                    ? {
                          ...step,
                          expect: [{ kind: "cast-spell", card: "Shock" }],
                      }
                    : step
            ),
        };
        const out = verdictsFromLine(broken);
        expect(out.verdicts).toHaveLength(1);
        expect(out.gaps.map((g) => [g.label, g.reason])).toEqual([
            [lineDecisionLabel(LINE, 1), "no-match"],
            [lineDecisionLabel(LINE, 2), "build"],
        ]);
    });

    it("a reply no opponent decision can play is a malformed Line, reported", () => {
        const broken: BladeLine = {
            ...LINE,
            steps: LINE.steps.map((step, i) =>
                i === 0
                    ? {
                          ...step,
                          replies: [
                              { kind: "cast-spell", card: "Giant Growth" },
                          ],
                      }
                    : step
            ),
        };
        const out = verdictsFromLine(broken);
        expect(out.verdicts).toHaveLength(1);
        expect(out.gaps.map((g) => g.reason)).toEqual(["build", "build"]);
        expect(out.gaps[0].detail).toMatch(/matched no opponent move/);
    });
});
