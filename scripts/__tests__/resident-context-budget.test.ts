import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Resident-context budget (docs/agents/context-residency-audit.md).
 *
 * `CLAUDE.md` and `.claude/rules/**` are loaded before the first user turn, in
 * every session AND in every subagent it spawns. Measured on this project's
 * telemetry, `cache_read` is 98.9% of all input-side tokens — so a byte here is
 * not paid once, it is re-read on every request of every agent. At the
 * 1,587-subagent volume the 2026-07-21 scorecard recorded, the multiplier is
 * four figures.
 *
 * Why a test rather than a norm in prose: this is the THIRD optimization pass
 * in the series (skill-timing-optimization.md, workflow-token-economics.md,
 * context-residency-audit.md). The first two both won and both decayed —
 * CLAUDE.md alone regrew +4,723 chars in the four days before the third pass,
 * eating roughly a third of #2189's projected saving. A one-shot prune is a
 * payment against a bill that keeps arriving; CLAUDE.md's own rule is that a
 * rule which CAN be enforced mechanically belongs in a script the gate runs.
 *
 * The ceiling is not a cap on writing things down. It is a cap on writing them
 * down HERE: episodic prose (benchmark seconds, file counts, incident
 * post-mortems) belongs in `docs/agents/`, which is read on demand and costs
 * nothing resident. Raising the ceiling stays available — it just has to be a
 * commit someone signs, not a side effect of a doc edit.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Everything the harness loads before the first user turn. */
const RESIDENT = ["CLAUDE.md", ".claude/rules"];

/**
 * Measured 2026-08-11 after the context-residency prune: 40,884 bytes
 * (~11,680 tokens at the series' 3.5 chars/token divisor).
 *
 * Headroom is deliberately ~7%: enough that ordinary edits to a norm never
 * trip it, tight enough that a repeat of the +4,723-byte regrowth the audit
 * measured goes red before it lands.
 */
const CEILING_BYTES = 44_000;

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
        const sizes = residentFiles().map((rel) => ({
            rel,
            bytes: fs.statSync(path.join(REPO_ROOT, rel)).size,
        }));
        const total = sizes.reduce((n, f) => n + f.bytes, 0);

        if (total > CEILING_BYTES) {
            const table = [...sizes]
                .sort((a, b) => b.bytes - a.bytes)
                .map((f) => `  ${String(f.bytes).padStart(7)}  ${f.rel}`)
                .join("\n");
            throw new Error(
                `Resident context is ${total} bytes, over the ${CEILING_BYTES} ceiling ` +
                    `by ${total - CEILING_BYTES}.\n\n${table}\n\n` +
                    `Every byte here is re-read on every request of every session AND ` +
                    `every subagent.\n` +
                    `Move episodic prose — benchmark numbers, file counts, incident ` +
                    `narratives — to docs/agents/\nand leave a one-line pointer, as ` +
                    `docs/agents/quality-gates.md does.\n` +
                    `If the growth is genuinely a new norm, raise CEILING_BYTES in this ` +
                    `file as part of the same commit.`
            );
        }
        expect(total).toBeLessThanOrEqual(CEILING_BYTES);
    });
});
