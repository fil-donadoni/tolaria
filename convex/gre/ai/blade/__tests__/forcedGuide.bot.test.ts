/**
 * The FORCED GUIDE (ADR 0186, the Ceiling gate's instrument;
 * `SearchVariant.forcedGuide`): along a Line, the Line's move takes the whole
 * prior at every Bot decision of the Line, in the tree and in the rollouts,
 * and nothing else changes. Two arms, `forced-guide` and
 * `forced-guide-no-probes`, named in `LADDER_VARIANTS` so the blade census
 * selects them by name.
 */

import { describe, expect, it } from "vitest";
import type { Move } from "../../../moves";
import {
    searchWithTrace,
    setLineGuideRecorder,
    type LineGuideRecorder,
} from "../../../search";
import {
    LADDER_VARIANTS,
    resolveForcedGuide,
    setSearchVariant,
    stepLineCursor,
    type SearchVariant,
} from "../../searchVariant";
import { ROOT_DECISION_MECHANISMS } from "../../decisionTelemetry";
import { buildBladeState } from "../build";
import { buildLineState, lineGuideFor, runBladeLine } from "../line";
import { BLADE_LINES } from "../lines";
import { seatPlayerId } from "../matcher";
import { bladeScenariosForTier } from "../registry";
import { DEFAULT_BLADE_SEED } from "../runner";
import type { BladeLine } from "../types";
import { resolveBladeVariant } from "../variant";

const ARMS = ["forced-guide", "forced-guide-no-probes"] as const;

type Event = { where: "tree" | "rollout"; step: number; move: Move };

function recording<T>(run: () => T): { value: T; events: Event[] } {
    const events: Event[] = [];
    const recorder: LineGuideRecorder = (where, step, move) =>
        events.push({ where, step, move });
    const previous = setLineGuideRecorder(recorder);
    try {
        return { value: run(), events };
    } finally {
        setLineGuideRecorder(previous);
    }
}

function under<T>(variant: SearchVariant | null, run: () => T): T {
    setSearchVariant(variant);
    try {
        return run();
    } finally {
        setSearchVariant(null);
    }
}

/** A search's trace with its wall-clock fields removed: everything else is a
 *  pure function of the position, the seed and the iteration budget. */
function deterministicPart(result: ReturnType<typeof searchWithTrace>) {
    return JSON.stringify(result, (key, value: unknown) =>
        key.endsWith("Ms") ? undefined : value
    );
}

/** `variant` with `line` bound from decision `step`, as the Line runner binds
 *  it. */
function bound(
    arm: (typeof ARMS)[number],
    line: BladeLine,
    step: number,
    botId: string
): SearchVariant {
    const variant = LADDER_VARIANTS[arm];
    return {
        ...variant,
        forcedGuide: {
            ...variant.forcedGuide!,
            line: lineGuideFor(line, step, botId),
        },
    };
}

const LINE = BLADE_LINES[0];

describe("forced guide — the two arms are census-selectable by name", () => {
    it.each(ARMS)("%s resolves through the blade variant reader", (arm) => {
        const variant = resolveBladeVariant(arm);
        expect(variant?.name).toBe(arm);
        expect(variant?.forcedGuide?.probes).toBe(arm === "forced-guide");
    });

    it("is not a root decision mechanism and does not disable one", () => {
        for (const arm of ARMS) {
            expect(ROOT_DECISION_MECHANISMS).not.toContain(arm);
            expect(LADDER_VARIANTS[arm].disabledRootRules).toBeUndefined();
        }
    });
});

describe("forced guide — off any Line, the search is the base search", () => {
    it.each(ARMS)("%s with no Line bound resolves to no guide", (arm) => {
        expect(resolveForcedGuide(LADDER_VARIANTS[arm])).toBeNull();
        expect(resolveForcedGuide(null)).toBeNull();
    });

    // The whole `must` tier is `BLADE_VARIANT=<arm> bun run test:blade`; this
    // samples it on the full trace, visit counts included.
    const sample = bladeScenariosForTier("must")
        .filter((s) => !s.revisit && !s.setup?.length)
        .filter((_, i) => i % 97 === 0)
        .slice(0, 6);

    it.each(sample.map((s) => [s.label, s] as const))(
        "same pick and visit counts under both arms: %s",
        (_label, scenario) => {
            const run = () => {
                const state = buildBladeState(scenario);
                const botId = seatPlayerId(state, scenario.bot);
                return deterministicPart(
                    searchWithTrace(
                        state,
                        botId,
                        { iterations: scenario.budget.iterations },
                        DEFAULT_BLADE_SEED
                    )
                );
            };
            const base = run();
            for (const arm of ARMS) {
                expect(under(LADDER_VARIANTS[arm], run)).toBe(base);
            }
        }
    );

    it("the Line itself, under the base search, records no forcing", () => {
        const { value, events } = recording(() => runBladeLine(LINE));
        expect(value.ok).toBe(true);
        expect(events).toEqual([]);
    });
});

