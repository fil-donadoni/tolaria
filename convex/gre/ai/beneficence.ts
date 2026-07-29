// Who does this spell HELP? — per-target beneficence for a cast (issue #1888).
//
// The bot used to hand Wild Growth to its opponent. Nothing in the pipeline had
// an opinion: `getLegalTargets` correctly offers every land (CR 115.4), the
// evaluator scores the resulting position identically either way (the aura
// permanent is the bot's in both worlds, and the `mana` term counts untapped
// SOURCES, not the extra {G} the aura will add later), and so the two cast
// variants tie inside `OUTCOME_EPS` and the pick falls to rollout noise. The
// same hole makes a one-sided removal aimed at the bot's own permanent a coin
// flip — the shape issue #365 patched narrowly, in `search.ts`, for removal
// only.
//
// This module supplies the missing axis, derived from Op semantics with ZERO
// per-card knowledge (the settled principle of the closed wayfinder map
// #1254):
//
//     for each ANNOUNCED TARGET SLOT of a cast, is the card's effect on the
//     player at the other end a GIFT, an ATTACK, or neither?
//
// Two derivations, both mechanism-keyed:
//
//  1. **Effect Script.** Walk the (mode-selected) script; every Op that names
//     `{ target: n }` anywhere in its own fields contributes its
//     `opBeneficence` sign (`opValuers.ts`) to slot `n`. Structural constructs
//     (`if` / `forEach` / `optionChoice` / `coinFlip`) recurse into their
//     nested Op lists, so a mode's body is read exactly like a top-level one.
//  2. **Attachment payoff.** An Aura (CR 303.4) has no resolution script at
//     all — its whole effect is what it grants the permanent it enchants once
//     attached. Read that instead: a triggered ability carrying a
//     `manaBonusForPotential` descriptor (CR 605.4 — Wild Growth, Fertile
//     Ground, Utopia Sprawl) is mana for the HOST's controller, and the sign of
//     a `pt-buff` / keyword grant / restriction static effect is the sign of
//     the aura.
//
// The aggregation is fail-open: a slot with mixed signs, or with no signal at
// all, is `neutral` and draws no penalty. The cost of a missed signal is one
// un-redirected cast; the cost of a wrong signal is the bot refusing a correct
// play, so every ambiguity resolves to "no opinion".

import type {
    CardDefinition,
    EffectOp,
    TargetSelection,
} from "../../cards/types";
import type { GameState } from "../state";
import type { Move } from "../moves";
import { tryGetDefinition } from "../../cards";
import { type Beneficence, opBeneficence } from "./opValuers";

/** Merge two signs for the same slot. Agreement keeps the sign; disagreement
 *  (a "target player draws a card and loses 2 life" shape) collapses to
 *  `neutral` — the fail-open default. */
function mergeSign(a: Beneficence, b: Beneficence): Beneficence {
    if (a === "neutral") return b;
    if (b === "neutral") return a;
    return a === b ? a : "neutral";
}

/** Every announced target slot index reachable from `value`, at any depth of
 *  its own (non-effect-list) fields. `{ target: n }` is the ONE shape an
 *  announced slot takes across every selector type (`isAnnouncedTarget`,
 *  `opValuers.ts`), so a structural scan finds them all without a per-Op field
 *  list that would rot on the next Op. */
function announcedSlotsIn(value: unknown, out: Set<number>): void {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
        for (const v of value) announcedSlotsIn(v, out);
        return;
    }
    const bag = value as Record<string, unknown>;
    if (typeof bag.target === "number") out.add(bag.target);
    for (const [key, v] of Object.entries(bag)) {
        // Nested Op LISTS are walked by `collectScriptSigns` (each nested Op
        // gets its OWN sign); descending into them here would attribute the
        // outer Op's sign to an inner Op's slots.
        if (NESTED_EFFECT_KEYS.has(key)) continue;
        announcedSlotsIn(v, out);
    }
}

/** Fields on a structural construct that hold nested Op lists / branch bodies.
 *  Walked by `collectScriptSigns`, skipped by `announcedSlotsIn`. */
const NESTED_EFFECT_KEYS = new Set([
    "effects",
    "then",
    "else",
    "modes",
    "win",
    "loss",
]);

/** Accumulate each Op's sign onto every announced slot the Op names. */
function collectScriptSigns(
    effects: readonly EffectOp[],
    signs: Map<number, Beneficence>
): void {
    for (const op of effects) {
        switch (op.op) {
            case "if":
                collectScriptSigns(op.then, signs);
                if (op.else) collectScriptSigns(op.else, signs);
                continue;
            case "forEach":
                collectScriptSigns(op.effects, signs);
                continue;
            case "optionChoice":
                for (const mode of op.modes)
                    collectScriptSigns(mode.effects, signs);
                continue;
            case "coinFlip":
            case "coinFlipSync":
                collectScriptSigns(op.win.effects, signs);
                collectScriptSigns(op.loss.effects, signs);
                continue;
            default:
                break;
        }
        const sign = opBeneficence(op);
        if (sign === "neutral") continue;
        const slots = new Set<number>();
        announcedSlotsIn(op, slots);
        for (const slot of slots) {
            signs.set(slot, mergeSign(signs.get(slot) ?? "neutral", sign));
        }
    }
}

