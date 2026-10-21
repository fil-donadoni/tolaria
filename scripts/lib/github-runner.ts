// Self-hosted GitHub Actions runners on this machine (ADR 0156 §7 and its
// Amendment I, issue #5634): the PURE half of `scripts/github-runner.ts` —
// which runners a machine declares, their labels, their rendered units, and
// the steps that take the observed machine to the declared one. Nothing here
// touches the filesystem, the network or a service manager; the CLI observes,
// asks for a plan, and executes it (or prints it, under `--dry-run`).
//
// Every runner runs as the owner's user (Amendment I withdrew the dedicated
// system user), one directory per runner under `runnerRoot`, one user service
// per runner: a launchd agent on macOS (under `caffeinate`), an instance of
// one systemd template unit on Linux. "Paused" = a `.paused` marker in the
// runner's directory AND the service disabled in its manager, so a login or a
// reboot does not bring it back; the runner stays registered on GitHub (shown
// offline). The marker is the truth: systemd cannot tell a never-enabled
// instance from a disabled one.
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
    renderLaunchdUnit,
    renderedPath,
    runnerPathHead,
    type LaunchdSubstitutions,
} from "./launchd-render";

export type RunnerRole = "pass" | "lane" | "seed";
export const RUNNER_ROLES: readonly RunnerRole[] = ["pass", "lane", "seed"];

export type RunnerPlatform = "darwin" | "linux";

export interface RunnerSpec {
    name: string;
    role: RunnerRole;
    labels: string[];
    dir: string;
}

/** How many runners of each role this machine declares. */
export type RoleCounts = Record<RunnerRole, number>;

/** The defaults: two Claude passes and one lane check per machine; the seed
 *  runner only where the owner's Convex deployment lives — the MacBook
 *  (ADR 0156 §7). */
export function defaultCounts(platform: RunnerPlatform): RoleCounts {
    return { pass: 2, lane: 1, seed: platform === "darwin" ? 1 : 0 };
}

