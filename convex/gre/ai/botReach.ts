/**
 * Bot reachability, computed (ADR 0105 § 7.2, ADR 0137, issue #3830).
 *
 * `.claude/rules/gre-development.md` § Bot reachability asks a human to WALK
 * three seams for every new card — reachable (`enumerateMoves`), answerable
 * (the choice surface), wanted (the valuers). For a card the Oracle compiler
 * emits there is no human in the loop, so the walk is replaced by a PLAY: the
 * Bot is handed the card in a generated position and we watch what it does.
 *
 *   - `played`  — at some seat the REAL search (`searchWithTrace`) chose a
 *                 move that uses the card, and the follow-through reached a
 *                 stable position with every owed input answered.
 *   - `ignored` — a move using the card was legal (it was affordable) and the
 *                 search never chose it, at any seat, at any seed. The card is
 *                 playable by a human and ships; the Bot's valuation of it is
 *                 a gap (a Bot Gap row), never a reason to withhold it — a
 *                 valuation defect of the Bot must not keep a human-playable
 *                 card out of the catalogue (ADR 0137).
 *   - `frozen`  — at some seat no legal move uses the card at all, or the
 *                 follow-through owes an input the driver cannot answer
 *                 (`enumerateMoves` empty for the owing seat — the exact shape
 *                 in which the live driver stalls the game, ADR 0047). The
 *                 compiler quarantines the card with reason `bot-unreachable`.
 *
 * "Both seats": the card is held by the seat built FIRST and, separately, by
 * the seat built SECOND (`buildStateFromScenario`'s explicit `mySeatId`) — a
 * seat-orientation bug (the class issue #3443 fixed once) must not be able to
 * hide behind the one orientation the sweep happened to try.
 *
 * Deterministic by the blade contract (`blade/runner.ts`): a fixed synthetic
 * base deck, a fixed shuffle seed, an `iterations` budget (never `timeMs`) and
 * explicit search seeds. Same definition + same Bot ⇒ same verdict, which is
 * what lets `oracle:compile` cache the verdict by definition hash + Bot hash.
 *
 * Pure and synchronous. The CALLER registers the definition (the runtime
 * registry is keyed by id, and a compiled definition is not a catalogue card);
 * this module reads it through `getDefinition` like every other engine path.
 */

import { applyMoveForSearch } from "../applyMove";
import { buildBladeBaseState } from "./blade/baseState";
import { buildStateFromScenario } from "../scenarioBuilder";
import { decidingPlayer, searchWithTrace } from "../search";
import { enumerateMoves, type Move } from "../moves";
import { computeOwedPlayerIds } from "../expectedInput";
import { allocInstanceId, type GameState } from "../state";
import { manaValue } from "../constants";
import { basicLandsForColors, getCardColors } from "../../cards/colors";
import type { CardDefinition, TargetRequirement } from "../../cards/types";
import type { ScenarioCard, ScenarioSpec } from "../../debugScenarioSpec";

export type BotReachOutcome = "played" | "ignored" | "frozen";

/** Why a card is not `played` — the first half of its Bot Gap form. */
export type BotReachCause =
    /** No legal move uses the card in the generated position. */
    | "no-legal-move"
    /** The follow-through owes an input no legal move answers. */
    | "unanswerable-input"
    /** The follow-through did not settle inside the step bound. */
    | "no-progress"
    /** Legal and affordable, never chosen. */
    | "never-chosen";

export interface BotReachVerdict {
    readonly outcome: BotReachOutcome;
    /** Absent exactly when `outcome === "played"`. */
    readonly cause?: BotReachCause;
    /**
     * The FORM the cause is aggregated by into a Bot Gap — the card's cast
     * shape for a missing move, the pending choice's kind for an unanswerable
     * input. Never a card name: two cards failing the same way share a form,
     * and that is what makes a Bot Gap rank by blast radius. Absent exactly
     * when `outcome === "played"`.
     */
    readonly form?: string;
}

export interface BotReachBudget {
    /** ISMCTS iterations per decision — never wall-clock (blade contract). */
    readonly iterations: number;
    /** Search seeds tried per seat; `played` if ANY seed chooses the card. */
    readonly seeds: readonly number[];
}

/**
 * The sweep's budget. Small on purpose: this asks "does the Bot ever want to
 * use the card when it is the obvious thing to do", not "is its play strong",
 * and it runs over every `ready` card. Changing it changes verdicts, so it is
 * part of what the Bot hash covers (it lives in this file).
 */
export const BOT_REACH_BUDGET: BotReachBudget = {
    iterations: 48,
    seeds: [0xb07, 0x5eed],
};

/** Upper bound on follow-through decisions after the card's move. */
const MAX_FOLLOW_THROUGH_STEPS = 12;

/** Extra lands beyond the card's mana value — room for X and for a cost the
 *  mana value does not count (kicker, an activation after the cast). */
const EXTRA_LANDS = 2;

/** The card every generated position seeds as the object a target, a
 *  sacrifice or a discard can use — a real catalogue creature, both sides, in
 *  every zone a target requirement names. */
