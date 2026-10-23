// Self-hosted GitHub Actions runners on this machine (ADR 0156 §7 and its
// Amendment I, issue #5634) — `bun run runner <verb>`:
//
//   install [--dry-run] [--host <name>] [--pass N] [--lane N] [--seed N] [--no-convex] [--force-restart]
//   pause   [--dry-run]     stop this machine's runners, keep them registered
//   resume  [--dry-run]     start them again
//   status                  local service state + GitHub's online/busy view
//   remove  <name> [--dry-run] [--force-restart]   stop, unregister and delete one runner
//   prune   [--dry-run]     delete installed Tolaria units whose script is gone
//
// Observes the machine, asks scripts/lib/github-runner.ts for the plan, and
// runs it — or prints it under `--dry-run`. `install` is idempotent: a second
// run plans nothing. It prunes dead units too (issue #6019). It never stops a
// runner GitHub reports busy, nor any running one when GitHub cannot be read:
// the restart is deferred and the verb exits 1, unless `--force-restart`.
// Guide: docs/guides/github-pipeline.md.
import { execFileSync, spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { arch, homedir, hostname, platform as osPlatform } from "node:os";
import { dirname, join } from "node:path";
import {
    defaultCounts,
    describeStep,
    LAUNCHD_CONVEX_LABEL,
    launchdRunnerLabel,
    parseDeclaration,
    parseBusyView,
    parseGithubSlug,
    PAUSED_MARKER,
    planInstall,
    planRemove,
    planToggle,
    REMOVE_TOKEN_PLACEHOLDER,
    renderRunnerPlist,
    RESTART_PENDING_MARKER,
    renderRunnerSystemdTemplate,
    runnerAsset,
    runnerSpecs,
    sanitizeHost,
    serializeDeclaration,
    SYSTEMD_RUNNER_TEMPLATE,
    systemdRunnerPath,
    systemdRunnerUnit,
    TARBALL_PLACEHOLDER,
    TOKEN_PLACEHOLDER,
    type BusyView,
    type ObservedMachine,
    type ObservedRunner,
    type RoleCounts,
    type RunnerPlatform,
    type Step,
} from "./lib/github-runner";
import { renderLaunchdUnit } from "./lib/launchd-render";
import {
    planPruneStale,
    readInstalledUnits,
    staleUnits,
} from "./lib/stale-units";
import { primaryCheckout } from "./lib/primary-checkout";

const HOME = homedir();
const RUNNER_ROOT = join(HOME, ".local/share/tolaria/actions-runner");
const CACHE_DIR = join(HOME, ".cache/tolaria/actions-runner");
const LOG_DIR = join(HOME, ".cache/tolaria/gh-runner");
const CONVEX_LOG_DIR = join(HOME, ".cache/tolaria/convex");
const LAUNCH_AGENTS = join(HOME, "Library/LaunchAgents");
const SYSTEMD_USER = join(HOME, ".config/systemd/user");
const MACHINE_FILE = join(RUNNER_ROOT, "machine.json");
const UNITS = join(import.meta.dir, "runner-units");

function die(msg: string): never {
    console.error(`runner: ${msg}`);
    process.exit(1);
}

const sh = (argv: string[]) =>
    spawnSync(argv[0], argv.slice(1), { encoding: "utf8" });
const which = (bin: string) =>
    execFileSync("/bin/sh", ["-c", `command -v ${bin}`], {
        encoding: "utf8",
    }).trim();
const readOrNull = (p: string) =>
    existsSync(p) ? readFileSync(p, "utf8") : null;

function hostPlatform(): RunnerPlatform {
    const p = osPlatform();
    if (p !== "darwin" && p !== "linux") {
        die(`unsupported platform ${p} (macOS and Linux only)`);
    }
    return p;
}

function serviceRunning(
    platform: RunnerPlatform,
    uid: number,
    name: string
): boolean {
    if (platform === "darwin") {
        return (
            sh(["launchctl", "print", `gui/${uid}/${launchdRunnerLabel(name)}`])
                .status === 0
        );
    }
    const state = sh([
        "systemctl",
        "--user",
        "is-active",
        systemdRunnerUnit(name),
    ]).stdout.trim();
    return state === "active" || state === "activating";
}

/** GitHub's busy view, or null when `gh` cannot read it. */
function readBusyView(slug: string): BusyView {
    const r = sh([
        "gh",
        "api",
        "--paginate",
        `repos/${slug}/actions/runners`,
        "--jq",
        '.runners[] | "\\(.name)\\t\\(.busy)"',
    ]);
    if (r.status !== 0) {
        console.error(
            `runner: GitHub's busy view is unreadable: ${r.stderr.trim()}`
        );
        return null;
    }
    return parseBusyView(r.stdout);
}

function observe(
    platform: RunnerPlatform,
    uid: number,
    names: string[],
    busy: BusyView = null
): ObservedMachine {
    const installed = existsSync(RUNNER_ROOT)
        ? readdirSync(RUNNER_ROOT).filter((n) =>
              existsSync(join(RUNNER_ROOT, n, ".runner"))
          )
        : [];
    const systemdTemplateText =
        platform === "linux"
            ? readOrNull(join(SYSTEMD_USER, SYSTEMD_RUNNER_TEMPLATE))
            : null;
    const runners: Record<string, ObservedRunner> = {};
    for (const name of new Set([...names, ...installed])) {
        const dir = join(RUNNER_ROOT, name);
        runners[name] = {
            extracted: existsSync(join(dir, "config.sh")),
            registered: existsSync(join(dir, ".runner")),
            envText: readOrNull(join(dir, ".env")),
            paused: existsSync(join(dir, PAUSED_MARKER)),
            restartPending: existsSync(join(dir, RESTART_PENDING_MARKER)),
            unitText:
                platform === "darwin"
                    ? readOrNull(
                          join(
                              LAUNCH_AGENTS,
                              `${launchdRunnerLabel(name)}.plist`
                          )
                      )
                    : systemdTemplateText,
            running: serviceRunning(platform, uid, name),
        };
    }
    return {
        runners,
        installed,
        systemdTemplateText,
        convexText:
            platform === "darwin"
                ? readOrNull(
                      join(LAUNCH_AGENTS, `${LAUNCHD_CONVEX_LABEL}.plist`)
                  )
                : null,
        convexRunning:
            platform === "darwin" &&
            sh(["launchctl", "print", `gui/${uid}/${LAUNCHD_CONVEX_LABEL}`])
                .status === 0,
        machineText: readOrNull(MACHINE_FILE),
        busy,
        linger:
            platform === "darwin" ||
            sh([
                "loginctl",
                "show-user",
                process.env.USER ?? "",
                "-p",
                "Linger",
                "--value",
            ]).stdout.trim() === "yes",
    };
}

/** Stop and delete the installed units whose script left the checkout —
 *  never one the same plan rewrites (`rewritten`: its fresh text runs the
 *  live script). */
function planPrune(
    platform: RunnerPlatform,
    uid: number,
    rewritten: Step[] = []
): Step[] {
    const written = new Set(
        rewritten.flatMap((s) => (s.kind === "write" ? [s.path] : []))
    );
    const units = readInstalledUnits(platform, {
        systemdUserDir: SYSTEMD_USER,
        launchAgentsDir: LAUNCH_AGENTS,
    }).filter((u) => !written.has(u.path));
    return planPruneStale(staleUnits(units, existsSync), platform, uid);
}

function repoSlug(repo: string): string {
    const url =
        sh(["git", "-C", repo, "remote", "get-url", "origin"]).stdout ?? "";
    return (
        parseGithubSlug(url) ??
        die(`origin is not a GitHub remote: ${url.trim() || "(none)"}`)
    );
}

/** Runs a plan. Tokens and the tarball are fetched only when a step needs
 *  them, so a plan with nothing to register never calls the API. */
function execute(steps: Step[], platform: RunnerPlatform, slug: string): void {
    let tarball: string | null = null;
    const tokens = new Map<string, string>();
    const token = (kind: "registration" | "remove") => {
        if (!tokens.has(kind)) {
            const r = sh([
                "gh",
                "api",
                "-X",
                "POST",
                `repos/${slug}/actions/runners/${kind}-token`,
                "--jq",
                ".token",
            ]);
            if (r.status !== 0)
                die(
                    `could not get a ${kind} token (admin on ${slug} needed): ${r.stderr.trim()}`
                );
            tokens.set(kind, r.stdout.trim());
        }
        return tokens.get(kind)!;
    };
    for (const s of steps) {
        console.log(describeStep(s));
        switch (s.kind) {
            case "note":
            case "defer":
                break;
            case "mkdir":
                mkdirSync(s.path, { recursive: true });
                break;
            case "remove":
                rmSync(s.path, { recursive: true, force: true });
                break;
            case "write":
                mkdirSync(dirname(s.path), { recursive: true });
                writeFileSync(s.path, s.content);
                break;
            case "download": {
                const tag = sh([
                    "gh",
                    "api",
                    "repos/actions/runner/releases/latest",
                    "--jq",
                    ".tag_name",
                ]);
                if (tag.status !== 0)
                    die(
                        `could not read the latest runner release: ${tag.stderr.trim()}`
                    );
                const asset = runnerAsset(platform, arch(), tag.stdout.trim());
                tarball = join(CACHE_DIR, asset);
                if (!existsSync(tarball)) {
                    mkdirSync(CACHE_DIR, { recursive: true });
                    const url = `https://github.com/actions/runner/releases/download/${tag.stdout.trim()}/${asset}`;
                    const r = spawnSync(
                        "curl",
                        ["-fsSL", "-o", `${tarball}.part`, url],
                        { stdio: "inherit" }
                    );
                    if (r.status !== 0) die(`download failed: ${url}`);
                    renameSync(`${tarball}.part`, tarball);
                }
                break;
            }
            case "run": {
                const argv = s.argv.map((a) =>
                    a === TOKEN_PLACEHOLDER
                        ? token("registration")
                        : a === REMOVE_TOKEN_PLACEHOLDER
                          ? token("remove")
                          : a === TARBALL_PLACEHOLDER
                            ? (tarball ?? die("no runner tarball fetched"))
                            : a
                );
                const attempt = () =>
                    spawnSync(argv[0], argv.slice(1), {
                        cwd: s.cwd,
                        stdio: "inherit",
                    });
                let r = attempt();
                for (let i = 0; s.retry && r.status !== 0 && i < 10; i++) {
                    Bun.sleepSync(1000);
                    r = attempt();
                }
                if (r.status !== 0 && !s.okFail) {
                    die(
                        `step failed (exit ${r.status ?? r.error?.message}): ${s.argv.join(" ")}`
                    );
                }
                break;
            }
        }
    }
}

function parseFlags(args: string[]): {
    flags: Map<string, string>;
    positional: string[];
} {
    const flags = new Map<string, string>();
    const positional: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (!a.startsWith("--")) {
            positional.push(a);
        } else if (
            ["--dry-run", "--no-convex", "--force-restart"].includes(a)
        ) {
            flags.set(a.slice(2), "");
        } else {
            flags.set(a.slice(2), args[++i] ?? die(`${a} needs a value`));
        }
    }
    return { flags, positional };
}

