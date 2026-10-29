import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    defaultCounts,
    type InstallInput,
    type ObservedMachine,
    parseBusyView,
    parseDeclaration,
    parseGithubSlug,
    planInstall,
    planRemove,
    planToggle,
    REMOVE_TOKEN_PLACEHOLDER,
    renderRunnerPlist,
    renderRunnerSystemdTemplate,
    runnerAsset,
    runnerSpecs,
    sanitizeHost,
    serializeDeclaration,
    systemdRunnerPath,
    type Step,
    TOKEN_PLACEHOLDER,
} from "../lib/github-runner";
import { renderedPath, renderLaunchdUnit } from "../lib/launchd-render";

// Self-hosted GitHub Actions runners (ADR 0156 §7 + Amendment I, issue #5634).

const subs = {
    repo: "/r",
    bun: "/h/.bun/bin/bun",
    nodeBin: "/h/.nvm/v24/bin",
    home: "/h",
};
const hasNode = (p: string) => p === "/h/.nvm/v24/bin/node";
const hasNodeAndClaude = (p: string) =>
    hasNode(p) || p === "/h/.local/bin/claude";
const ROOT = "/h/.local/share/tolaria/actions-runner";
const plistTpl = readFileSync(
    "scripts/runner-units/com.tolaria.gh-runner.plist",
    "utf8"
);
const convexTpl = readFileSync(
    "scripts/runner-units/com.tolaria.convex.plist",
    "utf8"
);
const systemdTpl = readFileSync(
    "scripts/runner-units/tolaria-gh-runner@.service",
    "utf8"
);
const unit = (file: string) =>
    readFileSync(`scripts/runner-units/${file}`, "utf8");

function input(platform: "darwin" | "linux"): InstallInput {
    const runners = runnerSpecs(
        "mac",
        { pass: 2, lane: 1, maint: 0, seed: platform === "darwin" ? 1 : 0 },
        ROOT
    );
    return {
        platform,
        uid: 501,
        slug: "o/r",
        runners,
        plists:
            platform === "darwin"
                ? Object.fromEntries(
                      runners.map((r) => [
                          r.name,
                          renderRunnerPlist(
                              plistTpl,
                              r,
                              subs,
                              hasNodeAndClaude
                          ),
                      ])
                  )
                : {},
        systemdTemplate:
            platform === "linux"
                ? renderRunnerSystemdTemplate(
                      systemdTpl,
                      ROOT,
                      "/usr/bin:/bin",
                      "/r",
                      () => true
                  )
                : null,
        convexPlist:
            platform === "darwin"
                ? renderLaunchdUnit(convexTpl, subs, hasNode)
                : null,
        launchAgentsDir: "/h/Library/LaunchAgents",
        systemdUserDir: "/h/.config/systemd/user",
        logDir: "/h/.cache/tolaria/gh-runner",
        convexLogDir: "/h/.cache/tolaria/convex",
        heartbeat:
            platform === "darwin"
                ? {
                      plist: renderLaunchdUnit(
                          unit("com.tolaria.heartbeat.plist"),
                          subs,
                          hasNode
                      ),
                  }
                : {
                      service: renderRunnerSystemdTemplate(
                          unit("tolaria-heartbeat.service"),
                          ROOT,
                          "/usr/bin:/bin",
                          "/r",
                          () => true
                      ),
                      timer: unit("tolaria-heartbeat.timer"),
                  },
        heartbeatLogDir: "/h/.cache/tolaria/heartbeat",
        machineFile: { path: `${ROOT}/machine.json`, content: "{}\n" },
    };
}

const fresh: ObservedMachine = {
    runners: {},
    installed: [],
    systemdTemplateText: null,
    convexText: null,
    convexRunning: false,
    linger: true,
    machineText: null,
    busy: {},
};

