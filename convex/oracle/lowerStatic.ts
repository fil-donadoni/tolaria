/**
 * Lowering: static-clause IR → the `CardDefinition` fields a continuous static
 * ability lives in (CR 113.3d, ADR 0045 / ADR 0105).
 *
 * There are three destinations, and which one a clause takes is a statement
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
import type { CardDefinition, KickerCost } from "../cards/types";
import { kickedValue } from "./lowerEffects";
import { deriveCastPermissionId } from "./castPermissionId";
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
    readonly entersWithCounters?: {
        readonly type: string;
        readonly count: number;
    };
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
        case "self-pt-buff-if-controls": {
            // CR 611.2c — the condition is read off the LAYER view, so its
            // filter may only name fields that view can answer.
            const unreadable = Object.keys(clause.condition.filter).find(
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
                                kind: "controls",
                                filter: clause.condition.filter,
                                atLeast: clause.condition.atLeast,
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
                            spells: clause.spells,
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
        case "kicked-enters-with":
            return lowerKickedRider(clause, kickers, nextId);
        case "does-not-untap":
            return {
                ok: true,
                lowered: { staticAbility: DOES_NOT_UNTAP_MARKER },
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
