import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    defaultCounts,
    type InstallInput,
    type ObservedMachine,
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

function input(platform: "darwin" | "linux"): InstallInput {
    const runners = runnerSpecs(
        "mac",
        { pass: 2, lane: 1, seed: platform === "darwin" ? 1 : 0 },
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
        linger: true,
        machineText: inp.machineFile.content,
    };
}

const argvs = (steps: Step[]) =>
    steps.flatMap((s) => (s.kind === "run" ? [s.argv.join(" ")] : []));

describe("runner declaration", () => {
    it("names runners <host>-<role>-<n> with the role and host:<name> labels", () => {
        const specs = runnerSpecs(
            "huawei",
            { pass: 2, lane: 1, seed: 0 },
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
        const d = { host: "mac", counts: { pass: 3, lane: 1, seed: 1 } };
        expect(parseDeclaration(serializeDeclaration(d))).toEqual(d);
        expect(
            parseDeclaration(
                '{"host":"mac","counts":{"pass":-1,"lane":1,"seed":0}}'
            )
        ).toBeNull();
        expect(parseDeclaration("not json")).toBeNull();
    });
});

describe("runner units", () => {
    it("the MacBook runner runs run.sh under caffeinate, with node on PATH", () => {
        const [r] = runnerSpecs("mac", { pass: 1, lane: 0, seed: 0 }, ROOT);
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
        const [r] = runnerSpecs("mac", { pass: 1, lane: 0, seed: 0 }, ROOT);
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
        const [pass] = runnerSpecs("mac", { pass: 1, lane: 0, seed: 0 }, ROOT);
        expect(() => renderRunnerPlist(plistTpl, pass, subs, hasNode)).toThrow(
            /claude not resolvable/
        );
        const [lane] = runnerSpecs("mac", { pass: 0, lane: 1, seed: 0 }, ROOT);
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
});
