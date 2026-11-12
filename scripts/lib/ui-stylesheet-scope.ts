/**
 * Which modules a stylesheet diff can restyle (issue #9295, owner ruling).
 *
 * WHY. A `.css` path is global to `check:ui`: the cascade applies it to every
 * route, so any stylesheet diff forced `full` — 80 surfaces × 6 viewports,
 * ~88 min — even when every changed line sat inside a rule like
 * `.priority-half-mine { … }` that only one board component can match. A rule
 * whose selectors are made of CLASSES matches only elements carrying those
 * classes, and an element carries a class because some module wrote it. So
 * the diff can move exactly the surfaces whose closure holds a module that
 * names one of those classes.
 *
 * WHAT IS CONFINED. Every changed line (added: read in the new sheet, removed:
 * read in the old one) is judged by the chain of blocks that encloses it:
 *   - a blank or comment-only line → confines nothing, moves nothing;
 *   - `@media` / `@supports` / `@container` / `@layer` → transparent wrappers;
 *   - a style rule whose every selector is built only from classes, pseudo
 *     classes / elements, attribute selectors and combinators → its classes;
 *   - `@keyframes NAME` → the classes of every rule in the same sheet that
 *     names NAME (each judged by the same rules), plus NAME itself, so a
 *     module writing it inline, or a Tailwind `animate-NAME` /
 *     `animate-[NAME…]` utility, is an owner too;
 *   - anything else — `:root`, `html`, `*`, a type selector, `&` nesting,
 *     `@theme`, `@font-face`, `@property`, a top-level statement — → `null`:
 *     the stylesheet stays global (`full`), as before.
 *
 * OWNERS. A module owns a class when its text names it as a whole token, or
 * builds it from a template prefix (`priority-half-${seat}` owns every
 * `priority-half-*`). A class nothing names is dead: it matches no element,
 * so it selects no surface.
 *
 * FAIL-CLOSED. Anything unreadable — no merge-base, a deleted sheet, a diff
 * that cannot be parsed — leaves the stylesheet out of the map, and the
 * caller treats it as global. `stylesheetConfinement` and `classOwners` are
 * pure; `stylesheetOwnersSinceBase` reads git and disk.
 *
 * ACCEPTED HOLE. A class assembled at runtime from parts none of which is a
 * literal `prefix${` (`["priority", "half"].join("-")`) has no owner and reads
 * as dead. Recorded, not closed — the same class of hole as Tailwind's class
 * scan (`ui-scope.ts` header).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { ORIGIN_BASE } from "./branches.ts";

/** A changed stylesheet: line numbers (1-based) removed from the old text
 *  and added in the new one. */
export interface StylesheetChange {
    before: string;
    after: string;
    removed: readonly number[];
    added: readonly number[];
}

/** What a confined change can restyle: classes, and keyframe names a module
 *  may also reference inline. */
export interface Confinement {
    classes: Set<string>;
    keyframes: Set<string>;
}

interface Block {
    prelude: string;
    /** Line of the prelude's first non-blank character. */
    startLine: number;
    /** Line of the closing brace. */
    endLine: number;
    parent: Block | null;
}

interface ParsedSheet {
    blocks: Block[];
    /** Lines whose only content is whitespace and/or comment text. */
    blankLines: Set<number>;
    /** The text with comments replaced by spaces (newlines kept). */
    code: string;
}

/** Blocks, blank lines and comment-free text of a stylesheet. `null` when
 *  the braces do not balance. */
export function parseSheet(text: string): ParsedSheet | null {
    let code = "";
    for (let i = 0; i < text.length; ) {
        if (text.startsWith("/*", i)) {
            const end = text.indexOf("*/", i + 2);
            const stop = end === -1 ? text.length : end + 2;
            code += text.slice(i, stop).replace(/[^\n]/g, " ");
            i = stop;
        } else if (text[i] === '"' || text[i] === "'") {
            const quote = text[i];
            let j = i + 1;
            while (j < text.length && text[j] !== quote && text[j] !== "\n") {
                j += text[j] === "\\" ? 2 : 1;
            }
            code += text.slice(i, j + 1);
            i = j + 1;
        } else {
            code += text[i];
            i++;
        }
    }
    const lines = code.split("\n");
    const blankLines = new Set<number>();
    lines.forEach((l, idx) => {
        if (l.trim() === "") blankLines.add(idx + 1);
    });

    const blocks: Block[] = [];
    const stack: Block[] = [];
    let line = 1;
    let preludeStart = -1;
    let preludeStartLine = 1;
    let prelude = "";
    for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        if (ch === "{") {
            const block: Block = {
                prelude: prelude.trim(),
                startLine: preludeStart === -1 ? line : preludeStartLine,
                endLine: -1,
                parent: stack[stack.length - 1] ?? null,
            };
            stack.push(block);
            blocks.push(block);
            prelude = "";
            preludeStart = -1;
        } else if (ch === "}") {
            const block = stack.pop();
            if (!block) return null;
            block.endLine = line;
            prelude = "";
            preludeStart = -1;
        } else if (ch === ";") {
            prelude = "";
            preludeStart = -1;
        } else {
            if (preludeStart === -1 && !/\s/.test(ch)) {
                preludeStart = i;
                preludeStartLine = line;
            }
            if (preludeStart !== -1) prelude += ch;
        }
        if (ch === "\n") line++;
    }
    if (stack.length > 0) return null;
    return { blocks, blankLines, code };
}

