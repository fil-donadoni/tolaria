// Card-test colour placement (issue #2256, ADR 0043 colour split).
//
// A card's tests live in the per-colour test file parallel to the colour module
// that defines it: `sets/leg/red.cards.ts` → `sets/leg/__tests__/red.test.ts`.
// Tests resolve cards by `getDefinition(<uuid>)`, so nothing at an import site
// says which colour module a card comes from and a misplaced `describe` block
// is invisible to a reviewer. This module makes it mechanical.
//
// Rule: a top-level `describe("<title>")` in a colour test file NAMES the cards
// it covers — a real card `name:` from the set's own `*.cards.ts` modules,
// found as a whole phrase in the title. If it names at least one card and none
// of them is defined in the file's own colour module, the block is misplaced.
// Basic lands are fixtures, never subjects, and are ignored. A block naming no
// card (a mechanic or cross-cutting block) is out of the rule's reach.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

/** The five basic-colour test files the rule covers. */
export const COLOUR_TEST_FILES = [
    "white",
    "blue",
    "black",
    "red",
    "green",
] as const;

/** Modules a card can be defined in (a card may be named from any of them). */
export const CARD_MODULES = [
    ...COLOUR_TEST_FILES,
    "colorless",
    "multicolor",
] as const;

const BASIC_LANDS = new Set([
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
]);

export interface MisplacedBlock {
    file: string;
    line: number;
    title: string;
    /** Named cards, as `Name (module)`. */
    named: string[];
}

/** card name → modules defining it, for one set directory. */
export function cardNamesBySet(setDir: string): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const mod of CARD_MODULES) {
        const file = path.join(setDir, `${mod}.cards.ts`);
        if (!existsSync(file)) continue;
        for (const m of readFileSync(file, "utf8").matchAll(
            /^ {4}name:\s*"([^"]+)"/gm
        )) {
            if (BASIC_LANDS.has(m[1])) continue;
            const mods = out.get(m[1]) ?? new Set<string>();
            mods.add(mod);
            out.set(m[1], mods);
        }
    }
    return out;
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Cards a `describe` title names: whole-phrase hits, longest name first. */
export function namedCards(
    title: string,
    names: Map<string, Set<string>>
): { name: string; modules: Set<string> }[] {
    const hits: { name: string; modules: Set<string> }[] = [];
    let rest = title;
    const longestFirst = [...names.keys()].sort((a, b) => b.length - a.length);
    for (const name of longestFirst) {
        const re = new RegExp(`(?<![\\w'])${escapeRe(name)}(?![\\w])`);
        if (!re.test(rest)) continue;
        hits.push({ name, modules: names.get(name)! });
        rest = rest.replace(re, " ");
    }
    return hits;
}

/** Misplaced top-level `describe` blocks of one colour test file. */
export function misplacedBlocks(
    file: string,
    source: string,
    colour: string,
    names: Map<string, Set<string>>
): MisplacedBlock[] {
    const out: MisplacedBlock[] = [];
    const re = /^describe\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/gm;
    for (const m of source.matchAll(re)) {
        const title = m[2];
        const hits = namedCards(title, names);
        if (hits.length === 0) continue;
        if (hits.some((h) => h.modules.has(colour))) continue;
        out.push({
            file,
            line: source.slice(0, m.index).split("\n").length,
            title,
            named: hits.map((h) => `${h.name} (${[...h.modules].join("/")})`),
        });
    }
    return out;
}

/** Every misplaced block under `<setsRoot>/<set>/__tests__/<colour>.test.ts`. */
export function findMisplacedBlocks(setsRoot: string): MisplacedBlock[] {
    const out: MisplacedBlock[] = [];
    for (const set of readdirSync(setsRoot).sort()) {
        const setDir = path.join(setsRoot, set);
        const names = cardNamesBySet(setDir);
        if (names.size === 0) continue;
        for (const colour of COLOUR_TEST_FILES) {
            const file = path.join(setDir, "__tests__", `${colour}.test.ts`);
            if (!existsSync(file)) continue;
            out.push(
                ...misplacedBlocks(
                    path.relative(setsRoot, file),
                    readFileSync(file, "utf8"),
                    colour,
                    names
                )
            );
        }
    }
    return out;
}
