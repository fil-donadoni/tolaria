import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MACHINE_PINS, type MachinePin } from "../lib/machine-pins";

/**
 * Machine pins (issue #5590). Topology B' (ADR 0154) runs one tree on a
 * MacBook (`darwin`) and a Huawei (`linux`); a script that branches on the
 * host decides differently on each, so a test spawning it unpinned is green
 * where it landed and RED where batch health runs it — issue #5465's walk
 * test, `health-walk-off-mutex.test.ts`, red on `00aebfc40`.
 *
 * Every `process.platform` read in `scripts/**` is classified here: either a
 * ROLE decision (which machine am I — runner, gating walk) whose pin lives in
 * `MACHINE_PINS` and is applied to every test by `vitest.setup.node.ts`, or a
 * MECHANICS one (how this machine is probed: `/proc` vs `sysctl`), which
 * reads the same facts either way. A new read classified as neither reds.
 */
const REPO_ROOT = resolve(__dirname, "..", "..");

type Read =
    /** A role decision; `readIn` is the file that honours the pin. */
    { pin: MachinePin; readIn: string } | { mechanics: string };

const PLATFORM_READS: Record<string, Read> = {
    "scripts/land-runner.ts": {
        pin: "TOLARIA_LAND_RUNNER_PLATFORM",
        readIn: "scripts/lib/land-runner.ts",
    },
    "scripts/convex-ensure.ts": {
        mechanics: "systemd units exist on Linux only",
    },
    "scripts/lib/health-verdict.ts": {
        mechanics: "last sleep: journalctl vs sysctl",
    },
    "scripts/lib/machine-admission.ts": {
        mechanics: "load and memory: /proc vs sysctl (the probe is pinned)",
    },
    "scripts/lib/notify-owner.ts": {
        mechanics: "notification: notify-send vs osascript",
    },
};

/** Code only: a `process.platform` named in prose decides nothing. */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function platformReaders(): string[] {
    const files = spawnSync("git", ["ls-files", "--", "scripts/*.ts"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
    })
        .stdout.split("\n")
        .filter((f) => f !== "" && !/__tests__\/|\.test\.ts$/.test(f));
    return files.filter((f) =>
        /\bprocess\.platform\b/.test(
            stripComments(readFileSync(join(REPO_ROOT, f), "utf8"))
        )
    );
}

describe("machine pins — no test inherits the host's role (issue #5590)", () => {
    it("scans the scripts tree (an empty walk would pass vacuously)", () => {
        expect(platformReaders().length).toBeGreaterThanOrEqual(5);
    });

    it("every process.platform read in scripts/** is a pinned role or named mechanics", () => {
        const unclassified = platformReaders().filter(
            (f) => !(f in PLATFORM_READS)
        );
        expect(
            unclassified,
            "a script branches on the host platform: if it decides WHICH machine this is, add an env pin to MACHINE_PINS (scripts/lib/machine-pins.ts) and honour it; if it only decides HOW to probe this machine, add a mechanics row here"
        ).toEqual([]);
    });

    it("no row outlives its read", () => {
        const readers = new Set(platformReaders());
        expect(
            Object.keys(PLATFORM_READS).filter((f) => !readers.has(f))
        ).toEqual([]);
    });

    it("every role row's pin is registered and honoured where it says", () => {
        for (const [file, read] of Object.entries(PLATFORM_READS)) {
            if (!("pin" in read)) continue;
            expect(MACHINE_PINS, file).toHaveProperty(read.pin);
            expect(
                stripComments(
                    readFileSync(join(REPO_ROOT, read.readIn), "utf8")
                ),
                `${file}: ${read.readIn} never reads ${read.pin}`
            ).toContain(read.pin);
        }
    });

    it("the node test setup applied every pin — what every spawned script inherits", () => {
        // Asked of a real child, spawned the way the health tests spawn
        // `health-main`: the parent's environment, nothing added.
        const pins = Object.keys(MACHINE_PINS);
        const child = spawnSync(
            "bun",
            [
                "-e",
                `process.stdout.write(JSON.stringify(${JSON.stringify(pins)}.filter((k) => process.env[k] === undefined)))`,
            ],
            { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env } }
        );
        expect(child.status, child.stderr).toBe(0);
        expect(
            JSON.parse(child.stdout),
            "pins the child does not inherit"
        ).toEqual([]);
    });
});
