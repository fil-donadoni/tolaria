import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Guard for issue #3857 — a merge driver's message must survive its exit.
 *
 * Git invokes a merge driver with stderr on a PIPE, where
 * `process.stderr.write` queues rather than writes and `process.exit()` drops
 * the queue: the operator gets a bare non-zero exit and no reason for it. The
 * drivers write through {@link writeStderrSync} instead, which blocks on fd 2.
 *
 * The check is STRUCTURAL on purpose. Whether a queued write is lost depends on
 * the pipe buffer and on how much of the event loop the runtime happens to
 * drain before exiting, so a behavioural test would pass under the broken
 * spelling often enough to prove nothing. What can be proven is that no driver
 * uses the spelling that can lose bytes — and that is what reds here.
 */

const DRIVERS_DIR = resolve(__dirname, "..");

function driverSources(): { name: string; source: string }[] {
    return readdirSync(DRIVERS_DIR)
        .filter((f) => f.startsWith("merge-driver-") && f.endsWith(".ts"))
        .map((name) => ({
            name,
            source: readFileSync(join(DRIVERS_DIR, name), "utf8"),
        }));
}

describe("merge driver stderr survives process.exit (issue #3857)", () => {
    it("finds the drivers it is meant to guard", () => {
        expect(
            driverSources()
                .map((d) => d.name)
                .sort()
        ).toEqual(["merge-driver-cr-ledger.ts", "merge-driver-regenerated.ts"]);
    });

    it.each(driverSources())(
        "$name writes no message through the queueing spelling",
        ({ source }) => {
            expect(source).not.toContain("process.stderr.write");
            expect(source).not.toContain("console.error");
        }
    );

    it.each(driverSources())(
        "$name reports through writeStderrSync",
        ({ source }) => {
            expect(source).toContain("writeStderrSync");
            expect(source).toContain("./lib/merge-driver-io");
        }
    );
});
