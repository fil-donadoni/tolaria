// Parallel Planner with Review — four-phase orchestration loop
//
// This template drives a multi-phase workflow:
//   Phase 1 (Plan):             An opus agent analyzes open issues, builds a
//                               dependency graph, and outputs a <plan> JSON
//                               listing unblocked issues with branch names.
//   Phase 2+3 (Batch Execute + Merge):
//                               Issues are split into batches of
//                               MAX_CONCURRENT_ISSUES. Each batch runs
//                               implement + review in parallel, then a merge
//                               agent integrates completed branches before
//                               the next batch starts.
//
// The outer loop repeats up to MAX_ITERATIONS times so that newly unblocked
// issues are picked up after each round of merges.
//
// Usage:
//   npx tsx .sandcastle/main.ts [concurrency]
//
//   concurrency  Max parallel issues per batch (default: 3, use 1 for serial)
//
// Examples:
//   npx tsx .sandcastle/main.ts        # 3 parallel
//   npx tsx .sandcastle/main.ts 1      # fully serial
//   npx tsx .sandcastle/main.ts 5      # 5 parallel

process.setMaxListeners(0);

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Maximum number of plan→execute→merge cycles before stopping.
const MAX_ITERATIONS = 10;

// Maximum issues to execute in parallel per batch.
const MAX_CONCURRENT_ISSUES = parseInt(process.argv[2] ?? "3", 10);

// Hooks run inside the sandbox before the agent starts each iteration.
// npm install ensures the sandbox always has fresh dependencies.
const hooks = {
    sandbox: { onSandboxReady: [{ command: "npm install" }] },
};

// node_modules is 666MB — copying it to 12 worktrees in parallel exceeds
// the 60s timeout. Let npm install handle it from cache instead.
const copyToWorktree: string[] = [];

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

    // -------------------------------------------------------------------------
    // Phase 1: Plan
    //
    // The planning agent (opus, for deeper reasoning) reads the open issue list,
    // builds a dependency graph, and selects the issues that can be worked in
    // parallel right now (i.e., no blocking dependencies on other open issues).
    //
    // It outputs a <plan> JSON block — we parse that to drive Phase 2.
    // -------------------------------------------------------------------------
    const plan = await sandcastle.run({
        hooks,
        sandbox: docker(),
        name: "planner",
        // One iteration is enough: the planner just needs to read and reason,
        // not write code.
        maxIterations: 1,
        // Opus for planning: dependency analysis benefits from deeper reasoning.
        agent: sandcastle.claudeCode("claude-opus-4-7"),
        promptFile: "./.sandcastle/plan-prompt.md",
    });

    // Extract the <plan>…</plan> block from the agent's stdout.
    const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/);
    if (!planMatch) {
        throw new Error(
            "Planning agent did not produce a <plan> tag.\n\n" + plan.stdout
        );
    }

    // The plan JSON contains an array of issues, each with id, title, branch.
    const { issues } = JSON.parse(planMatch[1]!) as {
        issues: { id: string; title: string; branch: string }[];
    };

    if (issues.length === 0) {
        // No unblocked work — either everything is done or everything is blocked.
        console.log("No unblocked issues to work on. Exiting.");
        break;
    }

    const totalIssues = issues.length;
    const batchCount = Math.ceil(totalIssues / MAX_CONCURRENT_ISSUES);

    console.log(
        `Planning complete. ${totalIssues} issue(s) in ${batchCount} batch(es) of up to ${MAX_CONCURRENT_ISSUES}:`
    );
    for (const issue of issues) {
        console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);
    }

    // -------------------------------------------------------------------------
    // Phase 2 + 3: Execute batches, merge after each
    //
    // Issues are chunked into batches of MAX_CONCURRENT_ISSUES. Each batch
    // runs execute+review in parallel, then merges completed branches before
    // the next batch starts. This keeps resource usage bounded and reduces
    // merge conflict surface.
    // -------------------------------------------------------------------------

    for (let b = 0; b < batchCount; b++) {
        const batch = issues.slice(
            b * MAX_CONCURRENT_ISSUES,
            (b + 1) * MAX_CONCURRENT_ISSUES
        );

        console.log(
            `\n--- Batch ${b + 1}/${batchCount} (${batch.length} issue(s)) ---`
        );

        const settled = await Promise.allSettled(
            batch.map(async (issue) => {
                const sandbox = await sandcastle.createSandbox({
                    branch: issue.branch,
                    sandbox: docker(),
                    hooks,
                    copyToWorktree,
                });

                try {
                    const implement = await sandbox.run({
                        name: "implementer",
                        maxIterations: 100,
                        agent: sandcastle.claudeCode("claude-opus-4-7"),
                        promptFile: "./.sandcastle/implement-prompt.md",
                        promptArgs: {
                            TASK_ID: issue.id,
                            ISSUE_TITLE: issue.title,
                            BRANCH: issue.branch,
                        },
                    });

                    if (implement.commits.length > 0) {
                        const review = await sandbox.run({
                            name: "reviewer",
                            maxIterations: 1,
                            agent: sandcastle.claudeCode("claude-opus-4-7"),
                            promptFile: "./.sandcastle/review-prompt.md",
                            promptArgs: {
                                BRANCH: issue.branch,
                            },
                        });

                        return {
                            ...review,
                            commits: [...implement.commits, ...review.commits],
                        };
                    }

                    return implement;
                } finally {
                    await sandbox.close();
                }
            })
        );

        for (const [i, outcome] of settled.entries()) {
            if (outcome.status === "rejected") {
                console.error(
                    `  ✗ ${batch[i]!.id} (${batch[i]!.branch}) failed: ${outcome.reason}`
                );
            }
        }

        const completedIssues = settled
            .map((outcome, i) => ({ outcome, issue: batch[i]! }))
            .filter(
                (entry) =>
                    entry.outcome.status === "fulfilled" &&
                    entry.outcome.value.commits.length > 0
            )
            .map((entry) => entry.issue);

        const completedBranches = completedIssues.map((i) => i.branch);

        console.log(
            `\nBatch ${b + 1} done. ${completedBranches.length} branch(es) with commits:`
        );
        for (const branch of completedBranches) {
            console.log(`  ${branch}`);
        }

        if (completedBranches.length === 0) {
            console.log("No commits in this batch. Skipping merge.");
            continue;
        }

        // Merge after each batch so the next batch starts from a cleaner base.
        await sandcastle.run({
            hooks,
            sandbox: docker(),
            name: "merger",
            maxIterations: 1,
            agent: sandcastle.claudeCode("claude-opus-4-7"),
            promptFile: "./.sandcastle/merge-prompt.md",
            promptArgs: {
                BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
                ISSUES: completedIssues
                    .map((i) => `- ${i.id}: ${i.title}`)
                    .join("\n"),
            },
        });

        console.log(`\nBatch ${b + 1} merged.`);
    }
}

console.log("\nAll done.");
