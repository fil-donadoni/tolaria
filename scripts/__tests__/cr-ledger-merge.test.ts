import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    LEDGER_GENERATOR,
    LEDGER_PATH,
    mergeLedgers,
    parseLedger,
    serializeLedger,
    type Ledger,
    type LedgerEntry,
} from "../lib/cr-ledger";
import { LEDGER_MERGE_DRIVER_NAME } from "../lib/generated-artifacts";
import { BASE_BRANCH } from "../lib/branches";

/**
 * Guards for issue #3768 — the CR citation ledger merges as a keyed SET.
 *
 * The file was read as immune by shape: per-row and sorted, so "two branches
 * confirming two different citations touch disjoint lines". They do not. Rows
 * sort by rule id, a hot id carries hundreds of them, and two confirmations
 * under the SAME id land in the same sorted hunk — a textual conflict with no
 * semantic content, hit twice on one issue's rebases.
 *
 * The real-git block is the one that matters: it proves the conflict exists
 * without the driver, that the driver resolves it keeping BOTH confirmations,
 * and — the trap a plain union falls into — that an entry PRUNED on one side
 * is not resurrected by the merge.
 */

const REPO_ROOT = resolve(__dirname, "..", "..");
const DRIVER = join(REPO_ROOT, "scripts", "merge-driver-cr-ledger.ts");

const HASH_A = "0123456789abcdef";
const HASH_B = "fedcba9876543210";

function entry(
    id: string,
    line: string,
    over: Partial<LedgerEntry> = {}
): LedgerEntry {
    return { id, line, sites: 1, status: "baseline", ...over };
}

function ledger(entries: LedgerEntry[]): Ledger {
    return { generator: LEDGER_GENERATOR, entries };
}

/** The keys of a merge result, in the order the serializer commits them. */
function keys(result: Ledger): string[] {
    return parseLedger(serializeLedger(result)).entries.map(
        (e) => `${e.id} ${e.line}`
    );
}

