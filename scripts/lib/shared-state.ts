/**
 * Pipeline state every runner reads and writes (issue #5873): a JSON document
 * per key, each held by its OWN git ref on origin, `refs/tolaria/state/<key>`.
 *
 * WHY A REF. `housekeeping` kept its watermark and retry list in a file under
 * the primary checkout of the machine that ran it, so the job was pinned to
 * that machine (`host:huawei`) and a second runner could not resume its
 * batch. A ref on origin is read and written with the credential every job
 * already pushes the base branch with — no new token, no new service — and
 * `git push --force-with-lease` gives the compare-and-swap a watermark needs:
 * a writer that read sha A and finds sha B on the remote is refused and
 * re-reads. The verdict store (a commit status) is keyed by sha, the wrong
 * shape for a watermark; a repository variable needs an admin token.
 *
 * WHY ONE REF PER KEY. A lease is taken on a ref, so two keys under one ref
 * would refuse each other's writes: a six-hour nightly would lose its record
 * to every hourly housekeeping write in between (review of PR #5905). Each
 * key's ref points at a PARENTLESS commit whose tree holds that key's
 * `<key>.json` alone: every write is a fresh root commit, the ref carries no
 * history, the objects behind it are garbage once overwritten. A missing ref
 * is an empty store (first run), never an error; an origin that does not
 * answer, or a ref whose tree lacks its document, IS an error — the caller
 * decides what an unreadable store means.
 *
 * Node builtins only, like the verdict store: `housekeeping` and
 * `health-nightly` import this.
 */
import { spawnSync } from "node:child_process";

export const SHARED_STATE_NAMESPACE = "refs/tolaria/state";

/** The identity of a state commit — nobody reads it; set so `commit-tree`
 *  works on a runner whose service has no git identity. */
const COMMIT_ENV = {
    GIT_AUTHOR_NAME: "tolaria-pipeline",
    GIT_AUTHOR_EMAIL: "pipeline@tolaria.invalid",
    GIT_COMMITTER_NAME: "tolaria-pipeline",
    GIT_COMMITTER_EMAIL: "pipeline@tolaria.invalid",
};

export interface GitResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

/** Runs `git <args>` in `cwd`; injectable so tests can watch the calls. */
export type GitRunner = (
    args: string[],
    opts: { cwd: string; input?: string; env?: NodeJS.ProcessEnv }
) => GitResult;

export const realGit: GitRunner = (args, { cwd, input, env }) => {
    const r = spawnSync("git", args, {
        cwd,
        input,
        encoding: "utf8",
        env: env === undefined ? process.env : { ...process.env, ...env },
    });
    return {
        status: r.status,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? "",
    };
};

/** What a read returns: the ref's commit (the write's lease) and the key's
 *  raw document, both null when the key has never been written. */
export interface SharedRead {
    sha: string | null;
    raw: string | null;
}

export class SharedStateConflict extends Error {
    constructor(key: string, expected: string | null) {
        super(
            `shared state '${key}': ${stateRef(key)} moved since it was read (expected ${expected ?? "no ref"}) — re-read and retry`
        );
        this.name = "SharedStateConflict";
    }
}

/** A key is a plain slug: it names a ref and a file. */
function checkKey(key: string): void {
    if (!/^[a-z][a-z0-9-]*$/.test(key))
        throw new Error(`shared state key '${key}' is not [a-z][a-z0-9-]*`);
}

/** `refs/tolaria/state/<key>`: the one ref a key owns. Pure. */
export function stateRef(key: string): string {
    checkKey(key);
    return `${SHARED_STATE_NAMESPACE}/${key}`;
}

/** `<key>.json`: the one tree entry a key's commit holds. Pure. */
export function entryName(key: string): string {
    checkKey(key);
    return `${key}.json`;
}

/**
 * The `git mktree` input for a tree that holds `lsTree`'s entries (the
 * current tree, `git ls-tree` output) with `name` set to `blobSha` — added
 * when absent, replaced when present, every other entry kept. Pure.
 */
