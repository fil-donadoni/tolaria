import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    checkStructure,
    formatViolation,
    isSelfHosted,
    JOB_SETUP_FILE,
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

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

const HOSTED = `
on:
  pull_request:
concurrency:
  group: x
  cancel-in-progress: true
jobs:
  lane:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@${SHA}
      - uses: ./.github/actions/job-setup
      - run: bun run check:lane
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
    runs-on: [self-hosted, lane]
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

const JOB_SETUP = readFileSync(join(REPO, JOB_SETUP_FILE), "utf8");

const MERGIFY = `
merge_queue:
  max_parallel_checks: 2
queue_rules:
  - name: default
    queue_conditions:
      - label=queue:shadow
      - label=ready-to-land
      - -label=land-failed
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
      - or:
          - queue-dequeue-reason=checks-failed
          - queue-dequeue-reason=checks-timeout
    actions:
      label:
        add: [land-failed]
        remove: [ready-to-land]
      comment:
        message: "dequeued — https://example.test/run"
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
            "      - run: bun run check:lane",
            `      - run: bun run check:lane${env}`
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
            "      - uses: ./.github/actions/job-setup\n      - run: bun run check:lane\n",
            "      - run: bun run check:lane\n      - uses: ./.github/actions/job-setup\n"
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

    it("refuses a queue rule that does not gate entry", () => {
        for (const line of [
            "      - label=queue:shadow\n",
            "      - label=ready-to-land\n",
            "      - -label=land-failed\n",
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

    it("requires two parallel checks and no batches (issue #5642)", () => {
        for (const [from, to] of [
            ["max_parallel_checks: 2", "max_parallel_checks: 3"],
            ["merge_queue:\n  max_parallel_checks: 2\n", ""],
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
        ] as const) {
            const mergify = edit(MERGIFY, from, to);
            expect(rules(fixture({ mergify })), from).toEqual([
                "queue-dequeue",
            ]);
        }
    });

    it("reports a file it cannot parse", () => {
        expect(rules(fixture({ hosted: "on: [push\n" }))).toEqual([
            "unparseable",
        ]);
    });
});