function count(
    flags: Map<string, string>,
    role: keyof RoleCounts,
    d: number
): number {
    const v = flags.get(role);
    if (v === undefined) return d;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0)
        die(`--${role} must be a non-negative integer, got ${v}`);
    return n;
}

function main(): void {
    const [verb, ...rest] = process.argv.slice(2);
    const { flags, positional } = parseFlags(rest);
    const platform = hostPlatform();
    const uid = process.getuid?.() ?? 0;
    const repo = primaryCheckout();
    const slug = repoSlug(repo);
    const dryRun = flags.has("dry-run");
    const forceRestart = flags.has("force-restart");
    const run = (steps: Step[]) => {
        const deferred = steps.filter((s) => s.kind === "defer").length;
        if (steps.every((s) => s.kind === "note" || s.kind === "defer")) {
            for (const s of steps) console.log(describeStep(s));
            if (deferred === 0)
                console.log(
                    "runner: nothing to do — this machine already matches"
                );
        } else if (dryRun) {
            console.log(
                `runner: --dry-run — ${steps.length} step(s), nothing executed:`
            );
            for (const s of steps) console.log(`  ${describeStep(s)}`);
        } else {
            execute(steps, platform, slug);
        }
        // A deferral is unfinished work: exit 1 so it is not missed. A
        // dry run executes nothing, so it only shows it.
        if (deferred > 0 && !dryRun) {
            die(
                `${deferred} runner(s) not stopped — busy, or GitHub unreadable; re-run when idle`
            );
        }
    };

    switch (verb) {
        case "install": {
            // Flags override what machine.json remembers; it overrides the
            // defaults — so a bare re-run declares the same runners.
            const kept = parseDeclaration(readOrNull(MACHINE_FILE));
            const host = sanitizeHost(
                flags.get("host") ?? kept?.host ?? hostname()
            );
            if (!host) die("empty host name — pass --host <name>");
            const d = kept?.counts ?? defaultCounts(platform);
            const counts = {
                pass: count(flags, "pass", d.pass),
                lane: count(flags, "lane", d.lane),
                seed: count(flags, "seed", d.seed),
            };
            const runners = runnerSpecs(host, counts, RUNNER_ROOT);
            const seen = observe(
                platform,
                uid,
                runners.map((r) => r.name),
                readBusyView(slug)
            );
            let plists: Record<string, string> = {};
            let convexPlist: string | null = null;
            let systemdTemplate: string | null = null;
            try {
                if (platform === "darwin") {
                    const subs = {
                        repo,
                        bun: which("bun"),
                        nodeBin: dirname(which("node")),
                        home: HOME,
                    };
                    const tpl = readFileSync(
                        join(UNITS, "com.tolaria.gh-runner.plist"),
                        "utf8"
                    );
                    plists = Object.fromEntries(
                        runners.map((r) => [
                            r.name,
                            renderRunnerPlist(tpl, r, subs),
                        ])
                    );
                    if (!flags.has("no-convex")) {
                        convexPlist = renderLaunchdUnit(
                            readFileSync(
                                join(UNITS, "com.tolaria.convex.plist"),
                                "utf8"
                            ),
                            subs
                        );
                    }
                } else {
                    systemdTemplate = renderRunnerSystemdTemplate(
                        readFileSync(
                            join(UNITS, SYSTEMD_RUNNER_TEMPLATE),
                            "utf8"
                        ),
                        RUNNER_ROOT,
                        systemdRunnerPath(HOME, dirname(which("node"))),
                        repo,
                        undefined,
                        runners.some((r) => r.role === "pass")
                    );
                }
            } catch (e) {
                die((e as Error).message);
            }
            console.log(
                `runner: ${host} (${platform}) declares ${runners.map((r) => r.name).join(", ") || "no runner"} on ${slug}`
            );
            const installSteps = planInstall(
                {
                    platform,
                    uid,
                    slug,
                    runners,
                    plists,
                    systemdTemplate,
                    convexPlist,
                    launchAgentsDir: LAUNCH_AGENTS,
                    systemdUserDir: SYSTEMD_USER,
                    logDir: LOG_DIR,
                    convexLogDir: CONVEX_LOG_DIR,
                    machineFile: {
                        path: MACHINE_FILE,
                        content: serializeDeclaration({ host, counts }),
                    },
                    notifyCmd: process.env.TOLARIA_NOTIFY_CMD,
                    forceRestart,
                },
                seen
            );
            run([...installSteps, ...planPrune(platform, uid, installSteps)]);
            break;
        }
        case "prune":
            run(planPrune(platform, uid));
            break;
        case "pause":
        case "resume":
            run(
                planToggle(
                    verb,
                    platform,
                    uid,
                    LAUNCH_AGENTS,
                    RUNNER_ROOT,
                    observe(platform, uid, [])
                )
            );
            break;
        case "remove": {
            const name =
                positional[0] ?? die("usage: bun run runner remove <name>");
            run(
                planRemove(
                    name,
                    platform,
                    uid,
                    LAUNCH_AGENTS,
                    RUNNER_ROOT,
                    observe(platform, uid, [name], readBusyView(slug)),
                    forceRestart
                )
            );
            break;
        }
        case "status": {
            const seen = observe(platform, uid, []);
            if (seen.installed.length === 0)
                console.log("runner: no runner installed on this machine");
            for (const name of seen.installed) {
                const s = seen.runners[name];
                console.log(
                    `${name}\t${s.paused ? "paused" : s.running ? "running" : "STOPPED"}`
                );
            }
            if (platform === "darwin" && seen.convexText !== null) {
                console.log(
                    `${LAUNCHD_CONVEX_LABEL}\t${seen.convexRunning ? "running" : "STOPPED"}`
                );
            }
            const gh = sh([
                "gh",
                "api",
                `repos/${slug}/actions/runners`,
                "--jq",
                '.runners[] | "\\(.name)\\t\\(.status)\\t\\(if .busy then "busy" else "idle" end)\\t\\([.labels[].name] | join(","))"',
            ]);
            console.log(`\nGitHub (${slug}):`);
            console.log(
                gh.status === 0
                    ? gh.stdout.trim() || "(no runner registered)"
                    : `(unreadable: ${gh.stderr.trim()})`
            );
            break;
        }
        default:
            die(
                "usage: bun run runner <install|pause|resume|status|remove|prune> [--dry-run] — docs/guides/github-pipeline.md"
            );
    }
}

main();
