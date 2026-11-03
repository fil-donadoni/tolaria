import { spawnSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanCitations } from "../check-cr-citations.ts";
import {
    baselineSites,
    confirmLine,
    emptyLedger,
    initialLedger,
    LEDGER_PATH,
    ledgerReport,
    parseLedger,
    reconcileRevertedBaseline,
    reportIsClean,
    serializeLedger,
    type Ledger,
} from "../lib/cr-ledger.ts";
import { rulesOf } from "../lib/cr-rules.ts";
import { reconcileRevertCrLedger } from "../lib/revert-cr-ledger.ts";

/**
 * The RED ladder's revert reconciles the CR citation ledger (issue #7965).
 * A culprit that edited a citation line turned its `baseline` ledger entry
 * into a `confirmed` one; `git revert` restores both the old line and the old
 * `baseline` entry, which the base ledger lacks — `cr:lint`'s only-shrinks
 * check refused the revert PR (PR #7960). The reconciled revert confirms the
 * restored line instead, so `cr:lint` admits it; a revert that touches no
 * citation is left byte-identical.
 *
 * Fixture lines interpolate their ids: this file is a tracked `.ts`, and a
 * literal citation here would be scanned.
 */

const ONCE = "614.5";
const MISSING = "614.9";
const PREFIX = "CR";

const CR_DOC = [
    "1. Game Concepts",
    "",
    "1. Game Concepts",
    "100. General",
    "100.1. These Magic rules apply to any Magic game with two or more players.",
    "614. Replacement Effects",
    `${ONCE}. A replacement effect doesn't invoke itself repeatedly; it gets only one opportunity to affect an event.`,
    "Glossary",
    "Credits",
].join("\n");
const rules = rulesOf(CR_DOC);
const ids = new Set(rules.map((r) => r.id));

const SOURCE = "convex/gre/fixture.ts";
const OLD = `// ${PREFIX} ${ONCE} — a replacement applies once per event\n`;
const NEW = `// ${PREFIX} ${ONCE} — a replacement gets one opportunity per event\n`;

const citationsOf = (text: string) =>
    scanCitations([{ file: SOURCE, text }], ids).citations;

/** The base's ledger after the culprit: its edited line confirmed. */
const culpritLedger = (): Ledger =>
    confirmLine(emptyLedger(), citationsOf(NEW), rules, citationsOf(NEW))
        .ledger;

describe("reconcileRevertedBaseline (issue #7965)", () => {
    it("confirms a baseline entry the revert restores, so the only-shrinks check is clean", () => {
        const reverted = citationsOf(OLD);
        const base = baselineSites(culpritLedger());
        const { ledger, confirmed } = reconcileRevertedBaseline({
            ledger: initialLedger(reverted),
            baseBaseline: base,
            citations: reverted,
            rules,
        });
        expect(confirmed.map((e) => e.status)).toEqual(["confirmed"]);
        expect(ledger.entries.every((e) => e.status === "confirmed")).toBe(
            true
        );
        const report = ledgerReport({
            citations: reverted,
            ledger,
            rules,
            baseBaseline: base,
            widened: null,
        });
        expect(reportIsClean(report)).toBe(true);
    });

    it("leaves a ledger with nothing grown untouched", () => {
        const reverted = citationsOf(OLD);
        const ledger = initialLedger(reverted);
        const out = reconcileRevertedBaseline({
            ledger,
            baseBaseline: baselineSites(ledger),
            citations: reverted,
            rules,
        });
        expect(out.confirmed).toEqual([]);
        expect(out.ledger).toBe(ledger);
    });

    it("throws on a grown entry whose id resolves to no rule", () => {
        const line = `// ${PREFIX} ${MISSING} — a rule the CR does not have\n`;
        const reverted = scanCitations(
            [{ file: SOURCE, text: line }],
            new Set([...ids, MISSING])
        ).citations;
        expect(() =>
            reconcileRevertedBaseline({
                ledger: initialLedger(reverted),
                baseBaseline: new Map(),
                citations: reverted,
                rules,
            })
        ).toThrow(/resolves to no rule/);
    });
});

describe("reconcileRevertCrLedger on a real revert (issue #7965)", () => {
    let repo: string;
    const git = (...args: string[]): string => {
        const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
        if (r.status !== 0)
            throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
        return r.stdout.trim();
    };
    const commit = (subject: string, files: Record<string, string>) => {
        for (const [path, text] of Object.entries(files))
            writeFileSync(join(repo, path), text);
        git("add", "-A");
        git("commit", "-q", "-m", subject);
        return git("rev-parse", "HEAD");
    };
    const ledgerText = () => readFileSync(join(repo, LEDGER_PATH), "utf8");

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), "revert-cr-ledger-"));
        git("init", "-q", "-b", "main");
        git("config", "user.email", "t@example.com");
        git("config", "user.name", "t");
        git("config", "commit.gpgsign", "false");
        mkdirSync(join(repo, "convex", "gre"), { recursive: true });
        mkdirSync(join(repo, "data", "cr"), { recursive: true });
        commit("parent", {
            "data/cr/comprehensive-rules.txt": CR_DOC,
            [SOURCE]: OLD,
            "notes.txt": "a\n",
            [LEDGER_PATH]: serializeLedger(initialLedger(citationsOf(OLD))),
        });
    });

    afterEach(() => rmSync(repo, { recursive: true, force: true }));

    it("the revert of a culprit that confirmed a citation passes the only-shrinks check", () => {
        const culprit = commit("culprit", {
            [SOURCE]: NEW,
            [LEDGER_PATH]: serializeLedger(culpritLedger()),
        });
        git("revert", "--no-edit", culprit);
        const base = baselineSites(
            parseLedger(git("show", `${culprit}:${LEDGER_PATH}`))
        );
        const before = ledgerReport({
            citations: citationsOf(OLD),
            ledger: parseLedger(ledgerText()),
            rules,
            baseBaseline: base,
            widened: null,
        });
        expect(before.grown).toHaveLength(1);

        const out = reconcileRevertCrLedger(repo, culprit);

        expect(out.confirmed.map((e) => e.id)).toEqual([ONCE]);
        const after = ledgerReport({
            citations: citationsOf(OLD),
            ledger: parseLedger(ledgerText()),
            rules,
            baseBaseline: base,
            widened: null,
        });
        expect(reportIsClean(after)).toBe(true);
    });

    it("a revert touching no citation leaves the tree as git revert made it", () => {
        const culprit = commit("culprit", { "notes.txt": "b\n" });
        git("revert", "--no-edit", culprit);
        const out = reconcileRevertCrLedger(repo, culprit);
        expect(out).toEqual({ confirmed: [], pruned: [] });
        expect(git("status", "--porcelain")).toBe("");
    });
});
