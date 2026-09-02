/**
 * Lowering: spell IR → the CARD-level fields of a `CompiledDefinition`
 * (CR 113.3a, ADR 0045).
 *
 * The counterpart of `lowerActivated.ts` / `lowerTriggered.ts`, and the one
 * that writes onto the definition itself rather than into an ability: an
 * instant or sorcery has no permanent to hang anything on, so its body is
 * `effects[]`, its announced target is `targetRequirement`, its modes are
 * `modes[]`, its cast-time costs are `additionalCosts`, and its graveyard-cast
 * permission is `flashback`.
 *
 * ── Where the narrowing happens ────────────────────────────────────────────
 *
 * The GRAMMAR reads more than the engine can encode, deliberately: the shared
 * cost sub-grammar reads every cost atom an activation cost may carry, because
 * CR 118.1 draws no distinction between the costs a spell and an ability may
 * have. `CardDefinition.additionalCosts` and `FlashbackCost` carry a strictly
 * narrower vocabulary than `ActivatedAbility["cost"]` does. So this file is
 * where the two meet, and it meets them by REFUSING — an atom with no field to
 * land in fails the card. A dropped cost atom makes an unpayable spell
 * castable, which `shared/cost.ts` calls out as the unbounded failure: it is
 * no less unbounded for happening at a cast site instead of an activation one.
 */

import type {
    CardDefinition,
    EffectOp,
    SpellMode,
    TargetRequirement,
} from "../cards/types";
import type { CostAtomIR } from "./grammar/shared/cost";
import type { FlashbackCostIR, SpellModeIR } from "./grammar/ir";
import type { EffectSentenceIR } from "./grammar/shared/effectClause";
import {
    declareTargets,
    lowerSentence,
    TargetSlots,
    type SiteOptions,
} from "./lowerEffects";

export type LowerSpellResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly reason: string };

/** What a spell's own site declares, as a card-level slice. */
export interface LoweredSpellBody {
    readonly effects: EffectOp[];
    readonly targetRequirement?: TargetRequirement;
}

/**
 * One sentence list → an Effect Script plus the target it announced.
 *
 * A spell and a MODE of a spell are the same site in every respect that
 * matters here (CR 700.2d — only the chosen mode's targets are announced), so
 * both go through this one walk and each gets its own `TargetSlots`: a mode's
 * `{ target: 0 }` indexes that MODE's requirement, never a sibling's.
 */
function lowerBody(
    effects: readonly EffectSentenceIR[],
    site: SiteOptions
): LowerSpellResult<LoweredSpellBody> {
    const slots = new TargetSlots();
    const ops: EffectOp[] = [];
    for (const sentence of effects) {
        const lowered = lowerSentence(sentence, slots, site);
        if (!lowered.ok) return { ok: false, reason: lowered.reason };
        ops.push(...lowered.value);
    }
    const body: { effects: EffectOp[]; targetRequirement?: TargetRequirement } =
        { effects: ops };
    const error = declareTargets(body, slots.requirements());
    if (error !== null) return { ok: false, reason: error };
    return { ok: true, value: body };
}

export function lowerSpellBody(
    effects: readonly EffectSentenceIR[],
    site: SiteOptions
): LowerSpellResult<LoweredSpellBody> {
    return lowerBody(effects, site);
}

/**
 * CR 700.2 — the mode list.
 *
 * `id` is derived from the card name and the mode's ORDINAL, matching the
 * `<card>-ability` / `<card>-trigger` shape the rest of the compiler emits.
 * It is deliberately not slugged from the bullet's own words: two modes of one
 * spell can differ only in a filter ("Destroy target artifact" / "Destroy
 * target enchantment" collide on nothing, but "Target creature gets +1/+0" and
 * "Target creature gets +0/+1" slug identically), and a colliding `id` is a
 * mode the engine cannot dispatch — `ModeOption.id` must be unique within
 * `modes`.
 */
