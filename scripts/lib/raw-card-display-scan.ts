import * as fs from "fs";
import * as path from "path";

/**
 * Raw card-id display-name scan (issue #1735 review round 3).
 *
 * Three review rounds each found a NEW site reading a battlefield-or-stack
 * `CardInstance`'s raw `card.card.id` to resolve a DISPLAY name — 11, then +3,
 * then +1, then +1 again this round (`stack-target-line.ts`, which arrived
 * from an unrelated PR mid-review and was missed by the hand-maintained
 * "walk the reducers" census). `card.card.id` is the CR 708.2 face-down
 * sentinel for EVERY viewer including the card's own controller
 * (`convex/gameProjections.ts`); the fix is always the same one-line repoint
 * to `displayCardId(card)` (`~/lib/card-utils.ts`), so a list a person
 * re-derives by eye every round is the wrong mechanism — the next miss is a
 * grep away, not a design problem.
 *
 * This scan is that grep, made permanent: it matches the EXACT failure shape
 * every round's finding had — `getDefinition(<expr>.card.id)` /
 * `tryGetDefinition(<expr>.card.id)` immediately followed by `.name` on the
 * SAME line — across the whole `src/` tree. It is deliberately narrower than
 * "every raw `card.card.id` read" (`card-utils.ts` alone has ~20 legitimate
 * ones: power/supertypes/kickers/mana-cost reads that MUST stay off the raw
 * id, because a face-down permanent's real characteristics for THOSE purposes
 * ARE the hidden 2/2 vanilla ones — see `displayCardId`'s own doc comment). A
 * blanket ban on the raw id would false-positive on every one of those and
 * on every legitimate hand/graveyard/exile display read (CR 708.7: a
 * face-down permanent turns face up before it can reach those zones, so the
 * raw id is simply correct there) — teaching the guard to tell those apart
 * needs full type information this regex does not have, and a lint rule that
 * cries wolf gets disabled, not obeyed. Keying on "`.name` read off the SAME
 * call, in the SAME statement" is the one shape that is ALWAYS wrong (a rules
 * read never chains `.name` straight off the constructor call — every
 * legitimate site above assigns to a local first) and it is exactly the shape
 * every round's finding had, so it catches the next one without relitigating
 * the other ~20.
 */

const RAW_DISPLAY_NAME_RE =
    /\b(?:getDefinition|tryGetDefinition)\(\s*([A-Za-z0-9_.]+)\.card\.id\s*\)\??\.\s*name\b/;

export interface RawCardDisplayHit {
    /** Repo-relative path, forward-slash separated. */
    file: string;
    /** 1-based line number. */
    line: number;
    /** The full matched line, trimmed. */
    text: string;
}

function walk(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "__tests__") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
        } else if (
            (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
            !entry.name.endsWith(".test.ts") &&
            !entry.name.endsWith(".test.tsx")
        ) {
            out.push(full);
        }
    }
}

/** Scan `src/**\/*.{ts,tsx}` (production code only — tests and `__tests__`
 *  directories are excluded, since a fixture routinely hand-builds a raw id
 *  on purpose) for the raw-card-id-to-display-name shape. */
export function scanRawCardDisplayReads(repoRoot: string): RawCardDisplayHit[] {
    const srcRoot = path.join(repoRoot, "src");
    const files: string[] = [];
    walk(srcRoot, files);
    const hits: RawCardDisplayHit[] = [];
    for (const file of files) {
        const rel = path.relative(repoRoot, file).split(path.sep).join("/");
        const lines = fs.readFileSync(file, "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (RAW_DISPLAY_NAME_RE.test(lines[i])) {
                hits.push({ file: rel, line: i + 1, text: lines[i].trim() });
            }
        }
    }
    return hits;
}
