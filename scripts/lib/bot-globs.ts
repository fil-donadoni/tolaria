// Single source of truth for "is this file part of the Bot subsystem" — the
// set of paths the Bot verification doctrine (`.claude/skills/bot-slice/`)
// applies to.
//
// Two OTHER places need this exact list and must never drift from it or each
// other (issue #2688):
//   - `.claude/rules/bot-development.md`'s frontmatter `globs:` — what
//     auto-loads the rule for a human/agent editing the tree.
//   - the receipt validator (`receipt.ts`) — what makes the `blade` field
//     mandatory on a WorkReceipt whose `targetFiles` land here.
//
// Keeping ONE array, with a test asserting the markdown frontmatter equals
// it verbatim (`scripts/__tests__/bot-globs.test.ts`), is what stops the
// second copy from silently going stale the next time this list changes.
export const BOT_GLOBS: readonly string[] = [
    "convex/gre/{search,evaluate,moves,applyMove,determinize,difficulty,shouldThink,describeMove}.ts",
    "convex/gre/ai/**",
    "src/lib/ai/**",
];

const SPECIAL = new Set(".+?^${}()|[]\\".split("") as readonly string[]);

/**
 * Just enough glob support for `BOT_GLOBS`'s three shapes — `{a,b,c}`
 * brace-alternation and `**`/`*` wildcards — not a general-purpose glob
 * library. Anchored on both ends: a glob matches a full repo-relative path,
 * never a substring of one.
 */
function globToRegExp(glob: string): RegExp {
    let pattern = "";
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === "{") {
            const end = glob.indexOf("}", i);
            if (end === -1) {
                throw new Error(`glob "${glob}" has an unclosed "{"`);
            }
            const alts = glob
                .slice(i + 1, end)
                .split(",")
                .map((alt) => alt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
            pattern += `(?:${alts.join("|")})`;
            i = end;
        } else if (c === "*" && glob[i + 1] === "*") {
            pattern += ".*";
            i++;
        } else if (c === "*") {
            pattern += "[^/]*";
        } else if (SPECIAL.has(c)) {
            pattern += `\\${c}`;
        } else {
            pattern += c;
        }
    }
    return new RegExp(`^${pattern}$`);
}

const BOT_GLOB_PATTERNS = BOT_GLOBS.map(globToRegExp);

/** Does `filePath` (repo-relative, `/`-separated) match one of `BOT_GLOBS`? */
export function matchesBotGlob(filePath: string): boolean {
    return BOT_GLOB_PATTERNS.some((re) => re.test(filePath));
}

/** Does ANY of `targetFiles` fall under the Bot globs? */
export function touchesBotGlobs(targetFiles: readonly string[]): boolean {
    return targetFiles.some(matchesBotGlob);
}
