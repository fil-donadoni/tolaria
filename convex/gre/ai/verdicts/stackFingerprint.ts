// The stack fingerprint — how `lowerDecision` proves a DECLARED stack rebuilt
// the stack that was in play (issue #3514, PRD #3397, ADR 0127).
//
// WHY IT HAS TO SEE MORE THAN NAMES. The journal it replaces compared seat +
// name + kind, and could afford to: every object reached the rebuild through a
// recorded move, and the recorder was the first line of defence. Under a
// declarative lowering the lowering itself WRITES seat, name and kind, so a
// comparison on those alone passes by construction and proves nothing. What
// the declarative path can genuinely get wrong is the ANNOUNCEMENT: a target
// travels as name + seat + `nth` and resolves against whatever the rebuild
// placed at that index, so with two same-named permanents — one damaged, one
// not — a rebuild can point the spell at the wrong one. Nothing else catches
// that: the candidate list is identical, and an eval pair would simply be
// measured on the wrong board.
//
// So a target is fingerprinted by what can be OBSERVED about the object it
// names — its seat, name, and the per-instance facts two same-named copies
// differ by (tapped, marked damage, counters) — never by `nth`, which is the
// lowering's own output and would make the check circular again. Two copies
// that agree on every fact here are interchangeable for the position, so
// picking either is not a different board.
//
// WHAT THE FACTS DO NOT SEE, and why that is survivable: an until-end-of-turn
// pump or other continuous effect, summoning sickness, phasing. Two same-named
// permanents differing ONLY there would fingerprint alike. The rebuild still
// resolves `nth` against a battlefield placed in the live order (the lowering
// never merges distinct instances into a `count`), so reaching the wrong one
// needs a builder fault AND a pair indistinguishable on every fact below.
//
// Instance ids never appear: each build allocates its own.

import { tryGetDefinition } from "../../../cards";
import type { BladeSeat } from "../blade/types";
import type { CardInstanceState, GameState, StackItem } from "../../state";
import type { TargetSelection } from "../../../cards/types";

/** A live player id → its seat in the spec's frame, `null` when unmapped. */
export type SeatOf = (playerId: string) => BladeSeat | null;

/**
 * The stack as one label per object, bottom-up: seat, name, kind, every
 * announced target (in slot order — a slot's INDEX is load-bearing) and `x`.
 */
export function stackFingerprint(state: GameState, seatOf: SeatOf): string[] {
    return state.stack.map((item: StackItem) => {
        const seat = seatOf(item.castById) ?? "?";
        const kind =
            item.abilityId !== undefined
                ? `ability:${item.abilityId}`
                : item.triggerSourceId !== undefined
                  ? "trigger"
                  : "spell";
        const targets = (item.targets ?? [])
            .map((target) => targetLabel(state, target, seatOf))
            .join(", ");
        return `${seat} ${nameOf(item)} ${kind} targets[${targets}] x=${
            item.chosenX ?? "-"
        }`;
    });
}

/**
 * `null` when the rebuilt stack matches the live one, else ONE sentence naming
 * the first object that differs and both full fingerprints.
 *
 * Exported as the guard's own seam: "a duplicate-name target resolved to the
 * wrong instance" is the failure it exists for, and pinning it here names the
 * mechanism instead of hunting a builder bug that happens to produce one.
 */
export function stackRebuildMismatch(
    live: GameState,
    liveSeatOf: SeatOf,
    rebuilt: GameState,
    rebuiltSeatOf: SeatOf
): string | null {
    const inPlay = stackFingerprint(live, liveSeatOf);
    const onRebuild = stackFingerprint(rebuilt, rebuiltSeatOf);
    const depth = Math.max(inPlay.length, onRebuild.length);
    for (let index = 0; index < depth; index++) {
        if (inPlay[index] === onRebuild[index]) continue;
        return `stack index ${index} is "${inPlay[index] ?? "(nothing)"}" in play and "${
            onRebuild[index] ?? "(nothing)"
        }" on the rebuild — in play [${inPlay.join(" | ")}], on the rebuild [${onRebuild.join(" | ")}]`;
    }
    return null;
}

function targetLabel(
    state: GameState,
    target: TargetSelection,
    seatOf: SeatOf
): string {
    switch (target.type) {
        case "player":
            return `player:${seatOf(target.id) ?? "?"}`;
        case "permanent": {
            for (const player of state.players) {
                const card = player.battlefield.find((c) => c.id === target.id);
                if (card) {
                    return `permanent:${seatOf(player.id) ?? "?"} ${nameOf(card)}${facts(state, card)}`;
                }
            }
            return "permanent:?";
        }
        case "graveyard-card": {
            const player = state.players.find((p) => p.id === target.playerId);
            const card = player?.graveyard.find((c) => c.id === target.id);
            return card && player
                ? `graveyard:${seatOf(player.id) ?? "?"} ${nameOf(card)}`
                : "graveyard:?";
        }
        case "spell": {
            const index = state.stack.findIndex((s) => s.id === target.id);
            return index === -1 ? "stack:?" : `stack#${index}`;
        }
        case "hand-card":
            return "hand-card";
    }
}

/** The per-instance facts two same-named permanents can differ by. Empty for a
 *  pristine permanent, so the common label stays short. */
function facts(state: GameState, card: CardInstanceState): string {
    const out: string[] = [];
    if (card.isTapped) out.push("tapped");
    if (card.damageMarked) out.push(`damage=${card.damageMarked}`);
    // CR 301.5 / 303.4 — an Aura or Equipment on it, counted from the other
    // side of the link (`attachedTo` lives on the attachment).
    const attached = state.players.reduce(
        (n, player) =>
            n +
            player.battlefield.filter((c) => c.attachedTo === card.id).length,
        0
    );
    if (attached > 0) out.push(`attached=${attached}`);
    const counters = Object.entries(card.counters ?? {})
        .filter(([, n]) => n)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([kind, n]) => `${kind}=${n}`);
    if (counters.length > 0) out.push(`counters{${counters.join(",")}}`);
    return out.length === 0 ? "" : ` {${out.join(" ")}}`;
}

/** The registry name of an instance, or its definition id when the registry
 *  has none — two unnamed objects must not collapse into one label. */
function nameOf(instance: CardInstanceState): string {
    const id = (instance.card as { id?: string }).id;
    if (!id) return "(unnamed)";
    return tryGetDefinition(id)?.name ?? id;
}
