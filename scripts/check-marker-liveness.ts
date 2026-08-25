#!/usr/bin/env bun
/**
 * Divergence-marker LIVENESS sweep (issue #2560) — the other half of Guard B.
 *
 * Guard B (`convex/cards/__tests__/divergenceMarkers.test.ts`) checks only
 * that a divergence marker's own comment paragraph carries a tracking
 * disposition (`#NNN` / `tracked-by:` / an explicit "out of scope" note) —
 * PRESENCE, never whether the referenced issue is still open. A ref to a
 * long-closed issue satisfies Guard B exactly as well as a live one, so a
 * tracked divergence can quietly become an untracked one the moment its
 * issue closes with nobody noticing.
 *
 * This script resolves every `#NNN` a TRACKED marker names via `gh` and reds
 * when any of them is CLOSED. It needs the network, so per ADR 0098
 * ("check:all is offline by contract" — the reason `cr:check` sits outside
 * the gate too) it is NOT wired into `check:all` or `check:guards`. Reach it
 * explicitly:
 *
 *   bun run markers:lint
 *
 * A second mode is the loop's own umbrella-close refusal
 * (`.claude/skills/process-gh-issues/SKILL.md` § umbrella-close): before
 * auto-closing a `prd` issue on every sub-issue closed, the loop runs
 *
 *   bun scripts/check-marker-liveness.ts --umbrella <N>
 *
 * which exits non-zero and lists the blocking marker sites when a LIVE
 * marker's `tracked-by:` still names `N` — no network needed for that mode,
 * it is a pure text question, but it lives in this one script for a single
 * CLI to remember.
 *
 * ── SCOPE — the load-bearing decision ───────────────────────────────────────
 *
 * ~111 `tracked-by: #NNN` refs exist repo-wide, but almost all of them are
 * PROSE showing the convention as documentation/example, not a real marker a
 * build ever sees — 305 hits alone live under `.claude/` (skill and rule
 * docs demonstrating the Guard B convention in prose/fenced examples). A real
 * divergence marker is always a COMMENT inside compiled source — a `//` line
 * OR a `/** … *\/` / JSDoc block (Guard B's own MARKER regex only ever
 * required `//` because it was scoped to `convex/cards/sets/**`, where every
 * marker so far happens to be line-commented; the wider liveness sweep finds
 * live `tracked-by:` dispositions inside `/** *\/` blocks too — see
 * `convex/cards/types.ts`, `convex/limited/eventTypes.ts`,
 * `src/lib/deckViewPrefs.ts`, corrected in issue #2560's fixup round 1,
 * finding 4, after the false "always `//`" claim here hid 5 real sites) —
 * so this sweep scans only tracked `.ts`/`.tsx`/`.mts`/`.mjs`/`.js` files
 * (never `.md`), which drops the `.claude/` and most-of-`docs/` prose noise
 * without a single allowlist entry. Two further exclusions, both required by
 * the issue's own acceptance criteria:
 *   - `__tests__/**` and `*.test.*` — test fixtures, including Guard B's own
 *     regression strings (`convex/cards/__tests__/divergenceMarkers.test.ts`
 *     contains `"// DEFERRED: …"` INSIDE string literals to exercise the
 *     scanner; scanned as raw text those lines match MARKER exactly like a
 *     real comment would, so they MUST be excluded or every run of this
 *     script would red on its own sibling's fixtures).
 *   - `docs/findings/**` — draft observations (`docs/findings/README.md`),
 *     explicitly exempt.
 *
 * In one sentence: scan wherever a real comment can actually ship (any
 * tracked TS/JS source, `//` or `/** *\/` alike), and nowhere a marker can
 * only be prose (`.md`) or a scanner's own test fixture.
 *
 * A THIRD exclusion is content, not path: a marker sitting in the same
 * contiguous comment run as a commented-out `// export const … : CardDefinition`
 * stub anchor is `check-stub-coverage.ts`'s domain (its OWN `tracked-by:`
 * disposition, checked offline already) — issue #2560's own "out of scope"
 * note ("detecting markers inside commented-out card stubs … a separate
 * known gap already drafted in the findings drawer",
 * `docs/findings/2392-guard-b-misses-commented-out-card-stubs.md` part ii).
 * Left unfiltered this sweep would resolve liveness for ~60 stub notes
 * clustered on a handful of residue-tranche umbrellas (`#676`, `#679`, …) —
 * a different, larger cleanup than this issue scoped. `isStubContext` /
 * `STUB_ANCHOR`, imported from `scripts/lib/divergence-markers.ts`, reproduce
 * `check-stub-coverage.ts`'s own anchor and contiguous-comment-run window.
 * Issue #1900 moved them into the shared scanner so Guard B's OWN presence
 * check applies the same suppression — its widened MARKER vocabulary would
 * otherwise land inside commented-out-stub section prose too.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gh } from "./lib/gh";
import {
    scanTrackedByRefs,
    isStubContext,
    type MarkerRecord,
} from "./lib/divergence-markers";
// `STUB_ANCHOR` / `isStubContext` moved to `scripts/lib/divergence-markers.ts`
// in issue #1900, so Guard B's OWN scan can suppress stub context too (the
// widened MARKER vocabulary otherwise lands inside commented-out-stub
// section prose). Re-exported here so any external caller importing them
// from this module keeps working.
export { STUB_ANCHOR, isStubContext } from "./lib/divergence-markers";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Tracked source where a REAL (compiled) divergence-marker comment can
 *  live — never `.md`. See the SCOPE note above. */
