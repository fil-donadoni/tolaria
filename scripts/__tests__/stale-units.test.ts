import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderLaunchdUnit } from "../lib/launchd-render";
import {
    type InstalledUnit,
    planPruneStale,
    readInstalledUnits,
    staleUnits,
    unitScripts,
} from "../lib/stale-units";

// Installed units whose script is gone from the checkout (issue #6019): the
// Huawei's tolaria-health / tolaria-reaper units outlived PR #5856.

const REPO = "/home/f/tolaria";
const unit = (name: string, text: string): InstalledUnit => ({
    name,
    path: `/u/${name}`,
    text,
});
// The units as PR #5856 left them installed (comments stripped).
const health = unit(
    "tolaria-health.service",
    `[Service]
Type=oneshot
WorkingDirectory=${REPO}
ExecStart=/home/f/.local/bin/mise exec -- bun scripts/health-runner.ts
EnvironmentFile=-%h/.config/tolaria/runner.env
`
);
const healthTimer = unit(
    "tolaria-health.timer",
    `[Timer]
OnCalendar=*:0/5
Unit=tolaria-health.service
`
);
const reaper = unit(
    "tolaria-reaper.service",
    `[Service]
WorkingDirectory=${REPO}
ExecStart=/home/f/.bun/bin/bun ${REPO}/scripts/reaper.ts
`
);
// No `Unit=`: the timer triggers the service of its own stem.
const reaperTimer = unit("tolaria-reaper.timer", "[Timer]\nOnCalendar=*:0/2\n");
const convex = unit(
    "tolaria-convex.service",
    `[Service]
WorkingDirectory=${REPO}
ExecStart=/home/f/.local/bin/mise exec -- bun x convex dev --local
`
);
const ghRunner = unit(
    "tolaria-gh-runner@.service",
    `[Service]
WorkingDirectory=/home/f/.local/share/tolaria/actions-runner/%i
ExecStart=/home/f/.local/share/tolaria/actions-runner/%i/run.sh
`
);
const reaperPlist = unit(
    "com.tolaria.reaper.plist",
    `<plist version="1.0"><dict>
    <key>Label</key>
    <string>com.tolaria.reaper</string>
    <key>ProgramArguments</key>
    <array>
        <string>/h/.bun/bin/bun</string>
        <string>/r/scripts/reaper.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/r</string>
</dict></plist>`
);

const live = new Set([
    `${REPO}/scripts/land-runner.ts`,
    "/r/scripts/land-runner.ts",
]);
const exists = (p: string) => live.has(p);

describe("unitScripts", () => {
    it("resolves a relative ExecStart script against WorkingDirectory", () => {
        expect(unitScripts(health)).toEqual([
            `${REPO}/scripts/health-runner.ts`,
        ]);
    });
    it("reads an absolute one as-is, and a plist's ProgramArguments", () => {
        expect(unitScripts(reaper)).toEqual([`${REPO}/scripts/reaper.ts`]);
        expect(unitScripts(reaperPlist)).toEqual(["/r/scripts/reaper.ts"]);
    });
    it("finds no script in a unit that runs none", () => {
        expect(unitScripts(convex)).toEqual([]);
        expect(unitScripts(ghRunner)).toEqual([]);
    });
});

describe("staleUnits", () => {
    it("flags the dead health/reaper units and their timers, keeps the live ones", () => {
        const stale = staleUnits(
            [convex, ghRunner, health, healthTimer, reaper, reaperTimer],
            exists
        );
        expect(stale.map((s) => [s.unit.name, s.missing])).toEqual([
            ["tolaria-health.service", `${REPO}/scripts/health-runner.ts`],
            ["tolaria-reaper.service", `${REPO}/scripts/reaper.ts`],
            ["tolaria-health.timer", "tolaria-health.service"],
            ["tolaria-reaper.timer", "tolaria-reaper.service"],
        ]);
    });
    it("keeps a unit whose script is present", () => {
        expect(staleUnits([health, healthTimer], () => true)).toEqual([]);
    });
    it("flags a dead launchd agent, keeps the rendered land-runner", () => {
        const landRunner = unit(
            "com.tolaria.land-runner.plist",
            renderLaunchdUnit(
                readFileSync(
                    "scripts/runner-units/com.tolaria.land-runner.plist",
                    "utf8"
                ),
                { repo: "/r", bun: "/h/bun", nodeBin: "/h/n", home: "/h" },
                () => true
            )
        );
        expect(
            staleUnits([landRunner, reaperPlist], exists).map(
                (s) => s.unit.name
            )
        ).toEqual(["com.tolaria.reaper.plist"]);
    });
});

describe("planPruneStale", () => {
    it("plans nothing when nothing is stale", () => {
        expect(planPruneStale([], "linux", 1000)).toEqual([]);
    });
    it("linux: stops timers first, deletes units and drop-ins, reloads", () => {
        const steps = planPruneStale(
            staleUnits([health, healthTimer], exists),
            "linux",
            1000
        );
        expect(
            steps.map((s) =>
                s.kind === "run"
                    ? s.argv.join(" ")
                    : s.kind === "remove"
                      ? `rm ${s.path}`
                      : s.kind
            )
        ).toEqual([
            "systemctl --user disable --now tolaria-health.timer",
            "systemctl --user disable --now tolaria-health.service",
            "rm /u/tolaria-health.timer",
            "rm /u/tolaria-health.timer.d",
            "rm /u/tolaria-health.service",
            "rm /u/tolaria-health.service.d",
            "systemctl --user daemon-reload",
            "systemctl --user reset-failed tolaria-health.timer tolaria-health.service",
        ]);
    });
    it("darwin: boots the agent out by its label and deletes the plist", () => {
        const steps = planPruneStale(
            staleUnits([reaperPlist], exists),
            "darwin",
            501
        );
        expect(steps).toMatchObject([
            {
                kind: "run",
                argv: ["launchctl", "bootout", "gui/501/com.tolaria.reaper"],
                okFail: true,
            },
            { kind: "remove", path: "/u/com.tolaria.reaper.plist" },
        ]);
    });
});

describe("readInstalledUnits + prune is idempotent", () => {
    it("a second read after the removal plans nothing", () => {
        const dir = mkdtempSync(join(tmpdir(), "stale-units-"));
        try {
            const sd = join(dir, "systemd");
            mkdirSync(join(sd, "tolaria-health.service.d"), {
                recursive: true,
            });
            writeFileSync(join(sd, health.name), health.text);
            writeFileSync(join(sd, healthTimer.name), healthTimer.text);
            writeFileSync(join(sd, convex.name), convex.text);
            writeFileSync(join(sd, "other.service"), health.text);
            const dirs = { systemdUserDir: sd, launchAgentsDir: dir };
            const first = planPruneStale(
                staleUnits(readInstalledUnits("linux", dirs), exists),
                "linux",
                1000
            );
            for (const s of first)
                if (s.kind === "remove")
                    rmSync(s.path, { recursive: true, force: true });
            expect(
                readInstalledUnits("linux", dirs).map((u) => u.name)
            ).toEqual(["tolaria-convex.service"]);
            expect(
                planPruneStale(
                    staleUnits(readInstalledUnits("linux", dirs), exists),
                    "linux",
                    1000
                )
            ).toEqual([]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
