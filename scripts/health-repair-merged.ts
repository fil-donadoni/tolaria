// health:repair-merged — does the pushed base tip merge a declared repair of
// the standing RED? (issue #6553). `health-early.yml`'s `classify` job runs it
// first: `repair=true|false` goes to $GITHUB_OUTPUT, and on a repair the job
// also dispatches the full health gate on the new tip.
//
//   bun run health:repair-merged --sha <sha>
import { appendFileSync } from "node:fs";
import { pushMergesDeclaredRepair } from "./lib/health-repair-merge";

const i = process.argv.indexOf("--sha");
const sha = i === -1 ? undefined : process.argv[i + 1];
if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
    console.error("usage: bun run health:repair-merged --sha <40-hex sha>");
    process.exit(2);
}
const repair = pushMergesDeclaredRepair(process.cwd(), sha);
console.log(`health:repair-merged: ${sha.slice(0, 8)} repair=${repair}`);
if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `repair=${repair}\n`);
