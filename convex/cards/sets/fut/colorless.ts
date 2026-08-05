// FUT (Future Sight) — colorless cards, split by colour per ADR 0043. The
// registry's `import * as fut from "./sets/fut"` resolves through fut/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";
import { equipAbility } from "../../abilities/equipment";

// Horizon Canopy — {T}, Pay 1 life: Add {G} or {W}; {1}, {T}, Sacrifice: Draw a
// card. (CR 605.1a mana ability — useStack: false, CR 605.3a; CR 118.4 life
// payment as part of the cost; CR 305 land. The cantrip-sacrifice ability is a
// normal activated ability that uses the stack, CR 602.) Composed entirely from
// existing primitives — the painland mana ability mirrors Standing Stones (DRK).
export const horizonCanopy: CardDefinition = {
    id: "d5dfc25d-a17b-4ead-9484-e8a18b8fa176",
    rarity: "rare",
    name: "Horizon Canopy",
    oracleText:
        "{T}, Pay 1 life: Add {G} or {W}.\n{1}, {T}, Sacrifice this land: Draw a card.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "horizon-canopy-mana",
            oracleText: "{T}, Pay 1 life: Add {G} or {W}.",
            cost: { tap: true, life: 1 },
            useStack: false,
            effect: (ctx) => ctx.addMana({ G: 1 }),
            manaChoices: [{ G: 1 }, { W: 1 }],
        },
        {
            id: "horizon-canopy-draw",
            oracleText: "{1}, {T}, Sacrifice this land: Draw a card.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, issue #1264): CR 121.1
            // draw via the DSL `draw` Op.
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};

// Coalition Relic — "{T}: Add one mana of any color.\n{T}: Put a charge
// counter on this artifact.\nAt the beginning of your first main phase,
// remove all charge counters from this artifact. Add one mana of any color
// for each charge counter removed this way." STOP-AND-ISSUE (re-audited
// under the #1306 residue tranche, parent PRD #620): the first mana ability
// alone is trivial (the established any-colour `manaChoices` shape — see
// Starting Town, `fin/colorless.ts`, shipped the same tranche), but the
// phase-trigger effect needs to add N independently-coloured mana instances
// (one choice per counter removed) — there is no `EffectChoiceKind` for
// "pick a mana colour" (the existing `choice` Op kinds are all
// permanent/card/hand selectors) and no SpellContext primitive for a
// repeated colour pick outside the established `manaChoices`/
// `getManaChoices` ACTIVATION-time machinery, which doesn't apply to a
// triggered ability's resolution. Left as a tracked stub pending a "choose N
// colours" primitive. tracked-by: #1368
// export const coalitionRelic: CardDefinition = {
//     id: "7a7c98b0-d64d-4d0a-b284-1187a8e7095e",
//     name: "Coalition Relic",
//     rarity: "rare",
//     manaCost: { X: 3 },
//     types: ["Artifact"],
// };

// Sword of the Meek — {2} Artifact — Equipment. "Equipped creature gets
// +1/+2. Equip {2}. Whenever a 1/1 creature you control enters, you may
// return this card from your graveyard to the battlefield, then attach it to
// that creature." (issue #1965 — re-audited off #920; the "needs an
// Equipment attach Op" blocker is gone: the Equipment spine shipped (#1349
// `attach` Op + Equip ability + detach SBA, #1350 equipped-creature-dies
// last-known, ADR 0065), #776 is closed.
//
// The static buff + Equip half is the plain Equipment shape (staticEffects
// applies-while-attached + `equip` cost). The recursive trigger is a
// `zone: "graveyard"` triggered ability (CR 603.6e — Nether Shadow /
// Ashen Ghoul precedent) watching for ANY `PERMANENT_ENTERED` event, not
// just an upkeep step, so it's built as a raw `TriggeredAbility` rather than
// through `enteredTrigger` (whose factory has no `zone` parameter and whose
// `filter` only inspects the event payload — no power/toughness there;
// `matches` instead reads the entering permanent's P/T off `TriggerStateView`
// directly, the same "read state, not the event" shape `interveningIf`
// predicates already use elsewhere). That P/T is the STORED value
// (`TriggerStateView`'s battlefield entries are not layer-computed
// server-side the way the frontend's `buildTriggerStateView` fills them for
// an affordability hint) — matches every printed-1/1 case this ability cares
// about; a creature whose P/T is modified by a continuous static effect
// before this trigger's `matches` runs is outside what the current
// `TriggerStateView` API can see (it doesn't structurally satisfy
// `LayerStateView`, so `getEffectivePower` isn't callable here) — a
// pre-existing engine-wide characteristic of every `matches`/`interveningIf`
// predicate, not something specific to this card. "you may" = a cost-free
// `mayPay` (issue #680);
// "return this card ... then attach it to that creature" is `moveZone
// { target: { ref: "$source" } }` (the Ashen Ghoul self-reanimation shape,
// issue #737's unconditional `$source` graveyard recovery) followed by
// `attach` targeting the entering creature. Naming "that creature"
// declaratively needed one new censused `$event.<field>` row —
// `PERMANENT_ENTERED.instanceId` (object family, mirrors
// `BECAME_TARGET.targetPermanent`) — added in `mechanicsRegistry.ts`
// alongside this card; NOT a new Op, the existing ADR 0049 generalization
// mechanism for exposing an already-existing event field to the DSL.
export const swordOfTheMeek: CardDefinition = {
    id: "e9f13705-6ede-4c29-a2b4-a082bf69e9c5",
    name: "Sword of the Meek",
    rarity: "uncommon",
    oracleText:
        "Equipped creature gets +1/+2.\nEquip {2}\nWhenever a 1/1 creature you control enters, you may return this card from your graveyard to the battlefield, then attach it to that creature.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    subtypes: ["Equipment"],
    staticEffects: [
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 1, toughness: 2 },
    ],
    activatedAbilities: [
        equipAbility({
            id: "sword-of-the-meek-equip",
            cost: { X: 2 },
            oracleText: "Equip {2}",
        }),
    ],
    triggeredAbilities: [
        {
            id: "sword-of-the-meek-return",
            oracleText:
                "Whenever a 1/1 creature you control enters, you may return this card from your graveyard to the battlefield, then attach it to that creature.",
            event: "PERMANENT_ENTERED",
            // CR 603.6e — this ability functions while the card sits in the
            // graveyard (Nether Shadow's scan path), not the battlefield.
            zone: "graveyard",
            matches: (event, self, state) => {
                if (event.type !== "PERMANENT_ENTERED") return false;
                if (event.controllerId !== self.controllerId) return false;
                if (!event.types.includes("Creature")) return false;
                const bf = state?.players
                    .find((p) => p.id === event.controllerId)
                    ?.battlefield.find((b) => b.id === event.instanceId);
                return bf?.power === 1 && bf?.toughness === 1;
            },
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Return Sword of the Meek to the battlefield and attach it to that creature?",
                    bind: "$return",
                },
                {
                    op: "if",
                    predicate: { binding: "$return" },
                    then: [
                        {
                            op: "moveZone",
                            target: { ref: "$source" },
                            to: "battlefield",
                        },
                        {
                            op: "attach",
                            target: { ref: "$event.instanceId" },
                        },
                    ],
                },
            ],
        },
    ],
};
