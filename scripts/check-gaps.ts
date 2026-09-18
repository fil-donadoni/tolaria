#!/usr/bin/env bun
/**
 * Derived Op census — the shrink-only Grammar Gap allowlist (ADR 0105 § 7.3,
 * ADR 0137, PRD issue #3820 stories 8 and 12).
 *
 * An Op of the Mechanics Registry is GRAMMAR-COVERED when at least one
 * Compiled Definition emits it. Coverage is DERIVED — read off the lockfile's
 * `opsUsed`, never declared — so the census cannot be talked into agreeing
 * with itself. `quarantine` counts alongside `ready`, because quarantine is a
 * trust gate on the CARD, not on the grammar that produced it.
 *
 * Every implemented Op nothing emits must carry a row in
 * `data/grammar-gaps.json` naming the issue that will close it. The allowlist
 * ONLY SHRINKS:
 *
 *   - a row whose Op became emitted must be removed (the rule landed);
 *   - a row whose Op left the implemented registry must be removed;
 *   - a NEW row is never legal. A newly implemented Op therefore has exactly
 *     one exit — the grammar rule that emits it (ADR 0137: "/new-op ends with
 *     the rule that emits the Op, or with the open gap"). Demanding a row and
 *     forbidding its addition is the same demand stated twice, deliberately:
 *     it is what stops the allowlist from becoming a parking lot.
 *
 * Shrink is proven against the allowlist as it stands at the MERGE-BASE with
 * the base branch, not against a hand-kept count: a row added on a branch is
 * one the merge-base does not have. When the merge-base carries no allowlist
 * at all (the commit that seeds it) there is no baseline and the shrink check
 * is announced as skipped rather than passed silently.
 *
 * Offline and ~1s: the committed lockfile plus the registry, no network, no
 * corpus. It runs in `health` ONLY — added to `scripts/lib/health-step.ts`'s
 * step list, never to `check:all` or `check:pr`, so a PR and `land` pay
 * nothing for it (ADR 0105 § 7.3, asserted by `check-gaps.test.ts`).
 *
 * Run: bun run check:gaps
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EFFECT_OP_REGISTRY } from "../convex/cards/mechanicsRegistry";
import { ORIGIN_BASE } from "./lib/branches";
import { opGapKey } from "./lib/grammar-gaps";
import { parseLockfile } from "./lib/oracle-lockfile";

export const ALLOWLIST_PATH = "data/grammar-gaps.json";
export const LOCKFILE_PATH = "data/oracle-compiled.json";

/** A row of the allowlist, as committed. Unknown keys are a violation. */
export interface GapRow {
    /** The gap's stable key — `opGapKey(op)`, shared with `gaps:sync`. */
    readonly key: string;
    readonly op: string;
    /** The open issue that closes the gap by landing the emitting rule. */
    readonly issue: number;
}

export interface Allowlist {
    readonly note?: string;
    readonly ops: readonly GapRow[];
}

export type Violation =
    | { kind: "missing"; op: string }
    | { kind: "covered"; op: string }
    | { kind: "unknown-op"; op: string }
    | { kind: "duplicate"; op: string }
    | { kind: "malformed"; op: string; detail: string }
    | { kind: "grown"; op: string };

export interface CensusInput {
    /** Ops the registry marks `implemented` — the only ones a card may use. */
    readonly implemented: readonly string[];
    /** Ops emitted by at least one `ready`/`quarantine` Compiled Definition. */
    readonly emitted: ReadonlySet<string>;
    readonly allowlist: Allowlist;
    /** The allowlist at the merge-base, or null when there is none yet. */
    readonly baseline: Allowlist | null;
}

export interface CensusResult {
    readonly violations: readonly Violation[];
    readonly implementedCount: number;
    readonly emittedCount: number;
    readonly allowlistedCount: number;
    readonly baselineChecked: boolean;
}

/**
 * The whole verdict, pure over its four inputs. Violations come back sorted by
 * Op within a kind so two runs over one tree print one list.
 */
export function auditOpCensus(input: CensusInput): CensusResult {
    const { implemented, emitted, allowlist, baseline } = input;
    const violations: Violation[] = [];
    const implementedSet = new Set(implemented);
    const seen = new Set<string>();
    const rowFor = new Map<string, GapRow>();

    for (const row of [...allowlist.ops].sort((a, b) =>
        a.op < b.op ? -1 : a.op > b.op ? 1 : 0
    )) {
        if (typeof row.op !== "string" || row.op === "") {
            violations.push({
                kind: "malformed",
                op: String(row.op),
                detail: "row has no `op`",
            });
            continue;
        }
        if (seen.has(row.op)) {
            violations.push({ kind: "duplicate", op: row.op });
            continue;
        }
        seen.add(row.op);
        rowFor.set(row.op, row);

        if (!Number.isInteger(row.issue) || row.issue <= 0) {
            violations.push({
                kind: "malformed",
                op: row.op,
                detail: `\`issue\` is ${JSON.stringify(row.issue)}, want a positive integer`,
            });
        }
        if (row.key !== opGapKey(row.op)) {
            violations.push({
                kind: "malformed",
                op: row.op,
                detail: `\`key\` is ${JSON.stringify(row.key)}, want ${JSON.stringify(opGapKey(row.op))}`,
            });
        }
        if (!implementedSet.has(row.op)) {
            violations.push({ kind: "unknown-op", op: row.op });
        } else if (emitted.has(row.op)) {
            violations.push({ kind: "covered", op: row.op });
        }
    }

    for (const op of [...implemented].sort()) {
        if (!emitted.has(op) && !seen.has(op)) {
            violations.push({ kind: "missing", op });
        }
    }

    if (baseline !== null) {
        const before = new Set(baseline.ops.map((r) => r.op));
        for (const op of [...seen].sort()) {
            if (!before.has(op)) violations.push({ kind: "grown", op });
        }
    }

    return {
        violations,
        implementedCount: implemented.length,
        emittedCount: emitted.size,
        allowlistedCount: allowlist.ops.length,
        baselineChecked: baseline !== null,
    };
}

