// health:batch-due — has the base landed a batch (`LANDINGS_PER_BATCH`) since
// its newest health verdict, with no run in flight? (ADR 0159 § 4, issue
// #6990). `health-early.yml`'s `classify` job runs it on every push:
// `due=true|false` goes to $GITHUB_OUTPUT, and on `true` the job dispatches
// health.yml's `gate` on the new tip — GREEN by event, the cron the fallback.
//
//   bun run health:batch-due --sha <sha>
import { appendFileSync } from "node:fs";
import { pushOwesBatchRun } from "./lib/health-batch-due";

const i = process.argv.indexOf("--sha");
const sha = i === -1 ? undefined : process.argv[i + 1];
if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
    console.error("usage: bun run health:batch-due --sha <40-hex sha>");
    process.exit(2);
}
const due = pushOwesBatchRun(process.cwd(), sha);
console.log(`health:batch-due: ${sha.slice(0, 8)} due=${due}`);
if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `due=${due}\n`);
