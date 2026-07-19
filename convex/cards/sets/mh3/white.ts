// MH3 — white cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { PERMANENT_TYPES } from "../../types";
import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Guide of Souls — {W} Creature — Human Cleric, 1/2 (MH3, issue #1194).
// "Whenever another creature you control enters, you gain 1 life and get {E}
// (an energy counter). Whenever you attack, you may pay {E}{E}{E}. When you
// do, put two +1/+1 counters and a flying counter on target attacking
// creature. It becomes an Angel in addition to its other types."
//
// Was a tracked stop-and-issue stub (#1194) blocked on two engine gaps, both
// closed by this issue:
//   (1) keyword counters that GRANT their ability (CR 122.1c / 613.4d) — a
//       "flying" counter placed by the `counters` Op now grants flying via
//       `SpellContext.addCounter`'s keyword-counter sync
//       (`mechanicsRegistry.getKeywordCounterGrant`).
//   (2) an indefinite type-add continuous effect (CR 613.1d, layer 4) — the
//       new `addSubtype` Op / `SpellContext.addSubtype` primitive.
// The fixed `{E}{E}{E}` pay + reflexive "When you do" is `mayPay` (cost.energy,
// issue #1194's third leg) + `if $paid`.
export const guideOfSouls: CardDefinition = {
    id: "76c3cad2-1e25-4abe-878d-9194de6fcc27",
    rarity: "rare",
    name: "Guide of Souls",
    oracleText:
        "Whenever another creature you control enters, you gain 1 life and get {E} (an energy counter).\nWhenever you attack, you may pay {E}{E}{E}. When you do, put two +1/+1 counters and a flying counter on target attacking creature. It becomes an Angel in addition to its other types.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "guide-of-souls-etb",
            oracleText:
                "Whenever another creature you control enters, you gain 1 life and get {E} (an energy counter).",
            scope: "another-yours",
            filter: { types: "Creature" },
            effects: [
                { op: "gainLife", player: "controller", amount: 1 },
                { op: "getEnergy", player: "controller", amount: 1 },
            ],
        }),
        {
            id: "guide-of-souls-attack",
            oracleText:
                "Whenever you attack, you may pay {E}{E}{E}. When you do, put two +1/+1 counters and a flying counter on target attacking creature. It becomes an Angel in addition to its other types.",
            event: "ATTACKERS_DECLARED",
            // CR 603.3d (issue #1193) — the target is chosen when this
            // triggered ability is put on the stack, regardless of the later
            // may-pay decision (CR 601.2c / 118.4).
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
            },
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackingPlayerId === self.controllerId,
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: { energy: 3 },
                    prompt: "Pay {E}{E}{E}?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { binding: "$paid" },
                    then: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            count: 2,
                            target: { target: 0 },
                        },
                        {
                            op: "counters",
                            action: "add",
                            counter: "flying",
                            count: 1,
                            target: { target: 0 },
                        },
                        {
                            op: "addSubtype",
                            target: { target: 0 },
                            subtype: "Angel",
                        },
                    ],
                },
            ],
        },
    ],
};

const PHELIA_ID = "55707746-da6e-46e5-a5ca-7ac843fdc38e";

