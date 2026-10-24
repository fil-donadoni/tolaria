/**
 * Lowering: static-clause IR → the `CardDefinition` fields a continuous static
 * ability lives in (CR 113.3d, ADR 0045 / ADR 0105).
 *
 * There are five destinations, and which one a clause takes is a statement
 * about the ENGINE, not about the sentence — which is why this file exists
 * rather than the clause carrying its own encoding:
 *
 *  - `compiledStaticEffects[]` — a real CR 611 continuous effect, emitted as a
 *    JSON descriptor because every `StaticEffect` kind carries a predicate
 *    closure (`cards/compiledStatics.ts`);
 *  - `entersTapped` / `entersWith` — a CR 614.1c self-replacement. NOT a
 *    continuous effect and deliberately not modelled as one: it is applied as
 *    the permanent enters, before the first layer read, and the catalogue-wide
 *    guard `cards/__tests__/entersWithCounters.test.ts` reds on the trigger-
 *    shaped alternative;
 *  - `drawStepReplacement` — CR 614.10, an unconditional skip of the
 *    turn-based draw: a per-card flag `gre/phases.ts` reads live, exactly as
 *    the hand-written Necropotence / Solitary Confinement declare it (it
 *    suppresses the draw, not the step — see the frame in `staticClause.ts`);
 *  - `shuffleFromAnywhere` — CR 614.1a, the self-referential "shuffle it into
 *    its owner's library instead" replacement: a JSON-pure flag
 *    `expandDefinition` rebuilds into the hand-written catalogue's
 *    `replacementEffects[]` entry (a replacement is a closure);
 *  - `damagePreventionCounterRemoval` — CR 615, the self "prevent that damage.
 *    Remove a +1/+1 counter" shield: the same JSON-pure-flag-for-a-closure
 *    shape, rebuilt by `expandDefinition` into two `replacementEffects[]`
 *    entries;
 *  - `staticAbilities[]` — the `does-not-untap` marker, which the untap step
 *    reads directly (`gre/phases.ts`). A filtered `untap-restriction` static
 *    would be the wrong encoding for a permanent talking about itself; the
 *    marker is what the hand-written catalogue writes (Island Fish Jasconius,
 *    Basalt Monolith).
 *
 * Nothing here allocates a target slot: a static ability targets nothing
 * (CR 115.1 — only spells and abilities that say "target" do), so there is no
 * `TargetSlots` walk and no one-target ceiling to pay.
 */

import { expandAnnihilator } from "../cards/abilities/annihilator";
import { expandFadingVanishing } from "../cards/abilities/fadingVanishing";
import { expandHideaway } from "../cards/abilities/hideaway";
import { expandKeywordTriggers } from "../cards/abilities/keywordTriggers";
import {
    MATERIALISED_FILTER_FIELDS,
    type CompiledStaticEffect,
} from "../cards/compiledStatics";
import type { CompiledTriggeredAbility } from "../cards/compiledTriggers";
import { PERMANENT_TYPES } from "../cards/types";
import type { PermanentFilter } from "../cards/filters";
import type {
    AsEntersChoice,
    CardDefinition,
    KickerCost,
} from "../cards/types";
import { kickedValue } from "./lowerEffects";
import { deriveCastPermissionId } from "./castPermissionId";
import type { EffectSentenceIR } from "./grammar/shared/effectClause";
import type {
    HostNoun,
    QuotedAbilityIR,
    StaticClauseIR,
} from "./grammar/shared/staticClause";

/** Where one lowered static clause lands. All fields are optional and merged. */
export interface LoweredStatic {
    readonly effects?: readonly CompiledStaticEffect[];
    /** CR 702.1 — keywords this clause GRANTS, censused like printed ones. */
    readonly grantedKeywords?: readonly {
        readonly ability: string;
        readonly implemented: boolean;
    }[];
    /**
     * CR 303.4b — the noun "enchanted" was printed with. Present only on a
     * host clause; `lower.ts` checks it against the card's enchant line,
     * which this per-line lowering cannot see.
     */
    readonly host?: HostNoun;
    /**
     * CR 113.1a — abilities granted in quotation marks, still as IR: they
     * are lowered by `lower.ts` through the same functions a printed ability
     * goes through, onto `grantTemplates[]` under `id` — the id the
     * `activated-grant` descriptor in `effects` names.
     */
    readonly quotedAbilities?: readonly {
        readonly id: string;
        readonly text: string;
        readonly ability: QuotedAbilityIR;
    }[];
    /** CR 702.16n — "This effect doesn't remove this Aura." */
    readonly exemptFromProtectionDetach?: true;
    readonly entersTapped?: true;
    /** CR 614.10 — "Skip your draw step". */
    readonly drawStepReplacement?: true;
    /**
     * CR 614.1a — "instead you may skip that draw. If you do, <body>": still
     * IR, because the body is lowered by `lower.ts` into the card's own DRAW
     * trigger (it needs the card's name and the trigger lowering).
     */
    readonly optionalDrawSkip?: {
        readonly effects: readonly EffectSentenceIR[];
    };
    /** CR 305.2 — additional land plays each turn. */
    readonly extraLandDrops?: number;
    /** CR 401.5 — the controller plays with their library top revealed. */
    readonly revealsLibraryTop?: "controller";

