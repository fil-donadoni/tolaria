// The stack journal — how a decision taken with something ON THE STACK becomes
// a Verdict (issue #3480, PRD #3397, ADR 0124 §1).
//
// THE PROBLEM. `ScenarioSpec` describes a BOARD; it has no stack. So every
// response decision — whether to counter, whether to answer a trigger, whether
// to let a spell resolve, the whole tempo half PRD #3397 exists for — refused
// to lower (`stack-not-empty`): 8.8% of Bot decisions measured over five
// matchups, and the FIRST refusal cause in three of the five corpora.
//
// WHY NOT INVERT THE STACK. The obvious repair is to lower the live board and
// put the stack back: read the item, return the card to its owner's hand,
// untap what paid for it. It cannot be done. Inverting needs the PRE-PAYMENT
// board and there is no event log (CLAUDE.md § Data model); `manaCommitted` is
// a bare boolean with no attribution to the object it paid for
// (`gre/state.ts`). What comes back is a guess, and a guess here is a verdict
// filed on a board nobody played.
//
// WHAT THIS DOES INSTEAD. It RECORDS. A caller that drives the game — the
// browser's vs-AI driver, the headless self-play loop the lowering sweep runs
// — already knows every move it submits, so it hands each one here BEFORE
// applying it. The journal keeps the board as it was the last time the stack
// was empty, plus the engine-real steps taken since. That is exactly the
// `{ spec, setup }` shape a `Verdict` already stores (`verdicts/types.ts`) and
// `buildVerdictPosition` already replays (`verdicts/candidates.ts`), so
// nothing is invented and ADR 0070 §4 holds by construction: every step is a
// real move applied through the real engine, and a step that finds no purchase
// THROWS rather than approximating.
//
// IT IS DELIBERATELY NARROW, AND IT FAILS CLOSED. Only three move kinds have a
// faithful one-for-one `BladeSetupStep` — a cast, an activation and a pass —
// and only in their plain shapes (no mode, no alternative cost, no kicker, at
// most one target: what the step vocabulary can say). Anything else BREAKS the
// window, and a broken window is a refusal with its own kind, never a
// best-effort replay. The verification is not this module's optimism either:
// `lowerDecision` rebuilds from `{ spec, setup }` and compares the rebuilt
// stack and the rebuilt candidate list against the live ones, so a window this
// journal got wrong dies there.
//
// NOT A CONVEX ROW. The quiz panel is dev-only and gameplay checks run in solo
// mode (CLAUDE.md), so the client drives both seats and already knows every
// move it sends. A persisted journal would put a `ScenarioSpec`-sized snapshot
// on the hot `gameStates` row, which Convex bills by the whole document, for a
// dev-only feature.

import { tryGetDefinition } from "../../../cards";
import { cloneGameState } from "../../clone";
import { getPlayer } from "../../state";
import { allInstances } from "../blade/matcher";
import type { BladeSeat, BladeSetupStep } from "../blade/types";
import type { Move } from "../../moves";
import type { CardInstanceState, GameState, StackItem } from "../../state";
import type { TargetSelection } from "../../../cards/types";

/** A journalled step's target, still in the LIVE game's vocabulary: a player
 *  id, or a card name. Seats are resolved later — the journal does not know
 *  which seat will be judged, and `BladeSetupStep` names seats, so the
 *  translation waits for `materialiseJournalSteps`. */
export type JournalTarget = { player: string } | { card: string };

/**
 * One recorded move, in the journal's own vocabulary.
 *
 * A near-twin of the `BladeSetupStep` it becomes, with two differences that
 * are the reason it is not simply that type: the acting seat is a PLAYER ID
 * (see {@link JournalTarget}), and the union is only the three kinds a replay
 * reproduces move-for-move. `declare-attackers` / `declare-blockers` are
 * absent on purpose — their blade steps do not replay one move, they declare
 * AND walk priority forward, so a journal entry built from one would name a
 * different priority window than the decision it was recorded at.
 */
export type JournalStep =
    | {
          kind: "cast";
          card: string;
          by: string;
          target?: JournalTarget;
          x?: number;
      }
    | {
          kind: "activate";
          card: string;
          ability: string;
          by: string;
          target?: JournalTarget;
      }
    | { kind: "pass"; by: string };

/** What the journal offers a lowering: the quiet board, and the walk from it
 *  to the decision. */
export type StackJournalEntry = {
    /** The board as it stood the last time the stack was empty — a CLONE, so
     *  the in-place mutation the headless loop applies to its own state cannot
     *  reach back into it. */
    quiet: GameState;
    /** The steps taken since, in order. Never empty: a stack with no recorded
     *  step is a stack the journal did not see begin. */
    steps: JournalStep[];
};

/**
 * The recorder. One per driven game; a caller feeds it every move it submits
 * and every change it cannot express.
 *
 * Not a log — it holds exactly one window (the current stack's) and drops it
 * the moment the stack empties again.
 */
