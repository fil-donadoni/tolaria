import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Manual Board — no native dialogs (issue #2170 AC).
 *
 * Every parameterised manual verb (draw/mill/exile-top/peek N, shuffle's
 * confirm, the custom counter's name, a card's note) and Concede used to
 * collect input via `window.prompt`/`window.confirm`, which blocks the
 * project's Chrome-automation debug workflow and looks foreign next to the
 * rest of the board. They now collect it through the anchored popover
 * (`manual-verb-popover.tsx`). This is the mechanical enforcement of the
 * AC's blanket rule: "No call to `window.prompt`, `window.confirm` or
 * `window.alert` remains anywhere in the manual board's code" — a fs walk
 * over every manual-mode source file, modeled on `manual-boundary.test.ts`.
 *
 * Scoped to the literal `window.<fn>(` form the AC names — the codebase has
 * no bare `prompt(...)`/`confirm(...)`/`alert(...)` call today (a stray
 * property NAMED `confirm`, e.g. `attackAllConfirm.confirm`, is not a call
 * and must not trip this).
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Every manual-mode source directory, matching the brief's own file list:
 *  `src/lib/manual-*`, `src/components/board/manual-*`, `src/hooks/useManual*`.
 *  Test files are excluded — a test asserting ON `window.confirm` (spying,
 *  or a fixture describing the old behaviour in a comment) is not the bug
 *  this guards against. */
const MANUAL_FILE_GLOBS: { dir: string; prefixes: string[] }[] = [
    { dir: "src/lib", prefixes: ["manual-"] },
    { dir: "src/components/board", prefixes: ["manual-"] },
    { dir: "src/hooks", prefixes: ["useManual", "manual-"] },
];

function manualModeFiles(): string[] {
    const files: string[] = [];
    for (const { dir, prefixes } of MANUAL_FILE_GLOBS) {
        const full = path.join(REPO_ROOT, dir);
        if (!fs.existsSync(full)) continue;
        for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
            if (!entry.isFile()) continue;
            if (!(entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")))
                continue;
            if (!prefixes.some((p) => entry.name.startsWith(p))) continue;
            files.push(path.relative(REPO_ROOT, path.join(full, entry.name)));
        }
    }
    return files;
}

/** Strips line comments and block comments so a doc comment MENTIONING
 *  `window.prompt` (prose, explaining what a verb used to do) never counts
 *  as a call. Good enough for this repo's style (no comment-opener sequence
 *  inside a string literal in these files — verified by the fact this
 *  produces zero false negatives against the pre-fix baseline, see the PR
 *  receipt's proof-of-failure). */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const NATIVE_DIALOG_CALL_RE = /\bwindow\.(prompt|confirm|alert)\s*\(/g;

describe("manual board — no native dialogs (issue #2170)", () => {
    it("no window.prompt/confirm/alert call remains in any manual-mode source file", () => {
        const violations: string[] = [];
        for (const file of manualModeFiles()) {
            const code = stripComments(
                fs.readFileSync(path.join(REPO_ROOT, file), "utf-8")
            );
            const hits = [...code.matchAll(NATIVE_DIALOG_CALL_RE)].map(
                (m) => m[0]
            );
            if (hits.length > 0) {
                violations.push(`${file} → ${hits.join(", ")}`);
            }
        }
        expect(
            violations,
            `Native dialog call(s) found in manual-mode code — issue #2170's ` +
                `AC forbids window.prompt/confirm/alert anywhere in the manual ` +
                `board (it blocks the Chrome-automation debug workflow):\n` +
                violations.join("\n")
        ).toEqual([]);
    });

    it("at least one manual-mode file is actually being scanned (a broken glob would pass vacuously)", () => {
        expect(manualModeFiles().length).toBeGreaterThan(5);
    });

    it("proof-of-failure: the detector DOES flag a real window.confirm(...) call", () => {
        const snippet = `
            export function verb() {
                if (window.confirm("Shuffle library?")) {
                    doIt();
                }
            }
        `;
        const hits = [
            ...stripComments(snippet).matchAll(NATIVE_DIALOG_CALL_RE),
        ];
        expect(hits.length).toBe(1);
        expect(hits[0][0]).toBe("window.confirm(");
    });

    it("proof-of-failure: a DOC COMMENT mentioning window.prompt is NOT flagged (prose, not a call)", () => {
        const snippet = `
            // This verb used to call window.prompt("Draw how many?") before
            // issue #2170 replaced it with the anchored popover.
            /** Also mentions window.confirm(...) inside a block comment. */
            export function verb() {
                requestVerbInput(anchor, { kind: "number" });
            }
        `;
        const hits = [
            ...stripComments(snippet).matchAll(NATIVE_DIALOG_CALL_RE),
        ];
        expect(hits).toEqual([]);
    });

    it("a bare property named `confirm` (e.g. attackAllConfirm.confirm) is NOT flagged", () => {
        const snippet = `
            const attackAllConfirm = { confirm: () => {}, cancel: () => {} };
        `;
        const hits = [
            ...stripComments(snippet).matchAll(NATIVE_DIALOG_CALL_RE),
        ];
        expect(hits).toEqual([]);
    });
});
