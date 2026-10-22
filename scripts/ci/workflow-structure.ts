/**
 * The structure guard over `.github/` and `.mergify.yml` (ADR 0156 §8 and
 * Amendment I, issue #5636): a pure check that returns one line per broken
 * invariant, pinned by `scripts/__tests__/workflow-structure.test.ts`.
 *
 * WHY A GUARD. The repository is public and its jobs run on the owner's
 * machines. A workflow file is a security boundary written in YAML, and every
 * slice of PRD #5620 adds one; the invariants below are the ones a single
 * careless line breaks silently — GitHub runs the broken workflow without a
 * word. Each rule fails CLOSED: a `runs-on` the guard cannot read is a
 * self-hosted one, an unknown trigger is an outsider's.
 *
 * Rules (the `rule` id each violation line carries):
 *   - `outsider-reaches-self-hosted` — a self-hosted job in a workflow an
 *     outsider can trigger. Safe triggers: `schedule`, `workflow_dispatch`,
 *     `push` with a `branches:` filter that cannot match Dependabot's
 *     branches, and `issues` limited to `labeled`/`unlabeled` (only a
 *     collaborator labels). Everything else — `pull_request`,
 *     `pull_request_target`, `issue_comment`, `discussion`, `workflow_run`,
 *     an `issues` open, an unfiltered `push` — is not. Only a single
 *     spelled-out hosted image (`ubuntu-24.04`) counts as GitHub-hosted.
 *   - `pr-target-head-checkout` — a `pull_request_target` job that checks out
 *     anything but the base (`ref:`/`repository:` set) or fetches the PR head
 *     (it runs with the base's token; the head is the outsider's code).
 *   - `unpinned-uses` — a `uses:` not pinned to a full 40-hex commit SHA
 *     (local `./` actions excepted; `docker://` refused outright — no Docker).
 *   - `reusable-call` — a job-level `uses:`: the guard cannot see the callee's
 *     runner, so it is refused until a slice needs one and extends the guard.
 *   - `no-timeout` — a job without a positive `timeout-minutes`.
 *   - `no-toolchain` — a job with a `run:` step that does not go through the
 *     shared job setup (`./.github/actions/job-setup`) first.
 *   - `concurrency-group` — a `concurrency` key on a self-hosted job or on a
 *     workflow holding one: a group keeps one pending job and CANCELS the
 *     older pending one; heavy work is serialised by runner labels. The
 *     exceptions are the `SERIALISED_DISPATCHERS`, `SERIALISED_JOBS` and
 *     `SUPERSEDED_JOBS` below.
 *   - `dispatcher-serialised` — a job of a `SERIALISED_DISPATCHERS` workflow,
 *     or a `SERIALISED_JOBS` job, without a JOB-level
 *     `concurrency: { group, cancel-in-progress: false }`. The dispatcher
 *     claims issues: two runs at once could claim one issue twice; a shared
 *     post-merge duty (`housekeeping`, `nightly`) runs on any machine and two
 *     at once would move one watermark twice. A dropped pending run loses nothing in either case — the next
 *     run re-reads every fact — so the group's cancel is harmless there; job
 *     level, so a run whose job is skipped (a label event that is not
 *     `ready-for-agent`, a push that fires no nightly) never displaces a
 *     pending one.
 *   - `queue-superseded` — a `SUPERSEDED_JOBS` job without exactly
 *     `concurrency: { group: SUPERSEDED_GROUP, cancel-in-progress: true }`.
 *     Mergify re-creates a PR's draft on a new branch and
 *     deletes the old one; without the group the old draft's lane keeps a
 *     `lane` runner the live draft waits for. The group is keyed by the PR
 *     the draft checks (its head commit, `Merge of #N`, batch size 1), the
 *     sha its fallback so a missing message never groups two PRs.
 *   - `host-pinned` — a self-hosted job whose `runs-on` names ONE machine by
 *     a literal `host:<name>` label: that machine offline or
 *     broken holds the job for 24 h, then fails it. A per-machine duty is a
 *     matrix over the hosts (`host:${{ matrix.host }}`) or an input; a shared
 *     duty names no host at all.
 *   - `self-hosted-clone` — `actions/checkout` on a self-hosted job: a job on
 *     the owner's machines works in a worktree of the primary checkout.
 *   - `job-worktree` — a self-hosted job whose first step does not create the
 *     job worktree or whose last step does not remove it `if: always()`,
 *     either one not under `shell: bash` (pipefail).
 *   - `claude-raw-output` — a `run:` line invoking `claude` that is not one
 *     `scripts/ci/run-quiet.sh` call (the public log must not carry a
 *     transcript); a `claude-code` action is refused as `unpinned-uses`.
 *   - `local-action-unscanned` — a `uses: ./…` the guard does not read.
 *   - `job-setup-contract` — the shared job setup lost its token mask or a
 *     pinned toolchain step, or nests an action (whose post step would run
 *     after the job worktree is removed).
 *   - `corpus-exclusion-gating` — `TOLARIA_HOSTED_NO_VERDICT_CORPUS` (the
 *     hosted advisory lane's one recorded test exclusion) named
 *     in a workflow holding a self-hosted job, or in a shared action: a lane
 *     on the owner's machines gates, and a gate never skips the corpus.
 *   - `queue-entry` — a `.mergify.yml` queue rule whose entry conditions do not
 *     require `ready-to-land`, no `land-failed`, no red advisory lane,
 *     `trusted-author`, `base-health` and the exclusion of `.github/`
 *     and `.mergify.yml` (ADR 0156 §8 barriers 3–4); one that still requires
 *     a marker label such as `merge:manual` (the queue admits by status, not by label); or an advisory
 *     lane job that runs on the queue's drafts.
 *   - `queue-merge` — a queue rule whose merge conditions are anything but
 *     the queue lane alone (Amendment I: the entry gates were proven on the
 *     PR, and `pr-gate` posts both green on Mergify's draft).
 *   - `queue-shape` — `merge_queue.max_parallel_checks` other than 2, or a
 *     queue rule with a `batch_size` other than 1 (ADR 0156 §3).
 *   - `queue-dequeue` — no `pull_request_rules` entry relabelling a PR the
 *     queue dequeued on `checks-failed`/`checks-timeout` from `ready-to-land`
 *     to `land-failed` with a comment carrying a link: the label is the
 *     repair pick's trigger, and `-label=land-failed` keeps the PR out. The
 *     rule must also carry a top-level `-check-failure=base-health`: a
 *     dequeue under a RED is a hold, not a repair pick.
 *   - `queue-refusal-hold` — a `pull_request_rules` entry that adds
 *     `land-failed` without the same top-level hold exemption, or no entry
 *     labelling `queue:held` a PR whose advisory lane is red while
 *     `base-health` is red. A RED reds every PR's lane (the lane tests the
 *     PR merged with the broken base): that red is the base's, so it holds
 *     the PR; `pr-refresh` rebases it on the next base push (a fresh lane) and
 *     `pr-gate`'s GREEN requeues it.
 *   - `derived-role` — a `check:lane` run in a job that tests a PR merged
 *     with the base (the job posting the advisory lane, a `DRAFT_LANE_JOBS`
 *     job) without `--regenerate-derived`. ADR 0157 keeps the lockfile
 *     header and the catalogue at the merge-base, so such a tree judged in
 *     the `base` role reds every PR touching a lockfile input on header
 *     drift (issue #6338).
 */