export function treeWith(
    lsTree: string,
    name: string,
    blobSha: string
): string {
    const lines = lsTree
        .split("\n")
        .filter((l) => l !== "" && !l.endsWith(`\t${name}`));
    lines.push(`100644 blob ${blobSha}\t${name}`);
    return `${lines.join("\n")}\n`;
}

/** The `--force-with-lease` value a write carries: the sha it read, or
 *  "the ref must not exist yet". Pure. */
export function leaseArg(key: string, expected: string | null): string {
    return `--force-with-lease=${stateRef(key)}:${expected ?? ""}`;
}

/** Whether a failed push's stderr is the lease refusing a moved ref (a
 *  conflict to retry) rather than an origin that did not answer. Pure. */
export function isLeaseRejection(stderr: string): boolean {
    return /stale info|\[rejected\]/.test(stderr);
}

function must(r: GitResult, what: string): string {
    if (r.status !== 0)
        throw new Error(`shared state: ${what} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
}

/**
 * Read `key` from origin: one `ls-remote` (no ref = never written), then a
 * fetch of the ref and a `cat-file` of ITS tip as fetched — the sha the
 * lease is taken on is the one whose document was read, whatever moved
 * between the two calls. Throws when origin does not answer or the ref's
 * tree lacks the document.
 */
export function readSharedState(
    root: string,
    key: string,
    git: GitRunner = realGit
): SharedRead {
    const ref = stateRef(key);
    // `--exit-code`: 2 = origin answered and holds no such ref (never
    // written); anything else non-zero = origin did not answer.
    const remote = git(["ls-remote", "--exit-code", "origin", ref], {
        cwd: root,
    });
    if (remote.status === 2) return { sha: null, raw: null };
    must(remote, "ls-remote origin");
    must(
        git(
            [
                "fetch",
                "--no-tags",
                "--no-write-fetch-head",
                "--quiet",
                "origin",
                `+${ref}:${ref}`,
            ],
            { cwd: root }
        ),
        `fetch ${ref}`
    );
    const sha = must(
        git(["rev-parse", `${ref}^{commit}`], { cwd: root }),
        `rev-parse ${ref}`
    );
    const blob = git(["cat-file", "-p", `${sha}:${entryName(key)}`], {
        cwd: root,
    });
    if (blob.status !== 0)
        throw new Error(
            `shared state: ${ref} at ${sha} holds no ${entryName(key)}: ${blob.stderr.trim()}`
        );
    return { sha, raw: blob.stdout };
}

/**
 * Write `raw` under `key`, provided its ref still is `expected` (the sha the
 * caller read; null = never written). Returns the new ref sha. Throws
 * `SharedStateConflict` when the lease refused the push, a plain Error when
 * git or origin failed.
 */
export function writeSharedState(
    root: string,
    key: string,
    raw: string,
    expected: string | null,
    git: GitRunner = realGit
): string {
    const ref = stateRef(key);
    const name = entryName(key);
    const blob = must(
        git(["hash-object", "-w", "--stdin"], { cwd: root, input: raw }),
        "hash-object"
    );
    const tree = must(
        git(["mktree"], { cwd: root, input: treeWith("", name, blob) }),
        "mktree"
    );
    const commit = must(
        git(["commit-tree", tree, "-m", `tolaria shared state: ${key}`], {
            cwd: root,
            env: COMMIT_ENV,
        }),
        "commit-tree"
    );
    // `--no-verify`: the ref is state, not code — the pre-push formatting
    // hook has nothing to check and must not delay or refuse a write.
    const push = git(
        [
            "push",
            "--quiet",
            "--no-verify",
            leaseArg(key, expected),
            "origin",
            `${commit}:${ref}`,
        ],
        { cwd: root }
    );
    if (push.status !== 0) {
        if (isLeaseRejection(push.stderr))
            throw new SharedStateConflict(key, expected);
        throw new Error(
            `shared state: push of ${ref} failed: ${push.stderr.trim()}`
        );
    }
    git(["update-ref", ref, commit], { cwd: root });
    return commit;
}