/** The machine as a completed `install` of `inp` leaves it. */
function installed(inp: InstallInput, paused: string[] = []): ObservedMachine {
    return {
        runners: Object.fromEntries(
            inp.runners.map((r) => [
                r.name,
                {
                    extracted: true,
                    registered: true,
                    unitText:
                        inp.platform === "darwin"
                            ? inp.plists[r.name]
                            : inp.systemdTemplate,
                    paused: paused.includes(r.name),
                    running: !paused.includes(r.name),
                },
            ])
        ),
        installed: inp.runners.map((r) => r.name),
        systemdTemplateText: inp.systemdTemplate,
        convexText: inp.convexPlist,
        convexRunning: inp.convexPlist !== null,
        heartbeatText: inp.heartbeat?.plist ?? inp.heartbeat?.service ?? null,
        heartbeatTimerText: inp.heartbeat?.timer ?? null,
        heartbeatRunning: inp.heartbeat !== undefined,
        linger: true,
        machineText: inp.machineFile.content,
        busy: Object.fromEntries(inp.runners.map((r) => [r.name, false])),
    };
}

/** `seen` with every runner's service definition stale. */
function changed(inp: InstallInput, seen: ObservedMachine): ObservedMachine {
    for (const name of Object.keys(seen.runners))
        seen.runners[name].unitText = "old";
    if (inp.platform === "linux") seen.systemdTemplateText = "old";
    return seen;
}

/** The commands that stop, start or restart runner `name`'s service. */
const stops = (steps: Step[], name: string) =>
    argvs(steps).filter(
        (a) =>
            / (bootout|bootstrap|restart|enable --now) /.test(a) &&
            (a.includes(`gh-runner.${name}.plist`) ||
                a.endsWith(`gh-runner.${name}`) ||
                a.endsWith(`gh-runner@${name}.service`))
    );

const paths = (steps: Step[]) =>
    steps.flatMap((s) =>
        s.kind === "write" || s.kind === "remove" ? [s.path] : []
    );

const argvs = (steps: Step[]) =>
    steps.flatMap((s) => (s.kind === "run" ? [s.argv.join(" ")] : []));

describe("runner declaration", () => {
    it("names runners <host>-<role>-<n> with the role and host:<name> labels", () => {
        const specs = runnerSpecs(
            "huawei",
            { pass: 2, lane: 1, maint: 0, seed: 0 },
            ROOT
        );
        expect(specs.map((s) => s.name)).toEqual([
            "huawei-pass-1",
            "huawei-pass-2",
            "huawei-lane-1",
        ]);
        expect(specs[2].labels).toEqual(["lane", "host:huawei"]);
        expect(specs[0].dir).toBe(`${ROOT}/huawei-pass-1`);
    });

    it("declares the seed runner only on the MacBook by default", () => {
        expect(defaultCounts("darwin").seed).toBe(1);
        expect(defaultCounts("linux").seed).toBe(0);
    });

    it("declares the lane runner on the MacBook only and a maint runner on every machine (ADR 0160)", () => {
        expect(defaultCounts("darwin")).toMatchObject({ lane: 1, maint: 1 });
        expect(defaultCounts("linux")).toMatchObject({ lane: 0, maint: 1 });
        const [maint] = runnerSpecs(
            "huawei",
            { pass: 0, lane: 0, maint: 1, seed: 0 },
            ROOT
        );
        expect(maint.name).toBe("huawei-maint-1");
        expect(maint.labels).toEqual(["maint", "host:huawei"]);
    });

    it("sanitizes a host name into a label-safe one", () => {
        expect(sanitizeHost("Filippo's-MacBook-Pro.local")).toBe(
            "filippo-s-macbook-pro"
        );
    });

    it("reads the repo slug from https and ssh remotes", () => {
        expect(
            parseGithubSlug("https://github.com/fil-donadoni/tolaria.git")
        ).toBe("fil-donadoni/tolaria");
        expect(
            parseGithubSlug("git@github.com:fil-donadoni/tolaria.git\n")
        ).toBe("fil-donadoni/tolaria");
        expect(parseGithubSlug("https://gitlab.com/a/b")).toBeNull();
    });

    it("names the release asset per OS and arch", () => {
        expect(runnerAsset("darwin", "arm64", "v2.328.0")).toBe(
            "actions-runner-osx-arm64-2.328.0.tar.gz"
        );
        expect(runnerAsset("linux", "x64", "v2.328.0")).toBe(
            "actions-runner-linux-x64-2.328.0.tar.gz"
        );
    });

    it("round-trips machine.json and refuses a malformed one", () => {
        const d = {
            host: "mac",
            counts: { pass: 3, lane: 1, maint: 0, seed: 1 },
        };
        expect(parseDeclaration(serializeDeclaration(d))).toEqual(d);
        expect(
            parseDeclaration(
                '{"host":"mac","counts":{"pass":-1,"lane":1,"seed":0}}'
            )
        ).toBeNull();
        expect(parseDeclaration("not json")).toBeNull();
        // A declaration from before the maint role declares none: the owner
        // adds it by flag, an old machine.json never grows one silently.
        expect(
            parseDeclaration(
                '{"host":"mac","counts":{"pass":3,"lane":1,"seed":1}}'
            )
        ).toEqual({
            host: "mac",
            counts: { pass: 3, lane: 1, maint: 0, seed: 1 },
        });
    });
});

