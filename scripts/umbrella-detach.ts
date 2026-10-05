#!/usr/bin/env bun
/**
 * `bun run umbrella:detach <issue#>` — remove a CLOSED issue from the band
 * umbrella it is a sub-issue of (issue #4235). Run it by hand for an issue
 * that was closed some other way (the merge keyword failed and the issue was
 * closed by hand, or it landed before this step existed).
 *
 * `bun run umbrella:detach --sweep` — the same rule over every child of every
 * censused umbrella (issue #5081): `gaps:sync` closures, cluster absorption
 * and hand closes never pass through a single-issue run. `land` runs
 * `<issue#> --sweep` after every merge (the sweep alone for a branch that
 * names no issue).
 *
 * Idempotent: an issue with no parent, or under a parent that is not a band
 * umbrella, or still open, is left alone and says why. Always exits 0 on a
 * readable outcome — this is housekeeping, and `land` runs it non-gating.
 */

import {
    LIVE_DETACH_DEPS,
    describeOutcome,
    describeSweepResult,
    detachFromUmbrella,
    sweepUmbrellas,
} from "./lib/umbrella-detach";

const args = process.argv.slice(2);
const sweep = args.includes("--sweep");
const positional = args.filter((a) => a !== "--sweep");
const issue =
    positional.length === 1 ? Number(positional[0]!.replace(/^#/, "")) : null;
if (
    positional.length > 1 ||
    (issue !== null && (!Number.isInteger(issue) || issue <= 0)) ||
    (issue === null && !sweep)
) {
    console.error(
        "usage: bun run umbrella:detach <issue#> | [<issue#>] --sweep"
    );
    process.exit(2);
}

if (issue !== null) {
    const outcome = detachFromUmbrella(issue, LIVE_DETACH_DEPS);
    const line = describeOutcome(issue, outcome);
    if (outcome.kind === "failed" || outcome.kind === "open")
        console.warn(line);
    else console.log(line);
}

if (sweep) {
    const results = sweepUmbrellas(LIVE_DETACH_DEPS);
    for (const result of results) {
        const line = describeSweepResult(result);
        if ("listFailed" in result || result.outcome.kind !== "detached")
            console.warn(line);
        else console.log(line);
    }
    const detached = results.filter(
        (r) => !("listFailed" in r) && r.outcome.kind === "detached"
    ).length;
    console.log(
        `umbrella:detach: sweep detached ${detached} closed child${detached === 1 ? "" : "ren"}`
    );
}
