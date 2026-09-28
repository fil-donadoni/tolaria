// Deriving a Minimal Pair's right-hand half from its anchor (issue #4795,
// PRD #4792, ADR 0148).
//
// The right-hand half is the anchor's position COPIED, with only the
// Discriminant changed — never an unrelated position linked in. This module is
// that copy: anchor position + Discriminant + the concrete edit → the half's
// position, prefilled so a tester only confirms or touches up. It is PURE and
// imports only types, so the browser (the quiz's prefill) can call it without
// dragging the blade harness into the client bundle — the build and the trace
// check live in the sibling `pairTrace.ts`.
//
// WHY THE EDIT IS A SECOND ARGUMENT. A Discriminant is `{ kind, detail }`, and
// `detail` is the judge's prose ("the opponent's end step", "Swords to
// Plowshares"): it is what the report counts and prints, not something to
// parse. The edit that realises it on the board is structured, and typed by
// the same `kind`, so a `step` Discriminant cannot be realised by adding a
// card. `other` has no edit: its prefill is the bare copy, touched up by hand.
//
// ONE PREFILL PER KIND, and each changes only what its kind names:
//
// - `step` moves the decision to another step: `phase`, the turn holder and the
//   priority holder (the anchor's deciding seat by default — the half is the
//   same decision, so the same seat owes it), plus the state a step boundary
//   implies. Mana pools empty at the end of every step (CR 106.4). A step
//   opens with priority on the active player (CR 117.3a), so a non-active
//   seat holds it only once the active player has passed to it (CR 117.3d):
//   one pass banked, none when the active player is the one deciding. A
//   combat exists only inside the combat phase (CR 506.1), and only the
//   turn's own — so it is dropped outside a combat step and whenever the turn
//   holder changes.
//
//   When the turn holder changes, the position is a later turn: the anchor's
//   turn went through its cleanup step, which removes marked damage
//   (CR 514.2); `turn` advances when the anchor names one, and the new turn
//   holder's `turnsTaken` with it; the per-turn tallies — the spec's own, which
//   the builder reads as "omitted = nothing yet this turn", and each card's
//   `activations` / `abilityResolutions` — are cleared; and the seat whose
//   turn ended carries its qualifying-action flag into
//   `qualifyingActionLastTurn`.
//
//   What the prefill does NOT imply, and leaves to the tester's touch-up: the
//   new turn holder's untap step (its permanents may have been tapped since),
//   continuous effects and animations that ended with the anchor's turn, and
//   the stack — carried unchanged, although a step ends only with an empty
//   stack (CR 500.2), because a trigger may well be waiting in the new one.
// - `card` adds one named card or removes one copy of it.
// - `life` / `mana` set the named figure for one seat: a life total, a
//   floating mana pool (CR 106.4).
// - `stack` adds, removes or replaces one object on the declared stack.
// - `sequence` appends the earlier move as engine-real setup steps; building
//   the half runs them, and a step that finds no purchase throws exactly as a
//   blade entry's `setup` does (`BladeSetupError`).
// - `other` is the bare copy.

import type {
    ScenarioCard,
    ScenarioSpec,
    ScenarioStackItem,
} from "../../../debugScenarioSpec";
import type { Phase } from "../../types";
import type { BladeSeat, BladeSetupStep } from "../blade/types";
import type { Discriminant, Verdict } from "./types";

/** The part of a Verdict that IS the position: what the half copies. */
export type PairPosition = Pick<
    Verdict,
    "spec" | "setup" | "seat" | "deckKnowledge"
>;

