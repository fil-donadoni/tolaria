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
 * Matches the native dialog call in ANY of its callable forms: `window.`
 * prefixed, `globalThis.`-prefixed, or bare (`confirm("x")` — the bare form
 * is what a native `<dialog>`/blocking call in a fresh violation would
 * actually look like; a review injected exactly that shape and the old
 * `window.`-only pattern stayed green). A negative lookbehind excludes a
 * MEMBER call on an object whose property happens to be named `confirm` /
 * `alert` / `prompt` (e.g. `attackAllConfirm.confirm()`, a real pattern in
 * this codebase's non-manual `pending-choice-prompt.tsx` /
 * `attack-all-confirm-dialog.tsx`) and a differently-named identifier merely
 * ending in one of those words (e.g. `checkPrompt(`).
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Every manual-mode source directory, matching the brief's own file list:
 *  `src/lib/manual-*`, `src/components/board/manual-*`, `src/hooks/useManual*`.
 *  Walked recursively — a future reorganisation moving manual files into a
 *  subdirectory (e.g. `src/lib/manual/pile-actions.ts`) must stay covered,
 *  not silently drop out of the scan. Test files are excluded — a test
 *  asserting ON `window.confirm` (spying, or a fixture describing the old
 *  behaviour in a comment) is not the bug this guards against. */
const MANUAL_FILE_ROOTS: { dir: string; prefixes: string[] }[] = [
    { dir: "src/lib", prefixes: ["manual-"] },
    { dir: "src/components/board", prefixes: ["manual-"] },
    { dir: "src/hooks", prefixes: ["useManual", "manual-"] },
];

/** Files that MUST be part of the scanned set — a coverage collapse (e.g. a
 *  broken glob, or manual files relocated out from under these roots) fails
 *  this assertion loudly instead of the old `length > 5` vacuity check
 *  quietly continuing to pass over an empty/near-empty set. */
const REQUIRED_SCANNED_FILES = [
    "src/lib/manual-pile-actions.ts",
    "src/lib/manual-controller-actions.ts",
    "src/components/board/manual-verb-popover.tsx",
    "src/hooks/useManualVerbPopover.ts",
];

/** True if any path segment between `root` and `full` (directory name or the
 *  leaf filename) starts with one of `prefixes` — so a future reorganisation
 *  into a subdirectory like `src/lib/manual-verbs/pile-actions.ts` still
 *  counts even though the leaf filename `pile-actions.ts` alone doesn't. */
function pathMatchesPrefix(
    root: string,
    full: string,
    prefixes: string[]
): boolean {
    const segments = path.relative(root, full).split(path.sep);
    return segments.some((segment) =>
        prefixes.some((p) => segment.startsWith(p))
    );
}

function walkRecursive(
    root: string,
    dir: string,
    prefixes: string[]
): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            // `__tests__` directories are test-only by convention in this
            // repo — a test asserting ON `window.confirm` (spying, or a
            // fixture describing the old behaviour) is not the bug this
            // guards against.
            if (entry.name === "__tests__") continue;
            files.push(...walkRecursive(root, full, prefixes));
            continue;
        }
        if (!entry.isFile()) continue;
        if (!(entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")))
            continue;
        if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx"))
            continue;
        if (!pathMatchesPrefix(root, full, prefixes)) continue;
        files.push(full);
    }
    return files;
}

function manualModeFiles(): string[] {
    const files: string[] = [];
    for (const { dir, prefixes } of MANUAL_FILE_ROOTS) {
        const full = path.join(REPO_ROOT, dir);
        if (!fs.existsSync(full)) continue;
        for (const abs of walkRecursive(full, full, prefixes)) {
            files.push(path.relative(REPO_ROOT, abs));
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

/**
 * Matches `prompt(`/`confirm(`/`alert(` in every callable shape:
 * `window.confirm(`, `globalThis.confirm(`, and the bare `confirm(`. The
 * negative lookbehind `(?<![.\w$])` rejects a match whose `prompt`/`confirm`/
 * `alert` token is itself preceded by `.` (a member access off some other
 * object, e.g. `attackAllConfirm.confirm(`), a word character, or `$` (so an
 * identifier merely ending in one of those words, e.g. `checkPrompt(`, is
 * never flagged).
 */
const NATIVE_DIALOG_CALL_RE =
    /(?<![.\w$])(?:window\.|globalThis\.)?(prompt|confirm|alert)\s*\(/g;

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

    it("scans a superset of the known manual-mode files (a broken/narrowed glob would pass vacuously)", () => {
        const scanned = new Set(manualModeFiles());
        expect(scanned.size).toBeGreaterThan(5);
        for (const required of REQUIRED_SCANNED_FILES) {
            expect(
                scanned.has(required),
                `expected ${required} to be in the scanned set — got ${scanned.size} files: ` +
                    `[${[...scanned].join(", ")}]`
            ).toBe(true);
        }
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

    it("proof-of-failure: the detector DOES flag a bare confirm(...) call (no window. prefix)", () => {
        const snippet = `
            export function verb() {
                if (confirm("Shuffle library?")) {
                    doIt();
                }
            }
        `;
        const hits = [
            ...stripComments(snippet).matchAll(NATIVE_DIALOG_CALL_RE),
        ];
        expect(hits.length).toBe(1);
        expect(hits[0][0]).toBe("confirm(");
    });

    it("proof-of-failure: the detector DOES flag a globalThis.alert(...) call", () => {
        const snippet = `
            export function verb() {
                globalThis.alert("Shuffle library?");
            }
        `;
        const hits = [
            ...stripComments(snippet).matchAll(NATIVE_DIALOG_CALL_RE),
        ];
        expect(hits.length).toBe(1);
        expect(hits[0][0]).toBe("globalThis.alert(");
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

    it("a member CALL on an object property named `confirm` (attackAllConfirm.confirm()) is NOT flagged", () => {
        const snippet = `
            attackAllConfirm.confirm();
        `;
        const hits = [
            ...stripComments(snippet).matchAll(NATIVE_DIALOG_CALL_RE),
        ];
        expect(hits).toEqual([]);
    });

    it("an identifier merely ending in `prompt`/`confirm`/`alert` (checkprompt()) is NOT flagged", () => {
        const snippet = `
            checkprompt();
            reCheckalert();
            userconfirm();
        `;
        const hits = [
            ...stripComments(snippet).matchAll(NATIVE_DIALOG_CALL_RE),
        ];
        expect(hits).toEqual([]);
    });
});
