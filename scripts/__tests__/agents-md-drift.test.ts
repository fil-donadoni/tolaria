import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

import {
    buildAll,
    CODEX_DOC_MAX_BYTES,
    NESTED_MIRRORS,
} from "../build-agents-md";

/**
 * The generated agent context must equal its sources.
 *
 * WHY THIS IS A TEST AND NOT A NORM. `AGENTS.md` and the `.opencode/` mirror
 * were both kept in sync by hand, and both rotted:
 *
 *   - `.opencode/rules/` froze in July while `.claude/rules/` moved
 *     repeatedly — 17,393 bytes of `gre-development.md` there against a file
 *     that had since been split in two.
 *   - `AGENTS.md` never gained `bot-development.md` at all, so the sentence
 *     "no card names in identifiers, no per-card registries (ADR 0102)"
 *     existed in exactly ONE file in the repo, and neither Codex nor opencode
 *     reads that file. A DeepSeek session then built the per-card combo
 *     registry ADR 0102 forbids. It was not a model failure: the rule was
 *     unreachable from that harness.
 *
 * Neither rot was visible — every file looked correct on its own. That is the
 * signature of a drift this repo's own doctrine says belongs in a gate, not in
 * a paragraph asking people to remember.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readCommitted(rel: string): string | null {
    const abs = path.join(REPO_ROOT, rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

describe("generated agent context matches its sources", () => {
    for (const rel of ["AGENTS.md", ...NESTED_MIRRORS.map((m) => m.mirror)]) {
        it(`${rel} is up to date`, () => {
            const expected = buildAll().get(rel);
            expect(
                expected,
                `${rel} is not a generated artifact`
            ).toBeDefined();
            expect(
                readCommitted(rel),
                `${rel} is stale or missing — run: bun run agents:build`
            ).toBe(expected);
        });
    }

    it("every declared nested source exists", () => {
        // A mirror generated from a deleted source would silently become an
        // empty document that still passes the equality assertions above.
        for (const { source } of NESTED_MIRRORS) {
            expect(
                fs.existsSync(path.join(REPO_ROOT, source)),
                `${source} is declared in NESTED_MIRRORS but does not exist`
            ).toBe(true);
        }
    });
});

describe("AGENTS.md fits Codex's project-doc budget", () => {
    /**
     * Codex stops adding project docs once the combined size reaches
     * `project_doc_max_bytes` (32 KiB by default), and that setting lives in
     * the user's `~/.codex/config.toml` — it cannot be shipped in the repo.
     * Past the cap the tail is dropped with no warning, and the tail is where
     * the inlined rules sit. Failing here is the only loud version of that.
     */
    it("stays under the 32 KiB default", () => {
        const bytes = Buffer.byteLength(buildAll().get("AGENTS.md")!);
        if (bytes > CODEX_DOC_MAX_BYTES) {
            throw new Error(
                `AGENTS.md is ${bytes} bytes, over Codex's ${CODEX_DOC_MAX_BYTES} ` +
                    `default by ${bytes - CODEX_DOC_MAX_BYTES}.\n` +
                    `Codex truncates silently past that, dropping the inlined rules ` +
                    `at the end of the file.\n` +
                    `Trim CLAUDE.md or a rule index — that lowers the resident budget too.`
            );
        }
        expect(bytes).toBeLessThanOrEqual(CODEX_DOC_MAX_BYTES);
    });
});

describe("the inlined rules actually reach the other harnesses", () => {
    /**
     * The equality assertions above prove AGENTS.md matches whatever the
     * generator produced — they would keep passing if the generator silently
     * stopped inlining the rules. These assert the PAYLOAD: the specific
     * sentences that were unreachable from Codex and opencode before this
     * existed, one per rule file, so an inlining regression cannot pass.
     */
    const REQUIRED: ReadonlyArray<{ rule: string; text: string }> = [
        {
            rule: "bot-development.md",
            text: "no card names in identifiers",
        },
        {
            rule: "gre-development.md",
            text: "A new card's effect is an **Effect Script by default**",
        },
        {
            rule: "chrome-debug.md",
            text: "Its output IS the receipt",
        },
        {
            rule: "frontend-components.md",
            text: "**ONE component per file**",
        },
    ];

    for (const { rule, text } of REQUIRED) {
        it(`carries ${rule}`, () => {
            expect(buildAll().get("AGENTS.md")).toContain(text);
        });
    }

    it("does not carry the two-tier section, which is false for Codex and opencode", () => {
        // Codex scopes nested docs by CWD; opencode has no nested tier at all.
        // Shipping CLAUDE.md's "loaded on first access" explanation to them
        // would be a documented lie AND ~950 bytes of a 32 KiB budget.
        expect(buildAll().get("AGENTS.md")).not.toContain(
            "Path-specific rules — index resident"
        );
    });
});