const FILLER_CREATURE = "Grizzly Bears";
/** A noncreature artifact, for artifact targets. */
const FILLER_ARTIFACT = "Ornithopter";
/** A global enchantment, for enchantment targets. */
const FILLER_ENCHANTMENT = "Castle";

/** Every target TYPE a definition announces, at the card and mode levels. */
function targetTypes(def: CardDefinition): string[] {
    const reqs: TargetRequirement[] = [];
    if (def.targetRequirement) reqs.push(def.targetRequirement);
    for (const mode of def.modes ?? []) {
        if (mode.targetRequirement) reqs.push(mode.targetRequirement);
    }
    return reqs.flatMap((r) => (Array.isArray(r.type) ? r.type : [r.type]));
}

/** CR 115.1 — a spell that targets a SPELL needs one on the stack. */
function needsStackTarget(def: CardDefinition): boolean {
    return targetTypes(def).some(
        (t) => t === "spell" || t === "spell-or-permanent"
    );
}

/**
 * The card's cast shape — the form a `no-legal-move` is aggregated by. Its
 * primary card type, the target types it announces, and whether its cost
 * carries X: the three things that decide whether the generated position
 * offers it a legal move at all.
 */
export function castShape(def: CardDefinition): string {
    const primary = def.types[0] ?? "Card";
    const targets = [...new Set(targetTypes(def))].sort();
    const parts: string[] = [primary];
    if (targets.length > 0) parts.push(`target:${targets.join("|")}`);
    // CR 107.3 — a VARIABLE X is the string marker; a number is generic.
    if (def.manaCost?.X === "X") parts.push("X");
    return parts.join(" ");
}

/**
 * The generated position, as a `ScenarioSpec` for the HOLDER seat (`me`): its
 * lands in the colours of the card's own cost, enough of them for the mana
 * value plus {@link EXTRA_LANDS}, filler objects on both sides and in both
 * graveyards, an opaque card in hand (a discard cost), a filler library, main phase,
 * the holder active with priority. When the card targets a spell, the
 * opponent's filler spell is on the stack instead — CR 117.1a keeps the cast
 * legal at instant speed only, which is what such a card is.
 *
 * The card itself is NOT in the spec: the spec names cards, and a compiled
 * definition is registered by id only. The caller adds it to the hand.
 */
export function botReachSpec(def: CardDefinition): ScenarioSpec {
    const isLand = def.types.includes("Land");
    const landCount = isLand ? 1 : manaValue(def.manaCost) + EXTRA_LANDS;
    const cycle = basicLandsForColors(getCardColors(def));
    const cards: ScenarioCard[] = [];
    for (let i = 0; i < landCount; i++) {
        cards.push({
            name: cycle[i % cycle.length]!,
            owner: "me",
            zone: "battlefield",
        });
    }
    for (const owner of ["me", "opp"] as const) {
        cards.push({ name: FILLER_CREATURE, owner, zone: "battlefield" });
        cards.push({ name: FILLER_ARTIFACT, owner, zone: "battlefield" });
        cards.push({ name: FILLER_ENCHANTMENT, owner, zone: "battlefield" });
        cards.push({ name: FILLER_CREATURE, owner, zone: "graveyard" });
    }
    const stack = needsStackTarget(def);
    return {
        cards,
        phase: "PRECOMBAT_MAIN",
        turn: 3,
        libraryCount: 20,
        // CR 400.2 — a card the holder can discard or reveal that is never a
        // castable alternative: an opaque placeholder resolves to no
        // definition, so it cannot compete with the card for the decision.
        // A real filler in hand did: holding a second copy of the card, the
        // search's interchangeable-copy collapse (issue #3593) could pick the
        // filler as the representative and the card read as never chosen.
        hiddenHand: { me: 1 },
        activePlayer: "me",
        priority: "me",
        ...(stack
            ? {
                  stack: [
                      {
                          kind: "spell" as const,
                          name: FILLER_CREATURE,
                          controller: "opp" as const,
                      },
                  ],
              }
            : {}),
    };
}

/** Does `move` use the card instance `instanceId`? */
function usesCard(move: Move, instanceId: string): boolean {
    return "cardInstanceId" in move && move.cardInstanceId === instanceId;
}

/** Is the card still in flight — on the stack, or a choice still pending? */
function unsettled(state: GameState, instanceId: string): boolean {
    if ((state.pendingChoices?.length ?? 0) > 0) return true;
    return state.stack.some((item) => item.id === instanceId);
}

