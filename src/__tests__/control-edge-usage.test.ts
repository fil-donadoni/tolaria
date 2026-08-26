// A CONTROL EDGE IS NOT DECORATION — usage sweep (issue #2727, round-2 review).
//
// `src/index.css` says it twice, next to `.btn-base` and next to
// `.segment-pill`: "a control EDGE is `--color-border-strong` /
// `--color-danger`, never the decorative `--hairline` pair". `--hairline-strong`
// is ivory/30 = 2.37:1 on `surface` and `--hairline` is ivory/12 = 1.34:1, both
// under WCAG 1.4.11's 3:1 for a control boundary; `--color-border-strong` is
// 3.38:1 and reads identically at a glance.
//
// `design-tokens.test.ts` already guards the token VALUES ("border-strong is
// brighter than the strong hairline"), and `field.test.tsx` guards two specific
// components' usage. Neither could see a NEW control adopting the decorative
// pair, which is how the rule was breached three times: PR #2827 round 1 (the
// button tones), PR #2827 round 2 (`.segment-pill`), and PR #2847's board
// chrome — a dozen controls across eight files, each individually plausible.
// This sweep is the usage half: it reads the source, finds every interactive
// opening tag, and fails on a hairline BORDER anywhere in its class expression.
// Adding it also turned up a FOURTH, older instance nobody had noticed: the
// collapse toggle in `Panel` (`panel.tsx`), fixed in the same change.
//
// WHAT IT SEES, precisely — so a future reader knows what it does not prove:
//   - `<button>` and the trigger primitives that render one, plus `<a>`.
//   - The whole opening tag, brace- and quote-aware, so a multi-line
//     `className={`…`}` template is covered.
//   - SCREAMING_SNAKE constants referenced inside the tag are resolved to their
//     definition text ANYWHERE in `src/` and scanned too — that is what catches
//     `${EDGE_PILL}` in `controller-command-row.tsx` and
//     `CONTROLLER_SECONDARY_TONE[action.tone]`, whose class strings live in
//     another file entirely.
// WHAT IT DOES NOT SEE (corrected in round 3 — the previous list named "a
// control built from a lowercase-named wrapper component", which is not a hole
// at all: a lowercase JSX tag IS a DOM element. The real gap is the opposite):
//   - An UPPERCASE wrapper that renders a control — `<Button className="border-
//     [var(--hairline-strong)]">` above all, this repo's own control primitive,
//     which is simply not in `CONTROL_TAG`.
//   - A border drawn on a presentational element AROUND the control rather than
//     on the control itself — `deck-shelf-tile.tsx`'s wrapper `<div>` holds the
//     tile's only bound while the `<button>` inside it carries no edge. Found
//     in round 3 and fixed by hand there; the sweep still cannot see it.
//   - `<div role="button" onClick>` — an ARIA control on a non-control tag.
//   - An inline `style={{ borderColor }}`, which never spells a Tailwind class.
//   - lowercase constants, local or module-level: `constantTable` only collects
//     SCREAMING_SNAKE. It also only collects them at column 0, its `decl` regex
//     being `^`-anchored under `/m`, so an INDENTED constant is invisible too.
//   - A class assembled at runtime from non-constant pieces, or a `cva`/`clsx`
//     variant map keyed by a lowercase local.
//   - A hairline reaching a control through a CSS class rather than a utility.
//   - Untracked files — the sweep reads `git ls-files`.
// It is a net with known holes, not a proof — but it closes the hole this diff
// fell into, cheaply, at source level, and it caught three more on its first
// real outing (the v4 lobby, PR #2846, landing minutes before this one).
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
);

/** Elements that ARE controls (or render one). Lowercase `a` included: a link
 *  styled as a button has the same boundary obligation. */
const CONTROL_TAG =
    /<(button|a|PopoverTrigger|DialogTrigger|SelectTrigger|AlertDialogTrigger|ContextMenuTrigger|DropdownMenuTrigger|TabsTrigger)(?=[\s>/])/g;

/** A BORDER drawn with the decorative hairline pair — including a variant
 *  (`hover:border-[var(--hairline-strong)]`). Deliberately anchored on
 *  `border-[`: `border-b-[var(--hairline)]` is a divider INSIDE a control, a
 *  legitimate decorative use, and stays out of scope. */
