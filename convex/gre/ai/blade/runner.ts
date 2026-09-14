/**
 * Blade-scenario suite — the runner (issue #1427, PRD #1423).
 *
 * Takes a `BladeScenario`, builds its `GameState` in-process through the
 * SHARED, production `buildStateFromScenario` (issue #1424 — the exact
 * builder the Debug panel's `debugSetupScenario` uses, so a blade position
 * and a hand-loaded Debug scenario are the same board), runs the REAL ISMCTS
 * entry point `searchWithTrace` at a fixed iterations budget and a fixed
 * seed, and reports whether the chosen move satisfies the entry.
 *
 * Determinism contract (an acceptance criterion of #1427):
 *   - the base state is built from a FIXED synthetic deck and a FIXED shuffle
 *     seed — never a preset deck that may be re-tuned, never `Math.random`;
 *   - the search budget is `iterations` only — a `timeMs` budget would make
 *     the number of rollouts machine-dependent, and with it the move;
 *   - `searchWithTrace(state, playerId, budget, seed)` is pure given those.
 * Same registry + same seeds => identical result, on any machine, forever.
 *
 * Pure and synchronous: no Convex `ctx`, no DB, no network.
 */

import { ConvexError } from "convex/values";

import { getCardByName } from "../../../cards";
import {
    assertLiveGameCanContinue,
    assertLoadableIntoLiveGame,
    buildStateFromScenario,
} from "../../scenarioBuilder";
// The base position lives in its own PURE module (issue #3405), and the
// builder in `./build` (issue #3479): the verdict quiz builds the same position
// in the browser and must not drag the registry and the harness in with it.
// Both re-exported here so every existing caller keeps its import.
import { buildBladeBaseState, type SeatIdentity } from "./baseState";
export { buildBladeBaseState } from "./baseState";
export type { SeatIdentity } from "./baseState";
import { decidingPlayer, greedyRootPick, searchWithTrace } from "../../search";
import { computeOwedPlayerIds } from "../../expectedInput";
import type { DeckKnowledgeBySeat } from "../../deckKnowledge";
import type { GameState } from "../../state";
import type { Move } from "../../moves";
import {
    describeChosenMove,
    describeMatcher,
    matchesMove,
    seatPlayerId,
} from "./matcher";
import {
    getSearchVariant,
    setSearchVariant,
    type SearchVariant,
} from "../searchVariant";
import { findBladeScenario } from "./registry";
import { applyBladeRevisit, applyBladeSetup } from "./setup";
import type { BeyondBudget, BladeScenario } from "./types";

/** Thrown when a blade entry's declared `bot` seat does not hold the
 *  decision at search start (issue #1522) — modeled on `BladeSetupError`
 *  (`setup.ts`): a distinct class so a caller can tell an AUTHORING mistake
 *  (the entry names the wrong seat, or a `setup` sequence that leaves the
 *  built position with no decision owed at all) from an actual bot result.
 *  Before this check, the same mistake reached `searchWithTrace`, which
 *  returns `move: null` for a seat that owes nothing — indistinguishable
 *  from a bot that legitimately has no move, and reported as "chose [no
 *  move]" against whatever `expect` demanded. That is exactly the kind of
 *  position `setup.ts`'s own header promises to throw on rather than
 *  silently mismeasure — this closes the one gap that promise didn't yet
 *  cover: a position built to spec but handed to the WRONG decider. */
export class BladeDeciderError extends Error {
    constructor(
        label: string,
        declaredBot: BladeScenario["bot"],
        state: GameState,
        actualDeciderId: string | null
    ) {
        const describe = (id: string | null): string => {
            if (id === null) return "no one (nothing is owed)";
            if (id === seatPlayerId(state, "me")) return `"me" (${id})`;
            if (id === seatPlayerId(state, "opp")) return `"opp" (${id})`;
            return id;
        };
        super(
            `Blade scenario "${label}": declares bot "${declaredBot}", but at ` +
                `search start the decision belongs to ${describe(actualDeciderId)} — ` +
                `check the entry's \`bot\` seat or its \`setup\` sequence.`
        );
        this.name = "BladeDeciderError";
    }
}