export class StackJournal {
    private quiet: GameState | null = null;
    private steps: JournalStep[] = [];
    private broken = false;

    /**
     * Record one move, BEFORE it is applied. `before` is the state the move is
     * about to be applied to.
     *
     * A move taken on an empty stack OPENS a window: the board becomes the
     * quiet one and the step list restarts. That is also what clears a
     * previously broken window — the damage a journal can do is bounded by the
     * next time the stack empties.
     */
    observe(before: GameState, playerId: string, move: Move): void {
        const opensWindow = before.stack.length === 0;
        if (opensWindow) {
            // The previous window is over whatever happens next: a stale quiet
            // board paired with a fresh step list is exactly the wrong-board
            // verdict this whole flow exists to prevent.
            this.quiet = null;
            this.steps = [];
            this.broken = false;
        }
        if (this.broken) return;
        const step = journalStepForMove(before, playerId, move);
        if (!step) {
            this.broken = true;
            this.quiet = null;
            return;
        }
        // Cloned only once the step is known to be sayable — a move that breaks
        // the window would otherwise pay a full deep clone that the next line
        // throws away.
        if (opensWindow) this.quiet = cloneGameState(before);
        this.steps.push(step);
    }

    /**
     * Record that something happened the journal cannot express — a pending
     * choice answered mid-resolution, a mulligan declaration, a move submitted
     * by a seat this caller does not drive.
     *
     * Unconditional, including on an empty stack: a change taken while the
     * stack was empty invalidates the quiet board itself, and a stale quiet
     * board with a valid-looking step list is precisely the wrong-board
     * verdict this whole flow exists to prevent. The next empty-stack move
     * reopens a window.
     */
    observeOpaque(): void {
        this.quiet = null;
        this.steps = [];
        this.broken = true;
    }

    /** The window, or `null` when there is none to offer. */
    entry(): StackJournalEntry | null {
        if (this.broken || !this.quiet || this.steps.length === 0) return null;
        return { quiet: this.quiet, steps: [...this.steps] };
    }
}

/**
 * The `JournalStep` for one move, or `null` when the step vocabulary cannot
 * say it faithfully.
 *
 * Pure, and exported because it is the whole judgement this module makes: what
 * a replay can and cannot reproduce. Every `null` below is a refusal downstream
 * (`stack-not-journalled`), never an approximation.
 */
export function journalStepForMove(
    state: GameState,
    playerId: string,
    move: Move
): JournalStep | null {
    switch (move.kind) {
        case "pass":
            return { kind: "pass", by: playerId };
        case "cast-spell": {
            // CR 601.3 — the ZONE the cast comes from. A `cast` step is
            // hand-only by construction (`blade/setup.ts` searches
            // `caster.hand`), so a Flashback / Yawgmoth's Will / exile-grant
            // cast recorded without this replays as a SAME-NAMED COPY OUT OF
            // HAND. Neither downstream check sees it: `stackShape` reads the
            // same seat and the same name, and both boards are missing a copy
            // of the card, just from different zones (PR review, issue #3480).
            if (
                move.castFromZone !== undefined &&
                move.castFromZone !== "hand"
            ) {
                return null;
            }
            // Every cast MODE and every extra payment the `cast` step cannot
            // name (CR 601.2b/118): a replay that dropped one would put a
            // different object on the stack under the same card name.
            if (
                move.chosenModeId !== undefined ||
                move.alternativeCostId !== undefined ||
                move.additionalCostLegId !== undefined ||
                move.kickerPayments !== undefined ||
                move.buybackPaid === true ||
                move.castCostPicks !== undefined ||
                (move.payLife ?? 0) > 0
            ) {
                return null;
            }
            const card = cardNameOfInstance(state, move.cardInstanceId);
            if (!card) return null;
            const target = soleTarget(state, move.targets);
            if (target === AMBIGUOUS) return null;
            return {
                kind: "cast",
                card,
                by: playerId,
                ...(target ? { target } : {}),
                ...(move.chosenX === undefined ? {} : { x: move.chosenX }),
            };
        }
        case "activate-ability": {
            if (
                move.chosenModeId !== undefined ||
                move.chosenX !== undefined ||
                move.costPicks !== undefined
            ) {
                return null;
            }
            // An `activate` step names a card on `controller`'s BATTLEFIELD and
            // activates it as that permanent's controller
            // (`blade/setup.ts`'s `battlefieldMatches`). `enumerateMoves`
            // emits activations from three other sources: the actor's own
            // graveyard and hand (cycling, ninjutsu), and the OPPONENT's
            // battlefield for a CR 113.3c "any player may activate" ability.
            // The first two throw on replay and cost only coverage; the third
            // silently activates the actor's OWN same-named permanent, and
            // `stackShape` cannot tell the two apart because `castById` is the
            // ACTIVATOR on both boards (PR review, issue #3480). One check
            // closes all three.
            if (
                !getPlayer(state, playerId).battlefield.some(
                    (permanent) => permanent.id === move.cardInstanceId
                )
            ) {
                return null;
            }
            const card = cardNameOfInstance(state, move.cardInstanceId);
            if (!card) return null;
            const target = soleTarget(state, move.targets);
            if (target === AMBIGUOUS) return null;
            return {
                kind: "activate",
                card,
                ability: move.abilityId,
                by: playerId,
                ...(target ? { target } : {}),
            };
        }
        default:
            // Everything else: a land drop and its landfall trigger, a granted
            // ability, a special action, a combat declaration, every yes/no and
            // zone-pick answer. Each is a real gap, and each is COUNTED as one
            // — the sweep's `stack-not-journalled` row is where they show up.
            return null;
    }
}

