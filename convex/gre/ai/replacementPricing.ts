// Replacement-effect pricing for the Brain's leaf evaluation (issue #5362).
//
// A permanent's `replacementEffects[]` change nothing the layer system or the
// effect scripts show, so a card whose standing worth IS a replacement read
// as `base + MV` on every board. This reads them, by `eventKind`, from the
// controller's point of view, off the ENGINE's own predicate: each
// replacement's `appliesTo` is asked about the damage events the board could
// produce (`buildStateView` / `buildPermanentView` / `describeDamageSource`,
// the conversions the dispatch loop runs), never a re-implementation of the
// match.
//
// The `damage` family, CR 615.1 / 614.1:
//   * PREVENTION shields what its predicate matches. A player the opponent's
//     creatures could hit is worth the damage they would deal, a creature the
//     damage their strongest attacker would deal (up to its toughness), each
//     point at `lifeWeight` — the price the evaluation already puts on a life
//     point, so no new fitted unit. Shielding the controller's side reads
//     positive, the opponent's negative.
//   * REDIRECTION and `other` read zero: where the damage goes, and what the
//     rewrite does to it, is not a fact the predicate shows.
//   * A prevention that shields BOTH sides (a symmetric effect) reads zero
//     here — the Differential Reading of PRD #5160 owns those, and this
//     reader must not become a second authority for them.
//
// Every other `eventKind` reads zero (fail neutral) until its own slice;
// `readEventKind` enumerates them exhaustively, so a new kind is a compile
// error here rather than a silent zero.
//
// Non-creature permanents only: a creature's hand face does not read a
// standing worth (`declaresStandingLock`'s same limit), so reading the
// board face alone would open a hand/board gap.

import { tryGetDefinition } from "../../cards";
import type {
    CardDefinition,
    DamageReplacementEvent,
    ReplacementEffect,
    ReplacementEventKind,
} from "../../cards/types";
import { isCreature } from "../constants";
import { getEffectivePT, type Layer7Pass } from "../layers";
import {
    buildPermanentView,
    buildStateView,
    describeDamageSource,
} from "../replacements";
import type { CardInstanceState, GameState } from "../state";

/** What the reading needs of the weight vector. */
export interface ReplacementShareWeights {
    lifeWeight: number;
}

/** The signed worth of one replacement of kind `kind`, to its controller.
 *  Exhaustive over `ReplacementEventKind`: an unhandled kind reads 0. */
function readEventKind(
    kind: ReplacementEventKind,
    effect: ReplacementEffect,
    priceDamage: (effect: ReplacementEffect) => number
): number {
    switch (kind) {
        case "damage":
            return effect.damageEffectKind === "prevention"
                ? priceDamage(effect)
                : 0;
        case "lifegain":
        case "lifeloss":
        case "damage-lifeloss":
        case "discard":
        case "lose-game":
        case "tap":
        case "destroy":
        case "graveyard-bound":
        case "enters-battlefield":
        case "draw":
        case "token-created":
        case "counter-placed":
            return 0;
        default: {
            const unhandled: never = kind;
            return unhandled;
        }
    }
}

/** True when `def` is a non-creature permanent carrying a damage prevention
 *  the reading prices. The `replacementEffects` precheck keeps the common
 *  case (no replacement at all) to one property read. */
export function declaresDamageShield(def: CardDefinition): boolean {
    const effects = def.replacementEffects;
    if (!effects || effects.length === 0) return false;
    if (
        def.types.includes("Creature") ||
        def.types.includes("Land") ||
        def.types.includes("Instant") ||
        def.types.includes("Sorcery")
    ) {
        return false;
    }
    // Host-scoped (an Aura's shield reads `self.attachedTo`) or chosen as it
    // enters: in hand the host / choice does not exist yet, so the board a
    // card in hand would leave behind cannot be measured (the same exclusion
    // `declaresStandingLock` makes).
    if (def.subtypes?.includes("Aura") || def.entersWith?.asEnters?.length) {
        return false;
    }
    return effects.some(
        (r) => r.eventKind === "damage" && r.damageEffectKind === "prevention"
    );
}

