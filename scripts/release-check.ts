/**
 * `bun scripts/release-check.ts <issue> [--hand-back]` — the release site's
 * check (issue #7646), called by `deny-guard.sh` § 6c: a claim release on an
 * issue with an open PR must also hand the issue back (`ready-for-human`).
 * Exit 2 + the refusal on stderr; a failed `gh` read fails OPEN (a release is
 * never blocked by infra).
 */
import { releaseRefusal } from "./lib/claim-labels";
import { fetchOpenPrRows, openPrFor, openPrMap } from "./lib/claim-verdict";
import { gh } from "./lib/gh";

if (import.meta.main) {
    const issue = Number(process.argv[2]);
    if (!Number.isInteger(issue)) process.exit(0);
    let pr: number | null = null;
    try {
        pr = openPrFor(
            issue,
            openPrMap(fetchOpenPrRows((_cmd, args) => gh(args)))
        );
    } catch {
        process.exit(0);
    }
    const refusal = releaseRefusal(
        issue,
        pr,
        process.argv.includes("--hand-back")
    );
    if (refusal) {
        console.error(refusal);
        process.exit(2);
    }
}