/** Thrown when a blade entry cannot be loaded into a LIVE game (issue #3443)
 *  — the loader's own refusal class, distinct from `BladeDeciderError` above
 *  because the two answer different questions on different paths.
 *  `BladeDeciderError` is the in-process harness saying the ENTRY is
 *  mis-authored (its declared seat holds no decision); this one is the Debug
 *  panel saying the entry cannot be persisted into THIS game — the live Bot's
 *  seat is not one of its seats, or the built position owes that seat nothing,
 *  so loading it would leave a developer staring at a board where nothing is
 *  ever going to move. Refusing is the whole point: before this, a mismatched
 *  position was saved and the board simply stopped.
 *
 *  `ConvexError`, not `Error`, for the same reason `assertExpectedInput`
 *  (`gre/expectedInput.ts`) uses one: a production deployment strips a plain
 *  `Error`'s message before it reaches the client, and this message IS the
 *  feedback — the panel renders it and nothing else happened. */
export class BladeLoadError extends ConvexError<string> {
    constructor(message: string) {
        super(message);
        this.name = "BladeLoadError";
    }
}

/** The one seed every blade entry uses unless it declares its own. Fixed
 *  forever — changing it re-rolls the whole suite. */
export const DEFAULT_BLADE_SEED = 0xb1ade;

// The builder itself moved to `./build` (issue #3479) so the browser can call
// it without dragging this module — and with it the 6.6k-line registry and the
// whole harness — into the client bundle. Re-exported here, where every
// existing caller already imports it.
export { buildBladeState } from "./build";
import { buildBladeState } from "./build";

/**
 * Normalize an arbitrary CURRENT game's `GameState` onto the same starting
 * position `buildBladeBaseState` produces, then apply the scenario through
 * `buildStateFromScenario` — the shape `debugLoadBladeScenario`
 * (`convex/game.ts`) needs to make a browser-loaded position match the one
 * the blade harness actually tests against (issue #1432 review finding #1).
 *
 * `buildStateFromScenario` alone normalizes only zones/phase/turn/stack (plus
 * life, but only when the scenario's own spec sets it — CR 119.1, issue
 * #2147); it never touches `activePlayerId` or any other turn-/game-scoped
 * counter, so feeding it a live game's snapshot directly leaves those fields
 * wherever the live game happened to be — a materially different position
 * from the one the harness built and the blade entry's `expect` was written
 * against.
 *
 * Two prior fixup rounds tried to hand-pick which fields diverge: a 4-field
 * list (round 1) that leaked `restrictedMana`/`spellsCastThisTurn`/
 * `poisonCounters`/`energyCounters`/`skipNextTurn`/`hasDrawnFromEmpty`/
 * `permanentYouControlledLeftThisTurn`/`drawnThisTurn`/`lastDrawnCardId`/
 * `turnsTaken`, then a per-field-authority DENYLIST (round 2,
 * `resetPerTurnFields` + `emptyManaPool`) that still leaked `extraTurns`
 * (CR 500.7 — a queued extra turn from the live game would fire after the
 * loaded position's turn), `queuedEndTurn` (a standing pass-turn intent that
 * is deliberately turn-boundary-crossing, so `resetPerTurnFields` never
 * clears it) and `islandSanctuaryProtection` when it belongs to the
 * NON-active player. A denylist over the live state is structurally leaky:
 * every `GameState` field not named in it survives untouched, so each new
 * field added to the type is a leak until someone remembers to list it here
 * too.
 *
 * This round inverts to an ALLOWLIST instead: build the harness's OWN base
 * state, `buildBladeBaseState()`, but AS the live game's player identity
 * (`id`/`name`/`bgColor`, so the loaded position is saved back under the
 * seats the live game (and its Convex row) actually uses) — passed into
 * `buildBladeBaseState` at construction time, not patched onto a `p1`/`p2`
 * state afterward (which would leave every card's `ownerId`/`controllerId`
 * still pointing at the discarded `p1`/`p2` strings; see `buildBladeBaseState`
 * for why identity is threaded through instead). Every other field — turn
 * counters, life, mana, poison/energy, `extraTurns`, `queuedEndTurn`,
 * `islandSanctuaryProtection`, RNG state, every future field — comes from
 * the harness's own construction, by definition, not by remembering to
 * clear it. Leak-proof against every field `GameState` has today AND every
 * one it grows tomorrow.
 *
 * Pure: takes an already-fetched base `GameState` (read for identity only),
 * returns a NEW state via `buildStateFromScenario`; the input is never
 * mutated.
 */