/** The innermost block whose prelude-to-brace range holds `line`. */
function innermostAt(sheet: ParsedSheet, line: number): Block | null {
    let best: Block | null = null;
    for (const b of sheet.blocks) {
        if (b.startLine <= line && line <= b.endLine) {
            if (!best || b.startLine >= best.startLine) best = b;
        }
    }
    return best;
}

const WRAPPER_AT_RULE = /^@(?:media|supports|container|layer)\b/;
const KEYFRAMES = /^@(?:-webkit-)?keyframes\s+([\w-]+)\s*$/;
const CLASS_TOKEN = /\.([A-Za-z_][\w-]*)/g;
const CLASS_COMPOUND = /^(?:\.[A-Za-z_][\w-]*)+$/;

/** The classes a selector list can match on, or `null` when any selector
 *  holds something other than classes, pseudos, attributes and combinators. */
export function selectorClasses(prelude: string): Set<string> | null {
    const classes = new Set<string>();
    for (const part of splitTopLevel(prelude)) {
        const selector = part.trim();
        if (selector === "" || selector.includes("&")) return null;
        let structure = selector.replace(/\[[^\]]*\]/g, "");
        // Pseudo-classes with arguments (`:not(.x)`, `:is(…)`), then bare ones.
        let previous = "";
        while (previous !== structure) {
            previous = structure;
            structure = structure.replace(/::?[A-Za-z-]+\([^()]*\)/g, "");
        }
        structure = structure.replace(/::?[A-Za-z-]+/g, "");
        const compounds = structure.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
        if (compounds.length === 0) return null;
        if (!compounds.every((c) => CLASS_COMPOUND.test(c))) return null;
        for (const m of selector.matchAll(CLASS_TOKEN)) classes.add(m[1]);
    }
    return classes;
}

function splitTopLevel(list: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of list) {
        if (ch === "(" || ch === "[") depth++;
        if (ch === ")" || ch === "]") depth--;
        if (ch === "," && depth === 0) {
            parts.push(current);
            current = "";
        } else current += ch;
    }
    parts.push(current);
    return parts;
}

/** Fold one block chain (innermost first) into `out`; `false` = global. */
function confineChain(
    block: Block | null,
    sheet: ParsedSheet,
    out: Confinement,
    seenKeyframes: Set<string>
): boolean {
    if (block === null) return false; // a top-level statement
    let confinedBy: "class" | "keyframes" | null = null;
    for (let b: Block | null = block; b; b = b.parent) {
        const p = b.prelude;
        if (WRAPPER_AT_RULE.test(p)) continue;
        const kf = KEYFRAMES.exec(p);
        if (kf) {
            if (!confineKeyframes(kf[1], sheet, out, seenKeyframes)) {
                return false;
            }
            confinedBy = "keyframes";
            continue;
        }
        if (p.startsWith("@")) return false;
        // A keyframe step (`50%`, `from`) is confined by its `@keyframes`.
        if (/^(?:from|to|[\d.]+%)(?:\s*,\s*(?:from|to|[\d.]+%))*$/.test(p)) {
            continue;
        }
        const classes = selectorClasses(p);
        if (!classes) return false;
        for (const c of classes) out.classes.add(c);
        confinedBy = "class";
    }
    return confinedBy !== null;
}