import { parse } from "yaml";
import { passRunIssue } from "../lib/afk-dispatch";
import { CORPUS_EXCLUSION_ENV } from "../lib/corpus-exclusion";
import {
    FAILED_LABEL,
    HELD_LABEL,
    READY_LABEL,
    MANUAL_LABEL,
} from "../lib/land-labels";

export interface SourceFile {
    path: string;
    text: string;
}

export interface StructureInput {
    workflows: SourceFile[];
    /** `.github/actions/<name>/action.yml` files. */
    actions: SourceFile[];
    /** `.mergify.yml`, or null when the repository has none. */
    mergify: SourceFile | null;
}

export type RuleId =
    | "outsider-reaches-self-hosted"
    | "pr-target-head-checkout"
    | "unpinned-uses"
    | "reusable-call"
    | "no-timeout"
    | "no-toolchain"
    | "concurrency-group"
    | "self-hosted-clone"
    | "job-worktree"
    | "claude-raw-output"
    | "job-setup-contract"
    | "queue-entry"
    | "queue-merge"
    | "queue-shape"
    | "queue-dequeue"
    | "queue-refusal-hold"
    | "derived-role"
    | "corpus-exclusion-gating"
    | "dispatcher-serialised"
    | "queue-superseded"
    | "host-pinned"
    | "pass-run-name"
    | "owner-merge-trigger"
    | "local-action-unscanned"
    | "unparseable";

export interface Violation {
    file: string;
    /** The job id, or null for a workflow- or file-level violation. */
    job: string | null;
    rule: RuleId;
    message: string;
}

export const JOB_SETUP = "./.github/actions/job-setup";

/** Workflows whose job must run one at a time, cross-machine, by a job-level
 *  concurrency group (rule `dispatcher-serialised`, issue #5649). */
export const SERIALISED_DISPATCHERS: ReadonlySet<string> = new Set([
    ".github/workflows/afk-dispatch.yml",
    // The RED ladder (issue #5646): two runs at once would both read "no
    // attempt yet" and spawn two fixers, or file the stop's issue twice.
    ".github/workflows/health-fix.yml",
]);

/** Jobs that must run one at a time, cross-machine, by a job-level
 *  concurrency group (issue #5873): `<workflow path>#<job id>`. Each reads
 *  every fact it acts on from shared state at its start, so a dropped
 *  pending run costs nothing; two running at once would act on one
 *  watermark twice. */
export const SERIALISED_JOBS: ReadonlySet<string> = new Set([
    ".github/workflows/post-merge.yml#housekeeping",
    ".github/workflows/post-merge.yml#nightly",
]);

/** Jobs whose newer run makes the older one worthless, RUNNING included
 *  (rule `queue-superseded`, issue #6020): `<workflow path>#<job id>`. */
export const SUPERSEDED_JOBS: ReadonlySet<string> = new Set([
    ".github/workflows/queue-lane.yml#queue-lane",
]);

/** Jobs that run `check:lane` on the queue's draft (rule `derived-role`,
 *  issue #6338): `<workflow path>#<job id>`. The advisory lane is found by
 *  its check name, `ADVISORY_LANE_CHECK`. */
export const DRAFT_LANE_JOBS: ReadonlySet<string> = new Set([
    ".github/workflows/queue-lane.yml#queue-lane",
]);

