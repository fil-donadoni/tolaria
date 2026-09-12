// The lowering sweep's own tests, plus the opt-in RUNNER (issue #3461).
//
// Two roles, the `harness.bot.test.ts` shape:
//
//  1. always-on unit tests — the message classifier, the allowlist-derived
//     residue, and DETERMINISM, which is the sweep's whole contract: a number
//     that moves between two runs of the same seeds orders nothing;
//  2. opt-in runner gated by `LOWERING_SWEEP`, invoked via
//     `bun run lowering-sweep`. Not a gate, holds no gate mutex, and
//     `test:bot` collects and skips it.

import { describe, it, expect } from "vitest";
import { makePlayer, makeState } from "@convex/cards/__tests__/setup";
import {
    GAME_STATE_ALLOWLIST,
    PLAYER_STATE_ALLOWLIST,
} from "@convex/gre/scenarioBuilder";
import {
    classifyStackObject,
    droppedMessageClass,
    formatLoweringReport,
    observeDecision,
    runLoweringSweep,
    type LoweringSweepConfig,
} from "./loweringSweep";
import { makeInstance } from "@convex/cards/__tests__/setup";
import type { StackItem } from "@convex/gre";

describe("lowering sweep: dropped-message classes (issue #3461)", () => {
    it("collapses the interpolations two decisions differ by", () => {
        // The same message class, from two different boards: a different item
        // count, a different quoted phase, a different card name. Ranking the
        // raw text would file these as four separate causes.
        expect(
            droppedMessageClass(
                `stack: 3 item(s) — the spell/ability stack isn't spec-expressible (see the blade suite's "setup" steps for a response-window position instead)`
            )
        ).toBe(
            droppedMessageClass(
                `stack: 1 item(s) — the spell/ability stack isn't spec-expressible (see the blade suite's "setup" steps for a response-window position instead)`
            )
        );
        expect(
            droppedMessageClass(
                `Grizzly Bears (me): live-only state not captured (grantedUntilEot)`
            )
        ).toBe(
            droppedMessageClass(
                `Llanowar Elves (opp, graveyard): live-only state not captured (grantedUntilEot)`
            )
        );
        // CR 611.2a (issue #3488) — two boards whose registry entry differs
        // only by which permanents it names, and by how many.
        expect(
            droppedMessageClass(
                `continuousEffects: layer 4 type-change, duration expiry, on Grizzly Bears (me) — its type-change payload names an object the rebuild has no id for; not lowered`
            )
        ).toBe(
            droppedMessageClass(
                `continuousEffects: layer 4 type-change, duration expiry, on Shivan Dragon (opp), Llanowar Elves (opp) — its type-change payload names an object the rebuild has no id for; not lowered`
            )
        );
        // …and stays DISTINCT from the same entry refused for another reason:
        // the clause after the dash is the classification.
        expect(
            droppedMessageClass(
                `continuousEffects: layer 4 type-change, duration expiry, on Grizzly Bears (me) — its type-change payload names an object the rebuild has no id for; not lowered`
            )
        ).not.toBe(
            droppedMessageClass(
                `continuousEffects: layer 4 type-change, duration expiry, on Grizzly Bears (me) — it affects a permanent in no zone this lowering captures, which no name could reach; not lowered`
            )
        );
        expect(
            droppedMessageClass(
                `me's mana pool: 2R 1G — not lowered (mana pool isn't spec-expressible)`
            )
        ).toBe(
            droppedMessageClass(
                `opp's mana pool: 1U — not lowered (mana pool isn't spec-expressible)`
            )
        );
    });

    it("keeps genuinely different causes apart", () => {
        // Masking must not be so aggressive that two distinct gaps merge —
        // a ranked table whose top row is "everything" orders nothing either.
        const classes = new Set(
            [
                `pendingCast: a spell payment is mid-flight — not lowered`,
                `pendingTarget: a target selection is mid-flight — not lowered`,
                `emblems: 2 — command-zone emblems aren't spec-expressible`,
                `madnessCastWindow: an open Madness cast window — not lowered`,
            ].map(droppedMessageClass)
        );
        expect(classes.size).toBe(4);
    });

    it("masks an engine constant but not an English word", () => {
        const phase = droppedMessageClass(
            `phase "DECLARE_BLOCKERS": buildStateFromScenario only re-seeds "combat" for phase "DECLARE_ATTACKERS" — loading this spec lands on DECLARE_BLOCKERS with NO combat object; use a blade "setup" step instead`
        );
        expect(phase).not.toContain("DECLARE_BLOCKERS");
        expect(phase).toContain("<CONST>");
        // `NO` and `spec` are not constants; the sentence must stay readable.
        expect(phase).toContain("with NO combat object");
    });
});