export function buildBladeLoadState(
    base: GameState,
    scenario: BladeScenario,
    botPlayerId: string
): GameState {
    const identity = (player: GameState["players"][number]): SeatIdentity => ({
        id: player.id,
        name: player.name,
        bgColor: player.bgColor,
    });
    const bot = base.players.find((p) => p.id === botPlayerId);
    const human = base.players.find((p) => p.id !== botPlayerId);
    if (!bot || !human) {
        throw new BladeLoadError(
            `Blade scenario "${scenario.label}": "${botPlayerId}" is not one of ` +
                `this game's two seats (${base.players.map((p) => p.id).join(", ")}).`
        );
    }
    // ORIENTATION (issue #3443). A blade entry's `bot` seat is a POINT OF
    // VIEW, not a position: `"me"` is the seat under test, and the spec's
    // `"me"` is `players[0]` by the `ScenarioSpec` convention
    // (`gre/ai/blade/types.ts`, `seatPlayerId`). Copying the live seats
    // POSITIONALLY — which is what this did before — put the seat under test
    // on the live FIRST seat, which in a vs-AI game is the human's: for the
    // entries declaring `bot: "me"` the whole position arrived reversed, the
    // human holding the cards and the decision the entry exists to ask the
    // Bot about.
    //
    // Consequence worth stating: the LIVE state that gets persisted therefore
    // has the Bot as `players[0]` after a `bot: "me"` load, and
    // `buildStateFromScenario`'s `"me"` is `players[0]` for every later build
    // on that state — so a DB-backed Debug scenario loaded into the same game
    // afterwards lands on the Bot's seat too. That is the sibling loader's
    // own positional convention, not a new mechanism; giving
    // `buildStateFromScenario` an explicit `mySeatId` (the way `specFromState`
    // already takes one) is what would decouple the two, and it is out of
    // this issue's scope.
    //
    // The choice is made HERE, at construction, and not by mirroring the spec
    // afterwards, because `ScenarioSpec` has no field for the turn holder:
    // `createInitialGameState` makes `players[0]` active and gives it
    // priority, so which live identity is built FIRST is the only thing that
    // decides who holds the turn. Mirroring a built state would move the
    // cards and leave the turn behind.
    const [first, second] = scenario.bot === "me" ? [bot, human] : [human, bot];
    const normalized = buildBladeBaseState([identity(first), identity(second)]);
    // Same two-stage build the in-process runner uses — the Debug panel must
    // load the SAME position the suite measures, pending decision included
    // (issue #1487). A setup step that finds no purchase throws here too; the
    // mutation lets it propagate rather than loading a different board.
    const loaded = applyBladeSetup(
        buildStateFromScenario(normalized, scenario.spec),
        scenario
    );
    // Issue #3590 — an entry that declares a `revisit` loop measures the
    // position AFTER it, so the Debug load walks it too. (The decision history
    // itself is not persisted: a live Bot starts remembering from here.)
    return scenario.revisit
        ? applyBladeSetup(loaded, {
              label: scenario.label,
              setup: scenario.revisit,
          })
        : loaded;
}

