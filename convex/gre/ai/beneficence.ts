// Who does this ANNOUNCEMENT help? — per-target beneficence (issue #1888).
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
//     for each ANNOUNCED TARGET SLOT, is the effect on the player at the other
//     end a GIFT, an ATTACK, or neither?
//
// "Announced" covers BOTH sites the bot chooses targets at: a cast (CR 601.2c)
// and an activated ability (CR 602.2b). They are the same read — `move.targets`
// against an `EffectOp[]` (ADR 0045) — so they share one derivation and one
// entry point (`misdirectedTargetCount`). Garruk Wildspeaker's "+1: Untap two
// target lands" is the ability-side case: `tapUntap action: "untap"` is
// beneficial, the tuples all tie inside `OUTCOME_EPS`, and without a sign the
// bot untaps the OPPONENT's lands on rollout noise.
//
// SCOPE. This axis is about the ANNOUNCEMENT — the targets a move names. A
// recipient the effect picks LATER is a different mechanism with its own seam:
// a `forEach` body's recipients are derived, not chosen (there is nothing to
// redirect), and a mid-resolution `choice` recipient is answered at a choice
// NODE, ranked by `choicePriors.ts`. Both are reached by `collectScriptSigns`
// here only insofar as they carry an announced `{ target: n }` slot, which is
// exactly the set of decisions this ranking can act on.
//
// Two derivations, both mechanism-keyed:
//
//  1. **Effect Script.** Walk the (mode-selected) script; every Op that names
//     `{ target: n }` anywhere in its own fields contributes its
//     `opBeneficence` sign (`opValuers.ts`) to slot `n`. Every script host
//     recurses into its nested Op lists (`childOpArrays`, the one enumeration
//     of them), so a mode's body is read exactly like a top-level one.
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
    ActivatedAbility,
    CardDefinition,
    EffectOp,
    TargetSelection,
} from "../../cards/types";
import type { GameState } from "../state";
import type { Move } from "../moves";
import { tryGetDefinition } from "../../cards";
import { type Beneficence, opBeneficence } from "./opValuers";
import { soleChosenModeId } from "../modeSelection";
import { childOpArrays, isTriggerBodyHost } from "./effectOpChildren";
import { findTriggeredAbility } from "../copy";
import { blinkReturnedBindings } from "./pendingReturn";

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

/** Field names that hold nested Op lists / branch bodies — a SKIP list for
 *  `announcedSlotsIn` only, so a leaf Op's sign never lands on a nested Op's
 *  slots. Which lists a host carries is `childOpArrays`'s answer, not this
 *  set's: script hosts never reach `announcedSlotsIn` at all, so their own
 *  non-list fields (a `divideIntoPiles` `divider`, a `forEach` `select`) are
 *  unsigned today — a future host naming an announced slot there needs its
 *  own row. */
const NESTED_EFFECT_KEYS = new Set([
    "effects",
    "then",
    "else",
    "modes",
    "win",
    "loss",
]);

/** CR 614.9 (issue #3810) — Ops that move stake in BOTH directions at once,
 *  one named slot gaining exactly what another loses. A per-OP sign cannot
 *  describe them: `redirectDamage`'s `from` is shielded and its `to` is hit,
 *  so the flat path below would stamp the same sign on both slots and send the
 *  bot's own creature the damage it was trying to dodge. The sign is per
 *  FIELD instead, and each field's slots are walked on their own.
 *
 *  Keyed by Op name → field name, never by card: a second two-sided Op adds a
 *  row, not a branch. Every Op here is `"neutral"` in `OP_BENEFICENCE` for the
 *  same reason — the stake is conserved, so the per-Op axis has nothing to
 *  say — and the census reads that row. */
const SPLIT_SIGN_OPS: Partial<
    Record<EffectOp["op"], Readonly<Record<string, Beneficence>>>
> = {
    redirectDamage: { from: "beneficial", to: "harmful" },
    // CR 701.14a — the `other` combatant is the stake (opponent's creature
    // preferred); the `creature` fighter has NO fixed sign: the Bot's own
    // lethal creature and an opponent's creature are both right fighters
    // depending on the exchange, which the valuer's pair reading prices.
    fight: { creature: "neutral", other: "harmful" },
};

