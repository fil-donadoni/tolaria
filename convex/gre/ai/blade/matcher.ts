/**
 * Blade-scenario suite — structural-by-name `MoveMatcher` resolver
 * (issue #1427).
 *
 * A blade expectation is written in card NAMES; a `Move` carries instance
 * IDS. This module is the bridge: it resolves a name against the BUILT state
 * (every zone of both players) and checks the chosen move against a matcher,
 * partially — only the fields the matcher declares are compared.
 *
 * Pure: no engine mutation, no I/O.
 */

import { getCardByName, tryGetDefinition } from "../../../cards";
import type { GameState, CardInstanceState } from "../../state";
import type { Move } from "../../moves";
import type { BladeSeat, MoveMatcher } from "./types";

/** Every zone a scenario can place a card in. `library` is included so a
 *  matcher can name a card the bot digs up mid-resolution. */
function allInstances(state: GameState): CardInstanceState[] {
    const out: CardInstanceState[] = [];
    for (const p of state.players) {
        out.push(
            ...p.battlefield,
            ...p.hand,
            ...p.graveyard,
            ...p.exile,
            ...p.library
        );
    }
    return out;
}

/** The player id for a seat. Mirrors `ScenarioSpec`: `me` = `players[0]`,
 *  `opp` = `players[1]`. */
export function seatPlayerId(state: GameState, seat: BladeSeat): string {
    return seat === "opp" ? state.players[1].id : state.players[0].id;
}

/**
 * Resolve a card NAME to the set of instance ids of that card present in
 * `state`. Throws (loudly, with the offending name) when the name is not a
 * known card — a typo in a blade entry must fail the suite, never silently
 * match nothing.
 */
export function instanceIdsForName(
    state: GameState,
    name: string
): Set<string> {
    const def = getCardByName(name); // throws on an unknown name
    const ids = new Set<string>();
    for (const inst of allInstances(state)) {
        if ((inst.card as { id?: string } | undefined)?.id === def.id) {
            ids.add(inst.id);
        }
    }
    return ids;
}

/** The card instances a move ACTS WITH (cast / activated / played / declared).
 *  Empty for moves that carry no card (pass, mulligan, yes-no answers). */
export function movingCardIds(move: Move): string[] {
    switch (move.kind) {
        case "play-land":
        case "cast-spell":
        case "activate-ability":
            return [move.cardInstanceId];
        case "declare-attackers":
            return move.attackerIds;
        case "declare-blockers":
            return move.assignments.map((a) => a.blockerId);
        case "mulligan-bottom":
        case "resolution-choice":
            return move.cardInstanceIds;
        default:
            return [];
    }
}

/** The ids a move TARGETS — spell/ability targets (card or player ids), the
 *  attacker each blocker is assigned to, and per-attacker planeswalker
 *  targets. */
export function targetedIds(move: Move): string[] {
    switch (move.kind) {
        case "cast-spell":
        case "activate-ability":
            return move.targets.map((t) => t.id);
        case "declare-blockers":
            return move.assignments.map((a) => a.attackerId);
        case "declare-attackers":
            return Object.values(move.attackTargets ?? {});
        default:
            return [];
    }
}

/** The boolean carried by the yes/no move kinds, or `undefined`. */
export function moveAccept(move: Move): boolean | undefined {
    switch (move.kind) {
        case "may-pay":
        case "land-entry":
        case "draw-replacement":
            return move.accept;
        default:
            return undefined;
    }
}

/** Resolve a matcher's `target` string to the set of ids it may denote: a
 *  player id for `"me"` / `"opp"`, otherwise every instance of that card. */
function targetCandidateIds(state: GameState, target: string): Set<string> {
    if (target === "me" || target === "opp") {
        return new Set([seatPlayerId(state, target)]);
    }
    return instanceIdsForName(state, target);
}

/**
 * Does `move` match `matcher` in `state`? Partial match: `kind` is always
 * compared, every other field only when the matcher declares it.
 */
export function matchesMove(
    state: GameState,
    move: Move | null,
    matcher: MoveMatcher
): boolean {
    if (!move) return false;
    if (move.kind !== matcher.kind) return false;

    const acting = movingCardIds(move);

    if (matcher.card !== undefined) {
        const ids = instanceIdsForName(state, matcher.card);
        if (!acting.some((id) => ids.has(id))) return false;
    }

    if (matcher.cards !== undefined) {
        for (const name of matcher.cards) {
            const ids = instanceIdsForName(state, name);
            if (!acting.some((id) => ids.has(id))) return false;
        }
    }

    if (matcher.target !== undefined) {
        const ids = targetCandidateIds(state, matcher.target);
        if (!targetedIds(move).some((id) => ids.has(id))) return false;
    }

    if (matcher.accept !== undefined && moveAccept(move) !== matcher.accept) {
        return false;
    }

    return true;
}

/** One-line, stable, human-readable rendering of a matcher — used in failure
 *  messages and the stretch report. */
export function describeMatcher(matcher: MoveMatcher): string {
    const parts: string[] = [matcher.kind];
    if (matcher.card) parts.push(`card=${matcher.card}`);
    if (matcher.cards) parts.push(`cards=[${matcher.cards.join(", ")}]`);
    if (matcher.target) parts.push(`target=${matcher.target}`);
    if (matcher.accept !== undefined) parts.push(`accept=${matcher.accept}`);
    return parts.join(" ");
}

/** One-line rendering of an actual chosen move, in the same name vocabulary
 *  as the matchers so a failure diff reads side by side. */
export function describeChosenMove(
    state: GameState,
    move: Move | null
): string {
    if (!move) return "<no move>";
    const nameOf = (id: string): string => {
        const inst = allInstances(state).find((c) => c.id === id);
        if (!inst) {
            const seat = state.players.find((p) => p.id === id);
            if (seat) return seat.id === state.players[0].id ? "me" : "opp";
            return id;
        }
        const cardId = (inst.card as { id?: string } | undefined)?.id;
        if (!cardId) return inst.id;
        return tryGetDefinition(cardId)?.name ?? cardId;
    };
    const parts: string[] = [move.kind];
    const acting = movingCardIds(move).map(nameOf);
    if (acting.length) parts.push(`cards=[${acting.join(", ")}]`);
    const targets = targetedIds(move).map(nameOf);
    if (targets.length) parts.push(`targets=[${targets.join(", ")}]`);
    const accept = moveAccept(move);
    if (accept !== undefined) parts.push(`accept=${accept}`);
    return parts.join(" ");
}
