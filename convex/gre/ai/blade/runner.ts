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

import { getCardByName } from "../../../cards";
import { createInitialGameState, type PlayerInput } from "../../setup";
import { buildStateFromScenario } from "../../scenarioBuilder";
import { decidingPlayer, searchWithTrace } from "../../search";
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
import { applyBladeSetup } from "./setup";
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

/** The one seed every blade entry uses unless it declares its own. Fixed
 *  forever — changing it re-rolls the whole suite. */
export const DEFAULT_BLADE_SEED = 0xb1ade;

/** Shuffle seed for the base (pre-scenario) game state. Fixed for the same
 *  reason. */
const BASE_STATE_SEED = 0x51ade;

/** Size of the synthetic base deck. A scenario clears both libraries anyway
 *  when it sets `libraryCount`; this only has to be a legal-sized pile the
 *  engine can draw from. */
const BASE_DECK_SIZE = 60;

/** Filler card for the synthetic base deck: a basic land, so any card left in
 *  a library the scenario did not override is inert (no cast decisions, no
 *  triggers) and cannot perturb a rollout. */
const BASE_DECK_CARD = "Plains";

/** A seat's identity — the only thing `buildBladeLoadState` (below) needs to
 *  vary per call: which player id/name/bgColor a seat is built AS. */
type SeatIdentity = { id: string; name: string; bgColor: string };

/** The harness's own default identities — unchanged from before this was
 *  parametrized (`p1`/`p2`, "Blade P1"/"Blade P2"). */
const DEFAULT_SEAT_IDENTITIES: [SeatIdentity, SeatIdentity] = [
    { id: "p1", name: "Blade P1", bgColor: "#000000" },
    { id: "p2", name: "Blade P2", bgColor: "#000000" },
];

function syntheticPlayer(identity: SeatIdentity): PlayerInput {
    const def = getCardByName(BASE_DECK_CARD);
    return {
        ...identity,
        deck: {
            id: `blade-${identity.id}`,
            name: "Blade base deck",
            format: "freeform",
            cards: Array.from({ length: BASE_DECK_SIZE }, () => ({
                cardId: def.id,
                cardName: def.name,
            })),
        },
    };
}

/**
 * The base `GameState` every blade scenario is applied on top of: two seats
 * with identical synthetic decks, shuffled at a fixed seed.
 * `buildStateFromScenario` finalizes the mulligan and clears every zone, so
 * nothing but the leftover library survives.
 *
 * `identities` defaults to the harness's own `p1`/`p2` seats — every caller
 * before issue #1432 review round 3 relied on that default and still gets
 * it unchanged. `buildBladeLoadState` (below) is the one caller that passes
 * an override: building the SAME position but AS the live game's actual
 * player ids, so identity (owner/controller ids throughout every card, plus
 * `activePlayerId`/`priorityPlayerId`, both derived from `players[0].id` in
 * `createInitialGameState`) is correct by construction from the very first
 * card dealt — not patched onto a `p1`/`p2`-built state after the fact,
 * which would leave every internal `ownerId`/`controllerId` still pointing
 * at the old `p1`/`p2` strings.
 */
export function buildBladeBaseState(
    identities: [SeatIdentity, SeatIdentity] = DEFAULT_SEAT_IDENTITIES
): GameState {
    return createInitialGameState(
        [syntheticPlayer(identities[0]), syntheticPlayer(identities[1])],
        BASE_STATE_SEED
    );
}

/** Build the `GameState` a blade entry describes: the `spec` board, then its
 *  engine-real `setup` steps (issue #1487, ADR 0070 §4). Exported so a failing
 *  entry can be inspected (or replayed at a bigger budget) from a scratch
 *  test. Throws `BladeSetupError` when a setup step finds no purchase. */
export function buildBladeState(scenario: BladeScenario): GameState {
    return applyBladeSetup(
        buildStateFromScenario(buildBladeBaseState(), scenario.spec),
        scenario
    );
}

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
    scenario: BladeScenario
): GameState {
    const normalized = buildBladeBaseState([
        {
            id: base.players[0].id,
            name: base.players[0].name,
            bgColor: base.players[0].bgColor,
        },
        {
            id: base.players[1].id,
            name: base.players[1].name,
            bgColor: base.players[1].bgColor,
        },
    ]);
    // Same two-stage build the in-process runner uses — the Debug panel must
    // load the SAME position the suite measures, pending decision included
    // (issue #1487). A setup step that finds no purchase throws here too; the
    // mutation lets it propagate rather than loading a different board.
    return applyBladeSetup(
        buildStateFromScenario(normalized, scenario.spec),
        scenario
    );
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
    label: string
): GameState {
    const scenario = findBladeScenario(label);
    if (!scenario) {
        throw new Error(`Unknown blade scenario: ${label}`);
    }
    return buildBladeLoadState(base, scenario);
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
 *  subtree that converges AWAY from the right move as budget rises, so there
 *  is no passing budget to report. */
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
export function runBladeScenario(
    scenario: BladeScenario,
    variant: SearchVariant | null = null
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
    if (!variant) return runBladeScenarioInner(scenario);
    const previous = getSearchVariant();
    setSearchVariant(variant);
    try {
        return runBladeScenarioInner(scenario);
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
function bladeDeckKnowledge(
    state: GameState,
    scenario: BladeScenario
): DeckKnowledgeBySeat | undefined {
    if (!scenario.deckKnowledge?.length) return undefined;
    return scenario.deckKnowledge.map(({ seat, cards }) => ({
        playerId: seatPlayerId(state, seat),
        cardIds: cards.map((name) => getCardByName(name).id),
    }));
}

function runBladeScenarioInner(scenario: BladeScenario): BladeResult {
    const seeds: BladeSeedResult[] = [];
    for (const seed of seedsFor(scenario)) {
        // A fresh state per seed: `searchWithTrace` never mutates the root
        // state, but rebuilding keeps each seed's run provably independent.
        const state = buildBladeState(scenario);
        const botId = seatPlayerId(state, scenario.bot);
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
        const { move } = searchWithTrace(
            state,
            botId,
            { iterations: scenario.budget.iterations },
            seed,
            bladeDeckKnowledge(state, scenario)
        );
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
