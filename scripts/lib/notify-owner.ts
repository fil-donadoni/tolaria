/**
 * A push notification to the owner, from a script nobody watches (issue
 * #5467): `TOLARIA_NOTIFY_CMD` wins (run by `sh -c` with the message as
 * `$1` — an `ntfy` curl on the Huawei), else the desktop's own notifier.
 * The same order as `loop-drain.sh`'s `notify_owner`. Never throws: a
 * notification that cannot be shown leaves the caller's log line.
 */
import { spawnSync } from "node:child_process";

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