describe("lowering sweep: residue is derived, not copied (issue #3461)", () => {
    it("reports a GameState field no allowlist covers, without editing the sweep", () => {
        // The acceptance criterion in prose: a field added to `GameState`
        // tomorrow must appear here on its own. Simulated by adding one now.
        const state = makeState({
            players: [makePlayer("A"), makePlayer("B")],
            activePlayerId: "A",
            priorityPlayerId: "A",
        });
        expect(GAME_STATE_ALLOWLIST.has("someFutureField")).toBe(false);
        (state as unknown as Record<string, unknown>).someFutureField = {
            live: true,
        };

        const observation = observeDecision(state, "A", "Pass priority");
        expect(observation.residue.game).toContain("someFutureField");
        // …and an allowlisted field is NOT residue, or every decision would
        // report the whole state and the table would say nothing.
        expect(PLAYER_STATE_ALLOWLIST.has("life")).toBe(true);
        expect(observation.residue.player).not.toContain("life");
    });
});

describe("lowering sweep: stack composition (issue #3456)", () => {
    // Any real card id — the classifier reads the STACK-ITEM markers, never
    // the definition, so which card is on the stack is irrelevant to it.
    const CARD = "55fe6449-1f23-43dc-adee-d144cd505b5c";
    const item = (overrides: Partial<StackItem>): StackItem =>
        ({
            ...makeInstance(CARD, { controllerId: "p1", zone: "stack" }),
            castById: "p1",
            ...overrides,
        }) as StackItem;

    it("names the seam that could rebuild each object, not the CR type", () => {
        // The four shapes the triage of issue #3456 has to tell apart: only
        // the first is replayable by a blade `cast` step, and only the third
        // needs `activateAbilityOnState` (which the browser cannot import,
        // ADR 0074).
        expect(classifyStackObject(item({}), "p1")).toBe("spell (own)");
        expect(
            classifyStackObject(
                item({ triggeredAbilityId: "t1", triggerSourceId: "src" }),
                "p1"
            )
        ).toBe("triggered ability (own)");
        expect(classifyStackObject(item({ abilityId: "a1" }), "p1")).toBe(
            "activated ability (own)"
        );
        expect(
            classifyStackObject(item({ castFromGraveyard: true }), "p1")
        ).toBe("spell (cast from a graveyard) (own)");
    });

    it("reads the narrowest marker first, and the side off the controller", () => {
        // The engine's OWN shapes, not invented ones: `pushReflexiveTrigger`
        // (`gre/state.ts`) builds a reflexive trigger AS an inline delayed one,
        // so it carries `delayedTriggerId` too and only its own flag separates
        // them. Read `delayedTriggerId` first and every Madness / Warp cast
        // window files as a delayed trigger.
        expect(
            classifyStackObject(
                item({
                    delayedTriggerId: "inline",
                    delayedEffects: [],
                    reflexiveTrigger: true,
                }),
                "p1"
            )
        ).toBe("reflexive trigger (own)");
        expect(
            classifyStackObject(item({ delayedTriggerId: "d1" }), "p1")
        ).toBe("delayed trigger (own)");
        // A copy (CR 707.10) QUALIFIES the kind — it is still a spell for
        // every rebuild purpose, and it is the one object no `cast` step can
        // produce.
        expect(classifyStackObject(item({ isCopy: true }), "p1")).toBe(
            "copy of a spell (own)"
        );
        // The side is relative to the DECIDING seat, which is what makes
        // "responding to the opponent" countable.
        expect(classifyStackObject(item({}), "p2")).toBe("spell (opponent's)");
    });

    it("reports a cast-commit snapshot no card allowlist covers, without editing the sweep", () => {
        // Same acceptance criterion as the residue table one field over: a
        // snapshot added to `StackItem` tomorrow must appear on its own, or
        // the payload table under-states what a declarative `stack:` field
        // would owe. Simulated by adding one now.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            stack: [item({ chosenX: 3 })],
        });
        (
            state.stack[0] as unknown as Record<string, unknown>
        ).someFutureSnapshot = { paid: true };

        const observation = observeDecision(state, "p1", "Pass priority");
        expect(observation.stack).toContain("spell (own)");
        expect(observation.stack).toContain("depth: 1 object(s)");
        expect(observation.stackPayload).toContain("chosenX");
        expect(observation.stackPayload).toContain("someFutureSnapshot");
        // …and a key the spec DOES express for a card is not payload, or the
        // table would claim a declarative field owes the whole instance.
        expect(observation.stackPayload).not.toContain("isTapped");
    });

    it("says nothing at all on a quiet board", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const observation = observeDecision(state, "p1", "Pass priority");
        expect(observation.stack).toBeNull();
        expect(observation.stackPayload).toEqual([]);
    });
});