/** The flag that judges a tree in the queue's `draft` role (ADR 0157). */
export const REGENERATE_DERIVED_FLAG = "--regenerate-derived";
const CHECK_LANE_CALL = /\bcheck:lane(?![\w:-])/;
const LANE_REGENERATES =
    /\bcheck:lane(?![\w:-])[^#]*\s--regenerate-derived(?![\w-])/;

/** The one group a `SUPERSEDED_JOBS` job may declare: the PR behind the
 *  queue's draft, never a branch (each draft is a new one). */
export const SUPERSEDED_GROUP =
    "queue-lane-${{ github.event.head_commit.message || github.sha }}";

/** A `runs-on` label that names one machine: `host:<name>` spelled out. An
 *  expression (`host:${{ matrix.host }}`) is a matrix or an input, not a
 *  pin. */
const HOST_LITERAL = /^host:(?!.*\$\{\{)\S+$/;

/** The `host:` literal a `runs-on` carries, or null. Pure. */
export function pinnedHost(runsOn: unknown): string | null {
    const labels = isObj(runsOn) ? asArray(runsOn.labels) : asArray(runsOn);
    for (const label of labels)
        if (typeof label === "string" && HOST_LITERAL.test(label)) return label;
    return null;
}

/** `{ group: <non-empty>, cancel-in-progress: false }` — serialises without
 *  ever cancelling a RUNNING job (a dispatcher mid-claim). */
function isSerialisingGroup(c: unknown): boolean {
    return (
        isObj(c) &&
        typeof c.group === "string" &&
        c.group.trim() !== "" &&
        c["cancel-in-progress"] === false
    );
}
/** `{ group: SUPERSEDED_GROUP, cancel-in-progress: true }` — the newer
 *  draft of one PR cancels the older one's run, running or pending. */
function isSupersedingGroup(c: unknown): boolean {
    return (
        isObj(c) &&
        c.group === SUPERSEDED_GROUP &&
        c["cancel-in-progress"] === true
    );
}
export const JOB_SETUP_FILE = ".github/actions/job-setup/action.yml";
/** A GitHub-hosted runner image (`ubuntu-24.04`, `macos-15`, …). Anything
 *  else — `self-hosted`, a role label, but also `Linux`, `macOS`, `X64`,
 *  `ARM64`, which every self-hosted runner carries by default and GitHub
 *  matches case-insensitively — reaches the owner's machines. */
const HOSTED_IMAGE = /^(ubuntu|windows|macos)-[a-z0-9.-]+$/i;
const SAFE_TRIGGERS = new Set(["schedule", "workflow_dispatch"]);
const LABEL_ONLY_ISSUE_TYPES = new Set(["labeled", "unlabeled"]);
const PINNED = /^[^@\s]+@[0-9a-f]{40}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
    typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] =>
    Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];

/** The trigger names of a workflow's `on:` and, per trigger, its config. */
function triggers(on: unknown): Map<string, unknown> {
    if (typeof on === "string") return new Map([[on, null]]);
    if (Array.isArray(on)) return new Map(on.map((t) => [String(t), null]));
    if (isObj(on)) return new Map(Object.entries(on));
    return new Map();
}

/** A branch filter that can match a branch someone other than the owner
 *  pushes (Dependabot's `dependabot/**`, or everything). */
const OPEN_BRANCH = /^(\*\*?|dependabot.*)$/;

/** Whether an outsider (no write access) can fire this trigger. An
 *  unfiltered `push` counts: Dependabot pushes its branches INTO the
 *  repository and its bumped dependencies install on the runner. */
function outsiderCanFire(name: string, config: unknown): boolean {
    if (name === "push") {
        const branches = isObj(config) ? asArray(config.branches) : [];
        return (
            branches.length === 0 ||
            branches.some((b) => OPEN_BRANCH.test(String(b)))
        );
    }
    if (SAFE_TRIGGERS.has(name)) return false;
    if (name === "issues" && isObj(config)) {
        const types = asArray(config.types).map(String);
        return (
            types.length === 0 ||
            types.some((t) => !LABEL_ONLY_ISSUE_TYPES.has(t))
        );
    }
    return true;
}

/** Fail-closed: only ONE hosted image name, spelled out, is GitHub-hosted;
 *  an expression, a group, a label list, anything else is ours. */
export function isSelfHosted(runsOn: unknown): boolean {
    if (Array.isArray(runsOn) && runsOn.length === 1)
        return isSelfHosted(runsOn[0]);
    return !(typeof runsOn === "string" && HOSTED_IMAGE.test(runsOn));
}

function stepUses(step: unknown): string | null {
    return isObj(step) && typeof step.uses === "string" ? step.uses : null;
}

function stepRun(step: unknown): string | null {
    return isObj(step) && typeof step.run === "string" ? step.run : null;
}

/** Actions that run Claude themselves, out of `run-quiet.sh`'s reach. */
const CLAUDE_ACTION = /claude-code/i;

function usesViolation(uses: string): string | null {
    if (uses.startsWith("./")) return null;
    if (CLAUDE_ACTION.test(uses))
        return `\`${uses}\`: Claude runs through scripts/ci/run-quiet.sh only`;
    if (uses.startsWith("docker://")) return `\`${uses}\`: no Docker`;
    if (!PINNED.test(uses))
        return `\`${uses}\` is not pinned to a full commit SHA`;
    return null;
}

/** `claude`, `/path/to/claude`, or the npm package. */
const CLAUDE_CALL = /(^|[\s;&|(`/])claude(\s|$)|claude-code/;
const RUN_QUIET = /^scripts\/ci\/run-quiet\.sh\s+[\w.-]+\s+--\s+[^;&|`]*$/;

/** A line that calls Claude must BE one `run-quiet.sh` call: a wrapper
 *  earlier on the line (`run-quiet.sh x -- true; claude …`) does not count. */
function claudeUnwrapped(run: string): string | null {
    for (const raw of run.split("\n")) {
        const line = raw.trim();
        if (line.startsWith("#")) continue;
        if (CLAUDE_CALL.test(line) && !RUN_QUIET.test(line)) return line;
    }
    return null;
}

const HEAD_REF =
    /github\.head_ref|github\.event\.pull_request\.(head|merge_commit_sha)|refs\/pull\/|gh pr checkout|\bpull\/[^\s]*\/(head|merge)/;

function isCheckout(uses: string | null): boolean {
    return uses !== null && uses.split("@")[0] === "actions/checkout";
}

function checkJob(
    file: string,
    id: string,
    job: unknown,
    wf: {
        outsiderTriggers: string[];
        prTarget: boolean;
        localActions: Set<string>;
        dispatcher: boolean;
    },
    out: Violation[]
): boolean {
    const v = (rule: RuleId, message: string) =>
        out.push({ file, job: id, rule, message });
    if (!isObj(job)) {
        v("unparseable", "job is not a mapping");
        return true;
    }
    if (typeof job.uses === "string") {
        v(
            "reusable-call",
            `job-level \`uses: ${job.uses}\` — the callee's runner is invisible to the guard`
        );
        return false;
    }
    const selfHosted = isSelfHosted(job["runs-on"]);
    if (selfHosted && wf.outsiderTriggers.length > 0)
        v(
            "outsider-reaches-self-hosted",
            `self-hosted job reachable from ${wf.outsiderTriggers.join(", ")}`
        );
    const timeout = job["timeout-minutes"];
    if (!(typeof timeout === "number" && timeout > 0))
        v("no-timeout", "no positive `timeout-minutes`");
    const mustSerialise = wf.dispatcher || SERIALISED_JOBS.has(`${file}#${id}`);
    const serialised = mustSerialise && isSerialisingGroup(job.concurrency);
    const mustSupersede = SUPERSEDED_JOBS.has(`${file}#${id}`);
    const supersedes = mustSupersede && isSupersedingGroup(job.concurrency);
    if (
        selfHosted &&
        job.concurrency !== undefined &&
        !serialised &&
        !supersedes
    )
        v("concurrency-group", "self-hosted job declares `concurrency`");
    if (mustSupersede && !supersedes)
        v(
            "queue-superseded",
            `the queue's lane must declare \`concurrency: { group: "${SUPERSEDED_GROUP}", cancel-in-progress: true }\` — a superseded draft's run holds a \`lane\` runner the live draft waits for (issue #6020)`
        );
    if (mustSerialise && !serialised)
        v(
            "dispatcher-serialised",
            wf.dispatcher
                ? "a dispatcher job must declare `concurrency: { group, cancel-in-progress: false }` — two runs at once could claim one issue twice"
                : "a shared post-merge duty must declare `concurrency: { group, cancel-in-progress: false }` — two machines at once would move one watermark twice (issue #5873)"
        );
    const host = selfHosted ? pinnedHost(job["runs-on"]) : null;
    if (host !== null)
        v(
            "host-pinned",
            `\`runs-on\` pins the job to \`${host}\` — that machine offline holds it for 24 h; use a matrix or an input, or no host (issue #5873)`
        );

    const steps = asArray(job.steps);
    // Only a self-hosted job's first and last steps (the job worktree) may
    // run before the toolchain exists.
    const worktreeStep = (i: number) =>
        selfHosted && (i === 0 || i === steps.length - 1);
    const runIdx = steps.findIndex(
        (s, i) => stepRun(s) !== null && !worktreeStep(i)
    );
    const setupIdx = steps.findIndex((s) => stepUses(s) === JOB_SETUP);
    if (runIdx !== -1 && (setupIdx === -1 || setupIdx > runIdx))
        v("no-toolchain", `a \`run:\` step precedes \`uses: ${JOB_SETUP}\``);

    steps.forEach((step, i) => {
        const uses = stepUses(step);
        const run = stepRun(step);
        if (uses) {
            const bad = usesViolation(uses);
            if (bad) v("unpinned-uses", `step ${i + 1}: ${bad}`);
            const local = uses.startsWith("./") ? uses.slice(2) : null;
            if (local && !wf.localActions.has(local.replace(/\/$/, "")))
                v(
                    "local-action-unscanned",
                    `step ${i + 1}: \`${uses}\` is not an action the guard reads (.github/actions/<name>/action.y[a]ml)`
                );
            if (selfHosted && isCheckout(uses))
                v(
                    "self-hosted-clone",
                    `step ${i + 1}: actions/checkout on a self-hosted runner`
                );
            // Any `ref` or `repository` on a pull_request_target checkout
            // can name the head (`head.sha`, `merge_commit_sha`, the fork):
            // the base's own code is the only safe checkout there.
            if (wf.prTarget && isCheckout(uses) && isObj(step)) {
                const w = isObj(step.with) ? step.with : {};
                if (w.ref !== undefined || w.repository !== undefined)
                    v(
                        "pr-target-head-checkout",
                        `step ${i + 1}: checks out \`${String(w.repository ?? "")}${String(w.ref ?? "")}\` instead of the base`
                    );
            }
        }
        if (run) {
            const line = claudeUnwrapped(run);
            if (line)
                v(
                    "claude-raw-output",
                    `step ${i + 1}: \`${line}\` without scripts/ci/run-quiet.sh`
                );
            if (wf.prTarget && HEAD_REF.test(run))
                v(
                    "pr-target-head-checkout",
                    `step ${i + 1}: fetches the PR head`
                );
        }
    });

    if (selfHosted) {
        // `shell: bash` = `bash -eo pipefail`: without it a failed `git show`
        // pipes nothing into `bash -s`, which exits 0.
        const bash = (s: unknown) => isObj(s) && s.shell === "bash";
        const first = steps[0];
        const last = steps[steps.length - 1];
        const lastIf = isObj(last) ? String(last.if ?? "") : "";
        if (
            !/job-worktree\.sh[^\n]*\bcreate\b/.test(stepRun(first) ?? "") ||
            !bash(first)
        )
            v(
                "job-worktree",
                "first step does not create the job worktree under `shell: bash`"
            );
        if (
            steps.length < 2 ||
            !/job-worktree\.sh[^\n]*\bremove\b/.test(stepRun(last) ?? "") ||
            !bash(last) ||
            !lastIf.includes("always()")
        )
            v(
                "job-worktree",
                "last step does not remove the job worktree `if: always()` under `shell: bash`"
            );
    }
    return selfHosted;
}

function checkWorkflow(
    f: SourceFile,
    localActions: Set<string>,
    out: Violation[]
): void {
    let doc: unknown;
    try {
        doc = parse(f.text);
    } catch (e) {
        out.push({
            file: f.path,
            job: null,
            rule: "unparseable",
            message: String(e),
        });
        return;
    }
    if (!isObj(doc) || !isObj(doc.jobs)) {
        out.push({
            file: f.path,
            job: null,
            rule: "unparseable",
            message: "no `jobs:` mapping",
        });
        return;
    }
    const trig = triggers(doc.on);
    const wf = {
        outsiderTriggers: [...trig]
            .filter(([n, c]) => outsiderCanFire(n, c))
            .map(([n]) => n),
        prTarget: trig.has("pull_request_target"),
        localActions,
        dispatcher: SERIALISED_DISPATCHERS.has(f.path),
    };
    let anySelfHosted = false;
    for (const [id, job] of Object.entries(doc.jobs))
        if (checkJob(f.path, id, job, wf, out)) anySelfHosted = true;
    if (anySelfHosted && f.text.includes(CORPUS_EXCLUSION_ENV))
        out.push({
            file: f.path,
            job: null,
            rule: "corpus-exclusion-gating",
            message: `${CORPUS_EXCLUSION_ENV} in a workflow with a self-hosted job — only a hosted advisory lane may skip the corpus tests`,
        });
    if (anySelfHosted && doc.concurrency !== undefined)
        out.push({
            file: f.path,
            job: null,
            rule: "concurrency-group",
            message: "workflow with a self-hosted job declares `concurrency`",
        });
}

function checkAction(f: SourceFile, out: Violation[]): void {
    let doc: unknown;
    try {
        doc = parse(f.text);
    } catch (e) {
        out.push({
            file: f.path,
            job: null,
            rule: "unparseable",
            message: String(e),
        });
        return;
    }
    if (f.text.includes(CORPUS_EXCLUSION_ENV))
        out.push({
            file: f.path,
            job: null,
            rule: "corpus-exclusion-gating",
            message: `${CORPUS_EXCLUSION_ENV} in a shared action — every job, gating ones included, would skip the corpus tests`,
        });
    const steps = isObj(doc) && isObj(doc.runs) ? asArray(doc.runs.steps) : [];
    steps.forEach((step, i) => {
        const uses = stepUses(step);
        const bad = uses ? usesViolation(uses) : null;
        if (bad)
            out.push({
                file: f.path,
                job: null,
                rule: "unpinned-uses",
                message: `step ${i + 1}: ${bad}`,
            });
        const line = claudeUnwrapped(stepRun(step) ?? "");
        if (line)
            out.push({
                file: f.path,
                job: null,
                rule: "claude-raw-output",
                message: `step ${i + 1}: \`${line}\``,
            });
    });
    if (f.path !== JOB_SETUP_FILE) return;
    const contract = (rule: string, ok: boolean) => {
        if (!ok)
            out.push({
                file: f.path,
                job: null,
                rule: "job-setup-contract",
                message: rule,
            });
    };
    const runs = steps.map((s) => stepRun(s) ?? "");
    contract(
        "the first step masks the gh token (`::add-mask::`)",
        runs[0]?.includes("::add-mask::") ?? false
    );
    contract(
        "no nested action (its post step would run after the job worktree is removed)",
        steps.every((s) => stepUses(s) === null)
    );
    contract(
        "node is pinned by `scripts/ci/setup-node.sh` (.nvmrc)",
        runs.some((r) => r.includes("scripts/ci/setup-node.sh"))
    );
    contract(
        "bun is pinned by `scripts/ci/setup-bun.sh`",
        runs.some((r) => r.includes("scripts/ci/setup-bun.sh"))
    );
    contract(
        "the tree is bootstrapped by `bun run worktree:init`",
        runs.some((r) => r.includes("bun run worktree:init"))
    );
}

/** The check run `pr-check`'s lane job posts on a PR's head. */
export const ADVISORY_LANE_CHECK = "check:lane (advisory)";
/** The branch prefix of the Mergify queue's drafts. */
const QUEUE_DRAFT_PREFIX = "mergify/merge-queue/";
/** An `if:` that skips the queue's drafts — negated, so a positive
 *  `startsWith` (run ONLY on drafts) never passes. */
const SKIPS_QUEUE_DRAFTS =
    /!\s*startsWith\(\s*github\.head_ref\s*,\s*'mergify\/merge-queue\/'\s*\)/;

/** Mergify condition strings that must stand at the top level (AND) of
 *  every queue rule's entry conditions. */
const QUEUE_ENTRY: { what: string; re: RegExp }[] = [
    { what: `label=${READY_LABEL}`, re: labelCondition(READY_LABEL) },
    {
        what: `-check-failure=${ADVISORY_LANE_CHECK} (a PR whose own lane is red, issue #5643)`,
        re: /^-check-failure\s*=\s*check:lane \(advisory\)$/,
    },
    {
        what: `-label=${FAILED_LABEL} (a rejected PR re-enters only through a repair)`,
        re: labelCondition(FAILED_LABEL, "-"),
    },
    {
        what: "trusted-author green",
        re: /^(check|status)-success\s*=\s*trusted-author$/,
    },
    {
        what: "base-health green",
        re: /^(check|status)-success\s*=\s*base-health$/,
    },
    {
        what: "no change under .github/",
        re: /^-files\s*~=\s*\^?\\?\.github\/?$/,
    },
    {
        what: "no change to .mergify.yml",
        re: /^-files\s*(=\s*\.mergify\.yml|~=\s*\^?\\?\.mergify\\?\.yml\$?)$/,
    },
];

function labelCondition(label: string, sign = ""): RegExp {
    const escaped = label.replace(/[.*+?^${}()|[\]\\:-]/g, "\\$&");
    return new RegExp(`^${sign === "-" ? "-" : ""}label\\s*=\\s*${escaped}$`);
}

/** The ONE merge condition: the queue's draft owes only the lane. */
const QUEUE_MERGE = /^(check|status)-success\s*=\s*queue-lane$/;
/** Two speculative checks, one per machine (ADR 0156 §3). */
export const QUEUE_PARALLEL_CHECKS = 2;
/** The dequeue reasons that make a PR a repair pick: its check went red. */
const DEQUEUE_REASONS = ["checks-failed", "checks-timeout"];
/** A dequeue under a red `base-health` is a hold (issue #6110). */
const HOLD_EXEMPT = [
    /^-check-failure\s*=\s*base-health$/,
    labelCondition(HELD_LABEL, "-"),
];

const strings = (v: unknown): string[] =>
    asArray(v)
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.trim());

/** Every condition string under `conds`, through `or:`/`and:` — never
 *  `not:`, which would invert the very condition being looked for. */
function flatConditions(conds: unknown): string[] {
    return asArray(conds).flatMap((c) =>
        typeof c === "string"
            ? [c.trim()]
            : isObj(c)
              ? [c.or, c.and].flatMap(flatConditions)
              : []
    );
}

/** A `pull_request_rules` entry that turns a red dequeue into `land-failed`
 *  (adds it, drops `ready-to-land`) with a comment. */
function relabelsDequeue(rule: unknown): boolean {
    if (!isObj(rule) || !isObj(rule.actions)) return false;
    const conds = flatConditions(rule.conditions);
    // A RED on the base is a hold, not the PR's red (issue #6110): the rule
    // must stand down when `base-health` failed, at the top level (an `or:`
    // branch would only widen it).
    const top = strings(rule.conditions);
    if (!HOLD_EXEMPT.every((re) => top.some((c) => re.test(c)))) return false;
    const label = isObj(rule.actions.label) ? rule.actions.label : {};
    const comment = isObj(rule.actions.comment) ? rule.actions.comment : {};
    return (
        DEQUEUE_REASONS.every((r) =>
            conds.some((c) =>
                new RegExp(`^queue-dequeue-reason\\s*=\\s*${r}$`).test(c)
            )
        ) &&
        strings(label.add).includes(FAILED_LABEL) &&
        strings(label.remove).includes(READY_LABEL) &&
        typeof comment.message === "string" &&
        /https:\/\//.test(comment.message)
    );
}

/** Top-level conditions carry the hold exemption: a RED stands it down. */
function holdExempt(rule: Record<string, unknown>): boolean {
    const top = strings(rule.conditions);
    return HOLD_EXEMPT.every((re) => top.some((c) => re.test(c)));
}

/** A rule that labels a PR `land-failed`. */
function addsFailed(rule: unknown): rule is Record<string, unknown> {
    return (
        isObj(rule) &&
        isObj(rule.actions) &&
        isObj(rule.actions.label) &&
        strings(rule.actions.label.add).includes(FAILED_LABEL)
    );
}

/** A rule that holds a PR whose advisory lane went red under a RED. */
function holdsRefusal(rule: unknown): boolean {
    if (!isObj(rule) || !isObj(rule.actions)) return false;
    const label = isObj(rule.actions.label) ? rule.actions.label : {};
    const top = strings(rule.conditions);
    const lane = new RegExp(
        `^check-failure\\s*=\\s*${ADVISORY_LANE_CHECK.replace(/[()]/g, "\\$&")}$`
    );
    return (
        strings(label.add).includes(HELD_LABEL) &&
        top.some((c) => /^check-failure\s*=\s*base-health$/.test(c)) &&
        flatConditions(rule.conditions).some((c) => lane.test(c))
    );
}

function checkMergify(f: SourceFile, out: Violation[]): void {
    let doc: unknown;
    try {
        doc = parse(f.text);
    } catch (e) {
        out.push({
            file: f.path,
            job: null,
            rule: "unparseable",
            message: String(e),
        });
        return;
    }
    const rules = isObj(doc) ? asArray(doc.queue_rules) : [];
    if (rules.length === 0)
        out.push({
            file: f.path,
            job: null,
            rule: "queue-entry",
            message: "no `queue_rules`",
        });
    const v = (rule: RuleId, message: string) =>
        out.push({ file: f.path, job: null, rule, message });
    rules.forEach((rule, i) => {
        const name = isObj(rule) ? String(rule.name ?? i + 1) : String(i + 1);
        const conds = isObj(rule) ? strings(rule.queue_conditions) : [];
        for (const need of QUEUE_ENTRY)
            if (!conds.some((c) => need.re.test(c)))
                v(
                    "queue-entry",
                    `queue rule \`${name}\`: queue_conditions lack ${need.what}`
                );
        if (conds.some((c) => labelCondition(MANUAL_LABEL).test(c)))
            v(
                "queue-entry",
                `queue rule \`${name}\`: queue_conditions require \`${MANUAL_LABEL}\` — the queue admits by status, not by label (issues #5643, #6213)`
            );
        const merge = isObj(rule) ? asArray(rule.merge_conditions) : [];
        if (
            merge.length !== 1 ||
            typeof merge[0] !== "string" ||
            !QUEUE_MERGE.test(merge[0].trim())
        )
            v(
                "queue-merge",
                `queue rule \`${name}\`: merge_conditions must be exactly \`check-success=queue-lane\``
            );
        const batch = isObj(rule) ? rule.batch_size : undefined;
        if (batch !== undefined && batch !== 1)
            v(
                "queue-shape",
                `queue rule \`${name}\`: batch_size must be 1 (no batches)`
            );
    });
    const mq = isObj(doc) && isObj(doc.merge_queue) ? doc.merge_queue : {};
    if (mq.max_parallel_checks !== QUEUE_PARALLEL_CHECKS)
        v(
            "queue-shape",
            `merge_queue.max_parallel_checks must be ${QUEUE_PARALLEL_CHECKS} (one per machine)`
        );
    const prRules = isObj(doc) ? asArray(doc.pull_request_rules) : [];
    if (!prRules.some(relabelsDequeue))
        v(
            "queue-dequeue",
            `no pull_request_rule labels a PR dequeued on ${DEQUEUE_REASONS.join("/")} \`${FAILED_LABEL}\` (removing \`${READY_LABEL}\`) with a comment carrying a link, unless held (\`-check-failure=base-health\` and \`-label=${HELD_LABEL}\`: a RED is a hold, issue #6110)`
        );
    prRules.forEach((rule, i) => {
        if (addsFailed(rule) && !holdExempt(rule))
            v(
                "queue-refusal-hold",
                `pull_request_rule \`${String(rule.name ?? i + 1)}\` adds \`${FAILED_LABEL}\` without top-level \`-check-failure=base-health\` and \`-label=${HELD_LABEL}\`: under a RED every PR's lane is red, and that red is the base's (issue #6256)`
            );
    });
    if (!prRules.some(holdsRefusal))
        v(
            "queue-refusal-hold",
            `no pull_request_rule labels \`${HELD_LABEL}\` a PR whose \`${ADVISORY_LANE_CHECK}\` is red while \`base-health\` is red (issue #6256)`
        );
}

export const PASS_WORKFLOW_FILE = ".github/workflows/afk-pass.yml";
const SAMPLE_PASS_ISSUE = 6194;

/** Render a `run-name` for a sample dispatch: only the two expressions the
 *  pass workflow uses are understood; anything else is `null`. */
function renderRunName(name: string, resume: boolean): string | null {
    let unknown = false;
    const out = name.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_m, expr: string) => {
        if (expr === "inputs.issue") return String(SAMPLE_PASS_ISSUE);
        const m = /^inputs\.resume && '(.*)' \|\| ''$/.exec(expr);
        if (m) return resume ? m[1] : "";
        unknown = true;
        return "";
    });
    return unknown ? null : out;
}