/**
 * Resolve a label against the registry and load it onto `base` — the ENTIRE
 * non-Convex body of `debugLoadBladeScenario`'s handler (`convex/game.ts`),
 * extracted so the mutation is a thin wrapper (`ctx`/admin gate/fetch/persist
 * only) around this pure function. `convex/game.ts` imports and calls this
 * exact function; it does not reimplement the lookup or the state build
 * inline. This is also why the "read-only browser loader" test suite
 * (`convex/__tests__/debugLoadBladeScenario.test.ts`) can call this function
 * directly and honestly claim it runs through the code the mutation
 * executes — see that file's header for the project's no-convex-test-harness
 * convention this still has to work around for the `ctx`-touching parts
 * (issue #1432 review round 2, finding #1).
 *
 * Throws `Unknown blade scenario: <label>` for an unregistered label —
 * the mutation lets this propagate as its own error, same as before.
 */
export function resolveBladeLoadState(
    base: GameState,
    label: string,
    botPlayerId: string
): GameState {
    const scenario = findBladeScenario(label);
    if (!scenario) {
        throw new Error(`Unknown blade scenario: ${label}`);
    }
    // CR 400.2 (issue #3452) — this loader PERSISTS into the developer's own
    // game, unlike `buildBladeState` above, which only evaluates. A hidden
    // hand is refused on this path for the reasons the assertion names.
    assertLoadableIntoLiveGame(scenario.spec);
    const state = buildBladeLoadState(base, scenario, botPlayerId);
    // CR 117.3 / 508.1 (issue #3515) — the same second refusal
    // `debugSetupScenario` makes: this loader PERSISTS too, so an entry whose
    // declared stack leaves nobody able to act would freeze the developer's own
    // game rather than show them the position.
    assertLiveGameCanContinue(state);
    // ...and a third (issue #3443): SOMEBODY can act, but is it the Bot? The
    // in-process runner already refuses a position whose declared seat under
    // test does not hold the decision at search start (`BladeDeciderError`);
    // this path had no such check, so an entry the orientation above cannot
    // satisfy would be persisted silently and the board would just stop.
    //
    // Owed-ness is read from `computeOwedPlayerIds` — the SAME expected-input
    // computation that feeds the `gameTicks` row the client driver wakes on
    // (`saveGameState`, `convex/game.ts`), never the search module's own
    // parallel `decidingPlayer` derivation (ADR 0047: owed-ness has one
    // source). A guard reading the other one could pass while the driver the
    // developer is actually waiting on never fires.
    assertBotOwesInput(state, label, scenario.bot, botPlayerId);
    return state;
}

/**
 * Refuse a built position the live Bot will not act on (issue #3443).
 *
 * Its own exported function, not an inline block, because it is the assertion
 * the registry-wide load sweep makes entry by entry — and a guard that can
 * only be reached through the whole resolve path is one a test has to
 * construct a scenario for rather than state directly.
 *
 * Owed-ness comes from `computeOwedPlayerIds` and from nowhere else: it is the
 * SAME expected-input computation that fills the `gameTicks` row the client
 * driver wakes on (`saveGameState`, `convex/game.ts`), and ADR 0047 makes that
 * the single source. The search module's own `decidingPlayer` is a parallel
 * derivation of the same question — a guard reading it could pass while the
 * driver the developer is actually waiting on never fires.
 */
export function assertBotOwesInput(
    state: GameState,
    label: string,
    declaredBot: BladeScenario["bot"],
    botPlayerId: string
): void {
    const owed = computeOwedPlayerIds(state);
    if (owed.includes(botPlayerId)) return;
    throw new BladeLoadError(
        `Blade scenario "${label}": declares bot "${declaredBot}", but the ` +
            `built position owes input to [${owed.join(", ") || "no one"}], ` +
            `not to this game's Bot seat "${botPlayerId}" — nothing was loaded.`
    );
}