const HAIRLINE_BORDER = /border-\[var\(--hairline/;

function srcFiles(): string[] {
    return execFileSync("git", ["ls-files", "src/**/*.ts", "src/**/*.tsx"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
    })
        .trim()
        .split("\n")
        .filter(Boolean);
}

/** Every module-level SCREAMING_SNAKE const in `src/`, mapped to the source
 *  text of its initialiser (string literal, template, or object literal). */
function constantTable(sources: Map<string, string>): Map<string, string> {
    const table = new Map<string, string>();
    const decl =
        /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\b[^=]*=\s*([\s\S]*?);\s*$/gm;
    for (const source of sources.values()) {
        let m: RegExpExecArray | null;
        while ((m = decl.exec(source))) table.set(m[1], m[2]);
    }
    return table;
}

/** The opening tag starting at `start`, brace/quote aware so a `>` inside a
 *  `className={…}` expression or a string never terminates it early. */
function openingTag(source: string, start: number): string {
    let depth = 0;
    let quote: string | null = null;
    let out = "";
    for (let i = start; i < source.length; i++) {
        const c = source[i];
        if (quote) {
            out += c;
            if (c === quote && source[i - 1] !== "\\") quote = null;
            continue;
        }
        // Comments inside the tag expression are SKIPPED, not scanned. Two
        // reasons, and the second is a correctness bug found in round 3:
        //   1. A class named in a comment is not applied to anything, so
        //      scanning it can only produce a false positive.
        //   2. English prose carries apostrophes ("the ADR's edge"). Quote
        //      tracking above treats `'` as a string delimiter, so one
        //      unpaired apostrophe in a `//` comment opened a string that
        //      never closed — the scan then ran past the tag's `>` and into
        //      the element's decorative CHILDREN. Measured on
        //      `lobby-mode-tile.tsx`: 3631 of the file's 5039 characters
        //      swallowed, through `</button>`, reporting the chip `<span>`'s
        //      legitimate hairline as the button's edge. Skipping comments
        //      removes the hazard at its source.
        if (c === "/" && source[i + 1] === "/") {
            const nl = source.indexOf("\n", i);
            if (nl === -1) return out;
            i = nl;
            out += "\n";
            continue;
        }
        if (c === "/" && source[i + 1] === "*") {
            const end = source.indexOf("*/", i + 2);
            if (end === -1) return out;
            i = end + 1;
            out += " ";
            continue;
        }
        out += c;
        if (c === '"' || c === "'" || c === "`") quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) return out;
    }
    return out;
}

function offenders(): string[] {
    const files = srcFiles();
    const sources = new Map(
        files.map((f) => [f, readFileSync(path.join(REPO_ROOT, f), "utf8")])
    );
    const constants = constantTable(sources);
    const found: string[] = [];

    for (const [file, source] of sources) {
        if (!file.endsWith(".tsx")) continue;
        if (file.includes("__tests__")) continue;
        CONTROL_TAG.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = CONTROL_TAG.exec(source))) {
            const tag = openingTag(source, m.index);
            let text = tag;
            for (const id of tag.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? []) {
                const body = constants.get(id);
                if (body) text += "\n" + body;
            }
            if (!HAIRLINE_BORDER.test(text)) continue;
            const line = source.slice(0, m.index).split("\n").length;
            found.push(`${file}:${line} <${m[1]}>`);
        }
    }
    return found.sort();
}

describe("control edges use --color-border-strong, never the decorative hairline pair", () => {
    it("finds interactive tags at all (the sweep is not vacuous)", () => {
        // Guards against the scan silently matching nothing — a regex typo
        // would otherwise turn this whole file into a green no-op.
        const files = srcFiles();
        expect(files.length).toBeGreaterThan(100);
        const buttons = files
            .filter((f) => f.endsWith(".tsx"))
            .map((f) => readFileSync(path.join(REPO_ROOT, f), "utf8"))
            .join("\n")
            .match(CONTROL_TAG);
        expect(buttons?.length ?? 0).toBeGreaterThan(200);
    });

    it("no control draws its border with --hairline / --hairline-strong", () => {
        // Empty by construction and meant to stay empty: a control that
        // genuinely wants the translucent pair does not exist — the pair is
        // for panels, banners, dividers and plaques. If this list grows, move
        // the edge, do not extend the list.
        expect(offenders()).toEqual([]);
    });
});
