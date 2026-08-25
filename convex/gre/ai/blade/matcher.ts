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
 *  matcher can name a card the bot digs up mid-resolution; `stack` is included
 *  because the archetypal blade position is a RESPONSE — a matcher naming the
 *  spell being answered (`{ kind: "cast-spell", card: "Counterspell", target:
 *  "Lightning Bolt" }`) must resolve the stack-resident name, or the entry
 *  false-fails under `moves` and false-passes under `forbidden`.
 *  (`StackItem extends CardInstanceState`.) */
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
    out.push(...state.stack);
    return out;
}

/** The player id for a seat. Mirrors `ScenarioSpec`: `me` = `players[0]`,
 *  `opp` = `players[1]`. */
export function seatPlayerId(state: GameState, seat: BladeSeat): string {
    return seat === "opp" ? state.players[1].id : state.players[0].id;
}

/**
 * Resolve a card NAME to the set of instance ids of that card present in
 * `state`. Throws (loudly, with the offending name) in BOTH unresolvable
 * cases:
 *   - the name is not a known card (a typo in a blade entry), and
 *   - the name IS a real card but has zero instances anywhere in the built
 *     state.
 * The second case is the dangerous one: an empty id set silently matches
 * nothing, which under `expect: { forbidden: [...] }` is a VACUOUS GREEN —
 * the entry passes while asserting nothing. This suite's whole value is that
 * it cannot pass by accident, so an unresolvable name is a hard authoring
 * error.
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
    if (ids.size === 0) {
        throw new Error(
            `Blade matcher names "${name}", but no instance of it exists in ` +
                `the built state (checked battlefield, hand, graveyard, exile, ` +
                `library and stack of both seats). A matcher name that resolves ` +
                `to nothing can never match — under \`forbidden\` that is a ` +
                `vacuous pass. Fix the spec or the matcher.`
        );
    }
    return ids;
}

/** The card instances a move ACTS WITH (cast / activated / played / declared).
 *  Empty for moves that carry no card (pass, mulligan, yes-no answers). */
export function movingCardIds(move: Move): string[] {
    switch (move.kind) {
        // CR 116.2b / 702.37e (issue #2705) — `turn-face-up` joins this group:
        // the special action acts with exactly one permanent. NOTE for
        // authors: naming that permanent's real card in a matcher will NOT
        // resolve — a face-down object presents the `FACE_DOWN_CARD_ID`
        // sentinel, which is deliberately absent from the name registry.
        // Match a turn-face-up on `kind` alone.
        case "play-land":
        case "cast-spell":
        case "activate-ability":
        case "turn-face-up":
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
        case "submit-target":
            // issue #2283 — the standalone answer to an engine-raised target
            // selection carries its targets the same way, so `target:` in a
            // matcher works on it unchanged.
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
    // Resolve EVERY declared name FIRST, before any short-circuit. An
    // unresolvable name is an authoring bug in the entry, and it must surface
    // whatever the bot happened to choose — resolving lazily would hide it
    // behind a kind mismatch and leave the entry vacuously green.
    const cardIds =
        matcher.card !== undefined
            ? instanceIdsForName(state, matcher.card)
            : undefined;
    const cardsIds = matcher.cards?.map((name) =>
        instanceIdsForName(state, name)
    );
    const targetIds =
        matcher.target !== undefined
            ? targetCandidateIds(state, matcher.target)
            : undefined;

    if (!move) return false;
    if (move.kind !== matcher.kind) return false;

    const acting = movingCardIds(move);

    if (cardIds && !acting.some((id) => cardIds.has(id))) return false;

    if (cardsIds) {
        for (const ids of cardsIds) {
            if (!acting.some((id) => ids.has(id))) return false;
        }
    }

    if (targetIds && !targetedIds(move).some((id) => targetIds.has(id))) {
        return false;
    }

    if (matcher.accept !== undefined && moveAccept(move) !== matcher.accept) {
        return false;
    }

    // issue #2306 — an OPTION id (never a card name, so no
    // `instanceIdsForName` resolution: an option-pick's ids are
    // author-supplied semantic strings like "protection-blue"), checked
    // against a `resolution-choice` move's submitted `cardInstanceIds`.
    if (matcher.option !== undefined) {
        if (move.kind !== "resolution-choice") return false;
        if (!move.cardInstanceIds.includes(matcher.option)) return false;
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
    if (matcher.option) parts.push(`option=${matcher.option}`);
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
