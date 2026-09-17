import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Guard for issue #3857 — a merge driver reports through ONE channel.
 *
 * Git invokes a merge driver with stderr on a PIPE, where
 * `process.stderr.write` queues rather than writes and `process.exit()` drops
 * what is still queued. Measured under Bun: a message over the pipe buffer
 * (512 KiB) arrives truncated at exactly the buffer, while the same message
 * through `writeSync` on fd 2 arrives whole; a driver's own ~130-byte messages
 * survive both ways, 100 runs out of 100. So this is hardening, not a live
 * bug — what it removes is the size dependence, on a channel whose whole job
 * is to explain a refusal (the cr-ledger driver already interpolates a parse
 * error of unbounded length).
 *
 * The rule is POSITIVE, not a denylist of broken spellings: a driver names no
 * output channel at all — no `process.stderr`, no `process.stdout`, no
 * `console`, no `Bun.write` — and says everything through
 * {@link writeStderrSync}. Enumerating banned spellings would miss
 * `process.stderr["write"]`, a destructured `write`, or a switch to stdout;
 * naming the channel is what every one of those has in common. What no static
 * check can see is a write smuggled through another module, so a driver's
 * imports stay few and this guard stays paired with reading them.
 *
 * STRUCTURAL on purpose: whether a queued write is lost depends on the message
 * size and on how much of the event loop the runtime drains before exiting, so
 * a behavioural test on a driver's real messages passes under the broken
 * spelling — the measurement above is exactly that. What can be proven at
 * every size is that no driver uses a channel that can queue.
 */

const DRIVERS_DIR = resolve(__dirname, "..");

/** The output channels a driver must never name; `writeStderrSync` is the one. */
const QUEUEING_CHANNELS = [
    "process.stderr",
    "process.stdout",
    "console.",
    "Bun.write",
];

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
        // The per-driver blocks below discover their subjects, so a third
        // driver is covered the moment it lands. This row is what makes that
        // arrival LOUD rather than silent.
        expect(
            driverSources()
                .map((d) => d.name)
                .sort()
        ).toEqual(["merge-driver-cr-ledger.ts", "merge-driver-regenerated.ts"]);
    });

    it.each(driverSources())(
        "$name names no queueing channel",
        ({ source }) => {
            expect(
                QUEUEING_CHANNELS.filter((channel) => source.includes(channel))
            ).toEqual([]);
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
