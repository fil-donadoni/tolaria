// OTJ — green cards, split by colour per ADR 0043. The registry's
// `import * as otj from "./sets/otj"` resolves through otj/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { landfallTrigger } from "../../abilities/triggers/landfallTrigger";

// Bristly Bill, Spine Sower — {1}{G} Legendary Creature — Plant Druid, 2/2.
// First card of the Landfall CAP (issue #694). The landfall clause is the
// canonical Landfall ability word (CR 702 preamble — italic, no independent
// rules meaning), modelled by the shared `landfallTrigger` factory (a
// `PERMANENT_ENTERED` trigger gated to Lands you control, CR 603.6a / 109.2).
//
// The landfall effect ("put a +1/+1 counter on TARGET creature" — any
// creature on EITHER battlefield) uses an imperative `resolve` with
// `requestChoice({ allControllers: true })` because the engine has **no
// announcement-time target selection for triggered abilities** (CR 603.3d):
// `TriggeredAbility` carries no `targetRequirement` field, triggers enter the
// stack with `targets: undefined` (`gre/triggers.ts`), and nothing populates a
// trigger's targets from a requirement. So a targeted trigger cannot be
// authored as `targetRequirement` + `{ target: 0 }` DSL today — the whole
// class (Loran of the Third Path ETB `sets/bro/white.ts`, Aura Shards
// `sets/inv/multicolor.ts`) uses this exact `resolve` + `requestChoice`
// pattern. The DSL `choice` Op is ALSO insufficient here: its candidate set is
// limited to the CHOOSER's own permanents (interpreter `choiceCandidates`), so
// it cannot offer the opponent's creatures that "target creature" allows.
// Tracked for a proper DSL migration once announcement-time targeted triggers
// ship: **#1193**. Not a protocol card; the effect (add counter) is trivially
// DSL — only the cross-controller targeting forces `resolve`
// (`.claude/rules/gre-development.md` § DSL-first authoring).
//
// The activated ability ("Double the number of +1/+1 counters on each creature
// you control") IS pure DSL: a `forEach` over your creatures adding, per
// creature, a number of +1/+1 counters equal to the count already present —
// the `counters` Op with a `counters` EffectValue count (CR 122.6, issue
// #1015). Doubling N via "add N more" needs no new Op.
export const bristlyBillSpineSower: CardDefinition = {
    id: "52eef0d6-24b7-40b7-8403-e8e863d0cd55",
    rarity: "rare",
    name: "Bristly Bill, Spine Sower",
    oracleText:
        "Landfall — Whenever a land you control enters, put a +1/+1 counter on target creature.\n{3}{G}{G}: Double the number of +1/+1 counters on each creature you control.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Plant", "Druid"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        landfallTrigger({
            id: "bristly-bill-landfall",
            oracleText:
                "Landfall — Whenever a land you control enters, put a +1/+1 counter on target creature.",
            resolve: (ctx) => {
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `bristly-bill-landfall-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    filter: { types: "Creature" },
                    allControllers: true,
                    count: 1,
                    prompt: "Landfall: put a +1/+1 counter on target creature.",
                });
                if (picks === undefined) return; // suspended for the choice
                const id = picks[0];
                if (id) ctx.addCounter({ type: "permanent", id }, "+1/+1", 1);
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "bristly-bill-double-counters",
            oracleText:
                "{3}{G}{G}: Double the number of +1/+1 counters on each creature you control.",
            cost: { mana: { X: 3, G: 2 } },
            useStack: true,
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            // Double = add a number of +1/+1 counters equal to
                            // the count already on the creature (CR 122.6 read
                            // via the `counters` EffectValue).
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$each" },
                            count: {
                                counters: {
                                    of: { ref: "$each" },
                                    type: "+1/+1",
                                },
                            },
                        },
                    ],
                },
            ],
        },
    ],
};
