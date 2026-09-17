/**
 * Stderr for a merge driver (issue #3857).
 *
 * A merge driver says everything it has to say on stderr and then exits: it
 * owns no other channel — stdout belongs to nothing, and the file it writes is
 * the merge result. Git always invokes it with stderr on a PIPE, and on a pipe
 * `process.stderr.write` does not write, it QUEUES: the bytes leave with the
 * event loop's next turn. `process.exit()` never gives it one, so the message
 * is dropped and the operator sees a bare non-zero exit with no reason.
 *
 * `writeSync` on fd 2 blocks until the bytes are in the pipe, so the message
 * survives the exit that follows it. Enforced for every driver by
 * `scripts/__tests__/merge-driver-io.test.ts`.
 */
import { writeSync } from "node:fs";

/** Write to stderr and do not return until the bytes have left. */
export function writeStderrSync(message: string): void {
    writeSync(2, message);
}
