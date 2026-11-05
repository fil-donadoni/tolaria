// Extort (CR 702.101a) — "Whenever you cast a spell, you may pay {W/B}. If you
// do, each opponent loses 1 life and you gain life equal to the total life lost
// this way." A card declares only `staticAbilities: ["extort"]`.
//
// A printed instance expands here, at the `getDefinition` seam (ADR 0054), into
// the one spell-cast trigger. A STATIC grant ("Other creatures you control have
// extort") expands too (`staticKeywordGrant.ts`), so CR 702.101b's "each triggers
// separately" needs no counting: Syndic of Tithes under two Pontiffs of Blight
// fires three times.
//
// A two-player engine, so `"opponent"` IS "each opponent". "The total life lost
// this way" is measured (`bindLost`), never assumed to be the 1 asked for: a CR
// 614 replacement can consume the loss, and then nothing is gained.

import type { CardDefinition, EffectOp, TriggeredAbility } from "../types";
import { expandStaticKeywordGrants } from "./staticKeywordGrant";
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

/** Injects the CR 702.101a trigger for a printed `extort` and a `triggered-grant`
 *  beside each static grant of it. Returns the input unchanged with neither;
 *  never mutates it; idempotent. */
export function expandExtort(def: CardDefinition): CardDefinition {
    const printed =
        def.staticAbilities?.includes(EXTORT_KEYWORD) === true &&
        !def.triggeredAbilities?.some((t) => t.id === EXTORT_TRIGGER_ID);
    return expandStaticKeywordGrants(
        printed
            ? {
                  ...def,
                  triggeredAbilities: [
                      ...(def.triggeredAbilities ?? []),
                      extortTrigger(EXTORT_TRIGGER_ID),
                  ],
              }
            : def,
        EXTORT_KEYWORD,
        () => extortTrigger(EXTORT_GRANT_ID)
    );
}