    /** CR 614.1a — the "instead" cost an entering permanent pays (discard a
     *  card, sacrifice a permanent), as the `entersWith.asEnters` member. */
    readonly asEntersCost?: AsEntersCost;
    /** CR 614.1a — the self-shuffle replacement. */
    readonly shuffleFromAnywhere?: true;
    /** CR 702.8a — "You may cast this spell as though it had flash." */
    readonly castAsThoughFlash?: true;
    /** CR 603.7a — triggered abilities the clause arms, as descriptors. */
    readonly triggeredAbilities?: readonly CompiledTriggeredAbility[];
    /** CR 615 — "prevent that damage. Remove a +1/+1 counter". */
    readonly damagePreventionCounterRemoval?: true;
    /** CR 615 — "Prevent all damage that would be dealt to you". */
    readonly preventsDamageToController?: true;
    readonly entersWithCounters?: {
        readonly type: string;
        readonly count: number;
    };
    /** CR 614.12a / 205.3m — "As this enters, choose a creature type". */
    readonly asEntersCreatureType?: true;
    /** CR 614.12a / 201.4a — "As this enters, choose a nonland card name". */
    readonly asEntersNonlandCardName?: true;
    /** CR 601.3a — the lowered clause reads the card's `chosenName`;
     *  `lower.ts` checks the card also declares the as-enters choice. */
    readonly readsChosenName?: true;
    /** CR 607.2d — the lowered clause reads the card's `chosenSubtypes`;
     *  `lower.ts` checks the card also declares the as-enters type choice. */
    readonly readsChosenType?: true;
    /** CR 604.3 / 208.2 — the clause is the card's `*` power and toughness
     *  definition; `lower.ts` reads a printed star power and toughness as base 0 only then. */
    readonly definesPowerToughness?: true;
    /**
     * CR 614.1c / 702.33e — kicker-counted entry counters, one `"kicker"`
     * entry per printed counter: `entersWith` SUMS same-type entries, and
     * `count: "kicker"` reads the times-kicked tally, so N entries is N
     * counters per kick (the catalogue's own encoding — Duskwalker, Llanowar
     * Elite). `per` is kept for `lower.ts`, which owns the card-level check
     * that a "kicked" rider reads a lone single kicker.
     */
    readonly kickerCounters?: {
        readonly counters: readonly {
            readonly type: string;
            readonly count: "kicker" | { readonly additionalCostPaid: string };
        }[];
        readonly per: "kicked" | "each-kick";
        /** CR 702.33f — the one kicker a "with its {A} kicker" rider reads;
         *  absent when the rider reads the tally. */
        readonly kickerId?: string;
    };
    readonly staticAbility?: string;
    /** CR 702.1 — granted, but only ever implemented for a PRINTED keyword. */
    readonly ungrantableKeywords?: readonly string[];
}

/** The as-enters members that are a COST the entering permanent pays (or,
 *  for the graveyard exile, a pile it takes: CR 614.12a). */
export type AsEntersCost = Extract<
    AsEntersChoice,
    { kind: "discard" | "sacrifice" | "exileFromGraveyard" }
>;

export type LowerStaticResult =
    | { readonly ok: true; readonly lowered: LoweredStatic }
    | { readonly ok: false; readonly reason: string };

/**
 * CR 502.3 — the engine-internal marker for "doesn't untap during your untap
 * step", read by the untap step in `gre/phases.ts`. Named from the Mechanics
 * Registry row id (`ENGINE_INTERNAL_MARKERS`, `cards/mechanicsRegistry.ts`)
 * rather than spelled inline at the call site.
 */
const DOES_NOT_UNTAP_MARKER = "does-not-untap";

