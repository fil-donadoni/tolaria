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
 *     older pending one; heavy work is serialised by runner labels.
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
 *     hosted advisory lane's one recorded test exclusion, issue #5675) named
 *     in a workflow holding a self-hosted job, or in a shared action: a lane
 *     on the owner's machines gates, and a gate never skips the corpus.
 *   - `queue-entry` — a `.mergify.yml` queue rule whose entry conditions do not
 *     require `ready-to-land`, `trusted-author`, `base-health` and the
 *     exclusion of `.github/` and `.mergify.yml` (ADR 0156 §8 barriers 3–4).
 */
import { parse } from "yaml";
import { CORPUS_EXCLUSION_ENV } from "../lib/corpus-exclusion";

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
    | "corpus-exclusion-gating"
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
    if (selfHosted && job.concurrency !== undefined)
        v("concurrency-group", "self-hosted job declares `concurrency`");

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

/** Mergify condition strings that must stand at the top level (AND) of
 *  every queue rule's entry conditions. */
const QUEUE_ENTRY: { what: string; re: RegExp }[] = [
    { what: "label=ready-to-land", re: /^label\s*=\s*ready-to-land$/ },
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
    rules.forEach((rule, i) => {
        const name = isObj(rule) ? String(rule.name ?? i + 1) : String(i + 1);
        const conds = isObj(rule)
            ? asArray(rule.queue_conditions)
                  .filter((c): c is string => typeof c === "string")
                  .map((c) => c.trim())
            : [];
        for (const need of QUEUE_ENTRY)
            if (!conds.some((c) => need.re.test(c)))
                out.push({
                    file: f.path,
                    job: null,
                    rule: "queue-entry",
                    message: `queue rule \`${name}\`: queue_conditions lack ${need.what}`,
                });
    });
}

export function checkStructure(input: StructureInput): Violation[] {
    const out: Violation[] = [];
    const localActions = new Set(
        input.actions.map((a) => a.path.replace(/\/action\.ya?ml$/, ""))
    );
    for (const f of input.workflows) checkWorkflow(f, localActions, out);
    for (const f of input.actions) checkAction(f, out);
    if (input.mergify) checkMergify(input.mergify, out);
    return out;
}

export function formatViolation(v: Violation): string {
    return `${v.file}${v.job ? ` (job ${v.job})` : ""}: ${v.rule}: ${v.message}`;
}
