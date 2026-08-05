#!/usr/bin/env bun
// `bun run queue:lint` — is an issue well-formed enough to be worked?
//
// Two callers at opposite ends of the queue's life: the intake skills before
// publishing (quality enforced at WRITE time, while the author is still in
// context) and the planner before admitting (a pre-existing defect cannot
// poison a batch).
//
// Usage:
//   bun run queue:lint 2188 2190       # specific issues
//   bun run queue:lint --all           # the whole ready-for-agent queue
//   bun run queue:lint --all --json    # machine-readable
//
// Exits 1 when any BLOCKING finding is present, 0 otherwise — so an intake
// skill can gate on it without parsing anything.

import { gh } from "./lib/gh";
import {
    lintIssue,
    isBlocking,
    type Finding,
    type LintableIssue,
} from "./lib/queue-lint";

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const all = argv.includes("--all");
const explicit = argv.filter((a) => /^\d+$/.test(a)).map(Number);

if (!all && explicit.length === 0) {
    console.error("usage: bun run queue:lint <issue…> | --all [--json]");
    process.exit(2);
}

const numbers = all
    ? (
          JSON.parse(
              gh([
                  "issue",
                  "list",
                  "--label",
                  "ready-for-agent",
                  "--state",
                  "open",
                  "--json",
                  "number",
                  "--limit",
                  "100",
              ])
          ) as { number: number }[]
      ).map((i) => i.number)
    : explicit;

const results: { issue: LintableIssue; findings: Finding[] }[] = [];

for (const n of numbers) {
    const raw = JSON.parse(
        gh([
            "issue",
            "view",
            String(n),
            "--json",
            "number,title,labels,parent,body",
        ])
    ) as {
        number: number;
        title: string;
        labels: { name: string }[];
        parent: { number: number } | null;
        body: string;
    };
    const issue: LintableIssue = {
        number: raw.number,
        title: raw.title,
        labels: raw.labels.map((l) => l.name),
        parentNumber: raw.parent?.number ?? null,
        body: raw.body ?? "",
    };
    results.push({ issue, findings: lintIssue(issue) });
}

if (asJson) {
    process.stdout.write(
        JSON.stringify(
            results.map((r) => ({
                number: r.issue.number,
                findings: r.findings,
            })),
            null,
            2
        ) + "\n"
    );
} else {
    let blocking = 0;
    let advisory = 0;
    for (const { issue, findings } of results) {
        if (findings.length === 0) continue;
        console.log(`\n#${issue.number} ${issue.title.slice(0, 70)}`);
        for (const f of findings) {
            const tag = f.severity === "blocking" ? "BLOCKING" : "advisory";
            if (f.severity === "blocking") blocking++;
            else advisory++;
            console.log(`  [${tag}] ${f.rule}: ${f.message}`);
            console.log(`      fix: ${f.fix}`);
        }
    }
    const clean = results.filter((r) => r.findings.length === 0).length;
    console.log(
        `\n${results.length} issue(s): ${clean} clean, ${blocking} blocking finding(s), ${advisory} advisory`
    );
}

process.exit(results.some((r) => isBlocking(r.findings)) ? 1 : 0);
