// MH3 — white cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { PERMANENT_TYPES } from "../../types";
import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

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
                // Pin the exiled card under Phelia on the board (Banishing-
                // Light-style, QA): the association self-clears when the
                // delayed trigger returns the card at the next end step.
                ctx.linkExileToSource(targetId, ctx.sourceInstanceId);
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

// ─────────────────────────────────────────────────────────────────────────────
// Ocelot Pride — {W} Creature — Cat, 1/1 (MH3, issue #1461).
// "First strike, lifelink
//  Ascend
//  At the beginning of your end step, if you gained life this turn, create a
//  1/1 white Cat creature token. Then if you have the city's blessing, for
//  each token you control that entered this turn, create a token that's a
//  copy of it."
//
// The integration test for four capability tickets, all shipped:
//   * #1457 — `GameState.lifeGainedThisTurn` + the CR 603.4 intervening-if
//     ("if you gained life this turn"), checked at trigger time AND re-checked
//     immediately before resolution (CR 603.4). Same shape as Crested
//     Sunmare (`hou/white.ts`), narrowed to `scope: "your"` (CR 500.1 — the
//     controller's own end step).
//   * #1458 — the `EffectCardFilter.enteredThisTurn` clause, which reads the
//     real per-permanent `CardInstanceState.enteredOnTurn` stamp against
//     `GameState.turn`. ANDed with `isToken: true` here — "each TOKEN you
//     control that entered this turn" (CR 111.1 / 400.7).
//   * #1459 — the `createTokenCopy` Op (CR 707.2 / 111.1), reading its runtime
//     source from a `ref` rather than an announced target.
//   * #1460 — Ascend (CR 702.131) and the City's Blessing designation, gated
//     declaratively by the `{ hasCityBlessing: "controller" }` predicate.
//
// ORDERING (the crux). The Cat token created by the FIRST Op is itself "a
// token you control that entered this turn", so the second clause copies it
// too — the `forEach` runs AFTER `createToken`, so the Cat is already on the
// battlefield (with its `enteredOnTurn` stamp) when the set is selected. No
// cascade: `execForEach` selects its member set exactly ONCE at construct
// entry and freezes it (`#forEach:<pos>:set`, CR 608.2i — "information is
// determined only once, as the effect is applied"), so the copies the body
// creates — which are themselves tokens that entered this turn — are never
// added to the set being iterated. Asserted directly in the test file.
//
// ORDERING, part two — "THEN if you have the city's blessing". The Cat token
// can itself be the TENTH permanent that turns this card's own Ascend on, and
// the `if` below must already see the blessing. CR 702.131b is a STATIC ability
// ("any time you control ten or more permanents"), true at all times (CR 604.1)
// and NOT a state-based action — Gatherer: "If the creature token created by
// Ocelot Pride's last ability is your tenth permanent, you'll get the city's
// blessing before the ability would check to see if you have the city's
// blessing." `createTokenPermanents` therefore grants it eagerly, at token
// creation; evaluating Ascend only in the SBA sweep (CR 704.3 — next priority)
// silently dropped this whole clause.
//
// No `resolve()` anywhere: the whole card is an Effect Script (ADR 0045).
export const OCELOT_PRIDE_ID = "89cf6f57-230f-497e-a14e-ad1e8737fd42";

export const ocelotPride: CardDefinition = {
    id: OCELOT_PRIDE_ID,
    name: "Ocelot Pride",
    rarity: "mythic",
    oracleText:
        "First strike, lifelink\nAscend (If you control ten or more permanents, you get the city's blessing for the rest of the game.)\nAt the beginning of your end step, if you gained life this turn, create a 1/1 white Cat creature token. Then if you have the city's blessing, for each token you control that entered this turn, create a token that's a copy of it.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Cat"],
    power: 1,
    toughness: 1,
    // CR 702.7 / 702.15 / 702.131 — all three resolve to `implemented`
    // Mechanics Registry rows. Ascend's permanent form is a continuous check
    // in the SBA sweep (`gre/cityBlessing.ts`).
    staticAbilities: ["first strike", "lifelink", "ascend"],
    triggeredAbilities: [
        phaseTrigger({
            id: "ocelot-pride-end-step",
            oracleText:
                "At the beginning of your end step, if you gained life this turn, create a 1/1 white Cat creature token. Then if you have the city's blessing, for each token you control that entered this turn, create a token that's a copy of it.",
            phase: "END_STEP",
            scope: "your",
            // CR 603.4 / 603.4 intervening-if — mirrored into `matches` by
            // the factory (trigger time) and re-evaluated by the engine right
            // before resolution. A zero/absent tally is false.
            interveningIf: (_event, self, state) =>
                (state?.lifeGainedThisTurn?.[self.controllerId] ?? 0) > 0,
            effects: [
                // CR 111 / 707.1 — the unconditional half; the intervening-if
                // above is the only gate.
                {
                    op: "createToken",
                    token: {
                        name: "Cat",
                        types: ["Creature"],
                        subtypes: ["Cat"],
                        power: 1,
                        toughness: 1,
                        colors: ["W"],
                    },
                    controller: "controller",
                },
                {
                    // "Then if you have the city's blessing …" (CR 702.131b).
                    op: "if",
                    predicate: { hasCityBlessing: "controller" },
                    then: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                controller: "controller",
                                filter: {
                                    isToken: true,
                                    enteredThisTurn: true,
                                },
                            },
                            effects: [
                                {
                                    // CR 707.2 — a token that's a copy of the
                                    // current member of the FROZEN set.
                                    op: "createTokenCopy",
                                    source: { ref: "$each" },
                                    controller: "controller",
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
    ],
};
