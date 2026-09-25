import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { payCastManaCost, tryAutoCommitPendingCast } from "../../game";
import {
    normalizeManaCost,
    removeFromZone,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { pentadPrism } from "../../cards/sets/5dn/colorless";

/**
 * Cast-time mana-spent capture across EVERY spell cast-commit path
 * (issue #2378).
 *
 * `CardDefinition.noteManaSpent` asks the engine to record which mana actually
 * paid for a spell: CR 106.4 mana-spent tracking, read at resolution by Soul
 * Burn (CR 202.3) and counted by colour by Sunburst (CR 702.44a, Pentad
 * Prism). The record is `StackItem.notedManaSpent`, built as the per-colour
 * delta over the payment (`manaSpentDelta`, CR 106.10).
 *
 * `convex/game.ts` commits a cast at FOUR sites, and until this issue only two
 * of them captured:
 *
 * | site                                       | shape                                                  | captured before #2378 |
 * | ------------------------------------------ | ------------------------------------------------------ | --------------------- |
 * | `tryAutoCommitPendingCast`                 | parked cast, mana tapped land-by-land, deferred commit | yes                   |
 * | `finalizeTargetSelection` immediate branch | targeted spell, pool already covers the cost           | yes                   |
 * | `announceCast` normal-cost immediate       | untargeted spell, pool already covers the cost         | **NO**                |
 * | `announceCast` alternative-cost immediate  | ditto, paying an alternative cost's mana leg           | **NO**                |
 *
 * The two misses are the shipped "tap your lands at priority, THEN cast" flow
 * (`convex/gre/__tests__/casting-flow.test.ts`): the floated pool already
 * covers the cost when `announceCast` runs, so nothing ever parks, and the
 * spell reached the stack with no `notedManaSpent` at all — Pentad Prism
 * entered with ZERO charge counters instead of two.
 *
 * The fix is one shared payment seam, `payCastManaCost`, called by all four.
 * This file guards both halves of it: the seam captures (behaviour), and no
 * cast-commit site bypasses it or drops the captured record on the floor
 * (source guard — the stack-item assembly lives inside a Convex mutation this
 * project has no harness to call, ADR 0001).
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
/** The cast-commit surface, as FILES. It became two in issue #3479: the CR 602
 *  activation path — and with it `payCastManaCost` and
 *  `tryAutoCommitPendingCast` — moved to `convex/gre/activation.ts` so the
 *  browser can replay a position (`convex/game.ts` imports `./auth`, which the
 *  client bundle may never reach, ADR 0074), while `announceCast` and
 *  `finalizeTargetSelection` stayed behind. The guard reads BOTH: a commit site
 *  that escapes the seam by moving to the sibling file is the same bug. */
const COMMIT_SOURCES = [
    "convex/game.ts",
    "convex/gre/activation.ts",
    // Issue #4445 — the Cast Commit kernel: the ONE place the five server
    // commit sites now pay, stamp and announce. The seam call lives here.
    "convex/gre/castCommit.ts",
    // The resolution-time cast primitive (`castChosenSpell`, CR 608.2g) used
    // to pay its mana OUTSIDE the seam; since issue #4445 it commits through
    // the kernel, and this file is read so it cannot quietly go back.
    "convex/gre/state.ts",
] as const;

function readCommitSources(): { rel: string; lines: string[] }[] {
    return COMMIT_SOURCES.map((rel) => ({
        rel,
        lines: fs.readFileSync(path.join(REPO_ROOT, rel), "utf8").split("\n"),
    }));
}

/** Pentad Prism in hand, `pool` floating, priority with its controller — the
 *  state `announceCast` sees when the caster tapped lands first. */
function prismInHandWithPool(pool: Record<string, number>): GameState {
    const prism = makeInstance(pentadPrism.id, {
        id: "prism",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [makePlayer("p1", { hand: [prism] }), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    Object.assign(state.players[0].manaPool, pool);
    return state;
}

describe("announceCast immediate-commit: mana-spent capture (CR 106.4 / 702.44a, issue #2378)", () => {
    /** The `announceCast` immediate-commit branch, step for step: the pool
     *  already covers the cost, so NO `pendingCast` is ever parked — the cost
     *  is paid through the shared seam, the card leaves the hand, and the
     *  stack item is assembled from the payment. */
    function castViaImmediateCommit(pool: Record<string, number>): GameState {
        const state = prismInHandWithPool(pool);
        const player = state.players[0];
        // The cost under test comes from the CARD, not from this test.
        const manaCost = normalizeManaCost(pentadPrism.manaCost!);
        const payment = payCastManaCost(
            state,
            player,
            manaCost,
            pentadPrism,
            [],
            "prism"
        );
        const card = removeFromZone(state, player, "prism", "hand", player.id);
        const item: StackItem = {
            ...card,
            castById: "p1",
            ...(payment.notedManaSpent
                ? { notedManaSpent: payment.notedManaSpent }
                : {}),
        };
        state.stack.push(item);
        return state;
    }

    it("captures the colours spent when the caster floated the mana BEFORE casting", () => {
        const state = castViaImmediateCommit({ W: 1, U: 1 });
        // The mana really left the pool — a cost treated as free would leave
        // it floating and the note empty.
        expect(state.players[0].manaPool.W).toBe(0);
        expect(state.players[0].manaPool.U).toBe(0);
        expect(state.stack[0].notedManaSpent).toEqual({ W: 1, U: 1 });
    });

    it("full path — floated {W}{U} → cast → resolve → TWO charge counters (CR 702.44a)", () => {
        const state = castViaImmediateCommit({ W: 1, U: 1 });
        resolveTopOfStack(state);
        const prism = state.players[0].battlefield.find(
            (c) => c.id === "prism"
        )!;
        expect(prism.counters?.charge).toBe(2);
    });

    it("colourless-only float still enters with no counters (CR 702.44b)", () => {
        const state = castViaImmediateCommit({ C: 2 });
        expect(state.stack[0].notedManaSpent).toEqual({ C: 2 });
        resolveTopOfStack(state);
        const prism = state.players[0].battlefield.find(
            (c) => c.id === "prism"
        )!;
        expect(prism.counters?.charge).toBeUndefined();
    });

    it("agrees with the PARKED path on the same pool — the two flows cannot disagree", () => {
        const immediate = castViaImmediateCommit({ B: 1, G: 1 });

        const parked = prismInHandWithPool({ B: 1, G: 1 });
        parked.pendingCast = {
            playerId: "p1",
            cardInstanceId: "prism",
            manaCost: normalizeManaCost(pentadPrism.manaCost!),
            tappedLandIds: [],
        };
        expect(tryAutoCommitPendingCast(parked, "p1")).not.toBeNull();

        expect(immediate.stack[0].notedManaSpent).toEqual(
            parked.stack[0].notedManaSpent
        );
        for (const state of [immediate, parked]) {
            resolveTopOfStack(state);
            expect(
                state.players[0].battlefield.find((c) => c.id === "prism")!
                    .counters?.charge
            ).toBe(2);
        }
    });

    it("alternative-cost branch — the ALT cost's mana leg is what gets captured (CR 118.9)", () => {
        // `announceCast`'s alternative-cost immediate-commit branch hands the
        // alt cost's own mana leg (Dash's amount, not the printed cost) to the
        // same seam; CR 702.44b counts mana spent on additional OR alternative
        // costs just the same.
        const state = prismInHandWithPool({ U: 1, R: 1 });
        const payment = payCastManaCost(
            state,
            state.players[0],
            { U: 1, R: 1 },
            pentadPrism,
            [],
            "prism"
        );
        expect(payment.notedManaSpent).toEqual({ U: 1, R: 1 });
        const card = removeFromZone(
            state,
            state.players[0],
            "prism",
            "hand",
            state.players[0].id
        );
        state.stack.push({
            ...card,
            castById: "p1",
            ...(payment.notedManaSpent
                ? { notedManaSpent: payment.notedManaSpent }
                : {}),
        });
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "prism")!.counters
                ?.charge
        ).toBe(2);
    });

    it("a card that did NOT ask for it carries no record (the snapshot is opt-in)", () => {
        const state = prismInHandWithPool({ W: 1, U: 1 });
        const payment = payCastManaCost(
            state,
            state.players[0],
            normalizeManaCost(pentadPrism.manaCost!),
            { ...pentadPrism, noteManaSpent: undefined },
            [],
            "prism"
        );
        expect(payment.notedManaSpent).toBeUndefined();
        // …and the mana was still paid.
        expect(state.players[0].manaPool.W).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Source guard. `announceCast` is a Convex mutation and this project has no
// harness that can call one (ADR 0001), so the two branches inside it are
// reachable from a test only through the seams they call. These assertions
// cover the rest: that every cast-commit site pays through the shared seam,
// and that each one puts the captured record ON the stack item it pushes.
// ═══════════════════════════════════════════════════════════════════════════

/** Line indices (0-based) of every `payCastManaCost(` CALL in one source. */
function paymentCallLines(src: string): number[] {
    return src
        .split("\n")
        .flatMap((line, i) =>
            /payCastManaCost\(/.test(line) && !/export function/.test(line)
                ? [i]
                : []
        );
}

describe("cast-commit sites all route through payCastManaCost (issue #2378)", () => {
    it("no cast-commit site pays a spell's mana cost directly", () => {
        const offenders: string[] = [];
        for (const { rel, lines } of readCommitSources()) {
            const callLines = lines.flatMap((line, i) =>
                /payManaCostForSpell\(/.test(line) &&
                !/^\s*payManaCostForSpell,/.test(line) &&
                // `state.ts` DEFINES the primitive; the definition is not a
                // call site.
                !/^export function payManaCostForSpell\(/.test(line)
                    ? [i]
                    : []
            );
            // Two CATEGORIES survive: the call inside `payCastManaCost` itself,
            // and the CR 116 SPECIAL ACTIONS — which pay a mana cost but push no
            // stack item, so they have nothing to note the spend onto (the
            // companion summon puts a card in hand; the morph turn-face-up flips a
            // permanent already on the battlefield, issue #2705). The exemption
            // keys on the phrase "special action" in the call's own comment
            // paragraph rather than on a hand-maintained list of cost constants:
            // a third special action must then DECLARE itself as one to be
            // exempt, instead of being added to a list nobody re-reads.
            // The shared seam's own body, as a line range: from its signature to
            // the first line that closes a top-level declaration.
            const seamStart = lines.findIndex((line) =>
                line.startsWith("export function payCastManaCost(")
            );
            const seamEnd =
                seamStart === -1
                    ? -1
                    : seamStart +
                      lines
                          .slice(seamStart)
                          .findIndex((line, i) => i > 0 && line === "}");
            offenders.push(
                ...callLines
                    .filter((i) => {
                        // Look BEHIND as well as ahead: the declaration lives in
                        // the comment above the call, not after it.
                        const context = lines
                            .slice(Math.max(0, i - 4), i + 4)
                            .join("\n");
                        return (
                            !/special action/i.test(context) &&
                            !(i > seamStart && i < seamEnd)
                        );
                    })
                    .map((i) => `${rel}:${i + 1} → ${lines[i].trim()}`)
            );
        }
        // The seam itself must exist SOMEWHERE in the surface — otherwise
        // every call above would be exempted by an always-(-1) range and the
        // guard would pass vacuously.
        expect(
            readCommitSources().filter(({ lines }) =>
                lines.some((line) =>
                    line.startsWith("export function payCastManaCost(")
                )
            )
        ).toHaveLength(1);
        expect(offenders).toEqual([]);
    });

    it("every payCastManaCost call puts its record on the stack item it pushes", () => {
        const missing: string[] = [];
        let total = 0;
        for (const { rel, lines } of readCommitSources()) {
            const callLines = paymentCallLines(lines.join("\n"));
            total += callLines.length;
            for (const start of callLines) {
                const push = lines.findIndex(
                    (line, i) => i > start && line.includes("state.stack.push(")
                );
                expect(push).toBeGreaterThan(start);
                // The SPREAD form (`notedManaSpent: <var>`, or the shorthand
                // `{ notedManaSpent }`), not merely a mention of the captured
                // local — reading the field off the payment and then never
                // spreading it is exactly the shipped bug.
                const between = lines.slice(start, push).join("\n");
                if (!/notedManaSpent(:|\s*\})/.test(between)) {
                    missing.push(
                        `${rel}:${start + 1} → commit at :${push + 1} drops notedManaSpent`
                    );
                }
            }
        }
        // ONE payment call, inside the Cast Commit kernel (issue #4445): the
        // four cast-commit paths of the table at the top of this file, plus
        // the resolution-time cast, all route through `commitCast`, which is
        // the only site left that calls the seam. A second call is not
        // forbidden — it just has to make the same decision explicitly.
        expect(total).toBe(1);
        expect(missing).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Issue #4445 — the Cast Commit kernel. Every server site that puts a CAST on
// the stack does so through `commitCast` (`convex/gre/castCommit.ts`); no site
// keeps an inline pay → record → legs → stack sequence of its own. Two reads
// of the same fact: the kernel is CALLED from every commit site, and the
// zone → stack move a cast makes (`removeFromZone`) happens nowhere else —
// except the CR 708 face-down cast (`castFaceDown`, Illusionary Mask), which
// pays nothing and is not a cost-paying commit.
// ═══════════════════════════════════════════════════════════════════════════

/** Line indices (0-based) of every CALL of `name(` in one source — never its
 *  definition, never an import/export list entry. */
function callLinesOf(lines: string[], name: string): number[] {
    const call = new RegExp(`\\b${name}\\(`);
    const decl = new RegExp(`^export function ${name}\\(`);
    const listEntry = new RegExp(`^\\s*${name},$`);
    return lines.flatMap((line, i) =>
        call.test(line) && !decl.test(line) && !listEntry.test(line) ? [i] : []
    );
}

describe("every server cast-commit site routes through the Cast Commit kernel (issue #4445)", () => {
    it("commitCast is called from the five server commit sites and defined once", () => {
        const calls: Record<string, number> = {};
        let definitions = 0;
        for (const { rel, lines } of readCommitSources()) {
            calls[rel] = callLinesOf(lines, "commitCast").length;
            definitions += lines.filter((line) =>
                line.startsWith("export function commitCast(")
            ).length;
        }
        expect(definitions).toBe(1);
        expect(calls).toEqual({
            // `finalizeTargetSelection`'s immediate branch and `announceCast`'s
            // two immediate branches (normal cost, alternative cost).
            "convex/game.ts": 3,
            // `tryAutoCommitPendingCast`, the deferred commit.
            "convex/gre/activation.ts": 1,
            // The kernel's own file calls nothing.
            "convex/gre/castCommit.ts": 0,
            // `castChosenSpell`, the resolution-time cast primitive.
            "convex/gre/state.ts": 1,
        });
    });

    it("no commit site moves a card zone → stack outside the kernel, save the CR 708 face-down cast", () => {
        const offenders: string[] = [];
        for (const { rel, lines } of readCommitSources()) {
            if (rel === "convex/gre/castCommit.ts") continue;
            for (const i of callLinesOf(lines, "removeFromZone")) {
                // The face-down cast declares itself in the comment paragraph
                // around its call (CR 708.2), the same self-declaration idiom
                // the special-action exemption above uses.
                const context = lines.slice(Math.max(0, i - 40), i + 4);
                if (context.some((line) => /castFaceDown\(/.test(line))) {
                    continue;
                }
                offenders.push(`${rel}:${i + 1} → ${lines[i].trim()}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