/**
 * Is this keyword implemented by DEFINITION-LEVEL EXPANSION rather than by an
 * instance-level `staticAbilities` read?
 *
 * A `keyword-grant` writes its keyword onto the TARGET INSTANCE's
 * `staticAbilities` (`beginApplyingStaticEffects`, `gre/state.ts`). That is
 * enough for a keyword the engine honours by reading that array —
 * `haste`, `flying`, `lifelink`. It is NOT enough for one whose implementation
 * is an ADR 0054 expander: `expandKeywordTriggers` reads
 * `def.staticAbilities` off the DEFINITION and injects a triggered ability
 * there (CR 702.83a exalted, CR 702.108a prowess), and trigger collection
 * reads the definition's `triggeredAbilities`, never the instance's keyword
 * list. Granting `exalted` therefore produces no trigger at all: First Sliver's
 * Chosen ("Sliver creatures you control have exalted") would ship `ready` and
 * do nothing.
 *
 * The registry's `status: "implemented"` cannot answer this — it is a claim
 * about the PRINTED keyword, and reading it as a claim about the GRANTED one
 * is the actual defect. So the question is asked of the expanders themselves:
 * run the ADR 0054 chain over a synthetic definition carrying only this
 * keyword and see whether anything was injected. Derived, not hand-listed, so
 * a keyword that becomes expander-backed later cannot silently start shipping
 * inert grants.
 */
export function isDefinitionLevelKeyword(keyword: string): boolean {
    const bare: CardDefinition = {
        id: "oracle-grant-probe",
        rarity: "common",
        name: "Grant probe",
        types: ["Creature"],
        power: 1,
        toughness: 1,
        staticAbilities: [keyword],
    };
    // The keyword expanders from `expandDefinition`'s chain (`cards/registry.ts`)
    // that key off `staticAbilities`. `expandChapterAbilities` is deliberately
    // absent: it reads `chapterAbilities`, not a keyword, so no grant can reach
    // it. Each returns its INPUT unchanged when its keyword is absent, which is
    // what makes identity the honest test.
    const expanded = expandAnnihilator(
        expandHideaway(expandFadingVanishing(expandKeywordTriggers(bare)))
    );
    return expanded !== bare;
}

/**
 * A one-member `types` / `subtypes` array spelled as the bare string the
 * hand-written catalogue writes (`{ types: "Land", subtypes: "Island" }`).
 * `PermanentFilter` reads both identically; the spelling is kept so a compiled
 * lock and a hand-written one are the same object to the gold harness.
 */
function catalogueSpelling(filter: PermanentFilter): PermanentFilter {
    const out: Record<string, unknown> = { ...filter };
    for (const field of ["types", "subtypes"] as const) {
        const value = out[field];
        if (Array.isArray(value) && value.length === 1) out[field] = value[0];
    }
    return out as PermanentFilter;
}

/**
 * @param oracleText the whole static LINE, full stop included. The
 * `cast-permission` kind needs it because the sentence is what the caster
 * reads on the cast option itself (`AlternativeCost.description`,
 * `gre/castPermissions.ts`), so it is behaviour-adjacent text rather than a
 * label lowering could synthesise.
 * @param nextId a card-unique id for an object this clause names — a granted
 * ability's template, a combat restriction. Minted by `lower.ts`, which is
 * the only place that knows what the card has already claimed.
 */