/** The pass workflow's `run-name` is the one string the dispatcher identifies
 *  a pass run by (`passRunIssue`). Read through the YAML parser, an unquoted
 *  ` #` is a comment and the name loses its issue (issue #6194). */
function checkPassRunName(workflows: SourceFile[], out: Violation[]): void {
    const f = workflows.find((w) => w.path === PASS_WORKFLOW_FILE);
    if (!f) return;
    let doc: unknown;
    try {
        doc = parse(f.text);
    } catch {
        return; // reported by checkWorkflow
    }
    const name = isObj(doc) ? doc["run-name"] : undefined;
    const fail = (message: string): void => {
        out.push({ file: f.path, job: null, rule: "pass-run-name", message });
    };
    if (typeof name !== "string")
        return fail(
            "no `run-name:` string — the dispatcher cannot map a run to its issue"
        );
    for (const resume of [false, true]) {
        const title = renderRunName(name, resume);
        if (title === null)
            return fail(
                `run-name \`${name}\` uses an expression the guard cannot render`
            );
        if (passRunIssue(title) !== SAMPLE_PASS_ISSUE)
            return fail(
                `run-name renders \`${title}\` (resume=${resume}), which the dispatcher's run-title parser does not map to its issue — quote the value (an unquoted \` #\` starts a YAML comment)`
            );
    }
}

