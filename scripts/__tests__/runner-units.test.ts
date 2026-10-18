import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LAUNCHD_LABEL } from "../lib/land-runner";

/**
 * The land-runner's launchd unit (issue #5669): KeepAlive/SuccessfulExit=false
 * restarts only after a crash, so a reboot left the runner unloaded and no
 * `ready-to-land` PR landed. `RunAtLoad` is what starts it at login.
 */
const plist = readFileSync(
    "scripts/runner-units/com.tolaria.land-runner.plist",
    "utf8"
);

describe("land-runner launchd unit (issue #5669)", () => {
    it("starts at load", () => {
        expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    });

    // The runner restarts itself on new code only when launchd's
    // XPC_SERVICE_NAME names this job (issue #5941).
    it("is the job the runner's self-restart recognises", () => {
        expect(plist).toMatch(
            new RegExp(`<key>Label</key>\\s*<string>${LAUNCHD_LABEL}</string>`)
        );
    });
});