export function lowerStaticClause(
    clause: StaticClauseIR,
    oracleText: string,
    nextId: (suffix: string) => string,
    /** CR 702.33a — the card's kicker costs, ids assigned (`lowerKickers`),
     *  for a line that reads one back. Empty on a card with no kicker. */
    kickers: readonly KickerCost[] = []
): LowerStaticResult {
    switch (clause.kind) {
        case "pt-buff":
            return {
                ok: true,
                lowered: {
                    effects: [
                        {
                            kind: "pt-buff",
                            filter: clause.filter,
                            power: clause.power,
                            toughness: clause.toughness,
                        },
                    ],
                },
            };
        case "self-pt-buff-conditional": {
            const { condition } = clause;
            // CR 611.3a — a graveyard count needs no filter to be readable.
            if (condition.kind === "graveyard-count")
                return {
                    ok: true,
                    lowered: {
                        effects: [
                            {
                                kind: "pt-buff",
                                appliesTo: "self",
                                power: clause.power,
                                toughness: clause.toughness,
                                condition: {
                                    kind: "graveyard-count",
                                    atLeast: condition.atLeast,
                                },
                            },
                        ],
                    },
                };
            // CR 611.3a — the condition is read off the LAYER view, so its
            // filter may only name fields that view can answer.
            const unreadable = Object.keys(condition.filter).find(
                (field) => !MATERIALISED_FILTER_FIELDS.has(field)
            );
            if (unreadable !== undefined)
                return {
                    ok: false,
                    reason: `a "${unreadable}" clause cannot be read by a static condition`,
                };
            return {
                ok: true,
                lowered: {
                    effects: [
                        {
                            kind: "pt-buff",
                            appliesTo: "self",
                            power: clause.power,
                            toughness: clause.toughness,
                            condition: {
                                kind: condition.kind,
                                filter: condition.filter,
                                atLeast: condition.atLeast,
                            },
                        },
                    ],
                },
            };
        }
        case "keyword-grant":
            return {
                ok: true,
                lowered: {
                    ...grantCensus([clause.keyword]),
                    effects: [
                        {
                            kind: "keyword-grant",
                            filter: clause.filter,
                            keyword: clause.keyword.ability,
                        },
                    ],
                },
            };
        case "cost-modifier":
            return {
                ok: true,
                lowered: {
                    effects: [
                        {
                            kind: "cost-modifier",
                            ...(clause.spells !== undefined
                                ? { spells: clause.spells }
                                : { abilities: clause.abilities }),
                            ...(clause.onlyOutsideAnnouncersTurn === true
                                ? { onlyOutsideAnnouncersTurn: true as const }
                                : {}),
                            // CR 118.7a — a generic reduction affects ONLY the
                            // generic component of a cost, which is why both
                            // directions carry a bare number and the
                            // descriptor turns it into mana (CR 601.2f
                            // applies it).
                            ...(clause.direction === "more"
                                ? { increase: clause.amount }
                                : { reduction: clause.amount }),
                        },
                    ],
                },
            };
        // CR 508.1d — the tax's id is a card-scoped private handle, like a
        // combat restriction's; the sentence is the rejection reason a player
        // reads when the tax cannot be paid.
        case "attack-mana-tax":
            return {
                ok: true,
                lowered: {
                    effects: [
                        {
                            kind: "attack-mana-tax",
                            id: nextId("attack-tax"),
                            oracleText,
                            attackers: clause.attackers,
                            perAttacker: clause.perAttacker,
                        },
                    ],
                },
            };
        // CR 508.1c — the id is a card-scoped private handle, like the tax's.
        case "attack-prohibition":
            return {
                ok: true,
                lowered: {
                    effects: [
                        {
                            kind: "attack-prohibition",
                            id: nextId("attack-ban"),
                            oracleText,
                            attackers: clause.attackers,
                        },
                    ],
                },
            };
        // CR 602.5 / 605.1a — the id is a card-scoped private handle.
        case "creature-activation-lock":
            return {
                ok: true,
                lowered: {
                    effects: [
                        {
                            kind: "activation-restriction",
                            id: nextId("creature-activation-lock"),
                            filter: { types: "Creature" },
                            oracleText,
                        },
                    ],
                },
            };
        case "cast-permission": {
            // CR 601.3 — the permission's id is DERIVED from the clause, never
            // from the card: `collectCastPermissions` deduplicates on the bare
            // id across both battlefields, so two cards printing the same
            // sentence must offer ONE cast option rather than two
            // (`oracle/castPermissionId.ts` carries the whole argument).
            const terms = {
                kind: "cast-permission" as const,
                grantee: clause.grantee,
                filter: clause.filter,
                ...(clause.withoutPayingManaCost === true
                    ? { withoutPayingManaCost: true }
                    : {}),
                ...(clause.asThoughFlash === true
                    ? { asThoughFlash: true }
                    : {}),
                // CARD DATA, and part of the identity: the printed sentence
                // (issue #3284). The UI's short row name is `label`, which the
                // compiler never emits — it is an author's copy, and no
                // grammar derives one (`oracle/castPermissionId.ts`).
                oracleText,
            };
            return {
                ok: true,
                lowered: {
                    effects: [{ ...terms, id: deriveCastPermissionId(terms) }],
                },
            };
        }
        case "enters-with-counters":
            return {
                ok: true,
                lowered: { entersWithCounters: clause.counters },
            };
        case "enters-tapped":
            return {
                ok: true,
                lowered: {
                    entersTapped: true,
                    ...(clause.counters !== undefined
                        ? { entersWithCounters: clause.counters }
                        : {}),
                },
            };
        case "ability-loss-pt-set":
            // CR 613.1f + 613.4b — one clause, two layers, one scope.
            return {
                ok: true,
                lowered: {
                    effects: [
                        { kind: "ability-loss", filter: clause.filter },
                        {
                            kind: "pt-set",
                            filter: clause.filter,
                            power: clause.power,
                            toughness: clause.toughness,
                        },
                    ],
                },
            };
        case "chosen-type-pt-buff":
            return {
                ok: true,
                lowered: {
                    readsChosenType: true,
                    effects: [
                        {
                            kind: "pt-buff",
                            appliesTo: "chosen-subtype",
                            power: clause.power,
                            toughness: clause.toughness,
                        },
                    ],
                },
            };
        case "animate-mana-value-pt":
            return {
                ok: true,
                lowered: {
                    effects: [
                        {
                            kind: "type-add",
                            filter: clause.filter,
                            types: clause.addTypes,
                        },
                        {
                            kind: "pt-cda",
                            filter: clause.filter,
                            count: { kind: "mana-value" },
                        },
                    ],
                },
            };
        case "self-pt-cda-graveyards":
            return {
                ok: true,
                lowered: {
                    definesPowerToughness: true,
                    effects: [
                        {
                            kind: "pt-cda",
                            appliesTo: "self",
                            count: {
                                kind: "graveyard-cards",
                                types: clause.cardTypes,
                            },
                        },
                    ],
                },
            };
        case "self-pt-cda-exiled-totals":
            return {
                ok: true,
                lowered: {
                    definesPowerToughness: true,
                    effects: [
                        {
                            kind: "pt-cda",
                            appliesTo: "self",
                            count: { kind: "exiled-with-source-totals" },
                        },
                    ],
                },
            };
        case "as-enters-choose-creature-type":
            return { ok: true, lowered: { asEntersCreatureType: true } };
        case "as-enters-choose-card-name":
            return { ok: true, lowered: { asEntersNonlandCardName: true } };
        case "chosen-name-spells-cant-be-cast":
            return {
                ok: true,
                lowered: {
                    readsChosenName: true,
                    effects: [
                        {
                            kind: "cast-restriction",
                            id: nextId("name-lock"),
                            oracleText:
                                "Spells with the chosen name can't be cast.",
                        },
                    ],
                },
            };
        case "kicked-enters-with":
            return lowerKickedRider(clause, kickers, nextId);
        // CR 509.1b — the engine collects a block restriction from the
        // creature's own definition (`collectBlockRestrictions`), so no scope.
        case "self-block-restriction":
            return {
                ok: true,
                lowered: {
                    effects: [
                        {
                            kind: "block-restriction",
                            id: nextId("cant-block"),
                            oracleText: clause.sentence,
                            ...(clause.unlessControlMoreCreatures === true
                                ? { unlessControlMoreCreatures: true as const }
                                : {}),
                        },
                    ],
                },
            };
        // CR 508.1c — the engine collects an attack restriction from the
        // creature's own definition (`collectAttackRestrictions`).
        case "self-attack-restriction":
            return {
                ok: true,
                lowered: {
                    effects: [
                        {
                            kind: "attack-restriction",
                            id: nextId("cant-attack"),
                            oracleText: clause.sentence,
                            unless: clause.unless,
                        },
                    ],
                },
            };
        case "does-not-untap":
            return {
                ok: true,
                lowered: { staticAbility: DOES_NOT_UNTAP_MARKER },
            };
        // CR 601.2c — the engine's own `StaticTargetChoiceRequirement`, whole
        // (see `CompiledStaticEffect`). The id is a private handle, so it is
        // card-scoped like a combat restriction's. The engine dedups by
        // CLAUSE — `JSON.stringify({ binds, filter })`
        // (`activeTargetChoiceRequirements`) — so the filter is spelled
        // exactly as the catalogue spells it (`subtypes: "<Type>"`, not a
        // one-element array): a compiled Flagbearer beside a hand-written one
        // must be ONE requirement, not two.
        case "target-choice-requirement":
            return {
                ok: true,
                lowered: {
                    effects: [
                        {
                            kind: "target-choice-requirement",
                            id: nextId(
                                `${clause.subtype.toLowerCase()}-requirement`
                            ),
                            oracleText,
                            binds: clause.binds,
                            filter: { subtypes: clause.subtype },
                        },
                    ],
                },
            };
        // CR 502.3 — the engine's `untap-restriction`, as a descriptor. The id
        // is a private handle, card-scoped like a combat restriction's.
        case "untap-lock":
            return {
                ok: true,
                lowered: {
                    effects: [
                        {
                            kind: "untap-restriction",
                            id: nextId("untap-lock"),
                            oracleText,
                            filter: catalogueSpelling(clause.filter),
                            maxUntap: clause.maxUntap,
                            ...(clause.whileSourceUntapped === true
                                ? { whileSourceUntapped: true }
                                : {}),
                            ...(clause.nonManaActivatedAbility === true
                                ? { nonManaActivatedAbility: true }
                                : {}),
                        },
                    ],
                },
            };
        // CR 614.10 — the untap step is skipped (`skipsStep`); the filter
        // over every permanent type still holds every permanent tapped.
        case "skip-untap-steps":
            return {
                ok: true,
                lowered: {
                    effects: [
                        {
                            kind: "untap-restriction",
                            id: nextId("untap-lock"),
                            oracleText,
                            filter: { types: [...PERMANENT_TYPES] },
                            maxUntap: 0,
                            skipsStep: true,
                        },
                    ],
                },
            };
        // CR 614.1d — the engine's `enters-tapped-restriction`.
        case "enters-tapped-lock":
            return {
                ok: true,
                lowered: {
                    effects: [
                        {
                            kind: "enters-tapped-restriction",
                            id: nextId("enters-tapped-lock"),
                            oracleText,
                            filter: catalogueSpelling(clause.filter),
                        },
                    ],
                },
            };
        case "skip-draw-step":
            return { ok: true, lowered: { drawStepReplacement: true } };
        case "optional-draw-skip":
            return {
                ok: true,
                lowered: {
                    drawStepReplacement: true,
                    optionalDrawSkip: { effects: clause.effects },
                },
            };
        // CR 401.5 / 604.2 — a flat scope `computeLibraryTopRevealedPlayers`
        // reads live off the battlefield; never stored state.
        case "reveal-library-top":
            return { ok: true, lowered: { revealsLibraryTop: "controller" } };
        case "extra-land-drop":
            return { ok: true, lowered: { extraLandDrops: clause.count } };
        case "as-enters-discard":
            return {
                ok: true,
                lowered: {
                    asEntersCost: {
                        kind: "discard",
                        filter: clause.filter,
                        ifDeclined: "graveyard",
                    },
                },
            };
        case "as-enters-sacrifice":
            return {
                ok: true,
                lowered: {
                    asEntersCost: {
                        kind: "sacrifice",
                        filter: clause.filter,
                        ifDeclined: "graveyard",
                    },
                },
            };
        case "as-enters-exile-from-graveyard":
            return {
                ok: true,
                lowered: {
                    asEntersCost: {
                        kind: "exileFromGraveyard",
                        filter: clause.filter,
                    },
                },
            };
        // CR 702.18a — the player-scoped guard is already the engine's own
        // JSON-pure effect (`StaticPlayerGuard` carries no predicate).
        case "player-shroud":
            return {
                ok: true,
                lowered: {
                    effects: [
                        {
                            kind: "player-guard",
                            id: nextId("player-shroud"),
                            cantBeTargeted: true,
                        },
                    ],
                },
            };
        case "shuffle-from-anywhere":
            return { ok: true, lowered: { shuffleFromAnywhere: true } };
        case "flash-cast-cleanup-sacrifice":
            return {
                ok: true,
                lowered: {
                    castAsThoughFlash: true,
                    triggeredAbilities: [flashCastCleanupSacrifice(nextId)],
                },
            };
        case "damage-prevention-counter-removal":
            return {
                ok: true,
                lowered: { damagePreventionCounterRemoval: true },
            };
        case "controller-damage-prevention":
            return {
                ok: true,
                lowered: { preventsDamageToController: true },
            };
        case "enchanted-host":
            return lowerHostClause(clause, nextId);
        default: {
            const never: never = clause;
            return {
                ok: false,
                reason: `no lowering for static clause ${JSON.stringify(never)}`,
            };
        }
    }
}