export const OWNER_MERGE_WORKFLOW_FILE = ".github/workflows/owner-merge.yml";

/** The hand-merge email (issue #6188) is one failed run per hand-off: the
 *  workflow fires only on `pull_request_target` `labeled` (no re-fire on a
 *  push, edit, status or sweep), and its job runs only for `ready-to-land`
 *  (a skipped job sends no email). The base-only checkout is
 *  `pr-target-head-checkout`'s; here it must also EXIST. */
function checkOwnerMergeTrigger(
    workflows: SourceFile[],
    out: Violation[]
): void {
    const f = workflows.find((w) => w.path === OWNER_MERGE_WORKFLOW_FILE);
    if (!f) return;
    let doc: unknown;
    try {
        doc = parse(f.text);
    } catch {
        return; // reported by checkWorkflow
    }
    const fail = (job: string | null, message: string): void => {
        out.push({ file: f.path, job, rule: "owner-merge-trigger", message });
    };
    const trig = triggers(isObj(doc) ? doc.on : undefined);
    const prt = trig.get("pull_request_target");
    const types = isObj(prt) ? asArray(prt.types).map(String) : [];
    if (trig.size !== 1 || types.length !== 1 || types[0] !== "labeled")
        fail(
            null,
            "the only trigger must be `pull_request_target` with `types: [labeled]` — any other event sends a second email for one hand-off"
        );
    const jobs = isObj(doc) && isObj(doc.jobs) ? Object.entries(doc.jobs) : [];
    for (const [id, job] of jobs) {
        if (!isObj(job)) continue;
        if (
            !/github\.event\.label\.name\s*==\s*'ready-to-land'/.test(
                String(job.if ?? "")
            )
        )
            fail(
                id,
                "the job must carry `if: github.event.label.name == 'ready-to-land'` — another label would run (and fail) it"
            );
        if (!asArray(job.steps).some((s) => isCheckout(stepUses(s))))
            fail(
                id,
                "the job must check out the base (`actions/checkout`, no `ref:`)"
            );
    }
}

