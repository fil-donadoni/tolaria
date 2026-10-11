// The pass's process lease (issue #5470): every `claude -p` pass the driver
// runs is anchored on its own pid and tags everything it spawns, so the
// reaper can take whatever a finished pass left running.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
    installLoopDrainHarness,
    tmp,
    writeStub,
    stubGhCountingFrom,
    run,
} from "./loop-drain-harness";

installLoopDrainHarness();

describe("loop-drain — the pass's process lease", () => {
    it("anchors a lease on the claude pass itself, tags the pass with it, and clears it when the pass ends", () => {
        stubGhCountingFrom(5);
        const seen = path.join(tmp, "claude-saw");
        const leases = path.join(tmp, "leases");
        writeStub(
            "claude",
            [
                `{ echo "owner=$TOLARIA_OWNER"; echo "self=$$"; cat "${leases}"/*.json; echo; } > "${seen}"`,
                `exit 0`,
            ].join("\n")
        );
        const r = run({ args: ["--max-passes", "1"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);

        const lines = fs.readFileSync(seen, "utf8").split("\n");
        const owner = lines[0].replace(/^owner=/, "");
        const self = Number(lines[1].replace(/^self=/, ""));
        const lease = JSON.parse(lines[2]);
        expect(owner).toMatch(/^loop-pass-\d+-1-\d+$/);
        // `exec` kept the wrapper's pid: the anchor IS the pass.
        expect(lease).toMatchObject({
            id: owner,
            kind: "loop-pass",
            pid: self,
            parent: null,
        });
        expect(lease.command).toMatch(/^claude -p \/next-ticket 101/);
        expect(fs.readdirSync(leases)).toEqual([]);
    });
});
