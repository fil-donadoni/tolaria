import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    checkStructure,
    formatViolation,
    HOST_PINNED_JOBS,
    LANE_JOBS,
    isSelfHosted,
    JOB_SETUP_FILE,
    SUPERSEDED_GROUP,
    type RuleId,
    type SourceFile,
    type StructureInput,
} from "../ci/workflow-structure";

// The structure guard over `.github/` and `.mergify.yml` (ADR 0156 §8 and
// Amendment I, issue #5636). One test reads the repository's real files; the
// rest pin each rule on a fixture that holds every invariant, broken one
// line at a time.

const REPO = join(__dirname, "..", "..");

function read(rel: string): SourceFile {
    return { path: rel, text: readFileSync(join(REPO, rel), "utf8") };
}

function repoInput(): StructureInput {
    const wfDir = ".github/workflows";
    const actDir = ".github/actions";
    return {
        workflows: readdirSync(join(REPO, wfDir))
            .filter((f) => /\.ya?ml$/.test(f))
            .map((f) => read(`${wfDir}/${f}`)),
        actions: readdirSync(join(REPO, actDir)).flatMap((d) =>
            ["action.yml", "action.yaml"]
                .filter((f) => existsSync(join(REPO, actDir, d, f)))
                .map((f) => read(`${actDir}/${d}/${f}`))
        ),
        mergify: existsSync(join(REPO, ".mergify.yml"))
            ? read(".mergify.yml")
            : null,
    };
}

describe("the repository's workflows", () => {
    it("hold every invariant", () => {
        const input = repoInput();
        // Never vacuous: a glob that reads nothing would pass anything.
        expect(input.workflows.map((w) => w.path)).toContain(
            ".github/workflows/pr-check.yml"
        );
        expect(input.actions.map((a) => a.path)).toContain(JOB_SETUP_FILE);
        expect(checkStructure(input).map(formatViolation)).toEqual([]);
    });
});

describe("pr-refresh's concurrency group (issue #6651)", () => {
    it("must keep one refresh run live at a time: dropping the job's group is refused", () => {
        const input = repoInput();
        const path = ".github/workflows/pr-refresh.yml";
        const stripped = input.workflows.map((w) => {
            if (w.path !== path) return w;
            const text = w.text.replace(
                /\n {8}concurrency:\n {12}group: pr-refresh\n {12}cancel-in-progress: false/,
                ""
            );
            expect(text).not.toBe(w.text);
            return { ...w, text };
        });
        const broken = checkStructure({ ...input, workflows: stripped });
        expect(broken.map((v) => [v.file, v.job, v.rule])).toEqual([
            [path, "refresh", "dispatcher-serialised"],
        ]);
    });
});

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

const HOSTED = `
on:
  pull_request:
concurrency:
  group: x
  cancel-in-progress: true
jobs:
  lane:
    name: check:lane (advisory)
    if: \${{ !startsWith(github.head_ref, 'mergify/merge-queue/') }}
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@${SHA}
      - uses: ./.github/actions/job-setup
      - run: bun run check:lane --regenerate-derived
  refusals:
    if: \${{ !startsWith(github.head_ref, 'mergify/merge-queue/') }}
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@${SHA}
      - uses: ./.github/actions/job-setup
      - env:
          PR_BODY: \${{ github.event.pull_request.body }}
        run: bun run pr:checks scenario
`;

const SELF_HOSTED = `
on:
  push:
    branches: [lane-timing/**]
  workflow_dispatch:
  issues:
    types: [labeled]
jobs:
  lane:
    runs-on: [self-hosted, maint]
    timeout-minutes: 30
    steps:
      - name: Job worktree
        shell: bash
        run: git show "$GITHUB_SHA:scripts/ci/job-worktree.sh" | bash -s -- create
      - uses: ./.github/actions/job-setup
      - run: scripts/ci/run-quiet.sh pass -- claude -p "/next-ticket 1"
      - if: always()
        shell: bash
        run: git show "$GITHUB_SHA:scripts/ci/job-worktree.sh" | bash -s -- remove
`;

const PR_TARGET = `
on:
  pull_request_target:
jobs:
  gate:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@${SHA}
      - uses: ./.github/actions/job-setup
      - run: bun scripts/pr-gate.ts
`;

const OWNER_MERGE = `
on:
  pull_request_target:
    types: [labeled]
jobs:
  notify:
    if: github.event.label.name == 'ready-to-land'
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@${SHA}
      - uses: ./.github/actions/job-setup
      - run: bun scripts/owner-merge.ts
`;

const JOB_SETUP = readFileSync(join(REPO, JOB_SETUP_FILE), "utf8");

