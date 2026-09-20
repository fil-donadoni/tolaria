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
    KickerCost,
    SpellMode,
    TargetRequirement,
} from "../cards/types";
import type { CostAtomIR } from "./grammar/shared/cost";
import { SELF_MARKER } from "./normalize";
import type { FlashbackCostIR, KickerIR, SpellModeIR } from "./grammar/ir";
import type { EffectSentenceIR } from "./grammar/shared/effectClause";
import {
    declareTargets,
    lowerSentence,
    SentenceWalk,
    type SiteOptions,
} from "./lowerEffects";

export type LowerSpellResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly reason: string };

/** What a spell's own site declares, as a card-level slice. */
export interface LoweredSpellBody {
    readonly effects: EffectOp[];
    readonly targetRequirement?: TargetRequirement;
    /**
     * CR 115.3 — the announcement's SECOND and later instances of the word
     * "target" ("Target creature gets +2/+2 … Another target creature gets
     * -2/-2"), each an independent group chosen after the one before it.
     */
    readonly additionalTargetRequirements?: TargetRequirement[];
    /**
     * CR 702.33g — the announcement the spell makes INSTEAD when it was
     * kicked ("Destroy target land. If this spell was kicked, destroy another
     * target land."). See `TargetSlots.foldKickerGatedTargets`, which chooses
     * between this and the gated-GROUP encoding
     * (`TargetRequirement.announcedOnlyIfKicked`, issue #4220).
     */
    readonly kickedTargetRequirement?: TargetRequirement;
}

/**
 * One sentence list → an Effect Script plus the target it announced.
 *
 * A spell and a MODE of a spell are the same site in every respect that
 * matters here (CR 700.2c — only the chosen mode's targets are announced), so
 * both go through this one walk and each gets its own `SentenceWalk`: a mode's
 * `{ target: 0 }` indexes that MODE's requirement, never a sibling's.
 */
