#!/usr/bin/env bun
/**
 * The `merge=cr-ledger` merge driver (issue #3768).
 *
 * Registered in LOCAL git config by `scripts/bootstrap-worktree.ts` — git merge
 * drivers cannot be committed, so the bootstrap is the only repo-controlled
 * place to install one. `.gitattributes` names it for {@link LEDGER_PATH}.
 *
 * WHAT IT DOES. It never runs the text merge at all: it parses the three
 * sides, merges them as a keyed SET of facts ({@link mergeLedgers}) and writes
 * the result through the ledger's own serializer, so the output is
 * byte-identical to what `cr:ledger` would write for the same entry set and
 * the merged file is stable under the next run.
 *
 * WHY NOT `merge=regenerated`. That driver takes OURS on conflict and defers to
 * a regeneration at the rebased tip. This file has no generator to defer to —
 * `cr:ledger` upserts and prunes, it never re-derives the whole file — so
 * taking a side would silently drop the other branch's confirmations. Hence a
 * second, independent driver name, no regenerate marker, and nothing for
 * `resolve-generated-artifacts.ts` to do.
 *
 * Exits non-zero only when a side does not PARSE. That is the one case where a
 * conflict is real: the file is the citation guard's memory, and a corrupted
 * memory must reach a human rather than be merged into a plausible-looking
 * ledger.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
    emptyLedger,
    mergeLedgers,
    parseLedger,
    serializeLedger,
    type Ledger,
} from "./lib/cr-ledger";

// git invokes a merge driver with cwd at the top of the working tree and
// substitutes %O (base), %A (ours — and the file to write), %B (theirs),
// %P (the path being merged, for messages).
const [base, ours, theirs, path] = process.argv.slice(2);
if (!base || !ours || !theirs) {
    process.stderr.write(
        "merge-driver-cr-ledger: expected %O %A %B %P as arguments\n"
    );
    process.exit(2);
}
const label = path ?? ours;

/**
 * An add/add merge has no common ancestor and git hands the driver an EMPTY
 * base file — every key on either side is then an addition, which is exactly
 * what an empty ledger makes the set merge say.
 */
function read(file: string, side: string): Ledger {
    const text = readFileSync(file, "utf8");
    if (text.trim() === "") return emptyLedger();
    try {
        return parseLedger(text);
    } catch (err) {
        process.stderr.write(
            `merge-driver-cr-ledger: the ${side} side of ${label} does not parse as a citation ledger — ` +
                `resolving it by hand is the only honest option (${String(err)})\n`
        );
        process.exit(1);
    }
}

const merged = mergeLedgers({
    base: read(base, "base"),
    ours: read(ours, "ours"),
    theirs: read(theirs, "theirs"),
});
writeFileSync(ours, serializeLedger(merged));
process.exit(0);
