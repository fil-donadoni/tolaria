// One search's time in buckets (issue #9527, issue #10122): the fold that
// `profile.mjs` (V8) and `profile-gecko.mjs` (SpiderMonkey) both apply, so
// the two engines' shares mean the same thing.
//
// Only the samples UNDER `searchWithTrace` count: loading the bundle and
// building the position are not the search. Each sample goes to the INNERMOST
// enclosing bucket function on its stack, so the buckets partition the search:
// a clone made while enumerating moves is cloning, not enumeration.
//
//   clone        cloneGameState / cloneValue — copying the state
//   determinize  determinize — sampling the hidden cards
//   enumerate    enumerateMoves — the legal moves
//   apply        applyMoveInSearch / applyMoveForSearch — a move through the
//                real engine (resolution, state-based actions, triggers, layers)
//   evaluate     evaluate — the leaf heuristic
//   gc           the garbage collector. V8 reports it outside any stack, so
//                there it is the whole run's collection, charged to the
//                search; Gecko samples it on the stack that triggered it, so
//                there it is the search's own
//   other        the search loop itself and everything not named above

export const BUCKETS = [
    ["clone", /^(cloneGameState|cloneValue)\d*$/],
    ["determinize", /^determinize\d*$/],
    ["enumerate", /^enumerateMoves\d*$/],
    ["apply", /^(applyMoveInSearch|applyMoveForSearch)\d*$/],
    ["evaluate", /^evaluate\d*$/],
];
export const SEARCH = /^searchWithTrace\d*$/;

/** Engine functions worth an INCLUSIVE share of their own: everything that
 *  ran while one of them was on the stack. These overlap each other and the
 *  buckets; they say what a rewrite of one piece could at most win back. */
export const INCLUSIVE = [
    "cloneValue",
    "enumerateMoves",
    "getLegalActions",
    "applyMoveInSearch",
    "checkStateBasedActions",
    "collectTriggers",
    "deriveBoardWithSources",
    "evaluate",
    "determinize",
];

/** A position argument: a blade index, or else a field fixture's path. */
export function isBladeIndex(position) {
    return /^\d+$/.test(position);
}

/** `<bundle.js> <out.json> [--iterations N] <position>...` — the profilers'
 *  shared command line. 1320 iterations (`expert`) unless told otherwise. */
export function parseProfileArgs(argv, script) {
    const at = argv.indexOf("--iterations");
    const iterations = at === -1 ? 1320 : Number(argv[at + 1]);
    const rest = argv.filter((_, i) => at === -1 || (i !== at && i !== at + 1));
    const [bundle, out, ...positions] = rest;
    if (!bundle || !out || positions.length === 0 || !(iterations > 0)) {
        console.error(
            `usage: ${script} <bundle.js> <out.json> [--iterations N] <position>...`
        );
        process.exit(2);
    }
    return { bundle, out, iterations, positions };
}