/**
 * CR 603.7a + CR 400.7d — the price of the flash permission: when the
 * permanent this spell became enters, if the spell was cast when a sorcery
 * couldn't have been (the `castOffSorceryTiming` snapshot it carries), a
 * delayed trigger sacrifices it at the beginning of the next cleanup step
 * (CR 514.3a). Armed from an entered trigger because a permanent spell runs no
 * script of its own as it resolves — the hand-written Necromancy's shape
 * (`vis/black.cards.ts`). `$source` is captured now and re-bound when the
 * delayed trigger fires; gone by then, the body skips (CR 608.2b). To
 * sacrifice it is its controller's act (CR 701.21a): "the controller of the
 * permanent it becomes" is the Op's default, so no player is named.
 */
function flashCastCleanupSacrifice(
    nextId: (suffix: string) => string
): CompiledTriggeredAbility {
    return {
        id: nextId("cleanup-sacrifice"),
        oracleText:
            "If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.",
        head: { kind: "entered", scope: "self" },
        condition: { kind: "cast-off-sorcery-timing" },
        effects: [
            {
                op: "delayedTrigger",
                timing: "next-cleanup-step",
                oracleText:
                    "At the beginning of the next cleanup step, the controller of this permanent sacrifices it.",
                capture: { $becomes: { ref: "$source" } },
                effects: [{ op: "sacrifice", target: { ref: "$becomes" } }],
            },
        ],
    };
}

