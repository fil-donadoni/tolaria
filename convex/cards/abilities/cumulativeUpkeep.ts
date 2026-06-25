// `cumulativeUpkeepTrigger` — declarative template for cumulative upkeep
// (CR 702.24), the Ice Age block's headline keyword (ADR 0042).
//
// CR 702.24a-c: cumulative upkeep is a triggered ability that fires "at the
// beginning of [the permanent's controller]'s upkeep". When it resolves, the
// controller (a) puts an AGE counter on the permanent, then (b) MAY pay the
// permanent's upkeep cost ONCE FOR EACH age counter on it. If the player
// declines, or cannot pay the total, they sacrifice the permanent. The payment
// is all-or-nothing for the whole multiplied total (CR 702.24c).
//
// Because the cost may be non-mana (pay life, sacrifice a permanent) and may
// even mix legs (Infernal Darkness — "Pay {B} and 1 life"), the scaled cost is
// the printed cost REPEATED N times, not a numeric multiply: "{B} and 1 life"
// at three age counters is "{B}{B}{B} and 3 life" (mana repeated, life summed,
// sacrifice count summed). This keeps arbitrary cost types correct by
// construction (ADR 0042).
//
// Structurally this is Primordial Ooze's "counter then may-pay-or-else" shape
// (leg.ts), so it reuses `phaseTrigger`'s two-step `resolveSteps` (CR 608.2):
// step 0 adds the age counter (irreversible — must not re-run on resume), step
// 1 offers the scaled may-pay and sacrifices on decline / inability.

import type { ManaCost, MayPayCost, PermanentFilter } from "../types";
import type { TriggeredAbility } from "../types";
import { phaseTrigger } from "./triggers/phaseTrigger";

/** The printed (one-age-counter) cumulative-upkeep cost. A bare `ManaCost`
 *  (the common pure-mana case — "Cumulative upkeep {1}{U}") or the union for
 *  life / sacrifice / mixed costs. */
export type CumulativeUpkeepCost = MayPayCost;

interface NormalizedCost {
    mana?: ManaCost;
    life?: number;
    sacrifice?: { filter: PermanentFilter; count: number };
}

function isUnion(cost: MayPayCost): cost is {
    mana?: ManaCost;
    life?: number;
    sacrifice?: { filter: PermanentFilter; count: number };
} {
    return "mana" in cost || "life" in cost || "sacrifice" in cost;
}

function normalize(cost: MayPayCost): NormalizedCost {
    if (isUnion(cost)) {
        return {
            ...(cost.mana ? { mana: cost.mana } : {}),
            ...(cost.life !== undefined ? { life: cost.life } : {}),
            ...(cost.sacrifice ? { sacrifice: cost.sacrifice } : {}),
        };
    }
    return { mana: cost as ManaCost };
}

/** Multiplies every numeric pip of a `ManaCost` by `n` (CR 702.24c repetition).
 *  `{1}{U}` × 3 → `{3}{U}{U}{U}`. A variable `X` is not used by any cumulative
 *  upkeep cost, so only numeric pips are scaled. */
function scaleMana(mana: ManaCost, n: number): ManaCost {
    const out: ManaCost = {};
    for (const [k, v] of Object.entries(mana)) {
        if (k === "xFactor") continue;
        if (typeof v === "number" && v > 0) {
            (out as Record<string, number>)[k] = v * n;
        }
    }
    return out;
}

/** The printed cost repeated `n` times (CR 702.24c). Mana pips ×n, life ×n,
 *  sacrifice count ×n — preserving correctness for mixed / non-mana costs. */
function scaleCost(cost: MayPayCost, n: number): MayPayCost {
    const norm = normalize(cost);
    // Pure-mana cost: keep the bare-`ManaCost` shape so existing mana-only
    // rendering and affordability stay on the historical path.
    if (norm.mana && norm.life === undefined && !norm.sacrifice) {
        return scaleMana(norm.mana, n);
    }
    return {
        ...(norm.mana ? { mana: scaleMana(norm.mana, n) } : {}),
        ...(norm.life !== undefined ? { life: norm.life * n } : {}),
        ...(norm.sacrifice
            ? {
                  sacrifice: {
                      filter: norm.sacrifice.filter,
                      count: norm.sacrifice.count * n,
                  },
              }
            : {}),
    };
}

export interface CumulativeUpkeepArgs {
    /** Stable id within the source's `triggeredAbilities` array. */
    id?: string;
    /** Oracle reminder text shown on the stack (CR 603.3a). Defaults to the
     *  standard cumulative-upkeep reminder for the given cost. */
    oracleText?: string;
    /** The printed (one-age-counter) cumulative-upkeep cost (CR 702.24a). */
    cost: CumulativeUpkeepCost;
    /** Label for the cost shown in the may-pay prompt (e.g. "{1}{U}",
     *  "{B} and 1 life", "Sacrifice a land"). Used only in the prompt string. */
    costLabel: string;
}

/** Builds the cumulative-upkeep triggered ability (CR 702.24). Add it to a
 *  card's `triggeredAbilities`. The `age` counter accrues on the source; the
 *  cost paid each upkeep is the printed cost repeated once per age counter,
 *  all-or-nothing; decline or inability sacrifices the source. */
export function cumulativeUpkeepTrigger(
    args: CumulativeUpkeepArgs
): TriggeredAbility {
    const oracle =
        args.oracleText ??
        `Cumulative upkeep ${args.costLabel} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)`;
    return phaseTrigger({
        id: args.id ?? "cumulative-upkeep",
        oracleText: oracle,
        phase: "UPKEEP",
        scope: "your",
        // CR 608.2 — step 0 adds the age counter (irreversible: must not re-run
        // when step 1's may-pay suspends), step 1 offers the scaled payment.
        resolveSteps: [
            (ctx) => {
                // CR 702.24a — put an age counter on the permanent.
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "age",
                    1
                );
            },
            (ctx, scopedPlayerId) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                // CR 702.24b — pay the upkeep cost once per age counter.
                const ageCount = ctx.getCounterCount(self, "age");
                if (ageCount <= 0) return;
                const scaled = scaleCost(args.cost, ageCount);
                const accept = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `cumulative-upkeep-${ctx.sourceInstanceId}`,
                    cost: scaled,
                    prompt: `Pay cumulative upkeep (${args.costLabel} ×${ageCount}) to keep this permanent?`,
                });
                if (accept === undefined) return; // suspended for the choice
                // CR 702.24c — declined or unable to pay: sacrifice it. The
                // engine collapses "can't pay" to the decline branch (the
                // affordability gate prevents an accept the pool can't cover),
                // so a single `false` covers both.
                if (!accept) ctx.sacrifice(ctx.sourceInstanceId);
            },
        ],
    });
}