function lowerBody(
    effects: readonly EffectSentenceIR[],
    site: SiteOptions
): LowerSpellResult<LoweredSpellBody> {
    const walk = new SentenceWalk();
    const ops: EffectOp[] = [];
    for (const sentence of effects) {
        const lowered = lowerSentence(sentence, walk, site);
        if (!lowered.ok) return { ok: false, reason: lowered.reason };
        ops.push(...lowered.value);
    }
    const body: {
        effects: EffectOp[];
        targetRequirement?: TargetRequirement;
        additionalTargetRequirements?: TargetRequirement[];
        kickedTargetRequirement?: TargetRequirement;
    } = { effects: ops };
    const kicked = walk.targets.kickedRequirement();
    if (kicked !== undefined) body.kickedTargetRequirement = kicked;
    // CR 702.33g (issue #4220) — a mode's body is lowered through this same
    // walk, and `lowerSpellModes` refuses either kicked encoding there (a
    // `SpellMode` has no `kickedTargetRequirement`, and `announceCast` filters
    // only the CARD-level group list). Nothing to do on the card's own body:
    // `declareTargets` already routes a gated group onto
    // `additionalTargetRequirements`, never onto `targetRequirement`.
    // CR 601.2c — a spell (and each of its modes) writes its groups onto
    // `targetRequirement` + `additionalTargetRequirements`, the pair the
    // cast-time target walk reads as one flat announcement.
    const error = declareTargets(body, walk.targets.requirements(), true);
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
    card: { readonly slug: string; readonly name: string },
    site: SiteOptions
): LowerSpellResult<SpellMode[]> {
    const out: SpellMode[] = [];
    for (const [index, mode] of modes.entries()) {
        const body = lowerBody(mode.effects, site);
        if (!body.ok) return body;
        // CR 702.33g — `SpellMode` has no `kickedTargetRequirement`, so a
        // mode that folded one would declare fewer slots than its own ops
        // reference. UNREACHABLE today (the modal slot refuses a kicked
        // sentence inside a bullet) and kept as the third of the three site
        // refusals `lowerActivated.ts` and `lowerTriggered.ts` already carry.
        if (body.value.kickedTargetRequirement !== undefined)
            return {
                ok: false,
                reason: "a mode cannot swap in a kicked target announcement (CR 702.33g)",
            };
        // CR 702.33g (issue #4220) — the gated-GROUP encoding, refused at the
        // mode site for the mirror reason: `announceCast` filters the group
        // list it built from the CARD (or from the chosen mode), and a modal
        // cast reaching the multi-instance path (ADR 0094) does not filter at
        // all — so a gated group inside a bullet would be announced on an
        // unkicked cast. Unreachable today (the modal slot refuses a kicked
        // sentence inside a bullet), kept as the line that stays right.
        if (
            body.value.additionalTargetRequirements?.some(
                (r) => r.announcedOnlyIfKicked
            ) === true ||
            body.value.targetRequirement?.announcedOnlyIfKicked === true
        )
            return {
                ok: false,
                reason: "a mode cannot announce a target only if kicked (CR 702.33g)",
            };
        // CR 201.5 — `normalize.ts` replaced the card's own name with
        // `SELF_MARKER` so the GRAMMAR could bind a REFERENT rather than a
        // string. These two fields are the only compiler output a PLAYER ever
        // reads (`ModeOption.label` is the mode picker's row, `oracleText` the
        // stack-item display and the rule-trace line), so the marker has to
        // come back out: "{self} deals 5 damage to target creature" is never
        // valid output, and it shipped on 18 of 34 modal rows until the review
        // of PR #3044 caught it — the gold harness structurally cannot, since
        // both fields are display keys it excludes.
        const printed = mode.text.split(SELF_MARKER).join(card.name);
        const lowered: SpellMode = {
            id: `${card.slug}-mode-${index + 1}`,
            // Both are DISPLAY strings and both are the bullet as printed: the
            // compiler has no shorter phrasing to offer a picker than the words
            // the card itself uses, and inventing one would be a claim about
            // the card that the Oracle text does not make.
            label: printed,
            oracleText: `${printed}.`,
            effects: body.value.effects,
        };
        if (body.value.targetRequirement !== undefined)
            lowered.targetRequirement = body.value.targetRequirement;
        if (body.value.additionalTargetRequirements !== undefined)
            lowered.additionalTargetRequirements =
                body.value.additionalTargetRequirements;
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
 * `discard X cards` (Sickening Dreams, 10 cards) never reaches this function
 * at all: the cost GRAMMAR refuses it, because `splitCount` reads its count
 * word through `readNumberWord`, which has no `X`. That is now the ONLY thing
 * refusing it — issue #2714 widened `additionalCosts.discard.count` to
 * `number | "X"`, so the encoding the finding said was missing exists and
 * Sickening Dreams ships hand-written against it. Teaching `readNumberWord`
 * the `X` case (and lowering it to `count: "X"`) is what would let the
 * compiler read the line. See docs/findings/2699-spell-slot-gaps.md.
 */
export function lowerAdditionalCosts(
    atoms: readonly CostAtomIR[]
): LowerSpellResult<AdditionalCosts> {
    const costs: AdditionalCosts = {};
    for (const atom of atoms) {
        switch (atom.kind) {
            case "sacrifice-other":
                // CR 701.21a — `sacrificeFilter` sacrifices exactly one matching
                // permanent; there is no count beside it, so "sacrifice two
                // creatures" has no encoding.
                if (atom.count !== 1)
                    return {
                        ok: false,
                        reason: "an additional cost sacrificing more than one permanent has no encoding (CR 701.21a)",
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

/** CR 105.1 — the five colours, in WUBRG order, as a kicker id names them. */
const KICKER_ID_COLORS = ["W", "U", "B", "R", "G"] as const;

/**
 * CR 702.33a / 702.33b — the kicker line's costs onto `CardDefinition.kickers`.
 *
 * The one thing lowering adds is the `id`, the key of the per-kicker payment
 * record (`StackItem.kickerPayments`) and of `{ additionalCostPaid }`. It is
 * the catalogue's own convention, so a compiled row reads like the cards
 * beside it: a lone kicker is `"kicker"`; each of an "and/or" pair is named
 * for the COLOURS of its cost (`"kicker-u"` for {2}{U}, Nightscape
 * Battlemage). Two costs that share a colour set — or a colourless one —
 * would collide on that name, so the card fails rather than inventing a
 * second naming scheme no hand-written card uses.
 */
export function lowerKickers(
    kickers: readonly KickerIR[]
): LowerSpellResult<KickerCost[]> {
    const out: KickerCost[] = [];
    for (const kicker of kickers) {
        let id = "kicker";
        if (kickers.length > 1) {
            const colors = KICKER_ID_COLORS.filter(
                (c) => kicker.mana?.[c] !== undefined
            );
            if (colors.length === 0)
                return {
                    ok: false,
                    reason: "a colourless cost in a kicker pair has no id under the catalogue's colour-named convention",
                };
            id = `kicker-${colors.join("").toLowerCase()}`;
            if (out.some((k) => k.id === id))
                return {
                    ok: false,
                    reason: `two kicker costs both named "${id}" under the catalogue's colour-named convention`,
                };
        }
        const cost: KickerCost = { id, description: kicker.description };
        if (kicker.mana !== undefined) cost.mana = kicker.mana;
        if (kicker.life !== undefined) cost.life = kicker.life;
        if (kicker.sacrifice !== undefined)
            cost.permanent = {
                action: "sacrifice",
                filter: kicker.sacrifice.filter,
                count: kicker.sacrifice.count,
            };
        if (kicker.multi) cost.multi = true;
        out.push(cost);
    }
    return { ok: true, value: out };
}