/**
 * CR 614.1c / 702.33e — a kicked entry rider: its counters, and whatever the
 * "and with …" tail grants the permanent itself.
 *
 * The counters are one entry per printed counter, because `entersWith` SUMS
 * same-type entries (the catalogue's own encoding — Duskwalker, Llanowar
 * Elite): `"kicker"` reads the times-kicked tally, `{ additionalCostPaid }`
 * the one named kicker's payment record (CR 702.33f — the Apocalypse Volvers).
 * The grants are self-scoped descriptors gated on the SAME kicker
 * (`self-if-kicked`, `cards/compiledStatics.ts`), so a Volver kicked with only
 * its {R} kicker gets first strike and not the {1}{B} kicker's ability.
 */
function lowerKickedRider(
    clause: Extract<StaticClauseIR, { kind: "kicked-enters-with" }>,
    kickers: readonly KickerCost[],
    nextId: (suffix: string) => string
): LowerStaticResult {
    // CR 122.1 — "a +1/+1 counter" is one; zero is not a printed count and
    // would lower to a rider that places nothing.
    if (clause.counters.count < 1)
        return {
            ok: false,
            reason: "an entry rider that places no counters",
        };
    let kickerId: string | undefined;
    if (clause.kickedWith !== undefined) {
        const named = kickedValue(
            { kind: "named", mana: clause.kickedWith },
            kickers
        );
        if (!named.ok) return named;
        const value = named.value;
        if (
            typeof value !== "object" ||
            value === null ||
            !("additionalCostPaid" in value) ||
            typeof value.additionalCostPaid !== "string"
        )
            return {
                ok: false,
                reason: '"with its [A] kicker" resolved to no single kicker (CR 702.33f)',
            };
        kickerId = value.additionalCostPaid;
        // CR 702.33c — a multikicker is paid any number of times, so its
        // payment count is not the 0-or-1 this rider's counters multiply.
        if (kickers.find((k) => k.id === kickerId)?.multi === true)
            return {
                ok: false,
                reason: '"with its [A] kicker" naming a multikicker (CR 702.33c)',
            };
    }
    const count: "kicker" | { additionalCostPaid: string } =
        kickerId === undefined ? "kicker" : { additionalCostPaid: kickerId };
    const effects: CompiledStaticEffect[] = [];
    const keywords: { ability: string; status: string }[] = [];
    const quotedAbilities: {
        id: string;
        text: string;
        ability: QuotedAbilityIR;
    }[] = [];
    const gate = {
        appliesTo: "self-if-kicked" as const,
        ...(kickerId !== undefined ? { kickerId } : {}),
    };
    for (const grant of clause.grants ?? []) {
        switch (grant.kind) {
            case "keyword-grant":
                keywords.push(grant.keyword);
                effects.push({
                    kind: "keyword-grant",
                    keyword: grant.keyword.ability,
                    ...gate,
                });
                break;
            case "activated-grant": {
                const id = nextId("kicked");
                quotedAbilities.push({
                    id,
                    text: grant.text,
                    ability: grant.ability,
                });
                effects.push({
                    kind: "activated-grant",
                    abilityId: id,
                    ...gate,
                });
                break;
            }
            case "triggered-grant": {
                const id = nextId("kicked");
                quotedAbilities.push({
                    id,
                    text: grant.text,
                    ability: grant.ability,
                });
                effects.push({
                    kind: "triggered-grant",
                    abilityId: id,
                    ...gate,
                });
                break;
            }
            default: {
                const never: never = grant;
                return {
                    ok: false,
                    reason: `no lowering for kicked grant ${JSON.stringify(never)}`,
                };
            }
        }
    }
    return {
        ok: true,
        lowered: {
            kickerCounters: {
                counters: Array.from({ length: clause.counters.count }, () => ({
                    type: clause.counters.type,
                    count,
                })),
                per: clause.per,
                ...(kickerId !== undefined ? { kickerId } : {}),
            },
            ...(effects.length > 0 ? { effects } : {}),
            ...(keywords.length > 0 ? grantCensus(keywords) : {}),
            ...(quotedAbilities.length > 0 ? { quotedAbilities } : {}),
        },
    };
}