/** The generated position with the card in the holder's hand. */
export function buildBotReachState(
    def: CardDefinition,
    holderSeat: 0 | 1
): { state: GameState; holderId: string; instanceId: string } {
    const base = buildBladeBaseState();
    const holderId = base.players[holderSeat]!.id;
    const state = buildStateFromScenario(base, botReachSpec(def), holderId);
    const holder = state.players.find((p) => p.id === holderId)!;
    const instanceId = allocInstanceId(state);
    holder.hand.push({
        id: instanceId,
        card: { id: def.id },
        types: def.types,
        subtypes: def.subtypes ?? [],
        power: def.power,
        toughness: def.toughness,
        staticAbilities: def.staticAbilities ?? [],
        controllerId: holderId,
        ownerId: holderId,
        zone: "hand",
        isTapped: false,
        isSummoningSick: false,
    });
    return { state, holderId, instanceId };
}

export type SeatVerdict =
    | { outcome: "played" }
    | { outcome: "ignored" }
    | { outcome: "frozen"; cause: BotReachCause; form: string };

/**
 * Follow the chosen move through: every decision the position owes afterwards
 * — a target, a choice mid-resolution, the opponent's priority — is answered
 * by the search for whoever owes it, until the card is off the stack with no
 * choice pending. `null` means it settled; otherwise the frozen verdict.
 */
function followThrough(
    start: GameState,
    holderId: string,
    instanceId: string,
    move: Move,
    budget: BotReachBudget,
    seed: number
): SeatVerdict | null {
    let state = applyMoveForSearch(start, holderId, move);
    for (let step = 0; step < MAX_FOLLOW_THROUGH_STEPS; step++) {
        if (state.gameOver || !unsettled(state, instanceId)) return null;
        const owed = computeOwedPlayerIds(state);
        const decider = decidingPlayer(state) ?? owed[0] ?? null;
        const head = state.pendingChoices?.[0];
        const inputForm = head ? `choice:${head.kind}` : "priority";
        if (decider === null) {
            return {
                outcome: "frozen",
                cause: "unanswerable-input",
                form: inputForm,
            };
        }
        const moves = enumerateMoves(state, decider);
        if (moves.length === 0) {
            return {
                outcome: "frozen",
                cause: "unanswerable-input",
                form: inputForm,
            };
        }
        const next =
            searchWithTrace(
                state,
                decider,
                { iterations: budget.iterations },
                seed
            ).move ?? moves[0]!;
        state = applyMoveForSearch(state, decider, next);
    }
    return unsettled(state, instanceId)
        ? { outcome: "frozen", cause: "no-progress", form: "follow-through" }
        : null;
}

/** One seat's play, tagged with the seat that held the card. */
export interface SeatPlay {
    readonly holderId: string;
    readonly verdict: SeatVerdict;
}

function playSeat(
    def: CardDefinition,
    holderSeat: 0 | 1,
    budget: BotReachBudget
): SeatPlay {
    const { state, holderId, instanceId } = buildBotReachState(def, holderSeat);
    return {
        holderId,
        verdict: playFrom(def, state, holderId, instanceId, budget),
    };
}

function playFrom(
    def: CardDefinition,
    state: GameState,
    holderId: string,
    instanceId: string,
    budget: BotReachBudget
): SeatVerdict {
    if (decidingPlayer(state) !== holderId) {
        // The generated position is ours, not the card's: a holder that does
        // not hold the decision is a defect of this module, never a verdict.
        throw new Error(
            `botReach: generated position for "${def.name}" does not give the holder the decision`
        );
    }
    const legal = enumerateMoves(state, holderId).filter((m) =>
        usesCard(m, instanceId)
    );
    if (legal.length === 0) {
        return {
            outcome: "frozen",
            cause: "no-legal-move",
            form: castShape(def),
        };
    }
    for (const seed of budget.seeds) {
        const move = searchWithTrace(
            state,
            holderId,
            { iterations: budget.iterations },
            seed
        ).move;
        if (move === null || !usesCard(move, instanceId)) continue;
        return (
            followThrough(state, holderId, instanceId, move, budget, seed) ?? {
                outcome: "played",
            }
        );
    }
    return { outcome: "ignored" };
}

/**
 * Play `def` (already registered under `def.id`) at both seats and return its
 * reachability. A seat that freezes freezes the card — a freeze at one seat
 * still stalls every game that seats the Bot there; otherwise a seat that
 * played makes it `played`; otherwise it is `ignored`.
 */
/** The card played from each seat in turn — first-built, then second-built. */
export function playBotReachSeats(
    def: CardDefinition,
    budget: BotReachBudget = BOT_REACH_BUDGET
): readonly SeatPlay[] {
    return [playSeat(def, 0, budget), playSeat(def, 1, budget)];
}

export function playBotReach(
    def: CardDefinition,
    budget: BotReachBudget = BOT_REACH_BUDGET
): BotReachVerdict {
    const seats = playBotReachSeats(def, budget).map((s) => s.verdict);
    const frozen = seats.find(
        (s): s is Extract<SeatVerdict, { outcome: "frozen" }> =>
            s.outcome === "frozen"
    );
    if (frozen) {
        return { outcome: "frozen", cause: frozen.cause, form: frozen.form };
    }
    if (seats.some((s) => s.outcome === "played")) return { outcome: "played" };
    return {
        outcome: "ignored",
        cause: "never-chosen",
        form: castShape(def),
    };
}