/** A runner/label-safe host name: lower case, `[a-z0-9-]`, no domain. */
export function sanitizeHost(hostname: string): string {
    return hostname
        .split(".")[0]
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/** The labels a runner of `role` on `host` registers with — GitHub adds
 *  `self-hosted`, the OS and the architecture on its own. */
export function runnerLabels(role: RunnerRole, host: string): string[] {
    return [role, `host:${host}`];
}

/** The runners this machine declares, named `<host>-<role>-<n>` so a
 *  re-run of `install` addresses the same directories and registrations. */
export function runnerSpecs(
    host: string,
    counts: RoleCounts,
    runnerRoot: string
): RunnerSpec[] {
    const out: RunnerSpec[] = [];
    for (const role of RUNNER_ROLES) {
        for (let i = 1; i <= counts[role]; i++) {
            const name = `${host}-${role}-${i}`;
            out.push({
                name,
                role,
                labels: runnerLabels(role, host),
                dir: join(runnerRoot, name),
            });
        }
    }
    return out;
}

/** `owner/repo` out of a GitHub remote URL (https or ssh), or null. */
export function parseGithubSlug(remoteUrl: string): string | null {
    const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(
        remoteUrl.trim()
    );
    return m ? `${m[1]}/${m[2]}` : null;
}

/** The release asset of the runner for this OS/arch, e.g.
 *  `actions-runner-osx-arm64-2.328.0.tar.gz`. */
export function runnerAsset(
    platform: RunnerPlatform,
    arch: string,
    version: string
): string {
    const os = platform === "darwin" ? "osx" : "linux";
    const a = arch === "arm64" ? "arm64" : "x64";
    return `actions-runner-${os}-${a}-${version.replace(/^v/, "")}.tar.gz`;
}

// ── Units ──────────────────────────────────────────────────────────────────

export const LAUNCHD_RUNNER_PREFIX = "com.tolaria.gh-runner.";
export const LAUNCHD_CONVEX_LABEL = "com.tolaria.convex";
export const SYSTEMD_RUNNER_TEMPLATE = "tolaria-gh-runner@.service";

export function launchdRunnerLabel(name: string): string {
    return `${LAUNCHD_RUNNER_PREFIX}${name}`;
}

export function systemdRunnerUnit(name: string): string {
    return `tolaria-gh-runner@${name}.service`;
}

/** A runner's plist: the per-runner placeholders first, then the shared
 *  launchd render (which throws on a leftover placeholder or a missing node). */
export function renderRunnerPlist(
    template: string,
    runner: Pick<RunnerSpec, "name" | "dir" | "role">,
    subs: LaunchdSubstitutions,
    exists?: (p: string) => boolean
): string {
    const out = renderLaunchdUnit(
        template
            .replaceAll("__RUNNER_NAME__", () => runner.name)
            .replaceAll("__RUNNER_DIR__", () => runner.dir),
        subs,
        exists
    );
    if (runner.role === "pass")
        assertClaudeResolvable(renderedPath(out), exists);
    return out;
}

/** A pass runner spawns `claude`: a PATH that cannot resolve it makes every
 *  pass die at spawn (issue #6217), so the install refuses it. */
export function assertClaudeResolvable(
    path: string,
    exists: (p: string) => boolean = existsSync
): void {
    if (!path.split(":").some((d) => d && exists(join(d, "claude")))) {
        throw new Error(`claude not resolvable on the unit's PATH: ${path}`);
    }
}

/** The PATH a runner's systemd unit carries: FIXED dirs plus node's, never
 *  the installing shell's PATH — `bun run` prepends a cwd-dependent
 *  `node_modules/.bin`, and a drifting PATH would change the unit and
 *  restart every runner on each re-run. */
export function systemdRunnerPath(home: string, nodeBin: string): string {
    return [
        ...runnerPathHead(home, nodeBin),
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ].join(":");
}

/** The systemd template unit, shared by every runner on the machine. Throws
 *  on a leftover placeholder, a PATH, runner root or repo systemd would
 *  mangle (`%` is a specifier, whitespace splits the assignment), or no
 *  `node` on the PATH. `repo` is the primary checkout, exported to every job
 *  as `TOLARIA_PRIMARY_CHECKOUT` (the job worktree's source, issue #5636). */
export function renderRunnerSystemdTemplate(
    template: string,
    runnerRoot: string,
    path: string,
    repo: string,
    exists: (p: string) => boolean = existsSync,
    passRunners = false
): string {
    if ([path, runnerRoot, repo].some((v) => /[%\s]/.test(v))) {
        throw new Error(
            `'%' or whitespace in the unit's PATH, runner root or repo: ${path} / ${runnerRoot} / ${repo}`
        );
    }
    const out = template
        .replaceAll("__RUNNER_ROOT__", () => runnerRoot)
        .replaceAll("__PATH__", () => path)
        .replaceAll("__REPO__", () => repo);
    const left = out.match(/__[A-Z_]+__/g);
    if (left) {
        throw new Error(
            `unsubstituted placeholder(s): ${[...new Set(left)].join(", ")}`
        );
    }
    if (!path.split(":").some((d) => d && exists(join(d, "node")))) {
        throw new Error(`node not resolvable on the unit's PATH: ${path}`);
    }
    if (passRunners) assertClaudeResolvable(path, exists);
    return out;
}

/** A runner name as `install` makes them; anything else (a `..`, a `/`) is
 *  refused before a path is built from it. */
export function isRunnerName(name: string): boolean {
    return /^[a-z0-9][a-z0-9-]*$/.test(name);
}

// ── Plans ──────────────────────────────────────────────────────────────────

/** One thing the CLI does. `argv` runs a command (the token placeholder
 *  stands for the registration token, fetched only when a step needs it);
 *  `write` puts a file in place; `download` fetches the runner tarball. */
export type Step =
    | {
          kind: "run";
          why: string;
          argv: string[];
          cwd?: string;
          okFail?: boolean;
          /** Retry a few seconds before failing: a `bootstrap` right after
           *  a `bootout` can race launchd's teardown (EIO). */
          retry?: boolean;
      }
    | { kind: "write"; why: string; path: string; content: string }
    | { kind: "mkdir"; why: string; path: string }
    | { kind: "remove"; why: string; path: string }
    | { kind: "download"; why: string }
    | { kind: "note"; why: string };

export const TOKEN_PLACEHOLDER = "<registration-token>";
export const REMOVE_TOKEN_PLACEHOLDER = "<removal-token>";
export const TARBALL_PLACEHOLDER = "<runner-tarball>";
export const PAUSED_MARKER = ".paused";

/** What the CLI saw of one runner on this machine. */
export interface ObservedRunner {
    /** `config.sh` is in its directory. */
    extracted: boolean;
    /** `.runner` is in its directory: `config.sh` registered it. */
    registered: boolean;
    /** Its `.env` (job environment), or null when none. */
    envText?: string | null;
    /** The installed unit's text (macOS: its plist), or null. */
    unitText: string | null;
    /** Its directory carries the `.paused` marker. */
    paused: boolean;
    /** Loaded/active in the service manager right now. */
    running: boolean;
}

export interface ObservedMachine {
    runners: Record<string, ObservedRunner>;
    /** Runner directories found under `runnerRoot` that carry `.runner`. */
    installed: string[];
    /** Linux: the installed template unit's text. */
    systemdTemplateText: string | null;
    /** macOS: the installed convex plist's text. */
    convexText: string | null;
    convexRunning: boolean;
    /** Linux: `loginctl` reports Linger=yes. */
    linger: boolean;
    /** The installed `machine.json`'s text. */
    machineText: string | null;
}

export interface InstallInput {
    platform: RunnerPlatform;
    uid: number;
    slug: string;
    runners: RunnerSpec[];
    /** Rendered units: per runner on macOS, the one template on Linux. */
    plists: Record<string, string>;
    systemdTemplate: string | null;
    /** macOS: the rendered convex plist, or null when not installed here. */
    convexPlist: string | null;
    launchAgentsDir: string;
    systemdUserDir: string;
    logDir: string;
    convexLogDir: string;
    /** The declaration to remember (`machine.json`), so a re-run without
     *  flags declares the same runners. */
    machineFile: { path: string; content: string };
    /** The installing shell's `TOLARIA_NOTIFY_CMD` (issue #5873): written to
     *  each runner's `.env`, which actions/runner loads into every job, so a
     *  job's `notifyOwner` reaches the owner from a headless machine too.
     *  Undefined = leave each runner's `.env` as it is. */
    notifyCmd?: string;
}

/** The runner's `.env` for `notifyCmd` (actions/runner reads `<dir>/.env`
 *  into job environments at start). Pure. */
export function runnerEnvFile(notifyCmd: string): string {
    return `TOLARIA_NOTIFY_CMD=${notifyCmd}\n`;
}

/** What `machine.json` remembers: the host name and the role counts. */
export interface MachineDeclaration {
    host: string;
    counts: RoleCounts;
}

export function serializeDeclaration(d: MachineDeclaration): string {
    return `${JSON.stringify(d, null, 4)}\n`;
}

/** The remembered declaration, or null when absent or malformed. */
export function parseDeclaration(
    text: string | null
): MachineDeclaration | null {
    if (text === null) return null;
    try {
        const d = JSON.parse(text) as Partial<MachineDeclaration>;
        const ok =
            typeof d.host === "string" &&
            d.counts !== undefined &&
            RUNNER_ROLES.every(
                (r) => Number.isInteger(d.counts?.[r]) && d.counts![r] >= 0
            );
        return ok ? (d as MachineDeclaration) : null;
    } catch {
        return null;
    }
}

const EMPTY_RUNNER: ObservedRunner = {
    extracted: false,
    registered: false,
    unitText: null,
    paused: false,
    running: false,
};

/** launchd: load (or reload, when the plist changed) an agent that is not
 *  disabled. `bootout` before `bootstrap` because bootstrapping a loaded
 *  label fails. */
function launchdLoad(
    uid: number,
    label: string,
    plistPath: string,
    content: string,
    observed: { text: string | null; running: boolean; paused: boolean },
    what: string
): Step[] {
    const steps: Step[] = [];
    const changed = observed.text !== content;
    if (changed) {
        steps.push({
            kind: "write",
            why: `${observed.text === null ? "install" : "update"} ${what}'s launchd agent`,
            path: plistPath,
            content,
        });
    }
    if (observed.paused) {
        steps.push({
            kind: "note",
            why: `${what} is paused — left stopped (\`bun run runner resume\` starts it)`,
        });
        return steps;
    }
    if (observed.running && changed) {
        steps.push({
            kind: "run",
            why: `stop ${what} to reload its changed plist`,
            argv: ["launchctl", "bootout", `gui/${uid}/${label}`],
            okFail: true,
        });
    }
    if (!observed.running || changed) {
        steps.push({
            kind: "run",
            why: `start ${what}`,
            argv: ["launchctl", "bootstrap", `gui/${uid}`, plistPath],
            retry: observed.running,
        });
    }
    return steps;
}

/** The steps that take the observed machine to the declared one. Empty when
 *  nothing differs — `install` is idempotent by construction. */
export function planInstall(
    input: InstallInput,
    seen: ObservedMachine
): Step[] {
    const steps: Step[] = [];
    const runnerState = (n: string) => seen.runners[n] ?? EMPTY_RUNNER;
    if (seen.machineText !== input.machineFile.content) {
        steps.push({
            kind: "write",
            why: "remember this machine's declaration",
            path: input.machineFile.path,
            content: input.machineFile.content,
        });
    }
    if (input.runners.some((r) => !runnerState(r.name).extracted)) {
        steps.push({
            kind: "download",
            why: "download the latest actions/runner release for this OS/arch (cached)",
        });
    }
    for (const r of input.runners) {
        const s = runnerState(r.name);
        if (!s.extracted) {
            steps.push({
                kind: "mkdir",
                why: `${r.name}: runner directory`,
                path: r.dir,
            });
            steps.push({
                kind: "run",
                why: `${r.name}: unpack the runner`,
                argv: ["tar", "xzf", TARBALL_PLACEHOLDER, "-C", r.dir],
            });
        }
        if (
            input.notifyCmd !== undefined &&
            (s.envText ?? null) !== runnerEnvFile(input.notifyCmd)
        ) {
            steps.push({
                kind: "write",
                why: `${r.name}: TOLARIA_NOTIFY_CMD into its .env (a job's notices reach the owner; applied at the runner's next start)`,
                path: join(r.dir, ".env"),
                content: runnerEnvFile(input.notifyCmd),
            });
        }
        if (!s.registered) {
            steps.push({
                kind: "run",
                why: `${r.name}: register with labels ${r.labels.join(",")}`,
                cwd: r.dir,
                argv: [
                    "./config.sh",
                    "--unattended",
                    "--url",
                    `https://github.com/${input.slug}`,
                    "--token",
                    TOKEN_PLACEHOLDER,
                    "--name",
                    r.name,
                    "--labels",
                    r.labels.join(","),
                    "--work",
                    "_work",
                    "--replace",
                ],
            });
        }
    }
    if (input.platform === "darwin") {
        if (
            input.runners.some(
                (r) => runnerState(r.name).unitText !== input.plists[r.name]
            )
        ) {
            steps.push({
                kind: "mkdir",
                why: "runner log directory",
                path: input.logDir,
            });
        }
        for (const r of input.runners) {
            const s = runnerState(r.name);
            const label = launchdRunnerLabel(r.name);
            steps.push(
                ...launchdLoad(
                    input.uid,
                    label,
                    join(input.launchAgentsDir, `${label}.plist`),
                    input.plists[r.name],
                    { text: s.unitText, running: s.running, paused: s.paused },
                    r.name
                )
            );
        }
        if (input.convexPlist !== null) {
            if (seen.convexText === null) {
                steps.push({
                    kind: "note",
                    why: "a `convex dev` that `convex:ensure` started still holds the port — stop it (`pkill -f 'convex dev'`) and the agent takes over within 10 s",
                });
            }
            if (seen.convexText !== input.convexPlist || !seen.convexRunning) {
                steps.push({
                    kind: "mkdir",
                    why: "convex agent log directory",
                    path: input.convexLogDir,
                });
            }
            steps.push(
                ...launchdLoad(
                    input.uid,
                    LAUNCHD_CONVEX_LABEL,
                    join(
                        input.launchAgentsDir,
                        `${LAUNCHD_CONVEX_LABEL}.plist`
                    ),
                    input.convexPlist,
                    {
                        text: seen.convexText,
                        running: seen.convexRunning,
                        paused: false,
                    },
                    "convex dev"
                )
            );
        }
    } else {
        const templateChanged =
            seen.systemdTemplateText !== input.systemdTemplate;
        if (templateChanged && input.systemdTemplate !== null) {
            steps.push({
                kind: "write",
                why: `${seen.systemdTemplateText === null ? "install" : "update"} the runner template unit`,
                path: join(input.systemdUserDir, SYSTEMD_RUNNER_TEMPLATE),
                content: input.systemdTemplate,
            });
            steps.push({
                kind: "run",
                why: "reload systemd's user units",
                argv: ["systemctl", "--user", "daemon-reload"],
            });
        }
        for (const r of input.runners) {
            const s = runnerState(r.name);
            const unit = systemdRunnerUnit(r.name);
            if (s.paused) {
                steps.push({
                    kind: "note",
                    why: `${r.name} is paused — left stopped (\`bun run runner resume\` starts it)`,
                });
            } else if (!s.running) {
                steps.push({
                    kind: "run",
                    why: `${r.name}: enable and start`,
                    argv: ["systemctl", "--user", "enable", "--now", unit],
                });
            } else if (templateChanged) {
                steps.push({
                    kind: "run",
                    why: `${r.name}: restart on the changed template`,
                    argv: ["systemctl", "--user", "restart", unit],
                });
            }
        }
        if (!seen.linger) {
            steps.push({
                kind: "note",
                why: "linger is off: the runners stop at logout — `sudo loginctl enable-linger $USER` keeps them up with nobody logged in",
            });
        }
    }
    const declared = new Set(input.runners.map((r) => r.name));
    for (const name of seen.installed) {
        if (!declared.has(name)) {
            steps.push({
                kind: "note",
                why: `${name} is installed here but not declared — \`bun run runner remove ${name}\` unregisters it`,
            });
        }
    }
    return steps;
}

/** `pause` / `resume`: stop or start every installed runner, never
 *  unregistering one. Every step is idempotent, so a repeated verb is
 *  harmless. */
export function planToggle(
    verb: "pause" | "resume",
    platform: RunnerPlatform,
    uid: number,
    launchAgentsDir: string,
    runnerRoot: string,
    seen: ObservedMachine
): Step[] {
    const steps: Step[] = [];
    for (const name of seen.installed) {
        const s = seen.runners[name] ?? EMPTY_RUNNER;
        if (s.unitText === null) {
            steps.push({
                kind: "note",
                why: `${name} has no service installed — \`bun run runner install\` first`,
            });
            continue;
        }
        const marker = join(runnerRoot, name, PAUSED_MARKER);
        if (verb === "pause" && !s.paused) {
            steps.push({
                kind: "write",
                why: `${name}: mark paused`,
                path: marker,
                content: "",
            });
        }
        if (platform === "darwin") {
            const label = launchdRunnerLabel(name);
            const target = `gui/${uid}/${label}`;
            if (verb === "pause") {
                // `disable` is idempotent and is what keeps a login from
                // reloading the agent; always re-assert it.
                steps.push({
                    kind: "run",
                    why: `${name}: disable`,
                    argv: ["launchctl", "disable", target],
                });
                if (s.running) {
                    steps.push({
                        kind: "run",
                        why: `${name}: stop`,
                        argv: ["launchctl", "bootout", target],
                    });
                }
            } else {
                steps.push({
                    kind: "run",
                    why: `${name}: enable`,
                    argv: ["launchctl", "enable", target],
                });
                if (!s.running) {
                    steps.push({
                        kind: "run",
                        why: `${name}: start`,
                        argv: [
                            "launchctl",
                            "bootstrap",
                            `gui/${uid}`,
                            join(launchAgentsDir, `${label}.plist`),
                        ],
                    });
                }
            }
        } else {
            const unit = systemdRunnerUnit(name);
            steps.push({
                kind: "run",
                why: `${name}: ${verb === "pause" ? "disable and stop" : "enable and start"}`,
                argv: [
                    "systemctl",
                    "--user",
                    verb === "pause" ? "disable" : "enable",
                    "--now",
                    unit,
                ],
            });
        }
        if (verb === "resume" && s.paused) {
            steps.push({
                kind: "remove",
                why: `${name}: clear the paused mark`,
                path: marker,
            });
        }
    }
    if (seen.installed.length === 0) {
        steps.push({
            kind: "note",
            why: "no runner installed on this machine",
        });
    }
    return steps;
}

/** `remove <name>`: stop the service, delete its unit, unregister the runner
 *  from GitHub and delete its directory. */
export function planRemove(
    name: string,
    platform: RunnerPlatform,
    uid: number,
    launchAgentsDir: string,
    runnerRoot: string,
    seen: ObservedMachine
): Step[] {
    if (!isRunnerName(name)) {
        return [
            {
                kind: "note",
                why: `${JSON.stringify(name)} is not a runner name — nothing removed`,
            },
        ];
    }
    const s = seen.runners[name] ?? EMPTY_RUNNER;
    const dir = join(runnerRoot, name);
    const steps: Step[] = [];
    if (platform === "darwin") {
        const label = launchdRunnerLabel(name);
        if (s.running) {
            steps.push({
                kind: "run",
                why: `${name}: stop`,
                argv: ["launchctl", "bootout", `gui/${uid}/${label}`],
            });
        }
        steps.push({
            kind: "run",
            why: `${name}: forget its disabled flag`,
            argv: ["launchctl", "enable", `gui/${uid}/${label}`],
            okFail: true,
        });
        if (s.unitText !== null) {
            steps.push({
                kind: "remove",
                why: `${name}: delete its plist`,
                path: join(launchAgentsDir, `${label}.plist`),
            });
        }
    } else {
        steps.push({
            kind: "run",
            why: `${name}: disable and stop`,
            argv: [
                "systemctl",
                "--user",
                "disable",
                "--now",
                systemdRunnerUnit(name),
            ],
            okFail: true,
        });
    }
    if (s.registered) {
        steps.push({
            kind: "run",
            why: `${name}: unregister from GitHub`,
            cwd: dir,
            argv: [
                "./config.sh",
                "remove",
                "--token",
                REMOVE_TOKEN_PLACEHOLDER,
            ],
        });
    }
    if (s.extracted || s.registered) {
        steps.push({
            kind: "remove",
            why: `${name}: delete its directory`,
            path: dir,
        });
    }
    if (steps.length === 0) {
        steps.push({ kind: "note", why: `${name}: nothing installed` });
    }
    return steps;
}

/** One line per step, as `--dry-run` prints it. */
export function describeStep(s: Step): string {
    switch (s.kind) {
        case "run":
            return `run    ${s.argv.join(" ")}${s.cwd ? `   (in ${s.cwd})` : ""}   # ${s.why}`;
        case "write":
            return `write  ${s.path}   # ${s.why}`;
        case "mkdir":
            return `mkdir  ${s.path}   # ${s.why}`;
        case "remove":
            return `rm     ${s.path}   # ${s.why}`;
        case "download":
            return `fetch  ${TARBALL_PLACEHOLDER}   # ${s.why}`;
        case "note":
            return `note   ${s.why}`;
    }
}
