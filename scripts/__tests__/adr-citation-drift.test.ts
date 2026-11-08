import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * ADR citations name a real record (issue #8723, audit
 * `docs/research/adr-audit-2026-11-07.md` finding 1).
 *
 * `docs/adr/0000-ai-opponent-client-side-ismcts.md` is the ISMCTS decision;
 * `0001-zone-change-trigger-factories.md` is a trigger-factory record. For
 * months the ISMCTS record was cited as "ADR 0001" in five ADRs, the glossary
 * and about a hundred code comments, and five markdown links pointed at a file
 * (`0001-ai-opponent-client-side-ismcts.md`) that never existed. The ADR index
 * test checks rows, not citations, so nothing noticed.
 *
 * Two mechanical halves:
 *   1. `ADR 0001` on the same line as a Brain / ISMCTS / client-side-search
 *      word is the wrong number (the trigger-factory record is not about those).
 *   2. A markdown link that targets a `docs/adr/NNNN-*.md` file must resolve.
 *
 * `docs/research/**` is dated history (it QUOTES the bad citation) and is not
 * scanned; this file names the bad strings and is skipped too.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ADR_DIR = path.join(REPO_ROOT, "docs", "adr");

const SCANNED_ROOTS = ["docs", ".claude", "convex", "src", "scripts"];
const SCANNED_ROOT_FILES = [
    "GLOSSARY.md",
    "CLAUDE.md",
    "AGENTS.md",
    "README.md",
];
const SKIPPED_DIRS = new Set([
    "node_modules",
    "_generated",
    ".git",
    "research",
]);
const SCANNED_EXT = /\.(md|ts|tsx)$/;
const SELF = path.join("scripts", "__tests__", "adr-citation-drift.test.ts");

/** Words that mean "this line is about the Brain / client-side search". */
const ISMCTS_CONTEXT =
    /ISMCTS|\bBrain\b|brain\.worker|brain[A-Za-z]*\.ts|search\.ts|client-side/i;

const WRONG_ADR_0001 = /ADR\s+0001\b/;
const ADR_LINK = /\]\(([^)\s]*?\b\d{4}-[A-Za-z0-9-]+\.md)(?:#[^)\s]*)?\)/g;

interface Drift {
    file: string;
    line: number;
    problem: string;
}

/** Lines citing "ADR 0001" beside an ISMCTS / Brain word. */
function wrongNumberDrift(file: string, text: string): Drift[] {
    const out: Drift[] = [];
    text.split("\n").forEach((line, i) => {
        if (WRONG_ADR_0001.test(line) && ISMCTS_CONTEXT.test(line)) {
            out.push({
                file,
                line: i + 1,
                problem:
                    "cites ADR 0001 (trigger factories) beside an ISMCTS/Brain word; the ISMCTS record is ADR 0000",
            });
        }
    });
    return out;
}

/** Markdown links into docs/adr/ whose target file does not exist. */
function brokenAdrLinkDrift(
    file: string,
    text: string,
    exists: (abs: string) => boolean
): Drift[] {
    const out: Drift[] = [];
    const dir = path.dirname(path.join(REPO_ROOT, file));
    text.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(ADR_LINK)) {
            const target = path.resolve(dir, m[1]);
            if (path.dirname(target) !== ADR_DIR) continue;
            if (!exists(target)) {
                out.push({
                    file,
                    line: i + 1,
                    problem: `link target ${m[1]} does not exist in docs/adr/`,
                });
            }
        }
    });
    return out;
}

function walk(dirAbs: string, acc: string[]): void {
    for (const e of fs.readdirSync(dirAbs, { withFileTypes: true })) {
        if (e.isDirectory()) {
            if (!SKIPPED_DIRS.has(e.name)) walk(path.join(dirAbs, e.name), acc);
        } else if (SCANNED_EXT.test(e.name)) {
            acc.push(path.join(dirAbs, e.name));
        }
    }
}

function scannedFiles(): string[] {
    const acc: string[] = [];
    for (const r of SCANNED_ROOTS) {
        const abs = path.join(REPO_ROOT, r);
        if (fs.existsSync(abs)) walk(abs, acc);
    }
    for (const f of SCANNED_ROOT_FILES) {
        const abs = path.join(REPO_ROOT, f);
        if (fs.existsSync(abs)) acc.push(abs);
    }
    return acc
        .map((abs) => path.relative(REPO_ROOT, abs))
        .filter((rel) => rel !== SELF);
}

const fmt = (d: Drift[]) =>
    d.map((x) => `${x.file}:${x.line}: ${x.problem}`).join("\n");

describe("ADR citation drift (issue #8723)", () => {
    it("no line cites ADR 0001 beside an ISMCTS / Brain / client-side-search word", () => {
        const drift = scannedFiles().flatMap((f) =>
            wrongNumberDrift(
                f,
                fs.readFileSync(path.join(REPO_ROOT, f), "utf8")
            )
        );
        expect(fmt(drift)).toBe("");
    });

    it("every markdown link into docs/adr/ names an existing file", () => {
        const drift = scannedFiles().flatMap((f) =>
            brokenAdrLinkDrift(
                f,
                fs.readFileSync(path.join(REPO_ROOT, f), "utf8"),
                fs.existsSync
            )
        );
        expect(fmt(drift)).toBe("");
    });

    describe("detectors go red on planted drift", () => {
        it("flags ADR 0001 beside ISMCTS, Brain, brain.worker, search.ts, client-side", () => {
            for (const w of [
                "ISMCTS",
                "the Brain",
                "brain.worker",
                "search.ts",
                "client-side",
            ]) {
                expect(
                    wrongNumberDrift("x.md", `${w} (ADR 0001)`)
                ).toHaveLength(1);
            }
        });

        it("leaves a real trigger-factory citation alone", () => {
            expect(
                wrongNumberDrift(
                    "x.ts",
                    "// Per ADR 0001: one factory per zone"
                )
            ).toEqual([]);
            expect(wrongNumberDrift("x.ts", "Brain (ADR 0000)")).toEqual([]);
        });

        it("flags a link to a nonexistent ADR file and passes a real one", () => {
            const bad =
                "See [ADR 0001](0001-ai-opponent-client-side-ismcts.md).";
            expect(
                brokenAdrLinkDrift("docs/adr/0015-x.md", bad, fs.existsSync)
            ).toHaveLength(1);
            const good =
                "See [ADR 0000](0000-ai-opponent-client-side-ismcts.md#x).";
            expect(
                brokenAdrLinkDrift("docs/adr/0015-x.md", good, fs.existsSync)
            ).toEqual([]);
        });

        it("resolves relative links from the linking file's directory", () => {
            const bad = "[ADR](../adr/0001-ai-opponent-client-side-ismcts.md)";
            expect(
                brokenAdrLinkDrift("docs/vs-ai/x.md", bad, fs.existsSync)
            ).toHaveLength(1);
            const good = "[ADR](../adr/0000-ai-opponent-client-side-ismcts.md)";
            expect(
                brokenAdrLinkDrift("docs/vs-ai/x.md", good, fs.existsSync)
            ).toEqual([]);
        });
    });
});
