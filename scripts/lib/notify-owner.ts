/**
 * A push notification to the owner, from a script nobody watches (issue
 * #5467): `TOLARIA_NOTIFY_CMD` wins (run by `sh -c` with the message as
 * `$1` — an `ntfy` curl on the Huawei), else the desktop's own notifier.
 * Never throws: a
 * notification that cannot be shown leaves the caller's log line.
 *
 * Inside a GitHub Actions job the variable reaches the process through the
 * runner's own `.env` file, which `bun run runner install` writes from the
 * installing shell's `TOLARIA_NOTIFY_CMD` (issue #5873): a headless Linux
 * runner has no desktop to fall back to.
 *
 * `notifyOnce` is the dedupe a job that fails on every push or every hour
 * needs: a marker file remembers the key of the last notice sent, the same
 * key is not sent twice in a row, and `forgetNotice` (a green run) makes the
 * same failure news again. The marker is written only after the send.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function notifyOwner(
    message: string,
    title = "Tolaria",
    env: NodeJS.ProcessEnv = process.env
): void {
    try {
        const custom = env.TOLARIA_NOTIFY_CMD;
        if (custom) {
            spawnSync("sh", ["-c", custom, "notify", message], {
                stdio: "ignore",
                timeout: 30_000,
            });
            return;
        }
        if (process.platform === "darwin") {
            const quoted = (s: string) => JSON.stringify(s);
            spawnSync(
                "osascript",
                [
                    "-e",
                    `display notification ${quoted(message)} with title ${quoted(title)}`,
                ],
                { stdio: "ignore", timeout: 30_000 }
            );
            return;
        }
        spawnSync("notify-send", ["-u", "critical", title, message], {
            stdio: "ignore",
            timeout: 30_000,
        });
    } catch {
        // Never fatal — see the header.
    }
}

/** The key the marker at `path` remembers, or null. */
export function lastNoticeKey(path: string): string | null {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as {
            last?: unknown;
        };
        return typeof parsed.last === "string" ? parsed.last : null;
    } catch {
        return null;
    }
}

/** Whether a notice keyed `key` is due given the last one sent. Pure. */
export function noticeDueAfter(key: string, last: string | null): boolean {
    return key !== last;
}

/**
 * Send `message` unless the marker at `path` says a notice with the same
 * `key` was the last one sent; record the key after sending. Returns
 * whether it was sent.
 */
export function notifyOnce(
    path: string,
    key: string,
    message: string,
    title = "Tolaria",
    env: NodeJS.ProcessEnv = process.env
): boolean {
    if (!noticeDueAfter(key, lastNoticeKey(path))) return false;
    notifyOwner(message, title, env);
    try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify({ last: key }));
    } catch {
        // A marker that cannot be written costs a repeated notice, never the run.
    }
    return true;
}

/** A green run: the next failure, whatever its key, is news. */
export function forgetNotice(path: string): void {
    rmSync(path, { force: true });
}