/**
 * CR 702.1 — the census every GRANTED keyword pays. A granted keyword the
 * engine does not implement ships a card whose whole behaviour is inert,
 * exactly like a printed one (the Guard A shape, #962) — so it is censused on
 * the same path, not trusted because the grant itself lowered cleanly. And one
 * whose implementation is a definition-level expander is QUARANTINED, never
 * refused: the SENTENCE was read correctly and only the engine's encoding is
 * missing, so recording it as a parse gap would put a fragment we understand
 * into the backlog histogram that ranks the next grammar rule (`compile.ts`).
 */
function grantCensus(
    keywords: readonly { ability: string; status: string }[]
): Pick<LoweredStatic, "grantedKeywords" | "ungrantableKeywords"> {
    const ungrantable = keywords
        .map((k) => k.ability)
        .filter(isDefinitionLevelKeyword);
    return {
        grantedKeywords: keywords.map((k) => ({
            ability: k.ability,
            implemented: k.status === "implemented",
        })),
        ...(ungrantable.length > 0 ? { ungrantableKeywords: ungrantable } : {}),
    };
}

/**
 * CR 303.4b — every effect a host clause names, scoped to the Aura's host.
 *
 * Emitted in the order the sentence prints them, one descriptor each — the
 * shape the hand-written catalogue writes ("gets +0/+2 and has reach" is a
 * `pt-buff` then a `keyword-grant`, Web).
 */