describe("forced guide — the Line's move takes the prior at the Line's decisions only", () => {
    it("forces every decision of the Line, each with that decision's move", () => {
        const { events } = recording(() =>
            runBladeLine(
                { ...LINE, seeds: [DEFAULT_BLADE_SEED] },
                LADDER_VARIANTS["forced-guide"]
            )
        );
        const treeSteps = new Set(
            events.filter((e) => e.where === "tree").map((e) => e.step)
        );
        expect([...treeSteps].sort()).toEqual(LINE.steps.map((_, i) => i));
        for (const e of events) {
            expect(e.step).toBeLessThan(LINE.steps.length);
            expect(e.move.kind).toBe(LINE.steps[e.step].expect[0].kind);
        }
    });

    it("forces nothing at a position whose Line move is not offered", () => {
        const state = buildLineState(LINE);
        const botId = seatPlayerId(state, LINE.bot);
        const offLine: BladeLine = {
            ...LINE,
            steps: [{ expect: [{ kind: "declare-attackers" }] }],
        };
        const { events } = recording(() =>
            under(bound("forced-guide", offLine, 0, botId), () =>
                searchWithTrace(
                    state,
                    botId,
                    { iterations: 100 },
                    DEFAULT_BLADE_SEED
                )
            )
        );
        expect(events).toEqual([]);
    });

    it("the cursor leaves the Line on any move the Line does not play", () => {
        const at = { step: 1, replied: 0 };
        const pass: Move = { kind: "pass" };
        const other = { kind: "play-land" } as unknown as Move;
        // The Bot: its Line move advances, anything else leaves.
        expect(stepLineCursor(at, true, true, true, other)).toEqual({
            step: 2,
            replied: 0,
        });
        expect(stepLineCursor(at, true, true, false, pass)).toBeNull();
        expect(stepLineCursor(at, true, false, false, pass)).toBeNull();
        // The opponent: its reply is consumed, a pass with none offered
        // keeps the cursor, anything else leaves.
        expect(stepLineCursor(at, false, true, true, other)).toEqual({
            step: 1,
            replied: 1,
        });
        expect(stepLineCursor(at, false, false, false, pass)).toBe(at);
        expect(stepLineCursor(at, false, true, false, pass)).toBeNull();
        expect(stepLineCursor(at, false, false, false, other)).toBeNull();
    });

    it("the Line names no Bot move past its end or before a pending reply", () => {
        const state = buildLineState(LINE);
        const botId = seatPlayerId(state, LINE.bot);
        const guide = lineGuideFor(LINE, 0, botId);
        const moves: Move[] = [{ kind: "pass" }];
        expect(guide.start).toEqual({ step: 0, replied: 0 });
        expect(guide.lineMoveIndex(state, botId, guide.start, moves)).toBe(0);
        // Decision 2 follows one reply (the Shock): not yet played → none.
        expect(
            guide.lineMoveIndex(state, botId, { step: 1, replied: 0 }, moves)
        ).toBe(-1);
        expect(
            guide.lineMoveIndex(
                state,
                botId,
                { step: LINE.steps.length, replied: 0 },
                moves
            )
        ).toBe(-1);
        expect(lineGuideFor(LINE, 1, botId).start).toEqual({
            step: 1,
            replied: 1,
        });
    });
});

describe("forced guide — the arms differ only in the rollouts' probes", () => {
    it("the probe-free arm runs its rollouts with no 1-ply probe", () => {
        const state = buildLineState(LINE);
        const botId = seatPlayerId(state, LINE.bot);
        const probes = (arm: (typeof ARMS)[number]) =>
            under(bound(arm, LINE, 0, botId), () =>
                searchWithTrace(
                    state,
                    botId,
                    { iterations: LINE.budget.iterations },
                    DEFAULT_BLADE_SEED
                )
            ).trace?.rolloutProbes;
        expect(probes("forced-guide")).toBeGreaterThan(0);
        expect(probes("forced-guide-no-probes")).toBe(0);
    });
});

describe("forced guide — the prior is forced, the pick is still the search's", () => {
    // A Line whose one move is a loss on the engine: Shock the Bot's own
    // Grizzly Bears (2 damage kills a 2/2, CR 704.5g) instead of the
    // opponent's creature or face.
    const losing: BladeLine = {
        label: "forced guide: Shock your own Bears",
        spec: {
            cards: [
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "battlefield" },
                { name: "Shock", owner: "me", zone: "hand" },
                { name: "Llanowar Elves", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            activePlayer: "me",
            priority: "me",
            landCount: 0,
            libraryCount: 10,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [DEFAULT_BLADE_SEED, 1, 2],
        tier: "stretch",
        cause: "a losing move, forced to show the search refuses it",
        steps: [
            {
                expect: [
                    {
                        kind: "cast-spell",
                        card: "Shock",
                        target: "Grizzly Bears",
                    },
                ],
            },
        ],
        note: "Test fixture only.",
    };

    it("forces the losing move's prior, and the search does not pick it", () => {
        const { value, events } = recording(() =>
            runBladeLine(losing, LADDER_VARIANTS["forced-guide"])
        );
        expect(events.some((e) => e.where === "tree" && e.step === 0)).toBe(
            true
        );
        for (const seed of value.seeds) {
            expect(seed.ok).toBe(false);
            expect(seed.reason).toMatch(
                /^decision 1: expected \[.*\], chose \[/
            );
            expect(seed.reason).not.toMatch(/chose \[[^\]]*Grizzly/);
        }
    });

    it("the forced prior moves the visits toward the Line's move, not the pick", () => {
        const state = buildLineState(losing);
        const botId = seatPlayerId(state, losing.bot);
        const visitsOnLosing = (variant: SearchVariant | null) => {
            const result = under(variant, () =>
                searchWithTrace(
                    state,
                    botId,
                    { iterations: losing.budget.iterations },
                    DEFAULT_BLADE_SEED
                )
            );
            const hit = (result.trace?.candidates ?? []).find(
                (c) =>
                    c.move.kind === "cast-spell" && c.label.includes("Grizzly")
            );
            return hit?.visits ?? 0;
        };
        // The base search barely opens the self-Shock; the forced prior
        // spends visits on it (PUCT's exploration term scales with the
        // prior) and the search still picks something else (above).
        expect(
            visitsOnLosing(bound("forced-guide", losing, 0, botId))
        ).toBeGreaterThan(visitsOnLosing(null));
    });
});