const MERGIFY = `
merge_queue:
  max_parallel_checks: 1
queue_rules:
  - name: default
    queue_conditions:
      - label=ready-to-land
      - -label=land-failed
      - -check-failure=check:lane (advisory)
      - check-success=trusted-author
      - check-success=base-health
      - -files~=^\\.github/
      - -files=.mergify.yml
    merge_conditions:
      - check-success=queue-lane
    batch_size: 1
pull_request_rules:
  - name: dequeued
    conditions:
      - -check-failure=base-health
      - -label=queue:held
      - or:
          - queue-dequeue-reason=checks-failed
          - queue-dequeue-reason=checks-timeout
    actions:
      label:
        add: [land-failed]
        remove: [ready-to-land]
      comment:
        message: "dequeued — https://example.test/run"
  - name: refusal
    conditions:
      - label=ready-to-land
      - -check-failure=base-health
      - -label=queue:held
      - or:
          - check-failure=check:lane (advisory)
          - check-failure=scenario
    actions:
      label:
        add: [land-failed]
        remove: [ready-to-land]
  - name: refusal under a RED
    conditions:
      - label=ready-to-land
      - check-failure=base-health
      - check-failure=check:lane (advisory)
    actions:
      label:
        add: [queue:held]
`;

interface Over {
    hosted?: string;
    self?: string;
    target?: string;
    setup?: string;
    mergify?: string;
}

function fixture(over: Over = {}): StructureInput {
    const wf = {
        hosted: over.hosted ?? HOSTED,
        self: over.self ?? SELF_HOSTED,
        target: over.target ?? PR_TARGET,
    };
    return {
        workflows: Object.entries(wf).map(([k, text]) => ({
            path: `.github/workflows/${k}.yml`,
            text,
        })),
        actions: [{ path: JOB_SETUP_FILE, text: over.setup ?? JOB_SETUP }],
        mergify: { path: ".mergify.yml", text: over.mergify ?? MERGIFY },
    };
}

function rules(input: StructureInput): RuleId[] {
    return [...new Set(checkStructure(input).map((v) => v.rule))];
}

/** Replace `from` in `text`, asserting it was there (a no-op edit would
 *  prove nothing). */
function edit(text: string, from: string, to: string): string {
    expect(text).toContain(from);
    return text.replace(from, to);
}

describe("the pass run name (issue #6194)", () => {
    const PASS = (name: string) => `
on:
  workflow_dispatch:
    inputs:
      issue:
        required: true
      resume:
        type: boolean
run-name: ${name}
jobs:
  pass:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: ./.github/actions/job-setup
`;
    const QUOTED = `"afk-pass #\${{ inputs.issue }}\${{ inputs.resume && ' (resume)' || '' }}"`;
    const check = (name: string) =>
        rules({
            ...fixture(),
            workflows: [
                {
                    path: ".github/workflows/afk-pass.yml",
                    text: PASS(name),
                },
            ],
        });

    it("admits the quoted name", () => {
        expect(check(QUOTED)).not.toContain("pass-run-name");
    });

    it("refuses the unquoted name, whose ` #` starts a YAML comment", () => {
        const unquoted = QUOTED.slice(1, -1);
        expect(check(unquoted)).toContain("pass-run-name");
    });

    it("refuses a name without the issue", () => {
        expect(check(`"afk-pass"`)).toContain("pass-run-name");
    });
});

describe("the pass's failed-setup record (issue #6781)", () => {
    const real = readFileSync(
        join(REPO, ".github/workflows/afk-pass.yml"),
        "utf8"
    );
    const check = (text: string) =>
        rules({
            ...fixture(),
            workflows: [{ path: ".github/workflows/afk-pass.yml", text }],
        });

    it("admits the shipped workflow", () => {
        expect(check(real)).not.toContain("pass-setup-record");
    });

    it("refuses the step run from the job workspace a failed worktree leaves missing", () => {
        const text = real.replace(
            /\n {14}working-directory: \$\{\{ runner\.temp \}\}\n(?= {14}env:\n {18}AFK_ISSUE)/,
            "\n"
        );
        expect(text).not.toBe(real);
        expect(check(text)).toContain("pass-setup-record");
    });

    it("refuses the step that does not recreate the workspace", () => {
        const text = real.replace(/\n {18}mkdir -p "\$GITHUB_WORKSPACE"/, "");
        expect(text).not.toBe(real);
        expect(check(text)).toContain("pass-setup-record");
    });

    it("refuses a pass workflow with no failed-setup record at all", () => {
        const text = real.replace(
            "name: Record a failed setup",
            "name: Something else"
        );
        expect(check(text)).toContain("pass-setup-record");
    });
});

