// Extort (CR 702.101a) — "Whenever you cast a spell, you may pay {W/B}. If you
// do, each opponent loses 1 life and you gain life equal to the total life lost
// this way." A card declares only `staticAbilities: ["extort"]`.
//
// A printed instance expands here, at the `getDefinition` seam (ADR 0054), into
// the one spell-cast trigger. A STATIC grant ("Other creatures you control have
// extort") writes `staticAbilities` on the recipient, which no expander reads,
// so it expands too: beside the keyword grant goes a `triggered-grant` of the
// same trigger under the same `applies`. Each grant is its own entry on the
// recipient, printed trigger included, so CR 702.101b's "each triggers
// separately" needs no counting: Syndic of Tithes under two Pontiffs of Blight
// fires three times. A one-shot "gains extort" grant has no such twin and stays
// quarantined by the census (`isDefinitionLevelKeyword`).
//
// A two-player engine, so `"opponent"` IS "each opponent". "The total life lost
// this way" is measured (`bindLost`), never assumed to be the 1 asked for: a CR
// 614 replacement can consume the loss, and then nothing is gained.

import type {
    CardDefinition,
    EffectOp,
    StaticKeywordGrant,
    TriggeredAbility,
} from "../types";
import { spellCastTrigger } from "./triggers/spellCastTrigger";

const EXTORT_KEYWORD = "extort";
const EXTORT_TRIGGER_ID = "extort";
const EXTORT_GRANT_ID = "extort-granted";

const EXTORT_ORACLE_TEXT =
    "Extort (Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.)";

const EXTORT_EFFECTS: EffectOp[] = [
    {
        op: "mayPay",
        player: "controller",
        cost: { hybrid: [["W", "B"]] },
        prompt: "Pay {W/B} to extort? Each opponent loses 1 life and you gain that much life.",
        bind: "$paid",
    },
    {
        op: "if",
        predicate: { binding: "$paid" },
        then: [
            {
                op: "loseLife",
                player: "opponent",
                amount: 1,
                bindLost: "$lost",
            },
            { op: "gainLife", player: "controller", amount: { ref: "$lost" } },
        ],
    },
];

function extortTrigger(id: string): TriggeredAbility {
    return spellCastTrigger({
        id,
        oracleText: EXTORT_ORACLE_TEXT,
        scope: "you",
        effects: EXTORT_EFFECTS,
    });
}

/** Does a static grant of `keyword` reach the engine through {@link expandExtort}?
 *  The census' exception to "granting an expander-backed keyword does nothing". */
export function staticGrantOfKeywordIsExpanded(keyword: string): boolean {
    return keyword === EXTORT_KEYWORD;
}

function isUnconditionalExtortGrant(
    effect: NonNullable<CardDefinition["staticEffects"]>[number]
): effect is StaticKeywordGrant {
    return (
        effect.kind === "keyword-grant" &&
        effect.keyword === EXTORT_KEYWORD &&
        effect.condition === undefined
    );
}

/** Injects the CR 702.101a trigger for a printed `extort` and a `triggered-grant`
 *  beside each static grant of it. Returns the input unchanged with neither;
 *  never mutates it; idempotent. */
export function expandExtort(def: CardDefinition): CardDefinition {
    const printed =
        def.staticAbilities?.includes(EXTORT_KEYWORD) === true &&
        !def.triggeredAbilities?.some((t) => t.id === EXTORT_TRIGGER_ID);
    const grants =
        def.triggeredGrantTemplates?.some((t) => t.id === EXTORT_GRANT_ID) ===
        true
            ? []
            : (def.staticEffects ?? []).filter(isUnconditionalExtortGrant);
    if (!printed && grants.length === 0) return def;
    const expanded = { ...def };
    if (printed) {
        expanded.triggeredAbilities = [
            ...(def.triggeredAbilities ?? []),
            extortTrigger(EXTORT_TRIGGER_ID),
        ];
    }
    if (grants.length > 0) {
        expanded.staticEffects = [
            ...(def.staticEffects ?? []),
            ...grants.map((grant) => ({
                kind: "triggered-grant" as const,
                applies: grant.applies,
                abilityId: EXTORT_GRANT_ID,
            })),
        ];
        expanded.triggeredGrantTemplates = [
            ...(def.triggeredGrantTemplates ?? []),
            extortTrigger(EXTORT_GRANT_ID),
        ];
    }
    return expanded;
}