/** Ops emitted by at least one `ready` or `quarantine` Compiled Definition. */
export function emittedOps(
    cards: readonly {
        readonly state: string;
        readonly opsUsed?: readonly string[];
    }[]
): Set<string> {
    const emitted = new Set<string>();
    for (const card of cards) {
        if (card.state !== "ready" && card.state !== "quarantine") continue;
        for (const op of card.opsUsed ?? []) emitted.add(op);
    }
    return emitted;
}

export function parseAllowlist(text: string): Allowlist {
    const parsed = JSON.parse(text) as Allowlist;
    if (!Array.isArray(parsed.ops)) {
        throw new Error(`${ALLOWLIST_PATH}: no \`ops\` array`);
    }
    return parsed;
}

/**
 * The allowlist at the merge-base with the base branch — the tree this one
 * must not have grown against. `null` when the merge-base is unreachable (a
 * detached checkout with no base ref) or carries no allowlist yet (the commit
 * that seeds it).
 */
export function baselineAllowlist(root: string): Allowlist | null {
    const git = (args: string[]) =>
        spawnSync("git", args, { cwd: root, encoding: "utf8" });
    const base = git(["merge-base", "HEAD", ORIGIN_BASE]);
    if (base.status !== 0) return null;
    const at = base.stdout.trim();
    const show = git(["show", `${at}:${ALLOWLIST_PATH}`]);
    if (show.status !== 0) return null;
    return parseAllowlist(show.stdout);
}

const EXITS: Record<Violation["kind"], string> = {
    missing:
        "implemented, emitted by no Compiled Definition, and NOT allowlisted.\n" +
        "    The allowlist is shrink-only — do not add a row. Land the grammar\n" +
        "    rule that emits the Op (ADR 0137), or retire the Op.",
    covered:
        "now emitted by a Compiled Definition — its rule landed.\n" +
        "    Delete the row: the allowlist only shrinks.",
    "unknown-op":
        "allowlisted but not an `implemented` row of EFFECT_OP_REGISTRY.\n" +
        "    Delete the row (the Op was renamed, retired, or is `planned`).",
    duplicate: "allowlisted twice — one row per Op.",
    malformed: "malformed row.",
    grown:
        "added to the allowlist on this branch.\n" +
        "    The allowlist only shrinks (ADR 0105 § 7.3): a new Op never enters it.",
};

export function render(result: CensusResult): string {
    if (result.violations.length === 0) {
        const base = result.baselineChecked
            ? "shrink verified against the merge-base"
            : "no allowlist at the merge-base — shrink check SKIPPED (seeding commit)";
        return (
            `✓ gaps: ${result.implementedCount} implemented Ops — ` +
            `${result.emittedCount} grammar-covered, ` +
            `${result.allowlistedCount} allowlisted; ${base}`
        );
    }
    const lines = [
        `✗ gaps: ${result.violations.length} violation(s) of the derived Op census:\n`,
    ];
    for (const v of result.violations) {
        const detail = v.kind === "malformed" ? ` ${v.detail}` : "";
        lines.push(`  - ${v.op}: ${EXITS[v.kind]}${detail}`);
    }
    lines.push(
        `\n  Coverage is DERIVED from \`opsUsed\` in ${LOCKFILE_PATH} ` +
            `(\`ready\` + \`quarantine\`);\n` +
            `  the allowlist is ${ALLOWLIST_PATH}. See ADR 0105 § 7.3.`
    );
    return lines.join("\n");
}

function main(): void {
    const root = resolve(".");
    const lock = parseLockfile(readFileSync(LOCKFILE_PATH, "utf8"));
    const result = auditOpCensus({
        implemented: EFFECT_OP_REGISTRY.filter(
            (r) => r.status === "implemented"
        ).map((r) => r.op),
        emitted: emittedOps(lock.cards),
        allowlist: parseAllowlist(readFileSync(ALLOWLIST_PATH, "utf8")),
        baseline: baselineAllowlist(root),
    });
    if (result.violations.length === 0) {
        console.log(render(result));
        return;
    }
    console.error(render(result));
    process.exit(1);
}

if (import.meta.main) main();