describe("runner units", () => {
    it("the MacBook runner runs run.sh under caffeinate, with node on PATH", () => {
        const [r] = runnerSpecs(
            "mac",
            { pass: 1, lane: 0, maint: 0, seed: 0 },
            ROOT
        );
        const out = renderRunnerPlist(plistTpl, r, subs, hasNodeAndClaude);
        expect(out).toContain(
            "<string>com.tolaria.gh-runner.mac-pass-1</string>"
        );
        expect(out).toMatch(
            /<string>\/usr\/bin\/caffeinate<\/string>[\s\S]*<string>\/h\/\.local\/share\/tolaria\/actions-runner\/mac-pass-1\/run\.sh<\/string>/
        );
        expect(out).toContain("<key>KeepAlive</key>\n    <true/>");
        expect(out).toContain("/h/.nvm/v24/bin");
        expect(out).toContain(
            "<key>TOLARIA_PRIMARY_CHECKOUT</key>\n        <string>/r</string>"
        );
    });

    it("convex dev is a launchd agent restarted when it dies", () => {
        const out = renderLaunchdUnit(convexTpl, subs, hasNode);
        expect(out).toContain(
            "<string>dev</string>\n        <string>--local</string>"
        );
        expect(out).toContain("<key>KeepAlive</key>\n    <true/>");
        expect(out).toContain("<string>/r</string>");
    });

    it("the systemd template restarts on crash and kills the job's cgroup", () => {
        const out = renderRunnerSystemdTemplate(
            systemdTpl,
            ROOT,
            "/usr/bin:/bin",
            "/r",
            () => true
        );
        expect(out).toContain(`ExecStart=${ROOT}/%i/run.sh`);
        expect(out).toContain("Restart=always");
        expect(out).toContain("KillMode=control-group");
        expect(out).toContain("Environment=TOLARIA_PRIMARY_CHECKOUT=/r");
        expect(() =>
            renderRunnerSystemdTemplate(
                "__NOPE__",
                ROOT,
                "/bin",
                "/r",
                () => true
            )
        ).toThrow(/unsubstituted/);
    });

    it("launchd and systemd PATHs both start with the one shared head (issue #6217)", () => {
        const [r] = runnerSpecs(
            "mac",
            { pass: 1, lane: 0, maint: 0, seed: 0 },
            ROOT
        );
        const plist = renderRunnerPlist(plistTpl, r, subs, hasNodeAndClaude);
        const head = ["/h/.local/bin", "/h/.bun/bin", "/h/.nvm/v24/bin"].join(
            ":"
        );
        expect(renderedPath(plist).startsWith(`${head}:`)).toBe(true);
        expect(systemdRunnerPath("/h", "/h/.nvm/v24/bin")).toMatch(
            new RegExp(`^${head}:`)
        );
    });

    it("a pass-runner unit whose PATH resolves no claude is refused", () => {
        const [pass] = runnerSpecs(
            "mac",
            { pass: 1, lane: 0, maint: 0, seed: 0 },
            ROOT
        );
        expect(() => renderRunnerPlist(plistTpl, pass, subs, hasNode)).toThrow(
            /claude not resolvable/
        );
        const [lane] = runnerSpecs(
            "mac",
            { pass: 0, lane: 1, maint: 0, seed: 0 },
            ROOT
        );
        expect(() =>
            renderRunnerPlist(plistTpl, lane, subs, hasNode)
        ).not.toThrow();
        expect(() =>
            renderRunnerSystemdTemplate(
                systemdTpl,
                ROOT,
                systemdRunnerPath("/h", "/h/.nvm/v24/bin"),
                "/r",
                hasNode,
                true
            )
        ).toThrow(/claude not resolvable/);
    });

    it("the systemd PATH is fixed, never the installing shell's", () => {
        const path = systemdRunnerPath("/h", "/h/.local/share/mise/node/bin");
        expect(path).toBe(
            "/h/.local/bin:/h/.bun/bin:/h/.local/share/mise/node/bin:/usr/local/bin:/usr/bin:/bin"
        );
        expect(() =>
            renderRunnerSystemdTemplate(
                systemdTpl,
                ROOT,
                path,
                "/r",
                () => false
            )
        ).toThrow(/node not resolvable/);
        expect(() =>
            renderRunnerSystemdTemplate(
                systemdTpl,
                ROOT,
                "/a b:/bin",
                "/r",
                () => true
            )
        ).toThrow(/whitespace/);
        expect(() =>
            renderRunnerSystemdTemplate(
                systemdTpl,
                ROOT,
                "/a%h:/bin",
                "/r",
                () => true
            )
        ).toThrow(/whitespace/);
        expect(() =>
            renderRunnerSystemdTemplate(
                systemdTpl,
                ROOT,
                "/usr/bin:/bin",
                "/my repo",
                () => true
            )
        ).toThrow(/whitespace/);
    });

    it("darwin: a reload's bootstrap retries past launchd's teardown race", () => {
        const inp = input("darwin");
        const seen = installed(inp);
        seen.runners[inp.runners[0].name].unitText = "old";
        const boot = planInstall(inp, seen).find(
            (s) => s.kind === "run" && s.argv[1] === "bootstrap"
        );
        expect(boot).toMatchObject({ retry: true });
    });
});