/** Result of running ONE seed of one blade scenario. */
export type BladeSeedResult = {
    seed: number;
    move: Move | null;
    /** Human-readable rendering of `move`, in card names. */
    moveDescription: string;
    ok: boolean;
    /** Why it failed — empty when `ok`. */
    reason: string;
};

/** Result of running one blade scenario across all its seeds. */
export type BladeResult = {
    label: string;
    tier: BladeScenario["tier"];
    ok: boolean;
    seeds: BladeSeedResult[];
    /** One-line failure summary, ready to hand to `expect(...).toBe(true)` as
     *  its message. Empty when `ok`. */
    failureMessage: string;
    /** Carried straight through from the entry (ADR 0070 §2) so the stretch
     *  report can print WHY the position needs more than its declared budget
     *  without re-reading the registry. Absent when the entry declares none. */
    beyondBudget?: BeyondBudget;
};

/** One line, ready to print: the classified cause of a beyond-budget entry.
 *  Exported so both the stretch report and its test render it identically.
 *  `passesAt` is absent for `cause: "valuation"` (issue #1518) — a mis-valued
 *  subtree that converges AWAY from the right move as budget rises — and for
 *  a `horizon` entry whose payoff sits behind a LOOP (ADR 0102, issue #3138),
 *  where the fix is the CR 732 shortcut Move rather than a bigger budget.
 *  Both then carry `sweptTo` instead, the ceiling actually searched. */
export function describeBeyondBudget(b: BeyondBudget): string {
    const passes = b.passesAt
        ? `passes at ${b.passesAt.iterations} iterations`
        : "does not pass at any measured budget";
    return `beyond budget [${b.cause}] — ${passes}; ${b.note}`;
}

function seedsFor(scenario: BladeScenario): number[] {
    const seeds = scenario.seeds ?? [DEFAULT_BLADE_SEED];
    if (seeds.length === 0) {
        throw new Error(
            `Blade scenario "${scenario.label}" declares an empty seed list.`
        );
    }
    return seeds;
}

function checkExpectation(
    scenario: BladeScenario,
    state: GameState,
    move: Move | null
): string {
    const expectation = scenario.expect;
    const actual = describeChosenMove(state, move);

    if (expectation.moves) {
        const hit = expectation.moves.some((m) => matchesMove(state, move, m));
        if (hit) return "";
        const wanted = expectation.moves.map(describeMatcher).join(" | ");
        return `chose [${actual}] — expected one of [${wanted}]`;
    }

    if (expectation.forbidden) {
        const hit = expectation.forbidden.find((m) =>
            matchesMove(state, move, m)
        );
        if (!hit) return "";
        return `chose [${actual}] — forbidden by [${describeMatcher(hit)}]`;
    }

    if (expectation.predicate(move, state)) return "";
    return `chose [${actual}] — expected: ${expectation.describe}`;
}

/**
 * Run one blade scenario at every declared seed. Never throws on a failed
 * expectation (the caller decides whether a failure is blocking — `must` — or
 * report-only — `stretch`); it DOES throw on a malformed entry (unknown card
 * name, a matcher name with no instance in the built state, empty seed list,
 * a seat that owes no action), which is an authoring bug, not a bot result.
 */
/** Which decider a blade run asks (issue #3393). `"search"` is the suite —
 *  the real ISMCTS at the entry's budget. `"greedy"` is the measurement leg:
 *  the 1-ply rollout policy applied at the root with no search
 *  (`greedyRootPick`), so the same registry answers "how many of these
 *  positions does the policy alone already get right?". Never a gate. */
export type BladePick = "search" | "greedy";

