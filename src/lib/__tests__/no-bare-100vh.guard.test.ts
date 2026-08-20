// Repo-wide regression guard (issue #2594) — in the spirit of
// `shellLayout.ts`'s own `VIEWPORT_HEIGHT_CLASSES` census
// (src/lib/shellLayout.ts:344-355): a mechanically-checkable invariant lives
// in a script the gate runs, not in prose.
//
// The bug class: `vh` is the LARGE viewport (the height the page has once a
// mobile browser's retracting URL bar has scrolled away) — on a phone with
// live chrome, `100vh` genuinely EXCEEDS the visible area, so a popover/sheet
// capped at `calc(100vh - Npx)` can overflow past the bottom of the screen
// under exactly the browser-chrome-visible condition it's supposed to fit
// (`card-preview.tsx`'s `100dvh` fix, issue #2589; `inspect-overlay.tsx`'s
// doc comment). `dvh` tracks the viewport as it actually is and is always
// `<= vh`, so swapping the unit can only shrink a cap, never widen one — a
// safe, unconditional fix wherever the literal pattern appears.
//
// Scope: every real `100vh` height-cap site in `src/` (`.ts`/`.tsx`/`.css`)
// PLUS the top-level `index.html` was converted to `100dvh` (issue #2594) —
// `game-dialog.tsx`, `controller-phase-list.tsx`, `mana-choice-picker.tsx`,
// `phyrexian-picker.tsx`, `mode-picker.tsx`, `card-preview-anchored.tsx`,
// `additional-cost-picker.tsx`, `alt-cost-picker.tsx`, `dev-panel-rail.tsx`.
// This guard is what keeps the next one from landing unnoticed — the scan
// walks the same file types the fix touched (review fixup, PR #2645: an
// earlier revision claimed CSS/HTML in scope but only walked `.ts`/`.tsx`).
//
// NOT in scope (deliberately untouched, do not "fix"):
//   - fractional caps (`max-h-[80vh]`, `max-w-[90vw]`) — a different claim
//     (a FRACTION of the viewport, not the whole of it) with its own
//     reasoning recorded at each site;
//   - prose (`//` / `*` / `<!-- -->` comments) that MENTIONS the literal
//     string "100vh" to explain the bug or as Tailwind-syntax documentation
//     (`shellLayout.ts`'s own doc comment, `inspect-overlay.tsx`'s doc
//     comment, `index.html`'s `viewport-fit=cover` comment) — these are not
//     live height caps;
//   - `shellLayout.test.ts`'s `arbitraryViewportClaims` fixture, which feeds
//     the literal string `"h-[100vh]"` to the PARSER as a case the parser
//     must catch — that occurrence IS the test proving this bug class is
//     caught at the Tailwind-bracket-syntax layer, not a live violation.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");
const SCAN_EXTENSIONS = [".ts", ".tsx", ".css"];

// path relative to REPO_ROOT -> why it's allowed to hold a real (non-comment)
// occurrence of the literal string "100vh".
const ALLOWLIST: Record<string, string> = {
    "src/lib/__tests__/shellLayout.test.ts":
        'feeds "h-[100vh]" to arbitraryViewportClaims as the case the parser must flag elsewhere — proof of the guard, not a live cap',
    // The guard's own source: its title/comments/allowlist VALUES necessarily
    // spell out the literal string being swept for. Scanning itself is not
    // meaningful — this file has no height cap of its own.
    "src/lib/__tests__/no-bare-100vh.guard.test.ts":
        "this file's own prose/strings necessarily contain the literal being swept for",
};

function collectSourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            collectSourceFiles(full, out);
        } else if (SCAN_EXTENSIONS.includes(extname(full))) {
            out.push(full);
        }
    }
    return out;
}

function isCommentLine(line: string): boolean {
    const trimmed = line.trim();
    return (
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("<!--")
    );
}

// `index.html`'s `viewport-fit=cover` explainer is a multi-line `<!-- -->`
// block whose continuation lines have no per-line comment marker (unlike the
// `*`-prefixed `/* */` style used elsewhere in the repo) — a literal "100vh"
// inside one would slip past line-by-line `isCommentLine`. Strip whole HTML
// comment blocks before scanning `.html` files.
function stripHtmlComments(content: string): string {
    return content.replace(/<!--[\s\S]*?-->/g, (block) =>
        block.replace(/[^\n]/g, "")
    );
}

function findOffenders(file: string, rel: string): string[] {
    const raw = readFileSync(file, "utf8");
    const content = extname(file) === ".html" ? stripHtmlComments(raw) : raw;
    const lines = content.split("\n");
    const offenders: string[] = [];
    lines.forEach((line, idx) => {
        if (!line.includes("100vh")) return;
        if (isCommentLine(line)) return;
        offenders.push(`${rel}:${idx + 1}: ${line.trim()}`);
    });
    return offenders;
}

describe("no bare 100vh height caps outside comments (issue #2594)", () => {
    it('every literal "100vh" in src/ (ts/tsx/css) and index.html is either a comment or on the documented allowlist', () => {
        const files = [
            ...collectSourceFiles(SRC_DIR),
            join(REPO_ROOT, "index.html"),
        ];
        const offenders: string[] = [];
        for (const file of files) {
            const rel = relative(REPO_ROOT, file);
            if (ALLOWLIST[rel]) continue;
            offenders.push(...findOffenders(file, rel));
        }
        expect(offenders).toEqual([]);
    });
});
