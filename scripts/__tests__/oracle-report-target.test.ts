/**
 * `oracle:report --target <id>` — the ranked Grammar Gap backlog for a
 * REGISTERED Target, not just a set or a format pool (issue #3835).
 *
 * `--set` reads an MTGJSON blob and `--pool` a format's `poolIn`, so before
 * this flag the only rollout the ranked backlog could scope was a set: the
 * premodern metagame list and the Vintage Cube were reachable through
 * `--targets` (their COVERAGE) and nowhere else. `/new-set` v2 drives either,
 * so the ranking has to take the same Targets the coverage report does.
 *
 * These run the real script against the committed lockfile — the seam under
 * test is argument handling, and a unit test of `resolveTarget` would not
 * touch it. `spawnSync` carries its own `timeout`: a blocked worker is a hang
 * vitest's `testTimeout` cannot interrupt.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");

function report(...args: string[]): { code: number; out: string } {
    const r = spawnSync("bun", ["scripts/oracle-report.ts", ...args], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 120_000,
    });
    return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("oracle:report --target <registered id> (issue #3835)", () => {
    it("ranks the backlog for a name-list Target, labelled by its id", () => {
        const { code, out } = report("--target", "vintage-cube", "--gaps", "1");
        expect(code).toBe(0);
        // The state line proves the Target's own cards were counted, not the
        // corpus: a silent fall-through to the corpus ranking is the failure
        // this flag existed to stop.
        expect(out).toMatch(/Target vintage-cube — \d+ cards: \d+ ready/);
        expect(out).toMatch(/Grammar Gaps for the Target vintage-cube/);
    }, 180_000);

    it("fails closed on an id no Target carries, and names the registry", () => {
        const { code, out } = report("--target", "not-a-target");
        expect(code).toBe(1);
        expect(out).toContain("no Target `not-a-target`");
        expect(out).toContain("vintage-cube");
    }, 180_000);

    it("refuses two Target flags rather than silently picking one", () => {
        const { code, out } = report(
            "--set",
            "apc",
            "--target",
            "vintage-cube"
        );
        expect(code).toBe(1);
        expect(out).toContain("pass one of --set, --pool, --target");
    }, 180_000);
});
