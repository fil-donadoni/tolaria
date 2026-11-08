/**
 * `bun scripts/radius-check.ts --body-file <path> | <issue#>` — the
 * blast-radius gate (issue #8937), called by `deny-guard.sh` § 8.
 * Exit 2 + the refusal on stderr when the body declares no readable
 * `Target files`; any read failure exits 0 (infra never blocks a session).
 */
import { readFileSync } from "node:fs";
import { gh } from "./lib/gh";
import { radiusRefusal } from "./lib/radius-check";

if (import.meta.main) {
    const argv = process.argv.slice(2);
    const fileAt = argv.indexOf("--body-file");
    let subject: string;
    let body: string;
    try {
        if (fileAt !== -1) {
            const path = argv[fileAt + 1];
            if (!path) process.exit(0);
            subject = `body file ${path}`;
            body = readFileSync(path, "utf8");
        } else {
            const issue = Number((argv[0] ?? "").replace(/^#/, ""));
            if (!Number.isInteger(issue) || issue <= 0) process.exit(0);
            subject = `issue #${issue}`;
            body = JSON.parse(
                gh(["issue", "view", String(issue), "--json", "body"])
            ).body as string;
        }
    } catch {
        process.exit(0);
    }
    const refusal = radiusRefusal(subject, body);
    if (refusal) {
        console.error(refusal);
        process.exit(2);
    }
}