describe("lowering sweep: determinism (issue #3461)", () => {
    it("prints the same table for the same seeds", () => {
        const config: LoweringSweepConfig = {
            deckA: "mono-red-burn",
            deckB: "mono-red-burn",
            games: 1,
            seed: 4242,
            iterations: 4,
        };
        const first = runLoweringSweep(config);
        const second = runLoweringSweep(config);
        expect(formatLoweringReport(second)).toBe(formatLoweringReport(first));
        // A sweep that observed nothing would pass the equality above while
        // measuring nothing at all.
        expect(first.decisions).toBeGreaterThan(0);
        expect(first.judgeable + sumRefusals(first.refusals)).toBe(
            first.decisions
        );
    }, 300_000);
});

function sumRefusals(refusals: Record<string, number>): number {
    return Object.values(refusals).reduce((total, n) => total + n, 0);
}

// `process` isn't in the browser-typed src tsconfig; read env off globalThis.
const ENV: Record<string, string | undefined> =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};
const RUN = ENV.LOWERING_SWEEP === "1";

describe.runIf(RUN)("lowering sweep (runner)", () => {
    it("sweeps N deterministic games and prints the ranked table", async () => {
        const config: LoweringSweepConfig = {
            deckA: ENV.LOWERING_SWEEP_DECK_A ?? "mono-red-burn",
            deckB: ENV.LOWERING_SWEEP_DECK_B ?? "channel-fireball",
            games: Number(ENV.LOWERING_SWEEP_GAMES ?? "6"),
            seed: Number(ENV.LOWERING_SWEEP_SEED ?? "1"),
            iterations: Number(ENV.LOWERING_SWEEP_ITER ?? "60"),
        };
        const report = runLoweringSweep(config);
        const table = formatLoweringReport(report);
        // The table is the deliverable, and vitest's reporter does not reliably
        // surface a multi-line console log from a `bot-dom` test (the same
        // reason `decisionCorpus.bot.test.ts` writes a file): default to one,
        // next to the repo, and say where it went. The src tsconfig is
        // browser-typed, hence the non-literal dynamic import — it defeats TS
        // module resolution the way the globalThis ENV read above does, and
        // resolves fine at runtime.
        const outPath =
            ENV.LOWERING_SWEEP_OUT ?? "ladder-runs/lowering-sweep.txt";
        const fs = (await import(/* @vite-ignore */ "node" + ":fs")) as {
            writeFileSync: (p: string, d: string) => void;
            mkdirSync: (p: string, o: { recursive: boolean }) => void;
        };
        const dir = outPath.slice(0, outPath.lastIndexOf("/"));
        if (dir) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(outPath, table + "\n");
        console.log(`lowering sweep → ${outPath}`);
        expect(report.decisions).toBeGreaterThan(0);
    }, 3_600_000);
});