function lowerHostClause(
    clause: Extract<StaticClauseIR, { kind: "enchanted-host" }>,
    nextId: (suffix: string) => string
): LowerStaticResult {
    const effects: CompiledStaticEffect[] = [];
    const keywords: { ability: string; status: string }[] = [];
    const quotedAbilities: {
        id: string;
        text: string;
        ability: QuotedAbilityIR;
    }[] = [];
    for (const effect of clause.effects) {
        switch (effect.kind) {
            case "pt-buff":
                effects.push({
                    kind: "pt-buff",
                    appliesTo: "host",
                    power: effect.power,
                    toughness: effect.toughness,
                });
                break;
            case "keyword-grant":
                keywords.push(effect.keyword);
                effects.push({
                    kind: "keyword-grant",
                    appliesTo: "host",
                    keyword: effect.keyword.ability,
                });
                break;
            case "activated-grant": {
                const id = nextId("granted");
                quotedAbilities.push({
                    id,
                    text: effect.text,
                    ability: effect.ability,
                });
                effects.push({
                    kind: "activated-grant",
                    appliesTo: "host",
                    abilityId: id,
                });
                break;
            }
            case "triggered-grant": {
                const id = nextId("granted");
                quotedAbilities.push({
                    id,
                    text: effect.text,
                    ability: effect.ability,
                });
                effects.push({
                    kind: "triggered-grant",
                    appliesTo: "host",
                    abilityId: id,
                });
                break;
            }
            case "control-change":
                effects.push({ kind: "control-change", appliesTo: "host" });
                break;
            case "attack-restriction":
                effects.push({
                    kind: "attack-restriction",
                    id: nextId("cant-attack"),
                    oracleText: effect.sentence,
                });
                break;
            case "block-restriction":
                effects.push({
                    kind: "block-restriction",
                    id: nextId("cant-block"),
                    oracleText: effect.sentence,
                });
                break;
            default: {
                const never: never = effect;
                return {
                    ok: false,
                    reason: `no lowering for host effect ${JSON.stringify(never)}`,
                };
            }
        }
    }
    return {
        ok: true,
        lowered: {
            effects,
            host: clause.host,
            ...(keywords.length > 0 ? grantCensus(keywords) : {}),
            ...(quotedAbilities.length > 0 ? { quotedAbilities } : {}),
            ...(clause.keepsThisAura === true
                ? { exemptFromProtectionDetach: true as const }
                : {}),
        },
    };
}
