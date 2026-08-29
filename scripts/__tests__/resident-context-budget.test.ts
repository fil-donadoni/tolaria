import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * Agent-context budget, in two tiers (docs/agents/context-residency-audit.md).
 *
 * TIER 1 — RESIDENT. `CLAUDE.md` and `.claude/rules/**` are loaded before the
 * first user turn, in every session AND in every subagent it spawns. Measured
 * on this project's telemetry, `cache_read` is 98.9% of all input-side tokens —
 * so a byte here is not paid once, it is re-read on every request of every
 * agent. At the 1,587-subagent volume the 2026-07-21 scorecard recorded, the
 * multiplier is four figures.
 *
 * TIER 2 — ON DEMAND. A nested `CLAUDE.md` enters context only the first time
 * a session reads a file under its directory (proven empirically in the Lever 4
 * pass, not inferred from frontmatter: `globs:` does NOT gate loading). Its
 * bytes are paid by the sessions that touch that subtree and by nobody else.
 *
 * Why BOTH are budgeted: the whole hazard of a two-tier split is that tier 2
 * looks free. It is not — it is merely narrower, and an engine session pays
 * `convex/CLAUDE.md` on every request exactly as it used to pay
 * `.claude/rules/gre-development.md`. Budgeting only tier 1 would turn the
 * nested files into the place prose goes to escape the guard, which is the
 * failure this file exists to prevent, one directory further down.
 *
 * Why a test rather than a norm in prose: this is the FOURTH optimization pass
 * in the series. The first three all won and all decayed — CLAUDE.md alone
 * regrew +4,723 chars in the four days before the third pass, and +6,186 more
 * between that pass and this one, under a ceiling that had been raised to
 * accommodate it. A one-shot prune is a payment against a bill that keeps
 * arriving; CLAUDE.md's own rule is that a rule which CAN be enforced
 * mechanically belongs in a script the gate runs.
 *
 * The ceiling is not a cap on writing things down. It is a cap on writing them
 * down HERE: episodic prose (benchmark seconds, file counts, incident
 * post-mortems) belongs in `docs/agents/`, which is read on demand and costs
 * nothing resident. Raising a ceiling stays available — it just has to be a
 * commit someone signs, not a side effect of a doc edit.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Everything the harness loads before the first user turn. */
const RESIDENT = ["CLAUDE.md", ".claude/rules"];

/**
 * Measured 2026-08-29 after the Lever 4 split: 33,085 bytes, down from 46,895
 * (−29%). The three path-specific rule bodies moved to `convex/CLAUDE.md` and
 * `src/CLAUDE.md`; what stayed in `.claude/rules/` is the invariant a session
 * must not violate before it opens a file, plus the `§` anchors the codebase
 * cites. `bot-development.md` was left whole — at 878 bytes the split would
 * save nothing, and its frontmatter `globs:` is parsed by
 * `scripts/lib/bot-globs.ts`.
 *
 * Headroom is deliberately ~7%: enough that ordinary edits to a norm never
 * trip it, tight enough that a repeat of the measured regrowth goes red before
 * it lands.
 */
const RESIDENT_CEILING_BYTES = 35_500;

/**
 * Measured 2026-08-29: 21,225 bytes across `convex/CLAUDE.md` (16,793) and
 * `src/CLAUDE.md` (4,432).
 *
 * Larger than the resident ceiling on purpose — this tier is where the tables,
 * worked examples and derivations are SUPPOSED to live. It is budgeted so that
 * "move it to the nested file" stays a real editorial decision rather than an
 * unbounded escape hatch.
 */
const ON_DEMAND_CEILING_BYTES = 23_000;

function residentFiles(): string[] {
    const out: string[] = [];
    for (const rel of RESIDENT) {
        const abs = path.join(REPO_ROOT, rel);
        if (!fs.existsSync(abs)) continue;
        if (fs.statSync(abs).isDirectory()) {
            for (const entry of fs.readdirSync(abs).sort()) {
                if (entry.endsWith(".md")) out.push(path.join(rel, entry));
            }
        } else {
            out.push(rel);
        }
    }
    return out;
}