export function checkStructure(input: StructureInput): Violation[] {
    const out: Violation[] = [];
    const localActions = new Set(
        input.actions.map((a) => a.path.replace(/\/action\.ya?ml$/, ""))
    );
    for (const f of input.workflows) checkWorkflow(f, localActions, out);
    for (const f of input.actions) checkAction(f, out);
    checkPassRunName(input.workflows, out);
    checkOwnerMergeTrigger(input.workflows, out);
    checkDraftLanesRegenerateDerived(input.workflows, out);
    if (input.mergify) {
        checkMergify(input.mergify, out);
        checkAdvisoryLaneSkipsDrafts(input.workflows, out);
    }
    return out;
}

/** The queue's entry reads the advisory lane, and Mergify re-reads entry
 *  conditions on its draft: a lane run on a draft that goes red dequeues the
 *  PR on a failed condition, with no `land-failed` (issue #5978's stranding).
 *  So the job posting that check must skip the queue's drafts (issue #5643). */
function checkAdvisoryLaneSkipsDrafts(
    workflows: SourceFile[],
    out: Violation[]
): void {
    for (const f of workflows) {
        let doc: unknown;
        try {
            doc = parse(f.text);
        } catch {
            continue; // reported by checkWorkflow
        }
        const jobs = isObj(doc) && isObj(doc.jobs) ? doc.jobs : {};
        for (const [id, job] of Object.entries(jobs)) {
            if (!isObj(job) || job.name !== ADVISORY_LANE_CHECK) continue;
            if (!SKIPS_QUEUE_DRAFTS.test(String(job.if ?? "")))
                out.push({
                    file: f.path,
                    job: id,
                    rule: "queue-entry",
                    message: `the job posting \`${ADVISORY_LANE_CHECK}\` must skip the queue's drafts (an \`if:\` on \`${QUEUE_DRAFT_PREFIX}\`): the queue's entry reads that check`,
                });
        }
    }
}