/** The sign an AURA carries for the controller of the permanent it enchants
 *  (CR 303.4). An aura's payoff is continuous / triggered, never a resolution
 *  script, so the script walk above sees nothing — read the attachment
 *  mechanisms instead. */
function auraAttachmentSign(def: CardDefinition): Beneficence {
    let sign: Beneficence = "neutral";

    // CR 605.4 — "whenever enchanted land is tapped for mana, its controller
    // adds …". The `manaBonusForPotential` descriptor exists precisely because
    // this mana accrues to the HOST's controller (`appliesTo: "host"`), which
    // is exactly the fact the beneficence axis needs.
    for (const trigger of def.triggeredAbilities ?? []) {
        if (trigger.manaBonusForPotential) sign = mergeSign(sign, "beneficial");
    }

    for (const effect of def.staticEffects ?? []) {
        switch (effect.kind) {
            case "pt-buff": {
                const net = effect.power + effect.toughness;
                if (net !== 0)
                    sign = mergeSign(sign, net > 0 ? "beneficial" : "harmful");
                break;
            }
            case "keyword-grant":
            case "activated-grant":
            case "triggered-grant":
                sign = mergeSign(sign, "beneficial");
                break;
            // Pacifism / Paralyze shapes — the aura is an attack on its host.
            case "attack-restriction":
            case "block-restriction":
            case "untap-restriction":
            case "declared-attack-restriction":
            case "declared-block-restriction":
            case "ability-loss":
            case "keyword-remove":
            case "control-change":
                sign = mergeSign(sign, "harmful");
                break;
            default:
                break;
        }
    }
    return sign;
}

/** The sign of `def`'s effect on the controller of whatever fills announced
 *  target slot `slot`, under chosen mode `modeId` (CR 700.2c). */
export function targetSlotBeneficence(
    def: CardDefinition,
    modeId: string | undefined,
    slot: number
): Beneficence {
    const signs = new Map<number, Beneficence>();
    const mode = modeId ? def.modes?.find((m) => m.id === modeId) : undefined;
    const effects = mode ? mode.effects : def.effects;
    if (effects) collectScriptSigns(effects, signs);
    const scripted = signs.get(slot) ?? "neutral";
    if (scripted !== "neutral") return scripted;
    // CR 303.4 — an Aura's single target slot IS its "enchant" slot.
    if (slot === 0 && def.subtypes?.includes("Aura")) {
        return auraAttachmentSign(def);
    }
    return "neutral";
}

/** Who is on the receiving end of `target`: the player whose stake the
 *  beneficence sign is about. `undefined` when it can't be attributed. */
function recipientOf(
    state: GameState,
    target: TargetSelection
): string | undefined {
    if (target.type === "player") return target.id;
    if (target.type === "permanent") {
        for (const p of state.players) {
            const perm = p.battlefield.find((c) => c.id === target.id);
            if (perm) return perm.controllerId ?? p.id;
        }
        return undefined;
    }
    if (target.type === "spell") {
        return state.stack.find((s) => s.id === target.id)?.castById;
    }
    return target.playerId;
}

/** How many of `move`'s announced targets are MISDIRECTED for `botId` — a
 *  beneficial slot pointed at the OPPONENT, or a harmful one pointed at the
 *  bot's own side. 0 for a non-cast, a targetless cast, or any slot the
 *  derivation has no opinion about.
 *
 *  A COUNT rather than a boolean so a multi-target spell that misdirects two
 *  slots ranks below one that misdirects one — the ranking in `search.ts` is a
 *  preference among cast variants, never a legality change. */
export function misdirectedTargetCount(
    state: GameState,
    move: Move,
    botId: string
): number {
    if (move.kind !== "cast-spell" || move.targets.length === 0) return 0;
    const player = state.players.find((p) => p.id === botId);
    const card = player?.hand.find((c) => c.id === move.cardInstanceId);
    const defId = (card?.card as { id?: string } | undefined)?.id;
    const def = defId ? tryGetDefinition(defId) : undefined;
    if (!def) return 0;

    let count = 0;
    for (let slot = 0; slot < move.targets.length; slot++) {
        const sign = targetSlotBeneficence(def, move.chosenModeId, slot);
        if (sign === "neutral") continue;
        const recipient = recipientOf(state, move.targets[slot]);
        if (recipient === undefined) continue;
        const mine = recipient === botId;
        if (sign === "beneficial" ? !mine : mine) count++;
    }
    return count;
}