/** The standing worth of `source`'s replacement effects on this board, to its
 *  controller: signed, zero for a permanent that carries none the reading
 *  prices. Read by the board term (once), `permanentRealisedValue` (once —
 *  the source's own credit is all a removal takes away) and the hand face
 *  (`standingLockWorth`), so the faces are one number. */
export function replacementStandingWorth(
    state: GameState,
    source: CardInstanceState,
    weights: ReplacementShareWeights,
    pass: Layer7Pass
): number {
    const def = tryGetDefinition(String(source.card.id ?? ""));
    if (!def || !declaresDamageShield(def)) return 0;
    let worth = 0;
    for (const effect of def.replacementEffects ?? []) {
        worth += readEventKind(effect.eventKind, effect, (e) =>
            damageShieldWorth(state, source, e, weights, pass)
        );
    }
    return worth;
}

/** One prevention's worth: what it shields on the controller's side minus
 *  what it shields on the opponent's, zero when it shields both. */
function damageShieldWorth(
    state: GameState,
    source: CardInstanceState,
    effect: ReplacementEffect,
    weights: ReplacementShareWeights,
    pass: Layer7Pass
): number {
    const view = buildPermanentView(source);
    const stateView = buildStateView(state);
    const shields = (event: DamageReplacementEvent): boolean =>
        effect.appliesTo(event, view, stateView);
    const probe = (
        attacker: CardInstanceState,
        targetType: "player" | "permanent",
        targetId: string,
        amount: number
    ): DamageReplacementEvent => {
        const desc = describeDamageSource(state, attacker.id);
        return {
            kind: "damage",
            sourceInstanceId: attacker.id,
            sourceControllerId: attacker.controllerId,
            sourceColors: desc.colors,
            sourceTypes: desc.types,
            sourceSubtypes: desc.subtypes,
            sourceStaticAbilities: desc.staticAbilities,
            target: { type: targetType, id: targetId },
            amount,
            isCombat: true,
        };
    };
    const powerOf = (c: CardInstanceState): number =>
        Math.max(
            0,
            getEffectivePT(state, c, { includeTemporary: false, pass }).power
        );
    let own = 0;
    let theirs = 0;
    for (const player of state.players) {
        const attackers = state.players
            .filter((p) => p.id !== player.id)
            .flatMap((p) => p.battlefield)
            .filter((c) => isCreature(c))
            .map((card) => ({ card, power: powerOf(card) }))
            .filter((a) => a.power > 0);
        let shielded = 0;
        // The player: every point their opponents' creatures would deal.
        for (const a of attackers) {
            if (shields(probe(a.card, "player", player.id, a.power))) {
                shielded += a.power;
            }
        }
        // Each of their creatures: the damage the strongest attacker would
        // put on it, up to the toughness it has to spend.
        let strongest: (typeof attackers)[number] | undefined;
        for (const a of attackers) {
            if (!strongest || a.power > strongest.power) strongest = a;
        }
        if (strongest) {
            for (const c of player.battlefield) {
                if (!isCreature(c)) continue;
                const toughness = Math.max(
                    0,
                    getEffectivePT(state, c, { includeTemporary: false, pass })
                        .toughness
                );
                const amount = Math.min(strongest.power, toughness);
                if (
                    amount > 0 &&
                    shields(probe(strongest.card, "permanent", c.id, amount))
                ) {
                    shielded += amount;
                }
            }
        }
        if (player.id === source.controllerId) own += shielded;
        else theirs += shielded;
    }
    // Symmetric: left to the Differential Reading (PRD #5160).
    if (own > 0 && theirs > 0) return 0;
    return (own - theirs) * weights.lifeWeight;
}