/** A lane run on a PR merged with the base — the advisory lane on the merge
 *  ref, the queue's lane on its draft — judges a tree whose lockfile header
 *  is the merge-base's (ADR 0157): only `--regenerate-derived` makes
 *  `check:oracle` compare it per row, in the `draft` role (issue #6338). */
function checkDraftLanesRegenerateDerived(
    workflows: SourceFile[],
    out: Violation[]
): void {
    for (const f of workflows) {
        let doc: unknown;
        try {
            doc = parse(f.text);
        } catch {
            continue; // reported by checkWorkflow
        }
        const jobs = isObj(doc) && isObj(doc.jobs) ? doc.jobs : {};
        for (const [id, job] of Object.entries(jobs)) {
            if (!isObj(job)) continue;
            const draftLane =
                job.name === ADVISORY_LANE_CHECK ||
                DRAFT_LANE_JOBS.has(`${f.path}#${id}`);
            if (!draftLane || !Array.isArray(job.steps)) continue;
            for (const step of job.steps) {
                const run = stepRun(step);
                if (run === null) continue;
                // Each `check:lane` command line (never `check:lane-timing`)
                // carries the flag before any comment.
                const lanes = run
                    .split("\n")
                    .filter((l) => CHECK_LANE_CALL.test(l));
                if (lanes.every((l) => LANE_REGENERATES.test(l))) continue;
                out.push({
                    file: f.path,
                    job: id,
                    rule: "derived-role",
                    message: `\`check:lane\` here tests a PR merged with the base: it must pass \`${REGENERATE_DERIVED_FLAG}\`, or every PR touching a lockfile input reds on header drift (ADR 0157)`,
                });
            }
        }
    }
}

export function formatViolation(v: Violation): string {
    return `${v.file}${v.job ? ` (job ${v.job})` : ""}: ${v.rule}: ${v.message}`;
}
