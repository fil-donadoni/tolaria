/**
 * A stand-in `gh` for tests that drive a script as a SUBPROCESS against a
 * fixture repository: the health verdict store speaks to GitHub commit
 * statuses (issue #5655 removed its local-file backend), and a fixture has no
 * GitHub to talk to. In-process tests inject a `GhRunner` instead
 * (`health-pivot.test.ts`); this is the same fake, behind a `gh` executable
 * whose state lives in one JSON file the test reads and seeds.
 *
 * `fakeGh(dir)` writes `dir/bin/gh` and returns the env that puts it first on
 * PATH and names the repository (`GH_REPO`). The commit history a lineage read
 * walks is the fixture's own: `git rev-list` of the ref the query names,
 * run in the caller's cwd.
 */
import { spawnSync } from "node:child_process";
import {
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { GhRunner } from "../lib/health-verdict-store";

export interface FakeStatus {
    state: string;
    context: string;
    description: string;
    created_at: string;
    target_url?: string | null;
}

interface State {
    /** The base history, newest first; absent: `git rev-list` in the cwd. */
    commits?: string[];
    /** Statuses per sha, newest first. */
    statuses: Record<string, FakeStatus[]>;
    /** Commit comments per sha, oldest first. */
    comments: Record<string, { body: string; html_url: string }[]>;
}

const REPO = "owner/name";

export interface FakeGh {
    /** Env to merge into a spawn: the fake first on PATH, the repo named.
     *  `FAKE_GH_BIN` is the directory alone, for a harness that owns PATH. */
    env: Record<string, string>;
    /** Put a status on `sha`, newest. `created_at` defaults to now. */
    seed(
        sha: string,
        s: Omit<FakeStatus, "created_at"> & { created_at?: string }
    ): void;
    /** `env` without PATH, for a harness that owns PATH and reaches the fake
     *  through `FAKE_GH_BIN`. */
    envNoPath: Record<string, string>;
    /** Name the base history (newest first) when the cwd is no repository. */
    setHistory(shas: string[]): void;
    statuses(sha: string): FakeStatus[];
    comments(sha: string): string[];
    /** The same fake as a `GhRunner`, for the store functions that take one. */
    run: GhRunner;
}

const readState = (path: string): State =>
    existsSync(path)
        ? (JSON.parse(readFileSync(path, "utf8")) as State)
        : { statuses: {}, comments: {} };

export function fakeGh(dir: string): FakeGh {
    mkdirSync(join(dir, "bin"), { recursive: true });
    const state = join(dir, "gh-state.json");
    const bin = join(dir, "bin", "gh");
    writeFileSync(
        bin,
        `#!/bin/sh\nexec bun ${JSON.stringify(resolve(__filename))} "$@"\n`
    );
    chmodSync(bin, 0o755);
    const env = {
        PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
        GH_REPO: REPO,
        FAKE_GH_STATE: state,
        FAKE_GH_BIN: join(dir, "bin"),
    };
    return {
        env,
        envNoPath: Object.fromEntries(
            Object.entries(env).filter(([k]) => k !== "PATH")
        ),
        run(args) {
            const r = spawnSync(bin, args, {
                encoding: "utf8",
                env: { ...process.env, ...env },
            });
            return {
                status: r.status,
                stdout: r.stdout ?? "",
                stderr: r.stderr ?? "",
            };
        },
        seed(sha, s) {
            const st = readState(state);
            st.statuses[sha] = [
                { created_at: new Date().toISOString(), ...s },
                ...(st.statuses[sha] ?? []),
            ];
            writeFileSync(state, JSON.stringify(st));
        },
        setHistory(shas) {
            writeFileSync(
                state,
                JSON.stringify({ ...readState(state), commits: shas })
            );
        },
        statuses: (sha) => readState(state).statuses[sha] ?? [],
        comments: (sha) =>
            (readState(state).comments[sha] ?? []).map((c) => c.body),
    };
}

/** `gh api …` as the verdict store issues it. */
function main(argv: string[]): number {
    const path = process.env.FAKE_GH_STATE;
    if (!path || argv[0] !== "api") {
        console.error(`fake gh: unsupported: ${argv.join(" ")}`);
        return 1;
    }
    const st = readState(path);
    const args = argv.slice(1);
    const field = (flag: string, k: string) => {
        for (let i = 0; i < args.length - 1; i++)
            if (args[i] === flag && args[i + 1].startsWith(`${k}=`))
                return args[i + 1].slice(k.length + 1);
        return "";
    };
    const joined = args.join(" ");
    if (args[0] === "graphql") {
        const ref = field("-F", "ref");
        const n = field("-F", "n") || "60";
        const ctx = /context\(name:"([a-z-]+)"\)/.exec(joined)?.[1];
        const log = (r: string) =>
            spawnSync("git", ["rev-list", "-n", n, r], { encoding: "utf8" });
        let rev = log(ref);
        if (rev.status !== 0)
            rev = log(ref.replace("refs/heads/", "refs/remotes/origin/"));
        const commits =
            st.commits ??
            (rev.status === 0 ? rev.stdout.split("\n").filter(Boolean) : []);
        const nodes = commits.map((oid) => {
            const s = (st.statuses[oid] ?? []).find((x) => x.context === ctx);
            return {
                oid,
                status: s
                    ? {
                          context: {
                              state: s.state,
                              description: s.description,
                              targetUrl: s.target_url ?? null,
                              createdAt: s.created_at,
                          },
                      }
                    : null,
            };
        });
        console.log(
            JSON.stringify({
                data: {
                    repository: { ref: { target: { history: { nodes } } } },
                },
            })
        );
        return 0;
    }
    const post = args.includes("POST");
    const target = args.find((a) => a.startsWith("repos/")) ?? "";
    const status = /statuses\/([0-9a-f]{40})$/.exec(target);
    if (post && status) {
        const sha = status[1];
        st.statuses[sha] = [
            {
                state: field("-f", "state"),
                context: field("-f", "context"),
                description: field("-f", "description"),
                created_at: new Date().toISOString(),
                target_url: field("-f", "target_url") || null,
            },
            ...(st.statuses[sha] ?? []),
        ];
        writeFileSync(path, JSON.stringify(st));
        console.log("{}");
        return 0;
    }
    const list = /commits\/([0-9a-f]{40})\/statuses/.exec(target);
    if (list) {
        console.log(
            JSON.stringify(
                (st.statuses[list[1]] ?? []).map((s) => ({
                    ...s,
                    target_url: s.target_url ?? null,
                }))
            )
        );
        return 0;
    }
    const comment = /commits\/([0-9a-f]{40})\/comments/.exec(target);
    if (comment) {
        const sha = comment[1];
        if (post) {
            const c = {
                body: field("-f", "body"),
                html_url: `https://github.com/${REPO}/commit/${sha}#commitcomment-${(st.comments[sha]?.length ?? 0) + 1}`,
            };
            st.comments[sha] = [...(st.comments[sha] ?? []), c];
            writeFileSync(path, JSON.stringify(st));
            console.log(c.html_url);
        } else console.log(JSON.stringify(st.comments[sha] ?? []));
        return 0;
    }
    console.error(`fake gh: unsupported: ${argv.join(" ")}`);
    return 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
