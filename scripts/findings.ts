#!/usr/bin/env bun
// `bun run findings` — the pre-triage drawer.
//
// Lists what subagents noticed but were not asked to fix, so a human can decide
// which of them becomes an issue. The loop never files its own work (see
// `scripts/lib/findings.ts`); this is the handoff.
//
// Usage:
//   bun run findings              # open drafts only
//   bun run findings --all        # including triaged and declined
//   bun run findings --json

import * as fs from "fs";
import * as path from "path";
import { parseFinding, triageOrder, type Finding } from "./lib/findings";

const DIR = path.join(process.cwd(), "docs", "findings");
const showAll = process.argv.includes("--all");
const asJson = process.argv.includes("--json");

const findings: Finding[] = fs.existsSync(DIR)
    ? fs
          .readdirSync(DIR)
          .filter((f) => f.endsWith(".md") && f !== "README.md")
          .map((f) =>
              // A malformed finding THROWS rather than being skipped: a draft
              // silently dropped from the drawer is the same as never written.
              parseFinding(f, fs.readFileSync(path.join(DIR, f), "utf8"))
          )
    : [];

const shown = triageOrder(findings).filter(
    (f) => showAll || f.status === "draft"
);

if (asJson) {
    console.log(JSON.stringify(shown, null, 2));
    process.exit(0);
}

if (shown.length === 0) {
    console.log(
        findings.length === 0
            ? "\nNo findings recorded.\n"
            : `\nNo open drafts (${findings.length} total — use --all).\n`
    );
    process.exit(0);
}

console.log(`\n${shown.length} finding(s) awaiting triage\n`);
for (const f of shown) {
    const tag =
        f.status === "draft"
            ? `[${f.confidence}]`
            : `[${f.status}${f.issue ? ` #${f.issue}` : ""}]`;
    console.log(`${tag.padEnd(10)} ${f.title}`);
    console.log(
        `${" ".repeat(11)}from #${f.discoveredBy} · docs/findings/${f.file}`
    );
    const first = f.body.split("\n").find((l) => l.trim() !== "") ?? "";
    console.log(`${" ".repeat(11)}${first.slice(0, 96)}\n`);
}
console.log("Open one, decide, then either:");
console.log(
    "  · file it     → gh issue create …, then set status: triaged + issue: N"
);
console.log("  · drop it     → set status: declined and say why in the body\n");
