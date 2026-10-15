/**
 * `bun run blade:audit-census` — the Bot Audit coverage table (issue #4925,
 * ADR 0149 §5): per Audit Theme, its Minimal Pairs, red (`stretch`) and green
 * (`must`) members, and the issues their notes name. A registry read, no
 * search run.
 *
 * Thin by design: loading the registry from a `scripts/` entry drags
 * `convex/game.ts` and `lib.dom` into the scripts tsconfig project, so the
 * read happens in the env-gated runner of
 * `convex/gre/ai/blade/__tests__/audit-census.spec.ts`, which writes the rows
 * to a file; this script runs it and prints the table. It imports only the
 * pure formatter.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    formatAuditCensus,
    type AuditCensusRow,
} from "../convex/gre/ai/blade/auditCensus";

const dir = mkdtempSync(join(tmpdir(), "audit-census-"));
const out = join(dir, "rows.json");
try {
    const run = spawnSync(
        "bunx",
        [
            "vitest",
            "run",
            "--config",
            "vitest.blade.config.ts",
            "convex/gre/ai/blade/__tests__/audit-census.spec.ts",
        ],
        {
            encoding: "utf8",
            env: { ...process.env, BLADE_AUDIT_CENSUS: out },
        }
    );
    if (run.status !== 0) {
        process.stderr.write(`${run.stdout}${run.stderr}`);
        process.exit(run.status ?? 1);
    }
    const rows = JSON.parse(readFileSync(out, "utf8")) as AuditCensusRow[];
    console.log(formatAuditCensus(rows));
} finally {
    rmSync(dir, { recursive: true, force: true });
}