/** The concrete edit a Discriminant is realised by, one shape per kind. */
export type DiscriminantChange =
    | {
          kind: "step";
          phase: Phase;
          activePlayer: BladeSeat;
          /** Defaults to the anchor's deciding seat. */
          priority?: BladeSeat;
      }
    | { kind: "card"; op: "add"; card: ScenarioCard }
    | {
          kind: "card";
          op: "remove";
          name: string;
          owner: BladeSeat;
          /** Narrows the match when the name sits in more than one zone. */
          zone?: NonNullable<ScenarioCard["zone"]>;
      }
    | { kind: "life"; seat: BladeSeat; life: number }
    | { kind: "mana"; seat: BladeSeat; pool: Record<string, number> }
    | { kind: "stack"; op: "add"; item: ScenarioStackItem }
    | { kind: "stack"; op: "remove"; index: number }
    | { kind: "stack"; op: "replace"; index: number; item: ScenarioStackItem }
    | { kind: "sequence"; steps: BladeSetupStep[] }
    | { kind: "other" };

/** A derivation the edit cannot perform — an authoring error, thrown. */
export class PairDerivationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PairDerivationError";
    }
}

/** CR 506.1 — the steps a declared combat can exist in. */
const COMBAT_STEPS: ReadonlySet<string> = new Set<Phase>([
    "BEGINNING_OF_COMBAT",
    "DECLARE_ATTACKERS",
    "DECLARE_BLOCKERS",
    "FIRST_STRIKE_DAMAGE",
    "COMBAT_DAMAGE",
    "END_OF_COMBAT",
]);

/** The spec's per-turn tallies: omitted means "none yet this turn", so a new
 *  turn clears them (`ScenarioSpec`'s own notes, the `landsPlayed` precedent). */
const PER_TURN_SPEC_KEYS = [
    "landsPlayed",
    "spellsCastThisTurn",
    "stormCount",
    "damageDealtToPlayerThisTurn",
    "artifactDamageToPlayerThisTurn",
    "lifeGainedThisTurn",
    "deathsThisTurn",
    "creatureAttackedThisTurn",
    "qualifyingActionThisTurn",
    "revolt",
] as const satisfies readonly (keyof ScenarioSpec)[];

/** The anchor's turn holder: `activePlayer`, omitted meaning `me` (the base
 *  state the verdict builder starts from gives the turn to `me`). */
const activeOf = (spec: ScenarioSpec): BladeSeat => spec.activePlayer ?? "me";

/** The anchor's position, and nothing else of the verdict. */
export const positionOf = (verdict: PairPosition): PairPosition => ({
    spec: verdict.spec,
    seat: verdict.seat,
    ...(verdict.setup?.length ? { setup: verdict.setup } : {}),
    ...(verdict.deckKnowledge?.length
        ? { deckKnowledge: verdict.deckKnowledge }
        : {}),
});

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The anchor's turn ended: what its cleanup and the next turn's start
 *  imply (header). */
function advanceTurn(spec: ScenarioSpec, next: BladeSeat): void {
    const ended = activeOf(spec);
    const qualified = spec.qualifyingActionThisTurn?.[ended];
    if (spec.turn !== undefined) spec.turn += 1;
    if (spec.turnsTaken?.[next] !== undefined) {
        spec.turnsTaken = {
            ...spec.turnsTaken,
            [next]: spec.turnsTaken[next]! + 1,
        };
    }
    for (const key of PER_TURN_SPEC_KEYS) delete spec[key];
    if (qualified !== undefined) {
        spec.qualifyingActionLastTurn = {
            ...spec.qualifyingActionLastTurn,
            [ended]: qualified,
        };
    }
    delete spec.combat;
    for (const card of spec.cards) {
        delete card.damageMarked;
        delete card.activations;
        delete card.abilityResolutions;
    }
}

function applyStep(
    spec: ScenarioSpec,
    change: Extract<DiscriminantChange, { kind: "step" }>,
    seat: BladeSeat
): void {
    if (change.activePlayer !== activeOf(spec)) {
        advanceTurn(spec, change.activePlayer);
    }
    spec.phase = change.phase;
    spec.activePlayer = change.activePlayer;
    spec.priority = change.priority ?? seat;
    if (spec.priority === change.activePlayer) delete spec.passCount;
    else spec.passCount = 1;
    delete spec.manaPool;
    delete spec.restrictedMana;
    if (!COMBAT_STEPS.has(change.phase)) delete spec.combat;
}

