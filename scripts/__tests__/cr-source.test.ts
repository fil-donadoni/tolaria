import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

/**
 * Comprehensive-Rules source guard (ADR 0098).
 *
 * The rules text this engine implements used to come from wherever a session
 * happened to look: `yawgatog.com`, `ancestral.vision` (whose own home page
 * says it is current as of 2022-10-07), or an ad-hoc `curl` of a
 * `MagicCompRules YYYYMMDD.txt` URL recalled from training data — twelve
 * distinct versions of that URL appear in past session transcripts, the oldest
 * from September 2022. Nothing in the workflow could see which revision an
 * agent had read, so "we follow the current CR" (ADR 0004) was unverifiable.
 *
 * These tests hold the three properties that make it verifiable:
 *   1. the vendored document is intact and is the revision VERSION.json claims;
 *   2. the document's own effective date agrees with that claim (a `cr:sync`
 *      that swapped the text but not the stamp would otherwise pass);
 *   3. the workflow's instructions point at the vendored file, and no mirror
 *      has crept back into a skill's `allowed-tools` or a permission allowlist.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CR_PATH = path.join(REPO_ROOT, "data/cr/comprehensive-rules.txt");
const VERSION_PATH = path.join(REPO_ROOT, "data/cr/VERSION.json");

type Version = {
    effectiveDate: string;
    fileName: string;
    txtUrl: string;
    pdfUrl: string;
    indexUrl: string;
    sha256: string;
    vendoredAt: string;
};

const version = (): Version =>
    JSON.parse(fs.readFileSync(VERSION_PATH, "utf8")) as Version;

const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

describe("vendored Comprehensive Rules (ADR 0098)", () => {
    it("the document matches the sha256 VERSION.json records", () => {
        const digest = createHash("sha256")
            .update(fs.readFileSync(CR_PATH))
            .digest("hex");
        expect(digest).toBe(version().sha256);
    });

    it("the document's own effective date matches the recorded revision", () => {
        const head = fs.readFileSync(CR_PATH, "utf8").slice(0, 400);
        const stated = head.match(
            /effective as of ([A-Z][a-z]+) (\d{1,2}), (\d{4})/
        );
        expect(
            stated,
            `no "effective as of" line at the top of ${CR_PATH}`
        ).not.toBeNull();
        const [, month, day, year] = stated!;
        const iso = `${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
        expect(iso).toBe(version().effectiveDate);
    });

    it("the source URLs point at the official Wizards document for that revision", () => {
        const v = version();
        const compact = v.effectiveDate.replace(/-/g, "");
        expect(v.txtUrl).toMatch(/^https:\/\/media\.wizards\.com\//);
        expect(v.txtUrl).toContain(compact);
        expect(v.txtUrl.endsWith(".txt")).toBe(true);
        expect(v.pdfUrl).toContain(compact);
        expect(v.indexUrl).toBe("https://magic.wizards.com/en/rules");
    });

    it("`bun run cr` prints the requested subrule verbatim and nothing else", () => {
        const out = execFileSync("bun", ["scripts/cr.ts", "605.3b"], {
            cwd: REPO_ROOT,
            encoding: "utf8",
        }).trim();
        expect(out.startsWith("605.3b ")).toBe(true);
        expect(out).toContain("doesn’t go on the stack");
        expect(out).not.toContain("605.3c");
    });

    /**
     * WotC's export uses U+2028 LINE SEPARATOR for a paragraph break INSIDE a
     * rule. JS does not treat it as a line terminator and `.` does not match
     * it, so the first cut of the slicer failed to see 509.1b and 205.4c as
     * rule starts and swallowed them into the preceding rule: `cr 509.1b`
     * answered "No CR rule 509.1b", about a rule that plainly exists. That is
     * the tool's worst possible failure — it is the authority an agent uses to
     * decide a citation is wrong, so a false negative rewrites correct code.
     */
    it("finds rules whose body contains a U+2028 paragraph break", () => {
        for (const [id, needle] of [
            ["509.1b", "evasion ability"],
            ["205.4c", "Eighth Edition"],
        ] as const) {
            const out = execFileSync("bun", ["scripts/cr.ts", id], {
                cwd: REPO_ROOT,
                encoding: "utf8",
            });
            expect(
                out.startsWith(`${id} `),
                `cr ${id} did not return that rule`
            ).toBe(true);
            expect(out).toContain(needle);
        }
    });

    it("an unknown rule id fails instead of inventing an answer", () => {
        expect(() =>
            execFileSync("bun", ["scripts/cr.ts", "605.99"], {
                cwd: REPO_ROOT,
                encoding: "utf8",
            })
        ).toThrow();
    });
});

describe("no third-party CR mirror in the workflow (ADR 0098)", () => {
    /**
     * Files that TELL an agent where to read rules from, plus the permission
     * allowlists that would let it. Prose ABOUT the mirrors (this test, the
     * ADR, its index row) is deliberately out of scope — the history is worth
     * recording, the instruction is not.
     */
    const INSTRUCTION_FILES = [
        ".claude/skills/mtg-rules-check/SKILL.md",
        ".claude/skills/new-card/SKILL.md",
        ".claude/skills/new-set/SKILL.md",
        ".claude/rules/gre-development.md",
        ".claude/settings.json",
        ".claude/settings.local.json",
        ".opencode/skills/mtg-rules-check/skill.md",
        ".opencode/skills/new-card/skill.md",
        ".opencode/settings.local.json",
        "CLAUDE.md",
    ];

    const MIRRORS = ["yawgatog.com", "ancestral.vision", "mtg.fandom.com"];

    for (const file of INSTRUCTION_FILES) {
        it(`${file} names no mirror as a fetch target`, () => {
            const full = path.join(REPO_ROOT, file);
            if (!fs.existsSync(full)) return; // settings.local.json is per-machine
            const text = fs.readFileSync(full, "utf8");
            for (const mirror of MIRRORS) {
                // The mtg-rules-check skill names them once, in the prohibition.
                const asTarget = new RegExp(
                    `(WebFetch\\(domain:${mirror.replace(".", "\\.")}\\)|https?://[\\w.]*${mirror.replace(".", "\\.")})`,
                    "i"
                );
                expect(
                    asTarget.test(text),
                    `${file} still points at ${mirror}`
                ).toBe(false);
            }
        });
    }

    it("the rules-check skill points at the vendored document", () => {
        const skill = fs.readFileSync(
            path.join(REPO_ROOT, ".claude/skills/mtg-rules-check/SKILL.md"),
            "utf8"
        );
        expect(skill).toContain("data/cr/comprehensive-rules.txt");
        expect(skill).toContain("bun run cr");
    });
});
