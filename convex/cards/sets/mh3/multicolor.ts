// MH3 — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, EffectOp, SpellContext } from "../../types";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Psychic Frog — {U}{B} Creature — Frog 1/2.
// "Whenever this creature deals combat damage to a player, draw a card." (CR
//  510.4 combat damage; CR 121.1 draw — a self-source combat-damage-to-player
//  trigger.)
// "Discard a card: Put a +1/+1 counter on this creature." (CR 122.1 counter.)
// "Exile three cards from your graveyard: This creature gains flying until end
//  of turn." (CR 118.5 exile-from-graveyard cost; CR 611.1b temporary keyword
//  grant via `grantStaticAbility`.)
//
// FLAGGED SIMPLIFICATION (CR 602.1 / 118.3): the cost union has no "discard a
// CHOSEN card" activation cost (only `discardLastDrawn` / `discardAtRandom`), so
// the discard ability is modelled as a stack ability with an empty cost whose
// resolve performs the discard via a `requestChoice` and only adds the counter
// when a card is actually discarded. This mirrors the established Necropolis
// idiom (cost→resolve-time pick) and keeps gameplay faithful; the only deviation
// is that the discard happens on resolution rather than at activation.
// (The engine has no planeswalkers, so the combat-damage trigger fires on
//  damage to a player only; the printed oracle text is preserved.)
export const psychicFrog: CardDefinition = {
    id: "68924203-c3d9-41ce-8ca8-c6dd491eb3ca",
    name: "Psychic Frog",
    rarity: "rare",
    oracleText:
        "Whenever this creature deals combat damage to a player or planeswalker, draw a card.\nDiscard a card: Put a +1/+1 counter on this creature.\nExile three cards from your graveyard: This creature gains flying until end of turn.",
    manaCost: { U: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Frog"],
    power: 1,
    toughness: 2,
    triggeredAbilities: [
        // NOT DSL-migratable (ADR 0045): the effect itself (draw one) is
        // trivially a `draw` Op, but the `damageDealtTrigger` factory only
        // exposes a `resolve` callback — it has no `effects` alternative to
        // hand a script to. Planned-migratable (blocked on the shared
        // trigger-factory helpers gaining an `effects` option, not this
        // card). tracked-by: #1280
        damageDealtTrigger({
            id: "psychic-frog-combat-draw",
            oracleText:
                "Whenever this creature deals combat damage to a player or planeswalker, draw a card.",
            source: "self",
            isCombat: true,
            target: { kind: "player", player: { relation: "any" } },
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.controller, 1);
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "psychic-frog-discard-pump",
            oracleText: "Discard a card: Put a +1/+1 counter on this creature.",
            cost: {},
            useStack: true,
            // NOT DSL-migratable (ADR 0045, issue #841): "Discard a card:" is
            // an activation COST (CR 118.3 / 602.1b), so with an empty hand the
            // ability is UNACTIVATABLE — the +1/+1 counter must not land. The
            // engine has no "discard a chosen card" activation cost (the cost
            // union offers only `discardLastDrawn` / `discardAtRandom`), and the
            // choice→discard→counters chain cannot express the cost-gating: on
            // an empty hand the choice/discard clamp to no-ops but a subsequent
            // `counters add` still fires, granting a free counter without paying
            // the discard. The `if` predicate grammar cannot test a choice
            // binding's cardinality (nor count the hand zone), so the counter
            // cannot be gated on the discard having happened. Kept as resolve():
            // the discard is performed via a resolve-time `requestChoice` and
            // the counter is added ONLY when a card is actually discarded (the
            // empty-hand early-return preserves the cost semantics). Mirrors the
            // established cost→resolve-time-pick Necropolis idiom.
            resolve: (ctx: SpellContext) => {
                const handIds = ctx.getHandIds(ctx.controller);
                if (handIds.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `psychic-frog-discard-${ctx.sourceInstanceId}`,
                    kind: "choose-hand-card",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card to put a +1/+1 counter on Psychic Frog.",
                });
                if (picks === undefined) return; // suspended on the discard choice
                if (picks.length === 0) return;
                ctx.discardCard(ctx.controller, picks[0]);
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "+1/+1",
                    1
                );
            },
        },
        {
            id: "psychic-frog-exile-flying",
            oracleText:
                "Exile three cards from your graveyard: This creature gains flying until end of turn.",
            cost: { exileFromGraveyard: { count: 3 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #843): self-grant flying
            // until end of turn (CR 611.1b). The three-card graveyard exile is
            // an activation cost (handled by the cost field), so the effect is
            // just the grant.
            effects: [
                {
                    op: "grantAbility",
                    ability: "flying",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// CR 702.138e — "sacrifice it unless it escaped": sacrifice $source when the
// escaped flag reads 0 (a non-escape cast). The escaped EffectValue resolves to
// 1 (escaped) or 0 (not); `< 1` selects the 0 case.
const phlageSacrificeUnlessEscaped: EffectOp[] = [
    {
        op: "if",
        predicate: {
            left: { escaped: { of: { ref: "$source" } } },
            op: "lt",
            right: 1,
        },
        then: [{ op: "sacrifice", target: { ref: "$source" } }],
    },
];

// Phlage's recurring value (fires on both enter and attack): it deals 3 damage
// to any target and you gain 3 life.
//
// TARGETING (CR 603.3d, CR 115.4 "any target"): the target is chosen when the
// trigger is put on the stack — declared as `targetRequirement: { type: "any",
// count: 1 }` on each TriggeredAbility (issue #1193 machinery,
// `raiseTriggerTargetSelection` in gre/rules.ts) — NOT a resolution-time
// `requestChoice`. That makes the damage subject to hexproof / protection /
// ward and fires "becomes the target of an ability" triggers, which the old
// choice-as-target workaround silently skipped. `type: "any"` legally targets
// any damageable permanent OR a player (CR 115.4); `ctx.targets[0]` is a
// `{ type: "permanent" | "player", id }` ref that `ctx.dealDamage` already
// handles for both branches. Kept as resolve() (not DSL) only because the plain
// damage + unconditional life-gain body reads the announced target slot.
function resolvePhlageValue(ctx: SpellContext): void {
    const target = ctx.targets[0];
    if (target) ctx.dealDamage(target, 3); // CR 608.2b — no-op if it left
    ctx.gainLife(ctx.controller, 3);
}

// Phlage, Titan of Fire's Fury — {1}{R}{W} Legendary Creature — Elder Giant 6/6.
// "When Phlage enters, sacrifice it unless it escaped." (CR 702.138e escaped.)
// "Whenever Phlage enters or attacks, it deals 3 damage to any target and you
//  gain 3 life."
// "Escape—{R}{R}{W}{W}, Exile five other cards from your graveyard." (CR 702.138.)
export const phlageTitanOfFiresFury: CardDefinition = {
    id: "e419cd0b-2449-4cc5-9ead-b9e45e271700",
    name: "Phlage, Titan of Fire's Fury",
    rarity: "mythic",
    oracleText:
        "When Phlage enters, sacrifice it unless it escaped.\nWhenever Phlage enters or attacks, it deals 3 damage to any target and you gain 3 life.\nEscape—{R}{R}{W}{W}, Exile five other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)",
    manaCost: { X: 1, R: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Elder", "Giant"],
    supertypes: ["Legendary"],
    power: 6,
    toughness: 6,
    triggeredAbilities: [
        enteredTrigger({
            id: "phlage-sacrifice-unless-escaped",
            oracleText: "When Phlage enters, sacrifice it unless it escaped.",
            scope: "self",
            effects: phlageSacrificeUnlessEscaped,
        }),
        enteredTrigger({
            id: "phlage-enters-value",
            oracleText:
                "Whenever Phlage enters, it deals 3 damage to any target and you gain 3 life.",
            scope: "self",
            // CR 603.3d / 115.4 — "any target" chosen when the trigger goes on
            // the stack (subject to hexproof/protection/ward), not at
            // resolution. count 1 = a single required target.
            targetRequirement: { type: "any", count: 1 },
            resolve: resolvePhlageValue,
        }),
        {
            id: "phlage-attacks-value",
            oracleText:
                "Whenever Phlage attacks, it deals 3 damage to any target and you gain 3 life.",
            event: "ATTACKERS_DECLARED",
            // CR 603.3d / 115.4 — "any target" chosen when the trigger goes on
            // the stack (subject to hexproof/protection/ward), not at
            // resolution. count 1 = a single required target.
            targetRequirement: { type: "any", count: 1 },
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: resolvePhlageValue,
        },
    ],
    // CR 702.138 — Escape. {R}{R}{W}{W} + exile five OTHER graveyard cards.
    escape: { mana: { R: 2, W: 2 }, exile: { count: 5 } },
};