export function runBladeScenario(
    scenario: BladeScenario,
    variant: SearchVariant | null = null,
    pick: BladePick = "search"
): BladeResult {
    if (scenario.budget.iterations <= 0) {
        throw new Error(
            `Blade scenario "${scenario.label}" needs a positive iterations budget.`
        );
    }
    // Variant plumbing (issue #2684). Until now the suite ran unconditionally
    // under production defaults, so "all `must` entries green with the variant
    // ON" — an acceptance criterion of every ladder experiment — was
    // unanswerable without hand-editing the runner. Installed around the WHOLE
    // scenario (build + search + expectation check), so one entry is evaluated
    // under one config, and the PREVIOUS variant is restored rather than
    // cleared, so a caller that already installed one (the decision-telemetry
    // corpus, `decisionCorpus.ts`) is not silently reset mid-run. `null` — the
    // default, and every existing call site — touches the module state not at
    // all, so the historical behaviour is byte-identical.
    if (!variant) return runBladeScenarioInner(scenario, pick);
    const previous = getSearchVariant();
    setSearchVariant(variant);
    try {
        return runBladeScenarioInner(scenario, pick);
    } finally {
        setSearchVariant(previous);
    }
}

/** Lower an entry's `deckKnowledge` (card NAMES, per seat) into the engine's
 *  `DeckKnowledgeBySeat` (definition ids, per player id) — issue #2789.
 *
 *  A name that resolves to no card THROWS, like every other authoring mistake
 *  in this file: a silently-dropped card would quietly widen the unseen
 *  remainder, and an entry whose whole point is "this deck cannot contain the
 *  answer" would then pass for the wrong reason. */
export function bladeDeckKnowledge(
    state: GameState,
    scenario: BladeScenario
): DeckKnowledgeBySeat | undefined {
    if (!scenario.deckKnowledge?.length) return undefined;
    return scenario.deckKnowledge.map(({ seat, cards }) => ({
        playerId: seatPlayerId(state, seat),
        cardIds: cards.map((name) => getCardByName(name).id),
    }));
}

function runBladeScenarioInner(
    scenario: BladeScenario,
    pick: BladePick
): BladeResult {
    const seeds: BladeSeedResult[] = [];
    for (const seed of seedsFor(scenario)) {
        // A fresh state per seed: `searchWithTrace` never mutates the root
        // state, but rebuilding keeps each seed's run provably independent.
        const state = buildBladeState(scenario);
        const botId = seatPlayerId(state, scenario.bot);
        // Issue #3590 — walk the loop the bot has already been round, and carry
        // what it chose into the search as its decision history.
        const repetition = scenario.revisit
            ? applyBladeRevisit(state, scenario, botId)
            : undefined;
        // AUTHORING CHECK (issue #1522): the declared `bot` seat must be the
        // one `searchWithTrace` would actually run for — the exact window
        // `decidingPlayer` defines (priority, an open declare-blockers/
        // attackers window, a live `pendingChoices` head). A mismatch means
        // the entry is malformed (wrong `bot`, or a `setup` sequence that
        // leaves nothing owed) — throw here, loudly, rather than let the
        // search return `move: null` and report a misleading "chose [no
        // move]" against the entry's `expect`.
        const decider = decidingPlayer(state);
        if (decider !== botId) {
            throw new BladeDeciderError(
                scenario.label,
                scenario.bot,
                state,
                decider
            );
        }
        const move =
            pick === "greedy"
                ? greedyRootPick(state, botId, seed)
                : searchWithTrace(
                      state,
                      botId,
                      { iterations: scenario.budget.iterations },
                      seed,
                      bladeDeckKnowledge(state, scenario),
                      repetition
                  ).move;
        const reason = checkExpectation(scenario, state, move);
        seeds.push({
            seed,
            move,
            moveDescription: describeChosenMove(state, move),
            ok: reason === "",
            reason,
        });
    }

    const failures = seeds.filter((s) => !s.ok);
    return {
        label: scenario.label,
        tier: scenario.tier,
        ok: failures.length === 0,
        seeds,
        failureMessage: failures
            .map((f) => `seed ${f.seed}: ${f.reason}`)
            .join("; "),
        ...(scenario.beyondBudget
            ? { beyondBudget: scenario.beyondBudget }
            : {}),
    };
}