describe("install plan", () => {
    for (const platform of ["darwin", "linux"] as const) {
        it(`${platform}: a fresh machine downloads, registers and starts every runner`, () => {
            const inp = input(platform);
            const steps = planInstall(inp, fresh);
            expect(steps.some((s) => s.kind === "download")).toBe(true);
            const runs = argvs(steps);
            for (const r of inp.runners) {
                expect(runs).toContain(
                    `./config.sh --unattended --url https://github.com/o/r --token ${TOKEN_PLACEHOLDER} --name ${r.name} --labels ${r.labels.join(",")} --work _work --replace`
                );
                expect(runs).toContain(
                    platform === "darwin"
                        ? `launchctl bootstrap gui/501 /h/Library/LaunchAgents/com.tolaria.gh-runner.${r.name}.plist`
                        : `systemctl --user enable --now tolaria-gh-runner@${r.name}.service`
                );
            }
        });

        it(`${platform}: re-running on an installed machine plans nothing (idempotent)`, () => {
            const inp = input(platform);
            expect(planInstall(inp, installed(inp))).toEqual([]);
        });

        it(`${platform}: a paused runner is left stopped by install`, () => {
            const inp = input(platform);
            const name = inp.runners[0].name;
            const steps = planInstall(inp, installed(inp, [name]));
            expect(argvs(steps).some((a) => a.includes(name))).toBe(false);
            expect(
                steps.some(
                    (s) =>
                        s.kind === "note" && s.why.includes(`${name} is paused`)
                )
            ).toBe(true);
        });
    }

    it("writes TOLARIA_NOTIFY_CMD into each runner's .env when the installing shell has one, and leaves .env alone otherwise (issue #5873)", () => {
        const inp = { ...input("linux"), notifyCmd: 'curl -d "$1" ntfy' };
        const seen = installed(inp);
        const writes = planInstall(inp, seen).filter(
            (s) => s.kind === "write" && s.path.endsWith("/.env")
        );
        expect(
            writes.map((s) => (s.kind === "write" ? s.content : ""))
        ).toEqual(
            inp.runners.map(() => 'TOLARIA_NOTIFY_CMD=curl -d "$1" ntfy\n')
        );
        // Already in place: nothing to do.
        for (const r of inp.runners)
            seen.runners[r.name]!.envText =
                'TOLARIA_NOTIFY_CMD=curl -d "$1" ntfy\n';
        expect(planInstall(inp, seen)).toEqual([]);
        // No notify command in the shell: an existing .env is not touched.
        expect(planInstall(input("linux"), seen)).toEqual([]);
    });

    it("darwin: a changed plist on a running agent is booted out, then bootstrapped", () => {
        const inp = input("darwin");
        const seen = installed(inp);
        const name = inp.runners[0].name;
        seen.runners[name].unitText = "old";
        expect(argvs(planInstall(inp, seen))).toEqual([
            `launchctl bootout gui/501/com.tolaria.gh-runner.${name}`,
            `launchctl bootstrap gui/501 /h/Library/LaunchAgents/com.tolaria.gh-runner.${name}.plist`,
        ]);
    });

    it("darwin: the MacBook installs convex dev as a launchd agent", () => {
        const runs = argvs(planInstall(input("darwin"), fresh));
        expect(runs).toContain(
            "launchctl bootstrap gui/501 /h/Library/LaunchAgents/com.tolaria.convex.plist"
        );
    });

    // The fallback clock (issue #7445): installed beside the runners on both
    // machines, so a dropped GitHub schedule cannot idle the pipeline.
    it("darwin: installs the heartbeat as a launchd agent", () => {
        const steps = planInstall(input("darwin"), fresh);
        expect(argvs(steps)).toContain(
            "launchctl bootstrap gui/501 /h/Library/LaunchAgents/com.tolaria.heartbeat.plist"
        );
        expect(paths(steps)).toContain(
            "/h/Library/LaunchAgents/com.tolaria.heartbeat.plist"
        );
    });

    it("linux: installs the heartbeat service and enables its timer", () => {
        const steps = planInstall(input("linux"), fresh);
        expect(paths(steps)).toEqual(
            expect.arrayContaining([
                "/h/.config/systemd/user/tolaria-heartbeat.service",
                "/h/.config/systemd/user/tolaria-heartbeat.timer",
            ])
        );
        expect(argvs(steps)).toContain(
            "systemctl --user enable --now tolaria-heartbeat.timer"
        );
    });

    it("linux: a changed heartbeat service is rewritten without restarting the timer", () => {
        const inp = input("linux");
        const steps = planInstall(inp, {
            ...installed(inp),
            heartbeatText: "old",
        });
        expect(paths(steps)).toEqual([
            "/h/.config/systemd/user/tolaria-heartbeat.service",
        ]);
        expect(argvs(steps)).toEqual(["systemctl --user daemon-reload"]);
    });

    it("the heartbeat units run scripts/heartbeat.ts every ten minutes", () => {
        const plist = unit("com.tolaria.heartbeat.plist");
        expect(plist).toMatch(
            /<key>StartInterval<\/key>\s*<integer>600<\/integer>/
        );
        expect(plist).toContain("__REPO__/scripts/heartbeat.ts");
        expect(unit("tolaria-heartbeat.timer")).toMatch(
            /^OnUnitActiveSec=10min$/m
        );
        expect(unit("tolaria-heartbeat.service")).toMatch(
            /^ExecStart=.* __REPO__\/scripts\/heartbeat\.ts$/m
        );
    });

    it("linux: installs no convex unit and flags missing linger", () => {
        const steps = planInstall(input("linux"), { ...fresh, linger: false });
        expect(argvs(steps).some((a) => a.includes("convex"))).toBe(false);
        expect(
            steps.some(
                (s) => s.kind === "note" && s.why.includes("enable-linger")
            )
        ).toBe(true);
    });
});