describe("workflow structure guard", () => {
    it("the fixture holds every invariant", () => {
        expect(checkStructure(fixture()).map(formatViolation)).toEqual([]);
    });

    it("refuses a self-hosted job an outsider can trigger", () => {
        for (const trigger of [
            "pull_request:",
            "pull_request_target:",
            "issue_comment:",
            "discussion:",
            "workflow_run:\n    workflows: [x]",
            "issues:\n    types: [labeled, opened]",
            "issues:",
        ]) {
            const self = edit(
                SELF_HOSTED,
                "  issues:\n    types: [labeled]",
                `  ${trigger}`
            );
            expect(rules(fixture({ self })), trigger).toEqual([
                "outsider-reaches-self-hosted",
            ]);
        }
    });

    it("admits the corpus exclusion on a hosted lane only (issue #5675)", () => {
        const env = `
        env:
          TOLARIA_HOSTED_NO_VERDICT_CORPUS: "1"`;
        const hosted = edit(
            HOSTED,
            "      - run: bun run check:lane --regenerate-derived",
            `      - run: bun run check:lane --regenerate-derived${env}`
        );
        expect(rules(fixture({ hosted }))).toEqual([]);
        const self = edit(
            SELF_HOSTED,
            "      - uses: ./.github/actions/job-setup\n",
            `      - uses: ./.github/actions/job-setup\n      - run: bun run check:lane${env}\n`
        );
        expect(rules(fixture({ self }))).toEqual(["corpus-exclusion-gating"]);
        const setup = edit(
            JOB_SETUP,
            "        - name: worktree:init\n",
            '        - name: worktree:init\n          env:\n              TOLARIA_HOSTED_NO_VERDICT_CORPUS: "1"\n'
        );
        expect(rules(fixture({ setup }))).toEqual(["corpus-exclusion-gating"]);
    });

    it("refuses a self-hosted workflow on a push any branch can fire", () => {
        for (const push of [
            "  push:\n",
            "  push:\n    branches: ['**']\n",
            "  push:\n    branches: [dependabot/**]\n",
        ]) {
            const self = edit(
                SELF_HOSTED,
                "  push:\n    branches: [lane-timing/**]\n",
                push
            );
            expect(rules(fixture({ self })), push).toEqual([
                "outsider-reaches-self-hosted",
            ]);
        }
    });

    it("reads every runs-on shape it cannot prove hosted as self-hosted", () => {
        for (const r of [
            "ubuntu-24.04",
            ["ubuntu-24.04"],
            "macos-15",
            "ubuntu-latest",
        ])
            expect(isSelfHosted(r), JSON.stringify(r)).toBe(false);
        // Every self-hosted runner also carries its OS and architecture, and
        // GitHub matches labels case-insensitively.
        for (const r of [
            "self-hosted",
            "Self-Hosted",
            "lane",
            "LANE",
            "macOS",
            ["linux", "x64"],
            ["ubuntu-24.04", "lane"],
            ["host:huawei"],
            "${{ inputs.runner }}",
            { group: "mine" },
            { labels: ["ubuntu-24.04"] },
            [],
            undefined,
        ])
            expect(isSelfHosted(r), JSON.stringify(r)).toBe(true);
        const hosted = edit(HOSTED, "runs-on: ubuntu-24.04", "runs-on: macOS");
        expect(rules(fixture({ hosted }))).toContain(
            "outsider-reaches-self-hosted"
        );
    });

    it("refuses a pull_request_target job that checks out anything but the base, or fetches the head", () => {
        for (const w of [
            "ref: ${{ github.event.pull_request.head.sha }}",
            "ref: ${{ github.event.pull_request.merge_commit_sha }}",
            "repository: ${{ github.event.pull_request.head.repo.full_name }}",
        ]) {
            const target = edit(
                PR_TARGET,
                `      - uses: actions/checkout@${SHA}`,
                `      - uses: actions/checkout@${SHA}\n        with:\n          ${w}`
            );
            expect(rules(fixture({ target })), w).toEqual([
                "pr-target-head-checkout",
            ]);
        }
        for (const run of [
            "gh pr checkout 12",
            'git fetch origin "pull/$N/merge"',
        ]) {
            const target = edit(
                PR_TARGET,
                "run: bun scripts/pr-gate.ts",
                `run: ${run}`
            );
            expect(rules(fixture({ target })), run).toEqual([
                "pr-target-head-checkout",
            ]);
        }
    });

    it("refuses a uses: not pinned to a full SHA, in a workflow or an action", () => {
        const hosted = edit(
            HOSTED,
            `actions/checkout@${SHA}`,
            "actions/checkout@v7"
        );
        expect(rules(fixture({ hosted }))).toEqual(["unpinned-uses"]);
        const docker = edit(
            HOSTED,
            `actions/checkout@${SHA}`,
            "docker://alpine:3"
        );
        expect(rules(fixture({ hosted: docker }))).toEqual(["unpinned-uses"]);
        const setup = edit(
            JOB_SETUP,
            "          run: scripts/ci/setup-bun.sh",
            "          run: scripts/ci/setup-bun.sh\n        - uses: oven-sh/setup-bun@v2"
        );
        expect(rules(fixture({ setup })).sort()).toEqual([
            "job-setup-contract",
            "unpinned-uses",
        ]);
    });

    it("refuses a local action the guard does not read", () => {
        const hosted = edit(
            HOSTED,
            "./.github/actions/job-setup",
            "./tools/setup"
        );
        expect(rules(fixture({ hosted })).sort()).toEqual([
            "local-action-unscanned",
            "no-toolchain",
        ]);
    });

    it("refuses a reusable-workflow call", () => {
        const hosted = `${HOSTED}  call:\n    uses: o/r/.github/workflows/x.yml@${SHA}\n`;
        expect(rules(fixture({ hosted }))).toEqual(["reusable-call"]);
    });

    it("refuses a job without a timeout", () => {
        const self = edit(SELF_HOSTED, "    timeout-minutes: 30\n", "");
        expect(rules(fixture({ self }))).toEqual(["no-timeout"]);
    });

    it("refuses a run: step before the shared job setup", () => {
        const hosted = edit(
            HOSTED,
            "      - uses: ./.github/actions/job-setup\n",
            ""
        );
        expect(rules(fixture({ hosted }))).toEqual(["no-toolchain"]);
        const late = edit(
            HOSTED,
            "      - uses: ./.github/actions/job-setup\n      - run: bun run check:lane --regenerate-derived\n",
            "      - run: bun run check:lane --regenerate-derived\n      - uses: ./.github/actions/job-setup\n"
        );
        expect(rules(fixture({ hosted: late }))).toEqual(["no-toolchain"]);
        // Naming the worktree script exempts only the first and last step.
        const sneak = edit(
            SELF_HOSTED,
            "      - uses: ./.github/actions/job-setup\n",
            "      - run: bun install # job-worktree.sh\n      - uses: ./.github/actions/job-setup\n"
        );
        expect(rules(fixture({ self: sneak }))).toEqual(["no-toolchain"]);
    });

    it("refuses a concurrency group on a self-hosted job or its workflow", () => {
        const job = edit(
            SELF_HOSTED,
            "    timeout-minutes: 30",
            "    timeout-minutes: 30\n    concurrency: heavy"
        );
        expect(rules(fixture({ self: job }))).toEqual(["concurrency-group"]);
        const wf = edit(SELF_HOSTED, "jobs:", "concurrency: heavy\njobs:");
        expect(rules(fixture({ self: wf }))).toEqual(["concurrency-group"]);
    });

    it("requires the dispatcher to run one at a time by a job-level group (issue #5649)", () => {
        const group =
            "    concurrency:\n      group: afk-dispatch\n      cancel-in-progress: false\n";
        const serialised = edit(
            SELF_HOSTED,
            "    timeout-minutes: 30\n",
            `    timeout-minutes: 30\n${group}`
        );
        const dispatcher = (text: string): StructureInput => ({
            ...fixture(),
            workflows: [
                ...fixture().workflows,
                { path: ".github/workflows/afk-dispatch.yml", text },
            ],
        });
        expect(rules(dispatcher(serialised))).toEqual([]);
        // The same group anywhere else is still refused.
        expect(rules(fixture({ self: serialised }))).toEqual([
            "concurrency-group",
        ]);
        // No group: two runs could claim one issue twice.
        expect(rules(dispatcher(SELF_HOSTED))).toEqual([
            "dispatcher-serialised",
        ]);
        // A group that cancels the RUNNING dispatcher mid-claim.
        expect(
            rules(
                dispatcher(
                    edit(
                        serialised,
                        "cancel-in-progress: false",
                        "cancel-in-progress: true"
                    )
                )
            )
        ).toEqual(["concurrency-group", "dispatcher-serialised"]);
        // At workflow level a skipped run (a non-ready label) would displace
        // a pending one.
        expect(
            rules(
                dispatcher(
                    edit(
                        SELF_HOSTED,
                        "jobs:",
                        "concurrency:\n  group: afk-dispatch\n  cancel-in-progress: false\njobs:"
                    )
                )
            )
        ).toEqual(["dispatcher-serialised", "concurrency-group"]);
    });

    it("requires a shared post-merge duty to run one at a time by a job-level group, and admits exactly that (issue #5873)", () => {
        const group =
            "    concurrency:\n      group: post-merge-housekeeping\n      cancel-in-progress: false\n";
        const serialised = edit(
            SELF_HOSTED,
            "    timeout-minutes: 30\n",
            `    timeout-minutes: 30\n${group}`
        ).replace("  lane:\n", "  housekeeping:\n");
        const postMerge = (text: string): StructureInput => ({
            ...fixture(),
            workflows: [
                ...fixture().workflows,
                { path: ".github/workflows/post-merge.yml", text },
            ],
        });
        expect(rules(postMerge(serialised))).toEqual([]);
        // No group: two machines could move one watermark twice.
        expect(
            rules(
                postMerge(SELF_HOSTED.replace("  lane:\n", "  housekeeping:\n"))
            )
        ).toEqual(["dispatcher-serialised"]);
        // A job of the same workflow that is not a shared duty keeps the ban.
        expect(
            rules(
                postMerge(serialised.replace("  housekeeping:\n", "  sync:\n"))
            )
        ).toEqual(["concurrency-group"]);
        // Cancelling a RUNNING run is still refused.
        expect(
            rules(
                postMerge(
                    edit(
                        serialised,
                        "cancel-in-progress: false",
                        "cancel-in-progress: true"
                    )
                )
            )
        ).toEqual(["concurrency-group", "dispatcher-serialised"]);
    });

    it("requires the queue's lane to be superseded by its PR's newer draft, and admits exactly that (issue #6020)", () => {
        const group = (cancel: boolean, key = SUPERSEDED_GROUP) =>
            `    concurrency:\n      group: "${key}"\n      cancel-in-progress: ${cancel}\n`;
        const withGroup = (g: string) =>
            edit(
                SELF_HOSTED,
                "    timeout-minutes: 30\n",
                `    timeout-minutes: 30\n${g}`
            ).replace("  lane:\n", "  queue-lane:\n");
        const queueLane = (text: string): StructureInput => ({
            ...fixture(),
            workflows: [
                ...fixture().workflows,
                { path: ".github/workflows/queue-lane.yml", text },
            ],
        });
        expect(rules(queueLane(withGroup(group(true))))).toEqual([]);
        // No group: the superseded draft's run holds a lane runner.
        expect(
            rules(
                queueLane(SELF_HOSTED.replace("  lane:\n", "  queue-lane:\n"))
            )
        ).toEqual(["queue-superseded"]);
        // Keyed by the branch: every draft is a new one, nothing supersedes.
        expect(
            rules(
                queueLane(
                    withGroup(group(true, "queue-lane-${{ github.ref }}"))
                )
            )
        ).toEqual(["concurrency-group", "queue-superseded"]);
        // Keeping the running one: the orphan still holds its runner.
        expect(rules(queueLane(withGroup(group(false))))).toEqual([
            "concurrency-group",
            "queue-superseded",
        ]);
        // The same group on any other self-hosted job keeps the ban.
        expect(rules(fixture({ self: withGroup(group(true)) }))).toEqual([
            "concurrency-group",
        ]);
    });

    it("refuses a self-hosted job pinned to one host by a literal label; a matrix or input expression is not a pin (issue #5873)", () => {
        const pinned = edit(
            SELF_HOSTED,
            "runs-on: [self-hosted, maint]",
            "runs-on: [self-hosted, maint, host:huawei]"
        );
        expect(rules(fixture({ self: pinned }))).toEqual(["host-pinned"]);
        const matrix = edit(
            SELF_HOSTED,
            "runs-on: [self-hosted, maint]",
            'runs-on: [self-hosted, maint, "host:${{ matrix.host }}"]'
        );
        expect(rules(fixture({ self: matrix }))).toEqual([]);
        const input = edit(
            SELF_HOSTED,
            "runs-on: [self-hosted, maint]",
            "runs-on: [self-hosted, maint, \"host:${{ inputs.host || 'macbook' }}\"]"
        );
        expect(rules(fixture({ self: input }))).toEqual([]);
        // The `{ group, labels }` form pins just the same.
        const grouped = edit(
            SELF_HOSTED,
            "runs-on: [self-hosted, maint]",
            "runs-on:\n      group: ours\n      labels: [maint, host:huawei]"
        );
        expect(rules(fixture({ self: grouped }))).toEqual(["host-pinned"]);
    });

    it("waives host-pinned for a HOST_PINNED_JOBS job only — the replay pins the fast host (ADR 0159, issue #6990)", () => {
        expect([...HOST_PINNED_JOBS.keys()]).toEqual([
            ".github/workflows/post-merge.yml#bot-replay",
            ".github/workflows/post-merge.yml#repair-watch",
        ]);
        const pinned = edit(
            SELF_HOSTED,
            "runs-on: [self-hosted, maint]",
            "runs-on: [self-hosted, maint, host:macbook]\n    concurrency:\n      group: post-merge-bot-replay\n      cancel-in-progress: false"
        );
        // The same job text under the waived path and id: no violation…
        const replay = edit(pinned, "jobs:\n  lane:", "jobs:\n  bot-replay:");
        const input = fixture({ self: replay });
        const asPostMerge: StructureInput = {
            ...input,
            workflows: input.workflows.map((w) =>
                w.path === ".github/workflows/self.yml"
                    ? { ...w, path: ".github/workflows/post-merge.yml" }
                    : w
            ),
        };
        expect(rules(asPostMerge)).toEqual([]);
        // …and under any other id or path the pin is still refused.
        expect(rules(fixture({ self: replay }))).toContain("host-pinned");
    });

    it("keeps the lane runner for the gates: lane-role refuses any other job reaching it (ADR 0160, issue #6653)", () => {
        expect([...LANE_JOBS.keys()]).toEqual([
            ".github/workflows/queue-lane.yml#queue-lane",
            ".github/workflows/health.yml#gate",
            ".github/workflows/release.yml#release",
        ]);
        const onLane = (runsOn: string) =>
            edit(SELF_HOSTED, "runs-on: [self-hosted, maint]", runsOn);
        // A maintenance job on the lane role, by name, by a runner group or
        // by an expression the guard cannot read (fail closed).
        for (const runsOn of [
            "runs-on: [self-hosted, lane]",
            'runs-on: [self-hosted, lane, "host:${{ matrix.host }}"]',
            "runs-on:\n      group: ours\n      labels: [X64]",
            'runs-on: [self-hosted, "${{ inputs.role }}"]',
        ])
            expect(rules(fixture({ self: onLane(runsOn) })), runsOn).toEqual([
                "lane-role",
            ]);
        // A literal other role rules the lane runner out: a runner carries
        // one role, and `runs-on` needs every label.
        for (const runsOn of [
            'runs-on: [self-hosted, pass, "${{ inputs.role }}"]',
            'runs-on: [self-hosted, maint, "host:${{ matrix.host }}"]',
            "runs-on:\n      group: ours\n      labels: [seed]",
        ])
            expect(rules(fixture({ self: onLane(runsOn) })), runsOn).toEqual(
                []
            );
        // The same lane job under a LANE_JOBS path and id is admitted.
        const gate = edit(
            onLane("runs-on: [self-hosted, lane]"),
            "jobs:\n  lane:",
            "jobs:\n  release:"
        );
        const input = fixture({ self: gate });
        const asRelease: StructureInput = {
            ...input,
            workflows: input.workflows.map((w) =>
                w.path === ".github/workflows/self.yml"
                    ? { ...w, path: ".github/workflows/release.yml" }
                    : w
            ),
        };
        expect(rules(asRelease)).toEqual([]);
    });

    it("refuses actions/checkout on a self-hosted job", () => {
        const self = edit(
            SELF_HOSTED,
            "      - uses: ./.github/actions/job-setup",
            `      - uses: actions/checkout@${SHA}\n      - uses: ./.github/actions/job-setup`
        );
        expect(rules(fixture({ self }))).toEqual(["self-hosted-clone"]);
    });

    it("refuses a self-hosted job that does not create and remove its worktree under pipefail", () => {
        for (const [from, to] of [
            ["bash -s -- create", "bash -s -- status"],
            ["bash -s -- remove", "bash -s -- status"],
            ["      - if: always()\n", "      - name: x\n"],
            [
                "        shell: bash\n        run: git show",
                "        run: git show",
            ],
        ] as const) {
            const self = edit(SELF_HOSTED, from, to);
            expect(rules(fixture({ self })), from).toEqual(["job-worktree"]);
        }
    });

    it("refuses a claude call that is not one run-quiet call", () => {
        for (const call of [
            'cd x && claude -p "/next-ticket 1"',
            '/usr/local/bin/claude -p "/next-ticket 1"',
            "bunx @anthropic-ai/claude-code -p hi",
            'scripts/ci/run-quiet.sh x -- true; claude -p "/next-ticket 1"',
        ]) {
            const self = edit(
                SELF_HOSTED,
                'run: scripts/ci/run-quiet.sh pass -- claude -p "/next-ticket 1"',
                `run: |\n          ${call}`
            );
            expect(rules(fixture({ self })), call).toEqual([
                "claude-raw-output",
            ]);
        }
        const action = edit(
            SELF_HOSTED,
            "      - uses: ./.github/actions/job-setup\n",
            `      - uses: ./.github/actions/job-setup\n      - uses: anthropics/claude-code-action@${SHA}\n`
        );
        expect(rules(fixture({ self: action }))).toEqual(["unpinned-uses"]);
    });

    it("refuses a job setup that lost its mask or a pinned toolchain step", () => {
        for (const [from, to] of [
            ["::add-mask::", "::notice::"],
            ["run: scripts/ci/setup-node.sh", "run: node --version"],
            ["scripts/ci/setup-bun.sh", "true"],
            ["bun run worktree:init", "bun install"],
        ] as const) {
            const setup = edit(JOB_SETUP, from, to);
            expect(rules(fixture({ setup })), from).toEqual([
                "job-setup-contract",
            ]);
        }
    });

    it("refuses a queue rule requiring a marker label (issues #5643, #6213)", () => {
        const mergify = edit(
            MERGIFY,
            "      - label=ready-to-land\n",
            "      - label=ready-to-land\n      - label=merge:manual\n"
        );
        expect(rules(fixture({ mergify }))).toEqual(["queue-entry"]);
    });

    it("refuses an advisory lane that runs on the queue's drafts (issue #5643)", () => {
        const hosted = edit(
            HOSTED,
            "    if: ${{ !startsWith(github.head_ref, 'mergify/merge-queue/') }}\n",
            ""
        );
        expect(
            checkStructure(fixture({ hosted })).map(formatViolation)
        ).toEqual([
            ".github/workflows/hosted.yml (job lane): queue-entry: the job posting `check:lane (advisory)` must skip the queue's drafts (an `if:` on `mergify/merge-queue/`): the queue's entry reads that check",
        ]);
        const onlyDrafts = edit(
            HOSTED,
            "!startsWith(github.head_ref",
            "startsWith(github.head_ref"
        );
        expect(rules(fixture({ hosted: onlyDrafts }))).toEqual(["queue-entry"]);
    });

    it("refuses a job reading the PR body that runs on the queue's drafts (issue #6404)", () => {
        const guard =
            "  refusals:\n    if: ${{ !startsWith(github.head_ref, 'mergify/merge-queue/') }}\n";
        const hosted = edit(HOSTED, guard, "  refusals:\n");
        expect(
            checkStructure(fixture({ hosted })).map(formatViolation)
        ).toEqual([
            ".github/workflows/hosted.yml (job refusals): draft-body-read: a job reading `github.event.pull_request.body` must skip the queue's drafts (an `if:` on `mergify/merge-queue/`): there the body is Mergify's, not the queued PR's",
        ]);
        const onlyDrafts = edit(
            HOSTED,
            guard,
            "  refusals:\n    if: ${{ startsWith(github.head_ref, 'mergify/merge-queue/') }}\n"
        );
        expect(rules(fixture({ hosted: onlyDrafts }))).toEqual([
            "draft-body-read",
        ]);
    });

    it("requires a lane run on a PR merged with the base to regenerate derived state (issue #6338)", () => {
        const hosted = edit(
            HOSTED,
            "check:lane --regenerate-derived",
            "check:lane --json"
        );
        expect(
            checkStructure(fixture({ hosted })).map(formatViolation)
        ).toEqual([
            ".github/workflows/hosted.yml (job lane): derived-role: `check:lane` here tests a PR merged with the base: it must pass `--regenerate-derived`, or every PR touching a lockfile input reds on header drift (ADR 0157)",
        ]);
        // The queue's lane, found by its job, not by its check name.
        const lane = (flag: string, job: string) =>
            edit(
                SELF_HOSTED,
                "      - uses: ./.github/actions/job-setup\n",
                `      - uses: ./.github/actions/job-setup\n      - run: bun run check:lane${flag}\n`
            ).replace("  lane:\n", `  ${job}:\n`);
        const queueLane = (text: string): StructureInput => ({
            ...fixture(),
            workflows: [
                ...fixture().workflows,
                { path: ".github/workflows/queue-lane.yml", text },
            ],
        });
        expect(rules(queueLane(lane("", "queue-lane")))).toContain(
            "derived-role"
        );
        expect(
            rules(queueLane(lane(" --regenerate-derived", "queue-lane")))
        ).not.toContain("derived-role");
        // The flag in a comment does not reach the lane.
        expect(
            rules(queueLane(lane(" # --regenerate-derived", "queue-lane")))
        ).toContain("derived-role");
        // Another script sharing the prefix is not the lane.
        expect(
            rules(
                queueLane(
                    lane("", "queue-lane").replace(
                        "check:lane\n",
                        "check:lane-timing\n"
                    )
                )
            )
        ).not.toContain("derived-role");
        // A lane timing the base itself (lane-timing) owes nothing.
        expect(rules(fixture({ self: lane("", "lane") }))).not.toContain(
            "derived-role"
        );
    });

    it("refuses a queue rule that does not gate entry", () => {
        for (const line of [
            "      - label=ready-to-land\n",
            "      - -label=land-failed\n",
            "      - -check-failure=check:lane (advisory)\n",
            "      - check-success=trusted-author\n",
            "      - check-success=base-health\n",
            "      - -files~=^\\.github/\n",
            "      - -files=.mergify.yml\n",
        ]) {
            const mergify = edit(MERGIFY, line, "");
            expect(rules(fixture({ mergify })), line).toEqual(["queue-entry"]);
        }
        expect(
            rules(fixture({ mergify: "pull_request_rules: []\n" }))
        ).toContain("queue-entry");
    });

    it("requires the queue lane, and nothing else, to merge (issue #5642)", () => {
        for (const [from, to] of [
            ["      - check-success=queue-lane\n", ""],
            ["check-success=queue-lane", "check-success=lane"],
            [
                "      - check-success=queue-lane\n",
                "      - check-success=queue-lane\n      - check-success=trusted-author\n",
            ],
        ] as const) {
            const mergify = edit(MERGIFY, from, to);
            expect(rules(fixture({ mergify })), to).toEqual(["queue-merge"]);
        }
    });

    it("requires one check at a time and no batches (issue #5642, ADR 0160)", () => {
        for (const [from, to] of [
            ["max_parallel_checks: 1", "max_parallel_checks: 2"],
            ["merge_queue:\n  max_parallel_checks: 1\n", ""],
            ["batch_size: 1", "batch_size: 2"],
        ] as const) {
            const mergify = edit(MERGIFY, from, to);
            expect(rules(fixture({ mergify })), to).toEqual(["queue-shape"]);
        }
    });

    it("requires a red dequeue to relabel the PR land-failed with a link (issue #5642)", () => {
        for (const [from, to] of [
            ["          - queue-dequeue-reason=checks-timeout\n", ""],
            ["add: [land-failed]", "add: [dequeued]"],
            ["remove: [ready-to-land]", "remove: []"],
            ["https://example.test/run", "see the queue"],
            ["      - or:\n", "      - not:\n"],
            // a RED is a hold, not a repair pick (issue #6110)
            ["      - -check-failure=base-health\n", ""],
            ["      - -label=queue:held\n", ""],
            [
                "      - -check-failure=base-health\n      - -label=queue:held\n      - or:\n",
                "      - -label=queue:held\n      - or:\n          - -check-failure=base-health\n",
            ],
        ] as const) {
            const mergify = edit(MERGIFY, from, to);
            // dropping the hold exemption also reds `queue-refusal-hold`
            expect(rules(fixture({ mergify })), from).toContain(
                "queue-dequeue"
            );
        }
    });

    it("holds a PR whose lane is red under a RED, never land-failed (issue #6256)", () => {
        for (const [from, to] of [
            [
                "      - label=ready-to-land\n      - -check-failure=base-health\n      - -label=queue:held\n      - or:\n          - check-failure=check:lane",
                "      - label=ready-to-land\n      - -label=queue:held\n      - or:\n          - check-failure=check:lane",
            ],
            [
                "      - -check-failure=base-health\n      - -label=queue:held\n      - or:\n          - check-failure=check:lane",
                "      - -check-failure=base-health\n      - or:\n          - check-failure=check:lane",
            ],
            ["        add: [queue:held]", "        add: [land-failed]"],
            [
                "      - check-failure=base-health\n      - check-failure=check:lane (advisory)\n    actions:\n      label:\n        add: [queue:held]",
                "      - check-failure=check:lane (advisory)\n    actions:\n      label:\n        add: [queue:held]",
            ],
        ] as const) {
            const mergify = edit(MERGIFY, from, to);
            expect(rules(fixture({ mergify })), to).toContain(
                "queue-refusal-hold"
            );
        }
    });

    it("reports a file it cannot parse", () => {
        expect(rules(fixture({ hosted: "on: [push\n" }))).toEqual([
            "unparseable",
        ]);
    });
});