export const SCANNED = /\.(ts|tsx|mts|mjs|js)$/;

/** Excludes test fixtures (incl. Guard B's own regression strings) and
 *  findings drafts — both required exempt by the issue's acceptance
 *  criteria. */
export function inScope(file: string): boolean {
    if (!SCANNED.test(file)) return false;
    if (/(^|\/)__tests__\//.test(file)) return false;
    if (/\.test\.[tj]sx?$/.test(file)) return false;
    if (file.startsWith("docs/findings/")) return false;
    return true;
}

/** Every tracked file the sweep considers. */
export function scannedFiles(root = ROOT): string[] {
    return execSync("git ls-files", {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 << 20,
    })
        .split("\n")
        .filter(inScope);
}

export function readSources(root = ROOT): { file: string; text: string }[] {
    const sources: { file: string; text: string }[] = [];
    for (const file of scannedFiles(root)) {
        try {
            sources.push({
                file,
                text: readFileSync(join(root, file), "utf8"),
            });
        } catch {
            continue;
        }
    }
    return sources;
}

/** Scan every in-scope source for `tracked-by:` dispositions, dropping
 *  stub-context hits. Pure over the source list, so it can be driven with
 *  synthetic content in tests.
 *
 *  Uses `scanTrackedByRefs`, NOT Guard B's `scanText` — deliberately (issue
 *  #2560 fixup round 1, finding 1). `scanText` only emits a record for a line
 *  matching Guard B's MARKER-word regex, which most per-card divergence
 *  paragraphs in this repo never do (they open with the card's own name).
 *  Liveness only ever resolves the `tracked-by:` numbers a record carries —
 *  `findRottenMarkers`/`markersBlockingClosure` both ignore an untracked
 *  record — so anchoring directly on `tracked-by:` occurrences, rather than
 *  on the MARKER word, drops nothing this sweep used and picks up every real
 *  disposition `scanText`'s narrower gate missed. */
export function scanRepoMarkers(
    sources: Iterable<{ file: string; text: string }>
): MarkerRecord[] {
    const out: MarkerRecord[] = [];
    for (const { file, text } of sources) {
        const lines = text.split("\n");
        for (const rec of scanTrackedByRefs(file, text)) {
            if (isStubContext(lines, rec.line - 1)) continue;
            out.push(rec);
        }
    }
    return out;
}

export interface RottenMarker {
    file: string;
    line: number;
    text: string;
    closedIssues: number[];
}

export interface UnresolvedMarker {
    file: string;
    line: number;
    text: string;
    unknownIssues: number[];
}

/**
 * The verdict — a pure function over already-resolved issue states, so it is
 * unit-testable with plain data and needs no `gh` mock (repo convention: see
 * `scripts/__tests__/land.test.ts`'s `refusalReason`). Only TRACKED markers
 * naming at least one `#NNN` are candidates — an "out of scope" disposition
 * or a bare `tracked-by:` with no number has nothing to resolve.
 *
 * Only an issue state PROVEN `CLOSED` counts as rotten — `UNKNOWN` (network
 * failure, rate limit, bad auth: see `resolveIssueStates`) is a SEPARATE
 * verdict, `findUnresolvedMarkers` below, so a broken token cannot masquerade
 * as mass rot (issue #2560 fixup round 1, finding 5).
 */
export function findRottenMarkers(
    markers: readonly MarkerRecord[],
    issueStates: ReadonlyMap<number, "OPEN" | "CLOSED" | "UNKNOWN">
): RottenMarker[] {
    const out: RottenMarker[] = [];
    for (const m of markers) {
        if (!m.tracked || m.issueNumbers.length === 0) continue;
        const closedIssues = m.issueNumbers.filter(
            (n) => issueStates.get(n) === "CLOSED"
        );
        if (closedIssues.length > 0) {
            out.push({
                file: m.file,
                line: m.line,
                text: m.text,
                closedIssues,
            });
        }
    }
    return out;
}

/**
 * The other half of the same verdict: markers naming an issue `gh` could not
 * resolve at all. Reported and exit-1'd SEPARATELY from `findRottenMarkers`
 * — an operator reading "N closed" when the real story is "gh auth expired"
 * would chase the wrong thing (issue #2560 fixup round 1, finding 5).
 */
export function findUnresolvedMarkers(
    markers: readonly MarkerRecord[],
    issueStates: ReadonlyMap<number, "OPEN" | "CLOSED" | "UNKNOWN">
): UnresolvedMarker[] {
    const out: UnresolvedMarker[] = [];
    for (const m of markers) {
        if (!m.tracked || m.issueNumbers.length === 0) continue;
        const unknownIssues = m.issueNumbers.filter(
            (n) => issueStates.get(n) === "UNKNOWN"
        );
        if (unknownIssues.length > 0) {
            out.push({
                file: m.file,
                line: m.line,
                text: m.text,
                unknownIssues,
            });
        }
    }
    return out;
}

/**
 * The loop's umbrella-close refusal (SKILL.md § umbrella-close): a `prd`
 * issue still named by any LIVE (tracked, non-closed-issue) marker must not
 * be auto-closed even when every sub-issue is closed. Pure function over the
 * already-scanned markers and the umbrella's own issue number — returns the
 * marker sites that block closure (empty ⇒ closure is allowed).
 */
export function markersBlockingClosure(
    markers: readonly MarkerRecord[],
    umbrellaIssue: number
): MarkerRecord[] {
    return markers.filter(
        (m) => m.tracked && m.issueNumbers.includes(umbrellaIssue)
    );
}

/** Resolve issue state for a batch of numbers, one `gh issue view` per
 *  number — the same per-issue pattern `scripts/queue-lint.ts` already uses
 *  for issue lookups.
 *
 *  A `gh` call that FAILS (deleted issue, no access, expired auth, rate
 *  limit) cannot be proven either open or closed — it is `UNKNOWN`, never
 *  silently coerced to `CLOSED`. Issue #2560 fixup round 1, finding 5: the
 *  original version mapped every `gh` failure to `CLOSED`, so an auth problem
 *  or a rate limit reds every referenced issue at once and reads
 *  indistinguishably from mass rot — fail LOUD (still exit non-zero, see
 *  `findUnresolvedMarkers`), not fail into the wrong verdict. */
export function resolveIssueStates(
    numbers: Iterable<number>
): Map<number, "OPEN" | "CLOSED" | "UNKNOWN"> {
    const states = new Map<number, "OPEN" | "CLOSED" | "UNKNOWN">();
    for (const n of new Set(numbers)) {
        try {
            const raw = JSON.parse(
                gh(["issue", "view", String(n), "--json", "number,state"])
            ) as { number: number; state: "OPEN" | "CLOSED" };
            states.set(raw.number, raw.state);
        } catch {
            states.set(n, "UNKNOWN");
        }
    }
    return states;
}

/**
 * `--umbrella N` mode: the loop's own umbrella-close refusal
 * (`.claude/skills/process-gh-issues/SKILL.md` § umbrella-close). Unlike the
 * default sweep this needs NO network call of its own — it only asks whether
 * any LIVE marker's `tracked-by:` still names `N`, a pure text question —
 * but lives in this same opt-in script for one CLI, one place to look.
 */
function runUmbrellaCheck(umbrella: number): number {
    const markers = scanRepoMarkers(readSources());
    const blockers = markersBlockingClosure(markers, umbrella);
    if (blockers.length === 0) {
        console.log(`no live marker names #${umbrella} — closable`);
        return 0;
    }
    console.log(
        `#${umbrella} is still named by ${blockers.length} live marker(s) — refusing to close:\n`
    );
    for (const b of blockers) {
        console.log(`  ${b.file}:${b.line}  ${b.text}`);
    }
    return 1;
}

function main(): number {
    const umbrellaFlag = process.argv.indexOf("--umbrella");
    if (umbrellaFlag !== -1) {
        const umbrella = Number(process.argv[umbrellaFlag + 1]);
        if (!Number.isFinite(umbrella)) {
            console.error("--umbrella needs an issue number");
            return 2;
        }
        return runUmbrellaCheck(umbrella);
    }

    const markers = scanRepoMarkers(readSources());
    const numbers = markers.flatMap((m) => m.issueNumbers);
    const states = resolveIssueStates(numbers);
    const rotten = findRottenMarkers(markers, states);
    const unresolved = findUnresolvedMarkers(markers, states);

    console.log(
        `scanned ${markers.length} divergence markers naming a tracked-by ` +
            `disposition in tracked source, ${new Set(numbers).size} distinct ` +
            `referenced issue(s)`
    );
    if (rotten.length === 0 && unresolved.length === 0) {
        console.log("every tracked divergence marker names an open issue");
        return 0;
    }
    if (unresolved.length > 0) {
        console.log(
            `\n${unresolved.length} marker(s) name an issue \`gh\` could not ` +
                `resolve (auth or rate limit? NOT proven closed):\n`
        );
        for (const u of unresolved) {
            console.log(
                `  ${u.file}:${u.line}  unknown #${u.unknownIssues.join(", #")}  ${u.text}`
            );
        }
    }
    if (rotten.length === 0) return 1;
    console.log(`\n${rotten.length} marker(s) name a CLOSED issue:\n`);
    for (const r of rotten) {
        console.log(
            `  ${r.file}:${r.line}  closes #${r.closedIssues.join(", #")}  ${r.text}`
        );
    }
    console.log(
        `\nRepoint each ref at a live issue, or delete the marker if the divergence no longer exists.`
    );
    return 1;
}

// CLI only. The regression guard imports the exported functions above;
// without this gate the import would tear the test runner down with
// `process.exit`.
if (import.meta.main) process.exit(main());