describe("mergeLedgers — a keyed set of independent facts (issue #3768)", () => {
    it("keeps BOTH confirmations when two sides confirm different lines under the same id", () => {
        const base = ledger([entry("601.2f", "shared")]);
        const ours = ledger([
            entry("601.2f", "shared"),
            entry("601.2f", "ours line", {
                status: "confirmed",
                ruleHash: HASH_A,
            }),
        ]);
        const theirs = ledger([
            entry("601.2f", "shared"),
            entry("601.2f", "their line", {
                status: "confirmed",
                ruleHash: HASH_A,
            }),
        ]);
        expect(keys(mergeLedgers({ base, ours, theirs }))).toEqual([
            "601.2f ours line",
            "601.2f shared",
            "601.2f their line",
        ]);
    });

    it("keeps an entry ADDED on one side and absent from base", () => {
        const base = ledger([]);
        const ours = ledger([entry("100.6", "ours only")]);
        const theirs = ledger([]);
        expect(keys(mergeLedgers({ base, ours, theirs }))).toEqual([
            "100.6 ours only",
        ]);
        expect(
            keys(mergeLedgers({ base, ours: theirs, theirs: ours }))
        ).toEqual(["100.6 ours only"]);
    });

    it("keeps an entry PRUNED on one side REMOVED — a union would resurrect it", () => {
        const pruned = entry("100.6", "a line the other side pruned");
        const base = ledger([pruned, entry("100.6", "kept")]);
        const ours = ledger([pruned, entry("100.6", "kept")]);
        const theirs = ledger([entry("100.6", "kept")]);
        expect(keys(mergeLedgers({ base, ours, theirs }))).toEqual([
            "100.6 kept",
        ]);
        // Symmetric: the side that pruned is not privileged.
        expect(
            keys(mergeLedgers({ base, ours: theirs, theirs: ours }))
        ).toEqual(["100.6 kept"]);
    });

    it("resolves confirmed vs baseline to confirmed, carrying its rule hash", () => {
        const base = ledger([entry("100.6", "line")]);
        const ours = ledger([entry("100.6", "line")]);
        const theirs = ledger([
            entry("100.6", "line", { status: "confirmed", ruleHash: HASH_A }),
        ]);
        const merged = mergeLedgers({ base, ours, theirs });
        expect(merged.entries).toEqual([
            {
                id: "100.6",
                line: "line",
                sites: 1,
                status: "confirmed",
                ruleHash: HASH_A,
            },
        ]);
        // And the other way round — the driver's %A side is not privileged.
        expect(
            mergeLedgers({ base, ours: theirs, theirs: ours }).entries
        ).toEqual(merged.entries);
    });

    it("takes the MAX site count — cr:lint recomputes it against the tree", () => {
        const base = ledger([entry("100.6", "line", { sites: 1 })]);
        const ours = ledger([entry("100.6", "line", { sites: 3 })]);
        const theirs = ledger([entry("100.6", "line", { sites: 2 })]);
        expect(mergeLedgers({ base, ours, theirs }).entries[0]?.sites).toBe(3);
    });

    it("prefers the re-read rule hash when both sides confirmed and one moved", () => {
        const base = ledger([
            entry("100.6", "line", { status: "confirmed", ruleHash: HASH_A }),
        ]);
        const ours = ledger([
            entry("100.6", "line", { status: "confirmed", ruleHash: HASH_A }),
        ]);
        const theirs = ledger([
            entry("100.6", "line", { status: "confirmed", ruleHash: HASH_B }),
        ]);
        expect(mergeLedgers({ base, ours, theirs }).entries[0]?.ruleHash).toBe(
            HASH_B
        );
    });

    it("takes OURS when two ADDED confirmations disagree — cr:lint arbitrates", () => {
        // add/add: git hands the driver an empty base, so no side MOVED off a
        // base hash and nothing in the inputs can arbitrate. Ours is kept, and
        // that is safe because the arbiter is the CR text at the merged tip:
        // `cr:lint` recomputes the hash and reds the survivor as `drifted` if
        // it is the stale one (review of PR #3844, issue #3857).
        const base = ledger([]);
        const ours = ledger([
            entry("100.6", "line", { status: "confirmed", ruleHash: HASH_A }),
        ]);
        const theirs = ledger([
            entry("100.6", "line", { status: "confirmed", ruleHash: HASH_B }),
        ]);
        const merged = mergeLedgers({ base, ours, theirs });
        expect(merged.entries).toHaveLength(1);
        expect(merged.entries[0]?.status).toBe("confirmed");
        expect(merged.entries[0]?.ruleHash).toBe(HASH_A);
    });

    it("never carries a rule hash on a baseline outcome (parseLedger reds on one)", () => {
        const base = ledger([]);
        const ours = ledger([entry("100.6", "line")]);
        const theirs = ledger([entry("100.6", "line")]);
        const text = serializeLedger(mergeLedgers({ base, ours, theirs }));
        expect(() => parseLedger(text)).not.toThrow();
        expect(text).not.toContain("ruleHash");
    });

    it("writes what cr:ledger itself would write for the same entry set", () => {
        const rows = [
            entry("601.2f", "b line", {
                status: "confirmed",
                ruleHash: HASH_A,
            }),
            entry("100.6", "a line"),
            entry("601.2f", "a line"),
        ];
        const merged = mergeLedgers({
            base: ledger([]),
            // Deliberately unsorted and split across the two sides: the
            // committed bytes must not depend on which side saw what.
            ours: ledger([rows[0]!, rows[1]!]),
            theirs: ledger([rows[2]!]),
        });
        expect(serializeLedger(merged)).toBe(serializeLedger(ledger(rows)));
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Real git, real driver — two branches confirming two citations under the
// SAME rule id, which is the shape that actually conflicted.
// ─────────────────────────────────────────────────────────────────────────

describe("cr-ledger merge driver (real git)", () => {
    let dir: string;
    let repo: string;

    function git(args: string[], cwd = repo): string {
        const r = spawnSync("git", args, { cwd, encoding: "utf8" });
        if (r.status !== 0) {
            throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
        }
        return r.stdout.trim();
    }

    /** 40 entries under ONE id — a hot rule, so every row is in one hunk. */
    function baseEntries(): LedgerEntry[] {
        return Array.from({ length: 40 }, (_, i) =>
            entry("601.2f", `pad line ${String(i).padStart(2, "0")}`)
        );
    }

    function writeLedgerFile(entries: LedgerEntry[]): void {
        writeFileSync(
            join(repo, LEDGER_PATH),
            serializeLedger(ledger(entries))
        );
    }

    function readLedgerFile(): Ledger {
        return parseLedger(readFileSync(join(repo, LEDGER_PATH), "utf8"));
    }

    function commit(message: string): void {
        git(["add", "-A"]);
        git(["commit", "-m", message]);
    }

    function useDriver(): void {
        writeFileSync(
            join(repo, ".gitattributes"),
            `${LEDGER_PATH} merge=${LEDGER_MERGE_DRIVER_NAME}\n`
        );
        commit("gitattributes");
        git(["config", `merge.${LEDGER_MERGE_DRIVER_NAME}.name`, "cr ledger"]);
        git([
            "config",
            `merge.${LEDGER_MERGE_DRIVER_NAME}.driver`,
            `bun ${DRIVER} %O %A %B %P`,
        ]);
    }

    /** Both sides confirm a DIFFERENT line under the SAME id, then rebase. */
    function divergeAndRebase(mutate: {
        branch: (entries: LedgerEntry[]) => LedgerEntry[];
        main: (entries: LedgerEntry[]) => LedgerEntry[];
    }): { status: number | null; output: string } {
        git(["checkout", "-q", "-b", "branch"]);
        writeLedgerFile(mutate.branch(baseEntries()));
        commit("branch confirms a citation");
        git(["checkout", "-q", BASE_BRANCH]);
        writeLedgerFile(mutate.main(baseEntries()));
        commit("main confirms a citation");
        git(["checkout", "-q", "branch"]);
        const r = spawnSync("git", ["rebase", BASE_BRANCH], {
            cwd: repo,
            encoding: "utf8",
        });
        return { status: r.status, output: r.stdout + r.stderr };
    }

    /**
     * ADJACENT rows, on purpose: sorted by id then line, two confirmations a
     * row apart are one hunk with overlapping context — which is exactly how
     * the ledger conflicted in practice, and what "disjoint lines" missed.
     */
    const OURS_LINE = "pad line 19";
    const THEIRS_LINE = "pad line 20";

    const confirm =
        (line: string, ruleHash: string) =>
        (entries: LedgerEntry[]): LedgerEntry[] =>
            entries.map((e) =>
                e.line === line
                    ? entry("601.2f", line, { status: "confirmed", ruleHash })
                    : e
            );
    const drop =
        (line: string) =>
        (entries: LedgerEntry[]): LedgerEntry[] =>
            entries.filter((e) => e.line !== line);
    const confirmOurs = confirm(OURS_LINE, HASH_A);
    const confirmTheirs = confirm(THEIRS_LINE, HASH_B);

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-ledger-merge-"));
        repo = join(dir, "repo");
        mkdirSync(join(repo, "data", "cr"), { recursive: true });
        spawnSync("git", ["init", "-b", BASE_BRANCH, repo], { cwd: dir });
        git(["config", "user.email", "test@example.com"]);
        git(["config", "user.name", "Test"]);
        writeLedgerFile(baseEntries());
        commit("base ledger");
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("WITHOUT the driver, two confirmations under the SAME id conflict (the bug)", () => {
        const r = divergeAndRebase({
            branch: confirmOurs,
            main: confirmTheirs,
        });
        expect(r.status).not.toBe(0);
        expect(r.output).toContain(LEDGER_PATH);
        spawnSync("git", ["rebase", "--abort"], { cwd: repo });
    });

    it("with the driver, the same two confirmations rebase clean and BOTH survive", () => {
        useDriver();
        const r = divergeAndRebase({
            branch: confirmOurs,
            main: confirmTheirs,
        });
        expect(r.status, r.output).toBe(0);
        expect(git(["status", "--porcelain"])).toBe("");
        const confirmed = readLedgerFile()
            .entries.filter((e) => e.status === "confirmed")
            .map((e) => e.line);
        expect(confirmed.sort()).toEqual([OURS_LINE, THEIRS_LINE]);
    });

    it("with the driver, an entry PRUNED on the other side is not resurrected", () => {
        useDriver();
        const r = divergeAndRebase({
            // The branch leaves the row alone; main PRUNES it while confirming
            // its neighbour. A union would bring the pruned row back.
            branch: confirmOurs,
            main: (entries) => drop("pad line 18")(confirmTheirs(entries)),
        });
        expect(r.status, r.output).toBe(0);
        const lines = readLedgerFile().entries.map((e) => e.line);
        expect(lines).not.toContain("pad line 18");
        expect(lines).toContain(OURS_LINE);
        expect(lines).toContain(THEIRS_LINE);
    });

    it("the merged file is what cr:ledger would write — no diff after a round-trip", () => {
        useDriver();
        divergeAndRebase({ branch: confirmOurs, main: confirmTheirs });
        const text = readFileSync(join(repo, LEDGER_PATH), "utf8");
        expect(serializeLedger(parseLedger(text))).toBe(text);
    });

    it("refuses rather than merging when a side does not parse", () => {
        useDriver();
        git(["checkout", "-q", "-b", "branch"]);
        writeFileSync(join(repo, LEDGER_PATH), "{ not a ledger");
        commit("branch corrupts the ledger");
        git(["checkout", "-q", BASE_BRANCH]);
        writeLedgerFile(confirmTheirs(baseEntries()));
        commit("main confirms a citation");
        git(["checkout", "-q", "branch"]);
        const r = spawnSync("git", ["rebase", BASE_BRANCH], {
            cwd: repo,
            encoding: "utf8",
        });
        expect(r.status).not.toBe(0);
        spawnSync("git", ["rebase", "--abort"], { cwd: repo });
    });
});