describe("the owner-merge workflow (issue #6188)", () => {
    const check = (text: string): RuleId[] =>
        rules({
            ...fixture(),
            workflows: [
                ...fixture().workflows,
                { path: ".github/workflows/owner-merge.yml", text },
            ],
        });

    it("admits the labeled trigger, the label filter and a base checkout", () => {
        expect(check(OWNER_MERGE)).toEqual([]);
    });

    it("refuses a job without the ready-to-land label filter", () => {
        const text = edit(
            OWNER_MERGE,
            "    if: github.event.label.name == 'ready-to-land'\n",
            ""
        );
        expect(check(text)).toContain("owner-merge-trigger");
    });

    it("refuses a trigger beyond `labeled` (a second email per hand-off)", () => {
        const synchronize = edit(
            OWNER_MERGE,
            "types: [labeled]",
            "types: [labeled, synchronize]"
        );
        expect(check(synchronize)).toContain("owner-merge-trigger");
        const extra = edit(
            OWNER_MERGE,
            "jobs:",
            "  schedule:\n    - cron: '*/15 * * * *'\njobs:"
        );
        expect(check(extra)).toContain("owner-merge-trigger");
    });

    it("refuses a job that checks nothing out", () => {
        const text = edit(
            OWNER_MERGE,
            `      - uses: actions/checkout@${SHA}\n`,
            ""
        );
        expect(check(text)).toContain("owner-merge-trigger");
    });
});
