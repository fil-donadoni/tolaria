import { writeSync } from "node:fs";

/**
 * Write `text` to `fd` synchronously and whole (issue #8180).
 *
 * `process.stderr.write` on a pipe is asynchronous, and `process.exit` drops
 * whatever it has not yet handed to the pipe: a red `check:lane` replays a
 * vitest step's entire output on stderr (piped into `tee` by `pr-check.yml`)
 * and the failing test names were cut mid-line. A synchronous write has
 * nothing left to lose. EAGAIN (a non-blocking pipe that is full) is retried
 * until the reader drains it.
 */
export function writeSyncAll(
    fd: number,
    text: string,
    write: typeof writeSync = writeSync
): void {
    const bytes = Buffer.from(text);
    let offset = 0;
    while (offset < bytes.length) {
        try {
            offset += write(fd, bytes, offset);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "EAGAIN") throw err;
        }
    }
}