function removeCard(
    spec: ScenarioSpec,
    change: Extract<DiscriminantChange, { kind: "card"; op: "remove" }>
): void {
    const matches = spec.cards
        .map((card, index) => ({ card, index }))
        .filter(
            ({ card }) =>
                card.name === change.name &&
                card.owner === change.owner &&
                (change.zone === undefined ||
                    (card.zone ?? "battlefield") === change.zone)
        );
    const where = `"${change.name}" (${change.owner}${change.zone ? `, ${change.zone}` : ""})`;
    if (matches.length === 0) {
        throw new PairDerivationError(
            `card Discriminant: the anchor holds no ${where} to remove`
        );
    }
    if (matches.length > 1) {
        throw new PairDerivationError(
            `card Discriminant: ${where} names ${matches.length} entries of the anchor — narrow it by zone`
        );
    }
    const { card, index } = matches[0];
    if ((card.count ?? 1) > 1) card.count = (card.count ?? 1) - 1;
    else spec.cards.splice(index, 1);
}

function editStack(
    spec: ScenarioSpec,
    change: Extract<DiscriminantChange, { kind: "stack" }>
): void {
    const stack = spec.stack ?? [];
    if (change.op === "add") {
        stack.push(change.item);
    } else {
        if (
            !Number.isInteger(change.index) ||
            change.index < 0 ||
            change.index >= stack.length
        ) {
            throw new PairDerivationError(
                `stack Discriminant: the anchor's stack has no object at index ${change.index} (it holds ${stack.length})`
            );
        }
        if (change.op === "remove") stack.splice(change.index, 1);
        else stack[change.index] = change.item;
    }
    if (stack.length === 0) delete spec.stack;
    else spec.stack = stack;
}

/**
 * The right-hand half's position: the anchor's, copied, with `change` applied.
 * Pure — the anchor is never touched. Throws `PairDerivationError` when the
 * edit does not realise `discriminant` (another kind) or finds nothing to edit.
 */
export function deriveRightHalfPosition(
    anchor: PairPosition,
    discriminant: Discriminant,
    change: DiscriminantChange
): PairPosition {
    if (change.kind !== discriminant.kind) {
        throw new PairDerivationError(
            `a "${discriminant.kind}" Discriminant is realised by a "${discriminant.kind}" edit, not a "${change.kind}" one`
        );
    }
    const half = copy(positionOf(anchor));
    const spec = half.spec;
    switch (change.kind) {
        case "step":
            applyStep(spec, change, anchor.seat);
            break;
        case "card":
            if (change.op === "add") spec.cards.push(copy(change.card));
            else removeCard(spec, change);
            break;
        case "life":
            spec.life = { ...spec.life, [change.seat]: change.life };
            break;
        case "mana": {
            const pool = Object.fromEntries(
                Object.entries(change.pool).filter(([, n]) => n > 0)
            );
            const pools = { ...spec.manaPool };
            if (Object.keys(pool).length === 0) delete pools[change.seat];
            else pools[change.seat] = pool;
            if (Object.keys(pools).length === 0) delete spec.manaPool;
            else spec.manaPool = pools;
            break;
        }
        case "stack":
            editStack(spec, copy(change));
            break;
        case "sequence":
            if (change.steps.length === 0) {
                throw new PairDerivationError(
                    "sequence Discriminant: the earlier move is at least one setup step"
                );
            }
            half.setup = [...(half.setup ?? []), ...copy(change.steps)];
            break;
        case "other":
            break;
        default: {
            const never: never = change;
            throw new PairDerivationError(
                `unknown Discriminant edit ${JSON.stringify(never)}`
            );
        }
    }
    return half;
}
