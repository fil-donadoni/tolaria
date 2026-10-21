/**
 * The Bot hash's input set (`botHash`, `oracle-bot-reach.ts`), with no
 * imports: `check-lane.ts` asks it whether a `full` diff runs the whole bot
 * fast lane (issue #6149), and must not load the Mechanics Registry to ask.
 */

/**
 * The sources whose edit can change a Bot-play verdict — what the Bot hash
 * covers. The Bot's own modules (the search, its evaluation, the Move model
 * and its application, the owed-input computation) plus the position the
 * sweep builds and the sweep driver (`oracle-bot-reach.ts`).
 *
 * Deliberately NOT the whole engine: `applyMove` runs the real GRE, so in
 * principle any rules edit can move a verdict, but hashing `convex/gre/**`
 * would replay every `ready` card on nearly every landing. A rules edit that
 * does move one is caught by the next edit to a file here, or by
 * `oracle:compile --replay-bot`, which ignores the cache.
 *
 * The blade REGISTRY is excluded for the same reason — it is a list of
 * positions, edited by every Bot PR, read by nothing the sweep runs — while
 * the blade base state the sweep's position is built on is included.
 */
export const BOT_SOURCE_FILES = [
    "convex/gre/search.ts",
    "convex/gre/evaluate.ts",
    "convex/gre/greedy.ts",
    "convex/gre/determinize.ts",
    "convex/gre/moves.ts",
    "convex/gre/applyMove.ts",
    "convex/gre/expectedInput.ts",
    "convex/gre/scenarioBuilder.ts",
    // DIRECT imports of the verdict function, not transitive engine (review
    // of PR #4057, finding 5). `rules.ts` carries `getLegalActions`, the sole
    // discriminator between a `frozen` card (withheld) and a
    // `position-unmodelled` one (shipped); the other three decide what the
    // generated position contains.
    "convex/gre/rules.ts",
    "convex/gre/constants.ts",
    "convex/gre/state.ts",
    "convex/cards/colors.ts",
] as const;

/**
 * Inside {@link BOT_SOURCE_DIR} and still NOT hashed: it decides the Bot Gap
 * KEY, which `buildLockfile` recomputes from the definition on every run, and
 * never a verdict. Hashing it would replay 3,400 cards to change a label.
 */
const BOT_SOURCE_EXCLUDED_FILES = new Set(["botReachForm.ts"]);
export const BOT_SOURCE_DIR = "convex/gre/ai";
export const BOT_SOURCE_EXCLUDED_DIRS = new Set(["__tests__", "verdicts"]);
const BOT_BLADE_INCLUDED = new Set(["baseState.ts"]);

/**
 * Is `rel` (repo-relative, `/`-separated) one of the files `botHash` covers?
 * The ONE definition of the set: `botSourceFiles` walks the tree through it,
 * `deny-guard.sh` § 7 asks it (via `bot-sweep-inputs.ts`) whether a
 * worktree's diff moved the Bot hash (issue #4942), and `check-lane.ts`
 * whether a `full` diff runs the bot fast lane whole (issue #6149).
 */
export function isBotSourceFile(rel: string): boolean {
    if ((BOT_SOURCE_FILES as readonly string[]).includes(rel)) return true;
    if (!rel.startsWith(`${BOT_SOURCE_DIR}/`) || !rel.endsWith(".ts")) {
        return false;
    }
    const parts = rel.split("/");
    const entry = parts[parts.length - 1]!;
    const dirs = parts.slice(0, -1);
    if (dirs.some((d) => BOT_SOURCE_EXCLUDED_DIRS.has(d))) return false;
    if (BOT_SOURCE_EXCLUDED_FILES.has(entry)) return false;
    return dirs[dirs.length - 1] !== "blade" || BOT_BLADE_INCLUDED.has(entry);
}
