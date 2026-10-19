// Installed Tolaria service units whose script is gone from the checkout
// (issue #6019): PR #5856 deleted `scripts/health-runner.ts` and
// `scripts/reaper.ts`, but the Huawei's `tolaria-health` / `tolaria-reaper`
// user units stayed installed and failed every tick. `bun run runner install`
// (and `bun run runner prune`) plans their removal; `bun run machine` reports
// them. The parsing and the plan are pure; `readInstalledUnits` is the one
// filesystem read.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import type { RunnerPlatform, Step } from "./github-runner";

/** One installed unit file: a systemd `.service`/`.timer` or a launchd plist. */
export interface InstalledUnit {
    /** The file name: `tolaria-health.service`, `com.tolaria.reaper.plist`. */
    name: string;
    path: string;
    text: string;
}

/** An installed unit that runs a `.ts` script missing from disk — or a timer
 *  that only triggers such a unit. */
export interface StaleUnit {
    unit: InstalledUnit;
    /** The missing script, or for a timer the stale unit it triggers. */
    missing: string;
}

const TS_TOKEN = /[^\s<>"'=]+\.ts(?=$|[\s<"'])/g;

/** The `.ts` scripts a unit runs, resolved against its working directory
 *  (`WorkingDirectory=` / launchd's `WorkingDirectory` key). A token that
 *  stays relative without one is returned as-is. Pure. */
export function unitScripts(unit: InstalledUnit): string[] {
    const plist = unit.name.endsWith(".plist");
    const cwd = plist
        ? /<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/.exec(
              unit.text
          )?.[1]
        : /^WorkingDirectory=(.+)$/m.exec(unit.text)?.[1]?.trim();
    const commands = plist
        ? [
              /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(
                  unit.text
              )?.[1] ?? "",
          ]
        : unit.text
              .split("\n")
              .filter((l) => /^Exec[A-Za-z]*=/.test(l))
              .map((l) => l.slice(l.indexOf("=") + 1));
    const out: string[] = [];
    for (const c of commands) {
        for (const tok of c.match(TS_TOKEN) ?? []) {
            out.push(isAbsolute(tok) || !cwd ? tok : join(cwd, tok));
        }
    }
    return out;
}

/** The service a systemd timer triggers: its `Unit=`, else its own stem. */
function timerTarget(unit: InstalledUnit): string {
    return (
        /^Unit=(.+)$/m.exec(unit.text)?.[1]?.trim() ??
        unit.name.replace(/\.timer$/, ".service")
    );
}

/** The units among `units` that name a missing script, plus the timers that
 *  trigger one of them. Pure: `exists` is the filesystem. */
export function staleUnits(
    units: InstalledUnit[],
    exists: (p: string) => boolean
): StaleUnit[] {
    const stale: StaleUnit[] = [];
    for (const u of units) {
        const missing = unitScripts(u).find((s) => !exists(s));
        if (missing !== undefined) stale.push({ unit: u, missing });
    }
    const staleNames = new Set(stale.map((s) => s.unit.name));
    for (const u of units) {
        if (!u.name.endsWith(".timer")) continue;
        const target = timerTarget(u);
        if (staleNames.has(target)) stale.push({ unit: u, missing: target });
    }
    return stale;
}

/** The launchd label of a plist: its `Label` key, else its file stem. */
function launchdLabel(unit: InstalledUnit): string {
    return (
        /<key>Label<\/key>\s*<string>([^<]*)<\/string>/.exec(unit.text)?.[1] ??
        basename(unit.name, ".plist")
    );
}

/** Stop, disable and delete every stale unit — its systemd drop-in directory
 *  with it — then reload and clear the failed state. Every step tolerates a
 *  unit already stopped; a second run finds no file and plans nothing. */
export function planPruneStale(
    stale: StaleUnit[],
    platform: RunnerPlatform,
    uid: number
): Step[] {
    if (stale.length === 0) return [];
    const steps: Step[] = [];
    if (platform === "darwin") {
        for (const s of stale) {
            steps.push({
                kind: "run",
                why: `${s.unit.name}: unload — its script ${s.missing} is gone`,
                argv: [
                    "launchctl",
                    "bootout",
                    `gui/${uid}/${launchdLabel(s.unit)}`,
                ],
                okFail: true,
            });
            steps.push({
                kind: "remove",
                why: `${s.unit.name}: delete the dead agent`,
                path: s.unit.path,
            });
        }
        return steps;
    }
    // Timers first, so none fires its service between the two stops.
    const ordered = [...stale].sort(
        (a, b) =>
            Number(b.unit.name.endsWith(".timer")) -
            Number(a.unit.name.endsWith(".timer"))
    );
    for (const s of ordered) {
        steps.push({
            kind: "run",
            why: `${s.unit.name}: stop and disable — ${s.unit.name.endsWith(".timer") ? `it triggers ${s.missing}` : `its script ${s.missing} is gone`}`,
            argv: ["systemctl", "--user", "disable", "--now", s.unit.name],
            okFail: true,
        });
    }
    for (const s of ordered) {
        steps.push({
            kind: "remove",
            why: `${s.unit.name}: delete the dead unit`,
            path: s.unit.path,
        });
        steps.push({
            kind: "remove",
            why: `${s.unit.name}: delete its drop-ins`,
            path: `${s.unit.path}.d`,
        });
    }
    steps.push({
        kind: "run",
        why: "reload systemd's user units",
        argv: ["systemctl", "--user", "daemon-reload"],
    });
    steps.push({
        kind: "run",
        why: "clear the dead units' failed state",
        argv: [
            "systemctl",
            "--user",
            "reset-failed",
            ...ordered.map((s) => s.unit.name),
        ],
        okFail: true,
    });
    return steps;
}

/** The Tolaria units installed for this user: `tolaria-*.{service,timer}`
 *  under `systemdUserDir` on Linux, `com.tolaria.*.plist` under
 *  `launchAgentsDir` on macOS. */
export function readInstalledUnits(
    platform: RunnerPlatform,
    dirs: { systemdUserDir: string; launchAgentsDir: string }
): InstalledUnit[] {
    const dir =
        platform === "darwin" ? dirs.launchAgentsDir : dirs.systemdUserDir;
    const ours =
        platform === "darwin"
            ? (n: string) =>
                  n.startsWith("com.tolaria.") && n.endsWith(".plist")
            : (n: string) =>
                  n.startsWith("tolaria-") && /\.(service|timer)$/.test(n);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter(ours)
        .sort()
        .map((name) => {
            const path = join(dir, name);
            return { name, path, text: readFileSync(path, "utf8") };
        });
}
