#!/usr/bin/env bun
/**
 * `bun run umbrella:detach <issue#>` — remove a CLOSED issue from the band
 * umbrella it is a sub-issue of (issue #4235). `land` runs it after every
 * merge for the issue the branch names; run it by hand for an issue that was
 * closed some other way (the merge keyword failed and the issue was closed by
 * hand, or it landed before this step existed).
 *
 * Idempotent: an issue with no parent, or under a parent that is not a band
 * umbrella, or still open, is left alone and says why. Always exits 0 on a
 * readable outcome — this is housekeeping, and `land` runs it non-gating.
 */

import {
    LIVE_DETACH_DEPS,
    describeOutcome,
    detachFromUmbrella,
} from "./lib/umbrella-detach";

const issue = Number((process.argv[2] ?? "").replace(/^#/, ""));
if (!Number.isInteger(issue) || issue <= 0) {
    console.error("usage: bun run umbrella:detach <issue#>");
    process.exit(2);
}
const outcome = detachFromUmbrella(issue, LIVE_DETACH_DEPS);
const line = describeOutcome(issue, outcome);
if (outcome.kind === "failed" || outcome.kind === "open") console.warn(line);
else console.log(line);