/** Accumulate each Op's sign onto every announced slot the Op names. */
function collectScriptSigns(
    effects: readonly EffectOp[],
    signs: Map<number, Beneficence>
): void {
    // Issue #6334 — an `exile` whose card this same script's delayed trigger
    // returns to the battlefield (CR 603.7a, the blink idiom) is not an attack
    // on the exiled card's controller: what it is worth depends on the board
    // (a fresh enters-trigger, a shed Aura, a tempo turn), which the resolved
    // margin reads. No sign, so flickering one's own permanent draws no
    // misdirection penalty.
    const blinked = blinkReturnedBindings(effects);
    for (const op of effects) {
        if (op.op === "exile" && op.bind && blinked.has(op.bind)) continue;
        // A script host carries no stake of its own; each nested Op is read
        // exactly like a top-level one (issue #4442 — a `divideIntoPiles`
        // pile names the host's announced slots too). A delayed / reflexive
        // trigger body is the exception: it announces its OWN targets when it
        // goes on the stack (CR 603.3d), so its `{ target: n }` is not this
        // script's slot `n` and signing it here would sign the wrong object.
        if (isTriggerBodyHost(op)) continue;
        const children = childOpArrays(op);
        if (children.length > 0) {
            for (const child of children) collectScriptSigns(child, signs);
            continue;
        }
        const split = SPLIT_SIGN_OPS[op.op];
        if (split !== undefined) {
            const bag = op as unknown as Record<string, unknown>;
            for (const [field, fieldSign] of Object.entries(split)) {
                const fieldSlots = new Set<number>();
                announcedSlotsIn(bag[field], fieldSlots);
                for (const slot of fieldSlots) {
                    signs.set(
                        slot,
                        mergeSign(signs.get(slot) ?? "neutral", fieldSign)
                    );
                }
            }
            continue;
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

/** Keywords whose grant is an attack on the permanent that receives them.
 *  CR 702.26a — phasing takes the host out of the game every other turn of its
 *  controller. */
const DRAWBACK_KEYWORDS: ReadonlySet<string> = new Set(["phasing"]);

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
                // A `computeFor` magnitude has no static sign (it reads the
                // board); it stays neutral, as the `pt-cda` it replaced did.
                if (effect.computeFor) break;
                const net = effect.power + effect.toughness;
                if (net !== 0)
                    sign = mergeSign(sign, net > 0 ? "beneficial" : "harmful");
                break;
            }
            case "keyword-grant":
                sign = mergeSign(
                    sign,
                    DRAWBACK_KEYWORDS.has(effect.keyword)
                        ? "harmful"
                        : "beneficial"
                );
                break;
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

/** The sign an Effect Script carries for the controller of whatever fills
 *  announced target slot `slot`. The one derivation both effect SITES share —
 *  a spell's `effects` and an `ActivatedAbility.effects` are the identical
 *  `EffectOp[]` shape (ADR 0045), so nothing but the source of the script
 *  differs between them. */
function scriptSlotSign(
    effects: readonly EffectOp[] | undefined,
    slot: number
): Beneficence {
    if (!effects) return "neutral";
    const signs = new Map<number, Beneficence>();
    collectScriptSigns(effects, signs);
    return signs.get(slot) ?? "neutral";
}

/** Where one announced target slot of a move is READ: the Effect Script that
 *  names it, the slot's index LOCAL to that script, and — for a cast only —
 *  the card whose Aura attachment payoff stands in when the script names no
 *  slot at all (CR 303.4). One resolution feeds every per-slot question this
 *  module answers (the sign, and since issue #9044 the cards a slot draws), so
 *  a mode span or a raised trigger's offset is mapped exactly once. */
interface SlotScript {
    readonly effects: readonly EffectOp[] | undefined;
    readonly slot: number;
    readonly auraHost?: CardDefinition;
}

/** The script a cast of `def` resolves under chosen mode `modeId`
 *  (CR 700.2c): the mode's own body, or the card's when no mode is named. */
function castScriptOf(
    def: CardDefinition,
    modeId: string | undefined
): readonly EffectOp[] | undefined {
    const mode = modeId ? def.modes?.find((m) => m.id === modeId) : undefined;
    return mode ? mode.effects : def.effects;
}

/** The sign a resolved slot carries for whoever fills it. */
function slotScriptSign(s: SlotScript): Beneficence {
    const scripted = scriptSlotSign(s.effects, s.slot);
    if (scripted !== "neutral") return scripted;
    // CR 303.4 — an Aura's single target slot IS its "enchant" slot.
    if (s.auraHost && s.slot === 0 && s.auraHost.subtypes?.includes("Aura")) {
        return auraAttachmentSign(s.auraHost);
    }
    return "neutral";
}

/** The sign of `def`'s effect on the controller of whatever fills announced
 *  target slot `slot`, under chosen mode `modeId` (CR 700.2c). */
export function targetSlotBeneficence(
    def: CardDefinition,
    modeId: string | undefined,
    slot: number
): Beneficence {
    return slotScriptSign({
        effects: castScriptOf(def, modeId),
        slot,
        auraHost: def,
    });
}

/** The sign of an ACTIVATED ability's effect on the controller of whatever
 *  fills its announced target slot `slot` (CR 602.2b). Same Op-keyed
 *  derivation, read off `ability.effects`. There is no aura fallback: an
 *  ability's payoff is its own script, never an attachment.
 *
 *  This is issue #1888 item 1's "uniformly to targets" clause reaching the
 *  other half of the announcement surface. Garruk Wildspeaker's `+1: Untap two
 *  target lands` is the live case — `tapUntap action: "untap"` is `beneficial`,
 *  the two target slots enumerate one sibling move per tuple, and every tuple
 *  ties inside `OUTCOME_EPS`, so without this the bot untaps the OPPONENT's
 *  lands on rollout noise. */
export function abilityTargetSlotBeneficence(
    ability: ActivatedAbility,
    slot: number
): Beneficence {
    return scriptSlotSign(ability.effects, slot);
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

/** The card definition behind `instanceId`, wherever the instance currently
 *  lives. An ability's source is normally a battlefield permanent, but the
 *  enumerator also activates abilities from the graveyard and the hand, and
 *  since issue #2971 CASTS a spell out of the graveyard or out of ANY player's
 *  exile — so every zone a Move can name is scanned. Undefined when the
 *  instance or its definition can't be resolved, which makes the caller fall
 *  back to "no opinion". */
function definitionOfInstance(
    state: GameState,
    instanceId: string
): CardDefinition | undefined {
    for (const p of state.players) {
        for (const zone of [p.battlefield, p.graveyard, p.hand, p.exile]) {
            const found = zone.find((c) => c.id === instanceId);
            if (found) {
                const id = (found.card as { id?: string } | undefined)?.id;
                return (id ? tryGetDefinition(id) : undefined) ?? undefined;
            }
        }
    }
    return undefined;
}

/** Per-slot script resolver for `move`'s announcement, or `undefined` when the
 *  move announces no targets or its source script can't be read. ONE seam for
 *  every site a target is chosen at — a cast (CR 601.2c), an activation
 *  (CR 602.2b), a raised trigger selection (CR 603.3d) — so a caller never has
 *  to know which kind it holds. A slot no span covers resolves to `undefined`
 *  (no opinion). Takes no `botId`: since issue #2971 BOTH announcement
 *  branches resolve the card through `definitionOfInstance`, which scans every
 *  player's zones — a cross-player exile grant means the card the bot is
 *  casting may not sit in any zone of its own. */
function slotScriptsFor(
    state: GameState,
    move: Move
): ((slot: number) => SlotScript | undefined) | undefined {
    if (move.kind === "cast-spell") {
        if (move.targets.length === 0) return undefined;
        // Issue #2971 review finding 3 — was `player.hand.find(...)`, which
        // resolves to `undefined` for every cast the graveyard and exile loops
        // now enumerate: the sign of each target slot then reads as "no
        // opinion" and `misdirectedTargetCount` returns 0, so a flashed-back
        // burn spell pointed at the bot's OWN face carried no penalty at all.
        // The `activate-ability` branch below already used the any-zone
        // resolver; both now do, which is what keeps a cast and an activation
        // of the same card scored the same way.
        const def = definitionOfInstance(state, move.cardInstanceId);
        if (!def) return undefined;
        // ADR 0094 — with several mode instances a flat slot belongs to the
        // instance whose span covers it (`modeTargetCounts`, stamped by the
        // enumerator, issue #2265), and reads THAT mode's script at its local
        // slot. No spans → no opinion rather than a guessed mapping.
        const chosen = move.chosenModeIds ?? [];
        if (chosen.length > 1) {
            const spans = move.modeTargetCounts;
            if (!spans || spans.length !== chosen.length) return undefined;
            return (slot) => {
                let offset = 0;
                for (const [i, span] of spans.entries()) {
                    if (slot < offset + span) {
                        return {
                            effects: castScriptOf(def, chosen[i]),
                            slot: slot - offset,
                            auraHost: def,
                        };
                    }
                    offset += span;
                }
                return undefined;
            };
        }
        const effects = castScriptOf(def, soleChosenModeId(move.chosenModeIds));
        return (slot) => ({ effects, slot, auraHost: def });
    }
    if (move.kind === "activate-ability") {
        if (move.targets.length === 0) return undefined;
        const def = definitionOfInstance(state, move.cardInstanceId);
        const ability = def?.activatedAbilities?.find(
            (a) => a.id === move.abilityId
        );
        if (!ability) return undefined;
        // A MODAL ability's scripts live on its modes (CR 700.2 / 602.2b):
        // read the chosen instance's own script at its local slot, exactly as
        // the cast branch does (issue #2265 review).
        const abilityModes = ability.modes;
        const chosenIds = move.chosenModeIds ?? [];
        if (abilityModes && abilityModes.length > 0 && chosenIds.length > 0) {
            const spans =
                chosenIds.length === 1
                    ? [move.targets.length]
                    : move.modeTargetCounts;
            if (!spans || spans.length !== chosenIds.length) return undefined;
            return (slot) => {
                let offset = 0;
                for (const [i, span] of spans.entries()) {
                    if (slot < offset + span) {
                        const mode = abilityModes.find(
                            (m) => m.id === chosenIds[i]
                        );
                        return { effects: mode?.effects, slot: slot - offset };
                    }
                    offset += span;
                }
                return undefined;
            };
        }
        return (slot) => ({ effects: ability.effects, slot });
    }
    if (move.kind === "submit-target") return raisedTriggerSlotScripts(state);
    return undefined;
}

/** Per-slot sign function for `move`'s announcement — `slotScriptsFor`'s
 *  resolution read through the sign derivation. */
function slotSignerFor(
    state: GameState,
    move: Move
): ((slot: number) => Beneficence) | undefined {
    const scriptOf = slotScriptsFor(state, move);
    if (!scriptOf) return undefined;
    return (slot) => {
        const s = scriptOf(slot);
        return s ? slotScriptSign(s) : "neutral";
    };
}

/** Per-slot script resolver for a `submit-target` answering a RAISED trigger
 *  target selection (CR 603.3d, issue #5496), or `undefined` for any other
 *  selection. Nobody announced the trigger, but its controller still chooses
 *  its targets, and the choice is the same question a cast's tuple answers:
 *  who is on the receiving end of the script. The script is the trigger's own
 *  (`findTriggeredAbility` — the printed-or-granted lookup resolution uses),
 *  or the announced mode's for a modal trigger (CR 700.2c). The submission's
 *  slot `i` is script slot `priorSelected + selected + i`: the stack item's
 *  `targets` are those three concatenated (`applyRaisedTargetFinalization`).
 *  A retarget / copy-retarget is a different question (whose script the new
 *  targets serve is the SPELL's, not a trigger's) and stays unranked. */
function raisedTriggerSlotScripts(
    state: GameState
): ((slot: number) => SlotScript) | undefined {
    const pt = state.pendingTarget;
    if (!pt || pt.kind !== "trigger") return undefined;
    const item = state.stack.find((s) => s.id === pt.cardInstanceId);
    if (!item?.triggeredAbilityId) return undefined;
    const ability = findTriggeredAbility(item, item.triggeredAbilityId);
    if (!ability) return undefined;
    let effects = ability.effects;
    let offset = (pt.priorSelected?.length ?? 0) + pt.selected.length;
    if (ability.modes && ability.modes.length > 0) {
        // ADR 0094 — with several instances the group being answered belongs
        // to one of them, whose script reads the slots from its OWN first pick.
        const instance = pt.groupModeInstances?.[0] ?? 0;
        const modeId = item.chosenModeIds?.[instance];
        effects = ability.modes.find((m) => m.id === modeId)?.effects;
        if (pt.modeTargetCounts) {
            offset = (pt.modeTargetCounts[instance] ?? 0) + pt.selected.length;
        }
    }
    return (slot) => ({ effects, slot: offset + slot });
}

/** The targets `move` names, for the move kinds whose targets carry a slot
 *  sign: a cast, an activation, a raised-target submission. */
function signedTargetsOf(move: Move): readonly TargetSelection[] {
    return move.kind === "cast-spell" ||
        move.kind === "activate-ability" ||
        move.kind === "submit-target"
        ? move.targets
        : [];
}

/** How many of `move`'s announced targets are MISDIRECTED for `botId` — a
 *  beneficial slot pointed at the OPPONENT, or a harmful one pointed at the
 *  bot's own side. 0 for a move that announces no targets, and for any slot the
 *  derivation has no opinion about.
 *
 *  Covers BOTH announcement sites (PR #1914 review finding 3): a cast
 *  (CR 601.2c) and an activated ability (CR 602.2b). The two reads are
 *  identical — `move.targets` plus an `EffectOp[]` — so narrowing to casts left
 *  every activated ability's targets unranked, Garruk Wildspeaker's "untap two
 *  target lands" among them.
 *
 *  A COUNT rather than a boolean so a multi-target spell that misdirects two
 *  slots ranks below one that misdirects one — the ranking in `search.ts` is a
 *  preference among sibling variants, never a legality change. */
export function misdirectedTargetCount(
    state: GameState,
    move: Move,
    botId: string
): number {
    const signOf = slotSignerFor(state, move);
    if (!signOf) return 0;
    const targets = signedTargetsOf(move);

    let count = 0;
    for (let slot = 0; slot < targets.length; slot++) {
        const sign = signOf(slot);
        if (sign === "neutral") continue;
        const recipient = recipientOf(state, targets[slot]);
        if (recipient === undefined) continue;
        const mine = recipient === botId;
        if (sign === "beneficial" ? !mine : mine) count++;
    }
    return count;
}

/** Cards the script draws for whoever fills announced slot `slot`: the sum of
 *  every `draw` whose player is that slot, `chosenX` standing in for an X
 *  count. `undefined` when one of those counts is not a literal or an X this
 *  move announces — the derivation cannot tell how many cards move. A draw in
 *  a delayed / reflexive trigger body names the trigger's OWN slots (CR
 *  603.3d), never this script's, and is skipped as `collectScriptSigns` skips
 *  it. */
function slotDrawCount(
    effects: readonly EffectOp[] | undefined,
    slot: number,
    chosenX: number | undefined
): number | undefined {
    let total = 0;
    for (const op of effects ?? []) {
        if (isTriggerBodyHost(op)) continue;
        const children = childOpArrays(op);
        if (children.length > 0) {
            for (const child of children) {
                const n = slotDrawCount(child, slot, chosenX);
                if (n === undefined) return undefined;
                total += n;
            }
            continue;
        }
        if (op.op !== "draw") continue;
        const player = op.player;
        if (typeof player !== "object" || !("target" in player)) continue;
        if (player.target !== slot) continue;
        const count = op.count;
        if (typeof count === "number") total += count;
        else if ("X" in count && chosenX !== undefined) total += chosenX;
        else return undefined;
    }
    return total;
}

/** How many of `move`'s announced PLAYER slots hand a pure gift to a player
 *  other than `botId` — a slot its script signs `beneficial` (a draw, a life
 *  gain, a player counter of a beneficial kind; `OP_BENEFICENCE`) pointed at
 *  the opponent's face (issue #9044). Stricter than `misdirectedTargetCount`
 *  on purpose: `selectRootMove` reads it as a GUARD, not a preference, so
 *  every ambiguity steps aside and the move counts 0:
 *
 *  - a permanent slot never counts — what a gift to a permanent is worth
 *    depends on the board, which the resolved margin reads;
 *  - a punisher slot ("target player draws two and loses two life") never
 *    counts — its signs disagree and `mergeSign` reads it `neutral`;
 *  - **decking**: a slot whose draws empty the recipient's library — at least
 *    one card drawn and no more cards left than it draws (CR 121.4: the next
 *    draw from the empty library loses the game, CR 704.5b) — is the winning
 *    play, not a gift, and never counts; nor does a slot whose draw count the
 *    derivation cannot read, since it cannot rule decking out. */
export function misdirectedPlayerGiftCount(
    state: GameState,
    move: Move,
    botId: string
): number {
    const scriptOf = slotScriptsFor(state, move);
    if (!scriptOf) return 0;
    const targets = signedTargetsOf(move);
    const chosenX =
        move.kind === "cast-spell" || move.kind === "activate-ability"
            ? move.chosenX
            : undefined;

    let count = 0;
    for (const [slot, target] of targets.entries()) {
        if (target.type !== "player" || target.id === botId) continue;
        const s = scriptOf(slot);
        if (!s || slotScriptSign(s) !== "beneficial") continue;
        const draws = slotDrawCount(s.effects, s.slot, chosenX);
        if (draws === undefined) continue;
        const library = state.players.find((p) => p.id === target.id)?.library;
        if (!library) continue;
        if (draws > 0 && library.length <= draws) continue;
        count++;
    }
    return count;
}

/** Is EVERY target `move` announces a slot its script signs `beneficial` — a
 *  boon the caster points at whatever it likes? False for a move that announces
 *  no targets, and for any slot the derivation has no opinion about, so a
 *  script the sign table cannot read never reads as a boon. The material
 *  margin cannot price a boon that lasts a turn (a keyword granted until end
 *  of turn is worth the card and the mana it costs, on the board alone), so a
 *  hold keyed on that margin asks this first. */
export function boonsEveryTarget(state: GameState, move: Move): boolean {
    const signOf = slotSignerFor(state, move);
    if (!signOf) return false;
    const targets = signedTargetsOf(move);
    return (
        targets.length > 0 &&
        targets.every((_, slot) => signOf(slot) === "beneficial")
    );
}