/** Every rule in `sheet` that names keyframes `name` must be confined. */
function confineKeyframes(
    name: string,
    sheet: ParsedSheet,
    out: Confinement,
    seen: Set<string>
): boolean {
    out.keyframes.add(name);
    if (seen.has(name)) return true;
    seen.add(name);
    const lines = sheet.code.split("\n");
    const token = new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`);
    for (let i = 0; i < lines.length; i++) {
        if (!token.test(lines[i])) continue;
        if (KEYFRAMES.test(lines[i].trim().replace(/\{.*$/, "").trim())) {
            continue; // the `@keyframes NAME` prelude itself
        }
        const block = innermostAt(sheet, i + 1);
        if (!confineChain(block, sheet, out, seen)) return false;
    }
    return true;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** What a stylesheet change can restyle, or `null` when any changed line is
 *  global (see the header). */
export function stylesheetConfinement(
    change: StylesheetChange
): Confinement | null {
    const out: Confinement = { classes: new Set(), keyframes: new Set() };
    const sides: [string, readonly number[]][] = [
        [change.before, change.removed],
        [change.after, change.added],
    ];
    for (const [text, lines] of sides) {
        if (lines.length === 0) continue;
        const sheet = parseSheet(text);
        if (!sheet) return null;
        const seen = new Set<string>();
        for (const line of lines) {
            if (sheet.blankLines.has(line)) continue;
            if (!confineChain(innermostAt(sheet, line), sheet, out, seen)) {
                return null;
            }
        }
    }
    return out;
}

/** Whether `source` names `token` as a whole token, or builds it from a
 *  template prefix (`prefix-${`). */
function namesToken(source: string, token: string): boolean {
    const whole = new RegExp(`(?<![\\w-])${escapeRegExp(token)}(?![\\w-])`);
    if (whole.test(source)) return true;
    for (let i = token.indexOf("-"); i !== -1; i = token.indexOf("-", i + 1)) {
        const prefix = escapeRegExp(token.slice(0, i + 1));
        if (new RegExp(`(?<![\\w-])${prefix}\\$\\{`).test(source)) return true;
    }
    return false;
}

/** The modules (of `files`: path → text) that name a confined class or
 *  keyframe name. */
export function classOwners(
    confinement: Confinement,
    files: ReadonlyMap<string, string>
): string[] {
    const tokens = [...confinement.classes, ...confinement.keyframes];
    // Tailwind's `animate-NAME` / `animate-[NAME_…]` utilities play keyframes
    // NAME (built-ins like `spin` included), so writing one owns NAME.
    const animateUtilities = [...confinement.keyframes].map(
        (k) =>
            new RegExp(
                `(?<![\\w-])animate-\\[?${escapeRegExp(k)}(?![A-Za-z0-9-])`
            )
    );
    const owners: string[] = [];
    for (const [file, source] of files) {
        if (
            tokens.some((t) => namesToken(source, t)) ||
            animateUtilities.some((re) => re.test(source))
        ) {
            owners.push(file);
        }
    }
    return owners.sort();
}

/** `git diff -U0` hunk headers → removed / added line numbers. */
export function zeroContextLines(diff: string): {
    removed: number[];
    added: number[];
} {
    const removed: number[] = [];
    const added: number[] = [];
    for (const m of diff.matchAll(
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm
    )) {
        const [oldStart, oldLen, newStart, newLen] = [
            Number(m[1]),
            m[2] === undefined ? 1 : Number(m[2]),
            Number(m[3]),
            m[4] === undefined ? 1 : Number(m[4]),
        ];
        for (let i = 0; i < oldLen; i++) removed.push(oldStart + i);
        for (let i = 0; i < newLen; i++) added.push(newStart + i);
    }
    return { removed, added };
}

/** A module a class can be written in: `src/**` JS/TS, not a test. */
function isOwnerCandidate(file: string): boolean {
    return (
        /^src\/.*\.[cm]?[jt]sx?$/.test(file) &&
        !/(?:^|\/)__tests__\//.test(file) &&
        !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)
    );
}

/** For each changed `.css` path whose diff against the merge-base is
 *  confined, the modules that own its classes. A path absent from the map
 *  stays global. */
export function stylesheetOwnersSinceBase(
    changed: readonly string[],
    root: string
): Map<string, string[]> {
    const owners = new Map<string, string[]>();
    const sheets = changed.filter((p) => /\.css$/.test(p));
    if (sheets.length === 0) return owners;
    try {
        const git = (args: string[]) =>
            execFileSync("git", args, {
                cwd: root,
                encoding: "utf8",
                maxBuffer: 64 * 1024 * 1024,
                stdio: ["ignore", "pipe", "ignore"],
            });
        const mergeBase = git(["merge-base", ORIGIN_BASE, "HEAD"]).trim();
        let files: Map<string, string> | null = null;
        for (const sheet of sheets) {
            const abs = path.join(root, sheet);
            if (!fs.existsSync(abs)) continue; // deleted: stays global
            let before = "";
            try {
                before = git(["show", `${mergeBase}:${sheet}`]);
            } catch {
                before = ""; // a new stylesheet: every line is added
            }
            const after = fs.readFileSync(abs, "utf8");
            const diff = git([
                "diff",
                "-U0",
                "--no-color",
                "--no-ext-diff",
                mergeBase,
                "--",
                sheet,
            ]);
            const confinement = stylesheetConfinement({
                before,
                after,
                ...zeroContextLines(diff),
            });
            if (!confinement) continue;
            if (files === null) {
                const loaded = new Map<string, string>();
                for (const f of git([
                    "ls-files",
                    "--cached",
                    "--others",
                    "--exclude-standard",
                    "--",
                    "src",
                ]).split("\n")) {
                    if (!isOwnerCandidate(f)) continue;
                    const p = path.join(root, f);
                    if (fs.existsSync(p)) {
                        loaded.set(f, fs.readFileSync(p, "utf8"));
                    }
                }
                files = loaded;
            }
            owners.set(sheet, classOwners(confinement, files));
        }
    } catch {
        // Unreadable: every stylesheet stays global.
    }
    return owners;
}
