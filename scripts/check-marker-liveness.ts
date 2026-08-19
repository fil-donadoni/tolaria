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
 * divergence marker is always a `//`-comment INSIDE compiled source — Guard
 * B's own MARKER regex requires the `//` prefix — so this sweep scans only
 * tracked `.ts`/`.tsx`/`.mts`/`.mjs`/`.js` files (never `.md`), which drops
 * the `.claude/` and most-of-`docs/` prose noise without a single allowlist
 * entry. Two further exclusions, both required by the issue's own acceptance
 * criteria:
 *   - `__tests__/**` and `*.test.*` — test fixtures, including Guard B's own
 *     regression strings (`convex/cards/__tests__/divergenceMarkers.test.ts`
 *     contains `"// DEFERRED: …"` INSIDE string literals to exercise the
 *     scanner; scanned as raw text those lines match MARKER exactly like a
 *     real comment would, so they MUST be excluded or every run of this
 *     script would red on its own sibling's fixtures).
 *   - `docs/findings/**` — draft observations (`docs/findings/README.md`),
 *     explicitly exempt.
 *
 * In one sentence: scan wherever a `//`-marker can actually ship (any
 * tracked TS/JS source), and nowhere a marker can only be prose (`.md`) or a
 * scanner's own test fixture.
 *
 * A THIRD exclusion is content, not path: a marker sitting in the same
 * contiguous comment run as a commented-out `// export const … : CardDefinition`
 * stub anchor is `check-stub-coverage.ts`'s domain (its OWN `tracked-by:`
 * disposition, checked offline already) — issue #2560's own "out of scope"
 * note ("detecting markers inside commented-out card stubs … a separate
 * known gap already drafted in the findings drawer",
 * `docs/findings/2392-guard-b-misses-commented-out-card-stubs.md` part ii).
 * Guard B's presence check does not distinguish (its MARKER regex matches a
 * stub's own `// TODO(issue #NNN stub — …)` note exactly like a shipped
 * card's divergence), so left unfiltered this sweep would resolve liveness
 * for ~60 stub notes clustered on a handful of residue-tranche umbrellas
 * (`#676`, `#679`, …) — a different, larger cleanup than this issue scopes.
 * `isStubContext` below reproduces `check-stub-coverage.ts`'s own
 * `STUB_ANCHOR` and walks the same contiguous-comment-run window it does.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gh } from "./lib/gh";
import { scanText, type MarkerRecord } from "./lib/divergence-markers";

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

/** Same anchor `check-stub-coverage.ts` uses to identify a commented-out card
 *  definition (`scripts/check-stub-coverage.ts`'s `STUB_ANCHOR`) — duplicated
 *  rather than imported: that module's top level runs `getAllCards()` to
 *  build its dead-duplicate index, so importing anything from it would pull
 *  in the whole card registry just for a regex constant. If `STUB_ANCHOR`
 *  ever changes there, mirror the edit here. */
const STUB_ANCHOR =
    /^\s*\/\/\s*export const\s+[A-Za-z0-9_]+\s*(?::\s*(?:CardDefinition|CardPrint)\b|=\s*[A-Za-z_][A-Za-z0-9_]*\s*\()/;
const IS_COMMENT_LINE = /^\s*\/\//;

/** True when `lines[i]` sits in the same contiguous `//` comment run as a
 *  commented-out card-definition stub anchor — `check-stub-coverage.ts`'s
 *  domain, out of scope here (see the module doc above). Walks the whole
 *  contiguous run in both directions, wider than Guard B's paragraph window,
 *  because a stub's own tracking note can sit above OR below its anchor and
 *  the run is not always paragraph-broken from it. */
export function isStubContext(lines: string[], i: number): boolean {
    let start = i;
    while (start > 0 && IS_COMMENT_LINE.test(lines[start - 1])) start--;
    let end = i;
    while (end < lines.length - 1 && IS_COMMENT_LINE.test(lines[end + 1]))
        end++;
    for (let k = start; k <= end; k++) {
        if (STUB_ANCHOR.test(lines[k])) return true;
    }
    return false;
}

/** Scan every in-scope source for divergence markers, dropping stub-context
 *  hits. Pure over the source list, so it can be driven with synthetic
 *  content in tests. */
export function scanRepoMarkers(
    sources: Iterable<{ file: string; text: string }>
): MarkerRecord[] {
    const out: MarkerRecord[] = [];
    for (const { file, text } of sources) {
        const lines = text.split("\n");
        for (const rec of scanText(file, text)) {
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

/**
 * The verdict — a pure function over already-resolved issue states, so it is
 * unit-testable with plain data and needs no `gh` mock (repo convention: see
 * `scripts/__tests__/land.test.ts`'s `refusalReason`). Only TRACKED markers
 * naming at least one `#NNN` are candidates — an "out of scope" disposition
 * or a bare `tracked-by:` with no number has nothing to resolve.
 */
export function findRottenMarkers(
    markers: readonly MarkerRecord[],
    issueStates: ReadonlyMap<number, "OPEN" | "CLOSED">
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
 *  for issue lookups. An issue `gh` cannot find (deleted / no access) cannot
 *  be proven open, so it is treated as CLOSED rather than silently trusted —
 *  fail closed, not open. */
export function resolveIssueStates(
    numbers: Iterable<number>
): Map<number, "OPEN" | "CLOSED"> {
    const states = new Map<number, "OPEN" | "CLOSED">();
    for (const n of new Set(numbers)) {
        try {
            const raw = JSON.parse(
                gh(["issue", "view", String(n), "--json", "number,state"])
            ) as { number: number; state: "OPEN" | "CLOSED" };
            states.set(raw.number, raw.state);
        } catch {
            states.set(n, "CLOSED");
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

    console.log(
        `scanned ${markers.length} divergence markers in tracked source, ` +
            `${new Set(numbers).size} distinct referenced issue(s)`
    );
    if (rotten.length === 0) {
        console.log("every tracked divergence marker names an open issue");
        return 0;
    }
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
