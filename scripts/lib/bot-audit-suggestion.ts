// The one-line `/bot-audit` suggestion `land` prints after a landing
// (ADR 0149 §6, issue #4924): a suggestion only — no exit-code effect, no
// label, no claim, nothing scheduled. The owner reads it and runs the skill
// by hand, or not.
//
// Pure on a `git diff --name-status` text so the test feeds it literal diffs;
// the CLI half reads that text from stdin, which is how `land`'s shell step
// hands it the merged tip's diff.

/** The committed (fitted) Evaluation weights — `convex/gre/ai/evalWeights.ts`. */
export const FITTED_WEIGHTS_PATH = "convex/gre/ai/evalWeights.ts";
const SETS_PREFIX = "convex/cards/sets/";

/**
 * `bot audit suggested: …` for the landed diff, or null. A diff touching the
 * weights module → "weights moved"; a set's `index.cards.ts` ADDED →
 * "new set <code>" (every code, sorted). Both → two lines, weights first.
 */
export function botAuditSuggestion(nameStatus: string): string | null {
    let weights = false;
    const sets = new Set<string>();
    for (const line of nameStatus.split("\n")) {
        const [status, ...paths] = line.trim().split("\t");
        if (!status || paths.length === 0) continue;
        if (paths.includes(FITTED_WEIGHTS_PATH)) weights = true;
        // Added (A) or the destination of a copy/rename (C/R).
        if (!/^[ACR]/.test(status)) continue;
        const dest = paths[paths.length - 1];
        if (!dest.startsWith(SETS_PREFIX)) continue;
        // Every set has exactly one `index.cards.ts`: its arrival is the set's.
        const [code, file] = dest.slice(SETS_PREFIX.length).split("/");
        if (code && file === "index.cards.ts") sets.add(code);
    }
    const lines: string[] = [];
    if (weights) lines.push("bot audit suggested: weights moved");
    if (sets.size > 0)
        lines.push(
            `bot audit suggested: new set ${[...sets].sort().join(", ")}`
        );
    return lines.length > 0 ? lines.join("\n") : null;
}

if (import.meta.main) {
    const text = await Bun.stdin.text();
    const out = botAuditSuggestion(text);
    if (out) console.log(out);
}
