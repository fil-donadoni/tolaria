// A test that asserts what the lane classifier PLANS, or what a receipt
// DECISION is, must not pay the whole-tree import-graph walk (issue #7884):
// ~2 s standalone, ~40x that in batch health under CPU contention. This finds
// the calls that fall back to the live defaults.
//
//   classifyLane(...)            needs its first seven parameters (related,
//                                overrides, botReach, scanGuards, sentinels
//                                are the walkers) — or `inertClassifyLane`.
//   skinReceiptInvalidForDiff()  needs `scopeOf` (the fourth argument).
//   landingDiffScope()           IS the walk: always a live-walk test.
//
// A live-walk test says so: `live-walk: <reason>` in a comment on the call's
// line or in the 8 lines above it, or `live-walk-file: <reason>` anywhere in
// the file (a file whose subject is the classifier itself).

export interface LiveCall {
    line: number;
    callee: string;
}

/** Parameters that must be present, per callee. */
const REQUIRED_ARGS: Readonly<Record<string, number>> = {
    classifyLane: 7,
    skinReceiptInvalidForDiff: 4,
    landingDiffScope: Number.POSITIVE_INFINITY,
};

const CALL =
    /(?<![\w$.])(classifyLane|skinReceiptInvalidForDiff|landingDiffScope)\(/g;
const MARKER_WINDOW = 8;

/** Top-level argument count of the call whose `(` is at `open`. */
function argCount(source: string, open: number): number {
    let depth = 0;
    let args = 0;
    let sawToken = false;
    for (let i = open; i < source.length; i++) {
        const c = source[i];
        if (c === '"' || c === "'" || c === "`") {
            for (i++; i < source.length && source[i] !== c; i++) {
                if (source[i] === "\\") i++;
            }
            sawToken = true;
            continue;
        }
        if (c === "/" && source[i + 1] === "/") {
            while (i < source.length && source[i] !== "\n") i++;
            continue;
        }
        if (c === "/" && source[i + 1] === "*") {
            i = source.indexOf("*/", i + 2);
            if (i < 0) return args;
            i++;
            continue;
        }
        if ("([{".includes(c)) {
            depth++;
            if (depth > 1) sawToken = true;
            continue;
        }
        if (")]}".includes(c)) {
            depth--;
            if (depth === 0) return sawToken ? args + 1 : args;
            continue;
        }
        if (c === "," && depth === 1) {
            if (sawToken) args++;
            sawToken = false;
            continue;
        }
        if (!/\s/.test(c)) sawToken = true;
    }
    return args;
}

/** The calls in `source` that rely on a live default and carry no marker. */
export function liveLaneSourceCalls(source: string): LiveCall[] {
    if (/live-walk-file:/.test(source)) return [];
    const lines = source.split("\n");
    // `pr-fixup.ts` exports an unrelated `classifyLane`: only the one imported
    // from `check-lane` (or defined in a file that wraps it) is the walker.
    const planner = /check-lane["']/.test(source);
    const found: LiveCall[] = [];
    for (const m of source.matchAll(CALL)) {
        const at = m.index!;
        const line = source.slice(0, at).split("\n").length;
        const text = lines[line - 1];
        // A declaration or an import, not a call.
        if (/\b(function|import|from)\b/.test(text) && !/=>/.test(text)) {
            if (/function\s+\w+\(/.test(text) || /^\s*import\b/.test(text))
                continue;
        }
        const callee = m[1];
        if (callee === "classifyLane" && !planner) continue;
        if (argCount(source, at + m[0].length - 1) >= REQUIRED_ARGS[callee])
            continue;
        const window = lines
            .slice(Math.max(0, line - 1 - MARKER_WINDOW), line)
            .join("\n");
        if (/live-walk:/.test(window)) continue;
        found.push({ line, callee });
    }
    return found;
}