// Phelia, Exuberant Shepherd — {1}{W} Legendary Creature — Dog, 2/2, Flash
// (MH3, issue #1320, parent #917 — cube FREE +1/+1 counters). "Flash.
// Whenever Phelia attacks, exile up to one other target nonland permanent.
// At the beginning of the next end step, return that card to the
// battlefield under its owner's control. If it entered under your control,
// put a +1/+1 counter on Phelia."
//
// TARGETING (CR 603.3d): "up to one other target nonland permanent" is a REAL
// target chosen when the attack trigger is put on the stack — declared as a
// `targetRequirement` on the TriggeredAbility (issue #1193 machinery,
// `raiseTriggerTargetSelection` in gre/rules.ts), NOT a resolution-time
// `requestChoice`. That makes it subject to hexproof / protection / ward and
// fires "becomes the target of an ability" triggers, which the old
// choice-as-target workaround silently skipped. The resolve() then only
// composes the flicker: `exile` the announced target +
// `scheduleDelayedTrigger("next-end-step")` + a card-level `delayedTriggers[]`
// entry that calls `returnToBattlefield(owner, id, "exile")` — the DSL
// `moveZone` Op still has no exile-zone branch, so the return leg stays an
// imperative resolve (the schedule/fire pair Flickerwisp and Liberate ship).
//
// NEW for this card (issue #1320 — the delayed-trigger controller/owner
// branch): the delayed trigger's payload additionally captures the ATTACK
// trigger's controller (`casterControllerId` — "you" in the oracle text,
// i.e. Phelia's controller at the moment the ability triggered, CR 603.7a
// fixes the delayed ability's controller at scheduling) and Phelia's own
// battlefield instance id (`sourceId` — a delayed trigger's fired stack item
// carries the CARD-DEFINITION id as `card.id`, not a specific permanent;
// `buildDelayedTriggerStackItem` sets no `triggerSourceId`, so
// `ctx.sourceInstanceId` inside THIS resolve() is the fired stack item's own
// fresh id, not Phelia's board instance — the id must cross via payload).
// At fire time, AFTER the return actually happens, resolve() reads the
// returned permanent's POST-RETURN controller via `ctx.getController` and
// compares it against the captured `casterControllerId`: since
// `returnToBattlefield` places the card under its OWNER's control (no
// controller override here), this is equivalent in practice to "did the
// returned card's owner match Phelia's controller" — but reading the LIVE
// post-return controller (rather than precomputing the comparison at exile
// time) is the generalizable shape: a future card whose delayed-return step
// passes an explicit `controllerId` override to `returnToBattlefield` (a
// "steal" flicker) still branches correctly, because the check reads
// control AFTER the return, not ownership captured before it.
export const phelia: CardDefinition = {
    id: PHELIA_ID,
    name: "Phelia, Exuberant Shepherd",
    rarity: "rare",
    oracleText:
        "Flash\nWhenever Phelia attacks, exile up to one other target nonland permanent. At the beginning of the next end step, return that card to the battlefield under its owner's control. If it entered under your control, put a +1/+1 counter on Phelia.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Dog"],
    supertypes: ["Legendary"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flash"],
    triggeredAbilities: [
        {
            id: "phelia-attack",
            oracleText:
                "Whenever Phelia attacks, exile up to one other target nonland permanent. At the beginning of the next end step, return that card to the battlefield under its owner's control. If it entered under your control, put a +1/+1 counter on Phelia.",
            event: "ATTACKERS_DECLARED",
            // CR 603.3d — "up to one OTHER target nonland permanent": a real
            // target chosen when the trigger is put on the stack (not a
            // resolution-time choice), so it is subject to hexproof /
            // protection / ward and fires "becomes the target" triggers.
            // `type: PERMANENT_TYPES minus Land` = "nonland permanent" (the
            // Boomerang idiom, ons/blue.ts); `excludeSource` drops Phelia
            // herself ("other"); `count 0..1` = "up to one". Any controller's
            // permanent is eligible (no controller restriction in the text).
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: { min: 0, max: 1 },
                excludeTypes: "Land",
                excludeSource: true,
            },
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return; // "up to one": none chosen / CR 608.2b none legal
                const targetId = target.id;
                const ownerId = ctx.getOwnerId(targetId);
                if (ownerId === undefined) return; // CR 608.2b — target left
                ctx.exile({ type: "permanent", id: targetId });
                ctx.scheduleDelayedTrigger(
                    PHELIA_ID,
                    "phelia-return",
                    "next-end-step",
                    {
                        cardId: targetId,
                        ownerId,
                        casterControllerId: ctx.controller,
                        sourceId: ctx.sourceInstanceId,
                    }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "phelia-return",
            oracleText:
                "Return that card to the battlefield under its owner's control at the beginning of the next end step. If it entered under your control, put a +1/+1 counter on Phelia.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                if (!payload.cardId || !payload.ownerId) return;
                const entered = ctx.returnToBattlefield(
                    payload.ownerId,
                    payload.cardId,
                    "exile"
                );
                if (!entered) return; // CR 608.2b — no longer in exile
                if (!payload.casterControllerId || !payload.sourceId) return;
                // Issue #1320 — the delayed-trigger controller/owner branch:
                // compare the returned permanent's POST-RETURN controller
                // against the captured caster (Phelia's controller when the
                // ability triggered, CR 603.7a). Skips cleanly if Phelia
                // herself has since left the battlefield (`addCounter` is a
                // CR 608.2b no-op against a missing instance).
                const controllerId = ctx.getController({
                    type: "permanent",
                    id: payload.cardId,
                });
                if (controllerId === payload.casterControllerId) {
                    ctx.addCounter(
                        { type: "permanent", id: payload.sourceId },
                        "+1/+1",
                        1
                    );
                }
            },
        },
    ],
};