export function lowerSpellModes(
    modes: readonly SpellModeIR[],
    cardSlug: string,
    site: SiteOptions
): LowerSpellResult<SpellMode[]> {
    const out: SpellMode[] = [];
    for (const [index, mode] of modes.entries()) {
        const body = lowerBody(mode.effects, site);
        if (!body.ok) return body;
        const lowered: SpellMode = {
            id: `${cardSlug}-mode-${index + 1}`,
            // Both are DISPLAY strings and both are the bullet as printed: the
            // compiler has no shorter phrasing to offer a picker than the words
            // the card itself uses, and inventing one would be a claim about
            // the card that the Oracle text does not make.
            label: mode.text,
            oracleText: `${mode.text}.`,
            effects: body.value.effects,
        };
        if (body.value.targetRequirement !== undefined)
            lowered.targetRequirement = body.value.targetRequirement;
        out.push(lowered);
    }
    return { ok: true, value: out };
}

type AdditionalCosts = NonNullable<CardDefinition["additionalCosts"]>;

/**
 * CR 601.2f / 118.8 — cost atoms → `additionalCosts`.
 *
 * The narrowing this file's header describes, atom by atom. Four of the ten
 * atoms the shared cost grammar reads have a field here; the rest have none,
 * and are refused rather than dropped:
 *
 *   - `tap` / `sacrifice-self` — CR 601.2a puts the card on the STACK before
 *     its costs are paid, so there is no permanent to tap and none to
 *     sacrifice. These are not missing fields; they are unpayable.
 *   - `discard-at-random`, `remove-counter`, `exile-from-graveyard`,
 *     `exile-self` — printed shapes with no `additionalCosts` field today.
 *   - `mana` — an additional MANA cost is folded into the printed mana cost by
 *     the engine's cast path, and no card prints one on this line.
 *
 * `discard X cards` (Sickening Dreams, 10 cards) is refused one level up, by
 * the `count` type: `additionalCosts.discard.count` is a `number`, so a
 * variable discard has no encoding at all — see the PR for issue #2699.
 */
export function lowerAdditionalCosts(
    atoms: readonly CostAtomIR[]
): LowerSpellResult<AdditionalCosts> {
    const costs: AdditionalCosts = {};
    for (const atom of atoms) {
        switch (atom.kind) {
            case "sacrifice-other":
                // CR 118.5 — `sacrificeFilter` sacrifices exactly one matching
                // permanent; there is no count beside it, so "sacrifice two
                // creatures" has no encoding.
                if (atom.count !== 1)
                    return {
                        ok: false,
                        reason: "an additional cost sacrificing more than one permanent has no encoding (CR 118.5)",
                    };
                costs.sacrificeFilter = atom.filter;
                break;
            case "pay-life":
                costs.payLife = atom.amount;
                break;
            case "discard":
                costs.discard = { filter: atom.filter, count: atom.count };
                break;
            default:
                return {
                    ok: false,
                    reason: `"${atom.kind}" is not an additional cost this grammar can encode (CR 601.2f)`,
                };
        }
    }
    return { ok: true, value: costs };
}

/** CR 702.34a — the flashback IR onto `CardDefinition.flashback`. */
export function lowerFlashback(
    cost: FlashbackCostIR
): LowerSpellResult<NonNullable<CardDefinition["flashback"]>> {
    // The engine normalizes both shapes (`gre/flashback.ts`), and the
    // catalogue writes the mana-only case as a bare `ManaCost` (Firebolt's
    // `flashback: { X: 4, R: 1 }`). Emitting the same shape keeps a compiled
    // row reading like the cards beside it.
    if (cost.sacrifice === undefined) {
        if (cost.mana === undefined)
            return { ok: false, reason: "a flashback cost with no components" };
        return { ok: true, value: cost.mana };
    }
    const full: { mana?: typeof cost.mana; sacrifice: typeof cost.sacrifice } =
        { sacrifice: cost.sacrifice };
    if (cost.mana !== undefined) full.mana = cost.mana;
    return { ok: true, value: full };
}