/**
 * Every tracked nested `CLAUDE.md`. Discovered from git rather than listed, so
 * a new one added anywhere in the tree is budgeted the day it lands instead of
 * whenever someone remembers to extend a constant here.
 */
function onDemandFiles(): string[] {
    const out = execFileSync("git", ["ls-files", "*/CLAUDE.md"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
    });
    return out.split("\n").filter(Boolean).sort();
}

function totalBytes(files: string[]): number {
    return files.reduce(
        (n, rel) => n + fs.statSync(path.join(REPO_ROOT, rel)).size,
        0
    );
}

function report(files: string[]): string {
    return files
        .map((rel) => ({
            rel,
            bytes: fs.statSync(path.join(REPO_ROOT, rel)).size,
        }))
        .sort((a, b) => b.bytes - a.bytes)
        .map((f) => `  ${String(f.bytes).padStart(7)}  ${f.rel}`)
        .join("\n");
}

describe("resident context budget", () => {
    it("finds the resident corpus", () => {
        const files = residentFiles();
        expect(files).toContain("CLAUDE.md");
        // The rules directory is the half most likely to be silently emptied by
        // a bad path constant; assert it actually contributed.
        expect(
            files.filter((f) => f.startsWith(".claude/rules")).length
        ).toBeGreaterThan(0);
    });

    it("stays under the ceiling", () => {
        const files = residentFiles();
        const total = totalBytes(files);

        if (total > RESIDENT_CEILING_BYTES) {
            throw new Error(
                `Resident context is ${total} bytes, over the ${RESIDENT_CEILING_BYTES} ceiling ` +
                    `by ${total - RESIDENT_CEILING_BYTES}.\n\n${report(files)}\n\n` +
                    `Every byte here is re-read on every request of every session AND ` +
                    `every subagent.\n` +
                    `Move episodic prose — benchmark numbers, file counts, incident ` +
                    `narratives — to docs/agents/,\nor move a path-specific derivation ` +
                    `down into the nested CLAUDE.md for that directory, and leave a\n` +
                    `one-line pointer as docs/agents/quality-gates.md does.\n` +
                    `If the growth is genuinely a new norm, raise RESIDENT_CEILING_BYTES ` +
                    `in this file as part of the same commit.`
            );
        }
        expect(total).toBeLessThanOrEqual(RESIDENT_CEILING_BYTES);
    });
});

describe("on-demand context budget (nested CLAUDE.md)", () => {
    it("finds the on-demand corpus", () => {
        const files = onDemandFiles();
        // A silently-emptied corpus would pass the ceiling assertion vacuously
        // — the exact failure the resident half already guards against.
        expect(files.length).toBeGreaterThan(0);
        expect(files).toContain("convex/CLAUDE.md");
        expect(files).toContain("src/CLAUDE.md");
    });

    it("never includes the root CLAUDE.md, which is resident and counted once", () => {
        expect(onDemandFiles()).not.toContain("CLAUDE.md");
    });

    it("stays under the ceiling", () => {
        const files = onDemandFiles();
        const total = totalBytes(files);

        if (total > ON_DEMAND_CEILING_BYTES) {
            throw new Error(
                `On-demand context is ${total} bytes, over the ${ON_DEMAND_CEILING_BYTES} ceiling ` +
                    `by ${total - ON_DEMAND_CEILING_BYTES}.\n\n${report(files)}\n\n` +
                    `A nested CLAUDE.md is narrower than the resident scaffold, not free: ` +
                    `every session that\ntouches that subtree pays it on every request. ` +
                    `Episodic prose still belongs in docs/agents/.\n` +
                    `If the growth is genuinely a new norm, raise ON_DEMAND_CEILING_BYTES ` +
                    `in this file as part of the same commit.`
            );
        }
        expect(total).toBeLessThanOrEqual(ON_DEMAND_CEILING_BYTES);
    });
});
