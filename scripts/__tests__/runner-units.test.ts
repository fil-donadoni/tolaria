import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

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
});
