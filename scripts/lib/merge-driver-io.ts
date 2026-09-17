/**
 * Stderr for a merge driver (issue #3857).
 *
 * A merge driver says everything it has to say on stderr and then exits: it
 * owns no other channel — stdout belongs to nothing, and the file it writes is
 * the merge result. Git always invokes it with stderr on a PIPE, and on a pipe
 * `process.stderr.write` does not write, it QUEUES: the bytes leave with the
 * event loop's next turn, which `process.exit()` never grants.
 *
 * MEASURED, because the size matters. Under Bun, a message larger than the
 * pipe buffer arrives truncated at exactly 512 KiB and the same message
 * through `writeSync` arrives whole; a driver's own ~130-byte messages survive
 * either way, 100 runs out of 100. So this is HARDENING, not a live bug: what
 * it removes is a correctness that holds only while the messages stay small,
 * on the one channel a driver has for explaining a refusal — and the cr-ledger
 * driver already interpolates a parse error of unbounded length into one.
 *
 * `writeSync` on fd 2 blocks until the bytes are in the pipe, so the message
 * survives the exit that follows it at any size. That a driver uses this and
 * names no queueing channel is enforced by
 * `scripts/__tests__/merge-driver-io.test.ts`.
 */
import { writeSync } from "node:fs";

/** Write to stderr and do not return until the bytes have left. */
export function writeStderrSync(message: string): void {
    writeSync(2, message);
}