describe("install never stops a busy runner (issue #6467)", () => {
    it("reads GitHub's busy view from `<name>\\t<busy>` lines", () => {
        expect(parseBusyView("a-pass-1\ttrue\na-lane-1\tfalse\n")).toEqual({
            "a-pass-1": true,
            "a-lane-1": false,
        });
        expect(parseBusyView("")).toEqual({});
        // A malformed line is left out: its runner reads unknown, not idle.
        expect(parseBusyView("a-pass-1\nb-pass-1\tnull\n")).toEqual({});
    });

    for (const platform of ["darwin", "linux"] as const) {
        it(`${platform}: a busy runner with a changed definition is written, not restarted, and deferred`, () => {
            const inp = input(platform);
            const [busy, idle] = inp.runners.map((r) => r.name);
            const seen = changed(inp, installed(inp));
            seen.busy = { ...seen.busy, [busy]: true };
            const steps = planInstall(inp, seen);
            expect(stops(steps, busy)).toEqual([]);
            expect(stops(steps, idle)).not.toEqual([]);
            expect(steps).toContainEqual({
                kind: "defer",
                why: `${busy}: busy — restart deferred, re-run install when idle (\`--force-restart\` restarts it now)`,
            });
            expect(steps).toContainEqual(
                expect.objectContaining({
                    kind: "write",
                    path: `${ROOT}/${busy}/.restart-pending`,
                })
            );
            // The new definition is still put in place — after the mark, so
            // a run cut short between the two still owes the restart.
            const unit =
                platform === "darwin"
                    ? `/h/Library/LaunchAgents/com.tolaria.gh-runner.${busy}.plist`
                    : "/h/.config/systemd/user/tolaria-gh-runner@.service";
            const written = paths(steps);
            expect(written).toContain(unit);
            expect(written.indexOf(`${ROOT}/${busy}/.restart-pending`)).toBe(
                written.indexOf(unit) - 1
            );
        });

        it(`${platform}: a running runner GitHub's view does not list is not restarted`, () => {
            const inp = input(platform);
            const name = inp.runners[0].name;
            const seen = changed(inp, installed(inp));
            delete seen.busy![name];
            const steps = planInstall(inp, seen);
            expect(stops(steps, name)).toEqual([]);
            expect(steps).toContainEqual(
                expect.objectContaining({
                    kind: "defer",
                    why: expect.stringContaining(
                        `${name}: absent from GitHub's busy view`
                    ),
                })
            );
        });

        it(`${platform}: a paused runner's pending mark is cleared — resume starts the new definition`, () => {
            const inp = input(platform);
            const name = inp.runners[0].name;
            const marker = `${ROOT}/${name}/.restart-pending`;
            const seen = installed(inp, [name]);
            seen.runners[name].restartPending = true;
            const steps = planInstall(inp, seen);
            expect(stops(steps, name)).toEqual([]);
            expect(steps).toContainEqual(
                expect.objectContaining({ kind: "remove", path: marker })
            );
            const resumed = planToggle(
                "resume",
                platform,
                501,
                "/h/Library/LaunchAgents",
                ROOT,
                seen
            );
            expect(paths(resumed)).toContain(marker);
        });

        it(`${platform}: an unreadable busy view restarts no running runner; --force-restart does`, () => {
            const inp = input(platform);
            const seen = changed(inp, installed(inp));
            seen.busy = null;
            const steps = planInstall(inp, seen);
            for (const r of inp.runners) {
                expect(stops(steps, r.name)).toEqual([]);
                expect(steps).toContainEqual({
                    kind: "defer",
                    why: `${r.name}: GitHub's busy view is unreadable — restart deferred, re-run install when idle (\`--force-restart\` restarts it now)`,
                });
            }
            const forced = planInstall({ ...inp, forceRestart: true }, seen);
            expect(forced.some((s) => s.kind === "defer")).toBe(false);
            for (const r of inp.runners)
                expect(stops(forced, r.name)).not.toEqual([]);
        });

        it(`${platform}: an unreadable busy view still starts a stopped runner`, () => {
            const inp = input(platform);
            const steps = planInstall(inp, { ...fresh, busy: null });
            expect(steps.some((s) => s.kind === "defer")).toBe(false);
            for (const r of inp.runners)
                expect(stops(steps, r.name)).not.toEqual([]);
        });

        it(`${platform}: a pending restart runs once the runner is idle, and clears its mark`, () => {
            const inp = input(platform);
            const name = inp.runners[0].name;
            const seen = installed(inp);
            seen.runners[name].restartPending = true;
            seen.busy = { ...seen.busy, [name]: true };
            // Still busy: deferred again, the mark is not rewritten.
            const held = planInstall(inp, seen);
            expect(stops(held, name)).toEqual([]);
            expect(held.filter((s) => s.kind === "write")).toEqual([]);
            expect(held.filter((s) => s.kind === "defer")).toHaveLength(1);
            // Idle: restarted although its definition already matches.
            seen.busy = { ...seen.busy, [name]: false };
            const steps = planInstall(inp, seen);
            expect(stops(steps, name)).not.toEqual([]);
            expect(steps).toContainEqual(
                expect.objectContaining({
                    kind: "remove",
                    path: `${ROOT}/${name}/.restart-pending`,
                })
            );
        });
    }
});

