import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `telemetry-serve.ts` resolves `DB_PATH` from `CLAUDE_PROJECT_DIR ?? cwd()`
 * AT IMPORT TIME and reaches for `bun:sqlite` when a store exists there — the
 * primary checkout has one (hundreds of MB), and every test that imports that
 * module runs under the `node` vitest project, where `bun:sqlite` doesn't
 * exist. Call this BEFORE the module's first `import()` (module top-level
 * code runs once, at that first import — too late inside a `beforeAll`) to
 * make the result independent of the machine's ambient state (#2623 review
 * round 1 finding 1; reintroduced by #2855's `dashboard-actions.test.ts`,
 * which imported `telemetry-serve` without this pin).
 */
export function pinEmptyProjectDir(prefix: string): () => void {
    const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
    const prev = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = dir;
    return function restoreProjectDir() {
        if (prev === undefined) delete process.env.CLAUDE_PROJECT_DIR;
        else process.env.CLAUDE_PROJECT_DIR = prev;
        rmSync(dir, { recursive: true, force: true });
    };
}