/** A target list the step vocabulary cannot name: more than one target, or one
 *  whose object the journal cannot resolve to a card name. */
const AMBIGUOUS = Symbol("ambiguous-target");

function soleTarget(
    state: GameState,
    targets: TargetSelection[]
): JournalTarget | undefined | typeof AMBIGUOUS {
    // A `BladeSetupStep`'s `target` pins ONE object. Zero is the untargeted
    // cast; two is a shape the step cannot express at all.
    if (targets.length === 0) return undefined;
    if (targets.length > 1) return AMBIGUOUS;
    const [only] = targets;
    if (only.type === "player") return { player: only.id };
    const card = cardNameOfInstance(state, only.id);
    return card ? { card } : AMBIGUOUS;
}

/** The card NAME of an instance anywhere in `state` — the vocabulary a blade
 *  step speaks. `null` for an instance the registry cannot name (a token, a
 *  face-down permanent), which is a step that could never be replayed. */
function cardNameOfInstance(
    state: GameState,
    instanceId: string
): string | null {
    const instance = allInstances(state).find((c) => c.id === instanceId);
    return instance ? cardNameOf(instance) : null;
}

function cardNameOf(instance: CardInstanceState): string | null {
    const id = (instance.card as { id?: string }).id;
    if (!id) return null;
    return tryGetDefinition(id)?.name ?? null;
}

/**
 * Turn a recorded walk into the `BladeSetupStep[]` a `Verdict` stores.
 *
 * `seatOf` maps a live player id to the seat it will be in the rebuilt
 * position; it returns `null` for an id the mapping does not cover, which
 * fails the whole materialisation rather than guessing a seat.
 */
export function materialiseJournalSteps(
    steps: JournalStep[],
    seatOf: (playerId: string) => BladeSeat | null
): BladeSetupStep[] | null {
    const out: BladeSetupStep[] = [];
    for (const step of steps) {
        const seat = seatOf(step.by);
        if (!seat) return null;
        if (step.kind === "pass") {
            out.push({ kind: "pass", seat });
            continue;
        }
        let target: BladeSeat | string | undefined;
        if (step.target) {
            if ("card" in step.target) {
                target = step.target.card;
            } else {
                const targetSeat = seatOf(step.target.player);
                if (!targetSeat) return null;
                target = targetSeat;
            }
        }
        if (step.kind === "cast") {
            out.push({
                kind: "cast",
                card: step.card,
                by: seat,
                ...(target === undefined ? {} : { target }),
                ...(step.x === undefined ? {} : { x: step.x }),
            });
        } else {
            out.push({
                kind: "activate",
                card: step.card,
                ability: step.ability,
                controller: seat,
                ...(target === undefined ? {} : { target }),
            });
        }
    }
    return out;
}

/**
 * The stack as a list of seat-and-identity labels, bottom-up — the CHEAP,
 * fail-closed proof that a replayed window reproduced the live one.
 *
 * `lowerDecision`'s existing `different-decision` check compares CANDIDATE
 * LISTS, and a candidate list is exactly what a missing response can leave
 * unchanged: the Bot's opponent casting a second spell in reply adds an object
 * to the board without adding a move to the Bot's options. So the stack itself
 * is compared, in the only vocabulary the live game and a rebuild share —
 * names and seats, never instance ids, which the rebuild allocates itself.
 *
 * WHAT IT DOES NOT SEE, and why that is survivable: targets, `chosenX`, a
 * chosen mode, a kicker, and a copy (CR 707.10), which fingerprints as its
 * original. Every one of those reaches the stack only through a move
 * {@link journalStepForMove} already refuses, so for them this is the SECOND
 * line of defence and never the first. Two objects the registry cannot name
 * both collapse to `(unnamed)` and would collide — unreachable for the same
 * reason: a step naming such a card is refused where it is recorded.
 */
export function stackShape(
    state: GameState,
    seatOf: (playerId: string) => BladeSeat | null
): string[] {
    return state.stack.map((item: StackItem) => {
        const seat = seatOf(item.castById) ?? "?";
        const name = cardNameOf(item) ?? "(unnamed)";
        const what =
            item.abilityId !== undefined
                ? `ability:${item.abilityId}`
                : item.triggerSourceId !== undefined
                  ? "trigger"
                  : "spell";
        return `${seat} ${name} ${what}`;
    });
}