describe("pause / resume / remove", () => {
    for (const platform of ["darwin", "linux"] as const) {
        it(`${platform}: pause stops every runner and never unregisters one`, () => {
            const inp = input(platform);
            const steps = planToggle(
                "pause",
                platform,
                501,
                "/h/Library/LaunchAgents",
                ROOT,
                installed(inp)
            );
            const runs = argvs(steps);
            expect(runs.some((a) => a.includes("config.sh"))).toBe(false);
            for (const r of inp.runners) {
                expect(steps).toContainEqual(
                    expect.objectContaining({
                        kind: "write",
                        path: `${ROOT}/${r.name}/.paused`,
                    })
                );
                expect(runs).toContain(
                    platform === "darwin"
                        ? `launchctl bootout gui/501/com.tolaria.gh-runner.${r.name}`
                        : `systemctl --user disable --now tolaria-gh-runner@${r.name}.service`
                );
            }
        });

        it(`${platform}: resume starts every paused runner and clears the mark`, () => {
            const inp = input(platform);
            const names = inp.runners.map((r) => r.name);
            const steps = planToggle(
                "resume",
                platform,
                501,
                "/h/Library/LaunchAgents",
                ROOT,
                installed(inp, names)
            );
            const runs = argvs(steps);
            for (const name of names) {
                expect(steps).toContainEqual(
                    expect.objectContaining({
                        kind: "remove",
                        path: `${ROOT}/${name}/.paused`,
                    })
                );
                expect(runs).toContain(
                    platform === "darwin"
                        ? `launchctl bootstrap gui/501 /h/Library/LaunchAgents/com.tolaria.gh-runner.${name}.plist`
                        : `systemctl --user enable --now tolaria-gh-runner@${name}.service`
                );
            }
        });
    }

    it("remove refuses a name that is not a runner name", () => {
        for (const bad of ["../x", "/etc", "a/b", ""]) {
            const steps = planRemove(
                bad,
                "darwin",
                501,
                "/h/Library/LaunchAgents",
                ROOT,
                fresh
            );
            expect(steps.every((s) => s.kind === "note")).toBe(true);
        }
    });

    it("remove unregisters with a removal token and deletes the directory", () => {
        const inp = input("darwin");
        const name = inp.runners[0].name;
        const steps = planRemove(
            name,
            "darwin",
            501,
            "/h/Library/LaunchAgents",
            ROOT,
            installed(inp)
        );
        expect(argvs(steps)).toContain(
            `./config.sh remove --token ${REMOVE_TOKEN_PLACEHOLDER}`
        );
        expect(steps).toContainEqual(
            expect.objectContaining({ kind: "remove", path: `${ROOT}/${name}` })
        );
    });

    for (const platform of ["darwin", "linux"] as const) {
        it(`${platform}: remove refuses a busy or unknown running runner unless forced (issue #6467)`, () => {
            const inp = input(platform);
            const name = inp.runners[0].name;
            const remove = (seen: ObservedMachine, force?: boolean) =>
                planRemove(
                    name,
                    platform,
                    501,
                    "/h/Library/LaunchAgents",
                    ROOT,
                    seen,
                    force
                );
            for (const busy of [{ [name]: true }, null]) {
                const seen = { ...installed(inp), busy };
                const steps = remove(seen);
                expect(steps).toHaveLength(1);
                expect(steps[0]).toMatchObject({ kind: "defer" });
                expect(argvs(remove(seen, true))).toContain(
                    `./config.sh remove --token ${REMOVE_TOKEN_PLACEHOLDER}`
                );
            }
            // A stopped runner runs no job: removed even with GitHub unread.
            const stopped = installed(inp, [name]);
            expect(argvs(remove({ ...stopped, busy: null }))).toContain(
                `./config.sh remove --token ${REMOVE_TOKEN_PLACEHOLDER}`
            );
        });
    }
});
