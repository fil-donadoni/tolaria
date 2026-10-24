// One classification per committed artefact (issue #6648). Three places say
// how a shared generated or census file merges: the registry
// (`scripts/lib/generated-artifacts.ts`), `.gitattributes` (what git actually
// runs) and the queue planner (which shared files are NOT an edge between two
// issues). They disagreed on the card index — append-only to the planner,
// immune-by-shape to the registry, driverless to git — and a repair merged it
// by hand. This pins them to one answer for every path any of them names.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
    matchesUnregeneratedPattern,
    MERGE_DRIVER_NAME,
    OTHER_MERGE_DRIVERS,
    REGENERATED_ARTIFACTS,
    UNREGENERATED_DATA,
} from "../lib/generated-artifacts";
import {
    DEFAULT_APPEND_ONLY_PATHS,
    isAppendOnlyPath,
    REGISTRATION_POINTS,
} from "../lib/queue-plan";

const REPO_ROOT = resolve(__dirname, "..", "..");

/** The `merge` attribute git resolves for each path, `unspecified` if none. */
function mergeAttributes(paths: readonly string[]): Map<string, string> {
    const r = spawnSync("git", ["check-attr", "merge", "--", ...paths], {
        cwd: REPO_ROOT,
        encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
    const out = new Map<string, string>();
    for (const line of r.stdout.trim().split("\n")) {
        const m = /^(.*): merge: (.*)$/.exec(line);
        if (m) out.set(m[1]!, m[2]!);
    }
    return out;
}

const plannerAbsorbs = (path: string) =>
    DEFAULT_APPEND_ONLY_PATHS.some((p) => isAppendOnlyPath(path, p));

function trackedData(): string[] {
    const r = spawnSync("git", ["ls-files", "data"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
    });
    return r.stdout.trim().split("\n").filter(Boolean);
}

/** Every path the registry classifies as merged by a driver, with its driver. */
const DRIVEN = new Map<string, string>([
    ...REGENERATED_ARTIFACTS.map((a) => [a.path, MERGE_DRIVER_NAME] as const),
    ...OTHER_MERGE_DRIVERS.map((a) => [a.path, a.driver] as const),
]);

describe("registry, .gitattributes and queue planner agree (issue #6648)", () => {
    it("every driven artefact: git runs the registry's driver, and the planner draws no edge on it", () => {
        const attrs = mergeAttributes([...DRIVEN.keys()]);
        for (const [path, driver] of DRIVEN) {
            expect(attrs.get(path), `${path}: .gitattributes`).toBe(driver);
            expect(plannerAbsorbs(path), `${path}: queue planner`).toBe(true);
        }
    });

    it("every undriven data file: git runs no driver, and the planner keeps it an edge", () => {
        const undriven = trackedData().filter(
            (p) =>
                !DRIVEN.has(p) &&
                UNREGENERATED_DATA.some((u) =>
                    matchesUnregeneratedPattern(u.pattern, p)
                )
        );
        expect(undriven.length).toBeGreaterThan(10);
        const attrs = mergeAttributes(undriven);
        for (const path of undriven) {
            expect(attrs.get(path), `${path}: .gitattributes`).toBe(
                "unspecified"
            );
            expect(plannerAbsorbs(path), `${path}: queue planner`).toBe(false);
        }
    });

    it("the planner's other exemptions are hand-written registration points, not artefacts", () => {
        const attrs = mergeAttributes(REGISTRATION_POINTS);
        for (const point of REGISTRATION_POINTS) {
            expect(DRIVEN.has(point), point).toBe(false);
            expect(point.startsWith("data/"), point).toBe(false);
            expect(attrs.get(point), point).toBe("unspecified");
        }
        expect(
            DEFAULT_APPEND_ONLY_PATHS.filter(
                (p) => !DRIVEN.has(p) && !REGISTRATION_POINTS.includes(p)
            )
        ).toEqual([]);
    });
});
