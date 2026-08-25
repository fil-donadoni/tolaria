// MH3 — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type {
    CardDefinition,
    EffectOp,
    PermanentView,
    SpellContext,
    StaticEffectContext,
} from "../../types";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Psychic Frog — {U}{B} Creature — Frog 1/2.
// "Whenever this creature deals combat damage to a player or planeswalker,
//  draw a card." (CR 510.4 combat damage; CR 121.1 draw — a self-source
//  combat-damage trigger over the player-or-planeswalker recipient class.)
// "Discard a card: Put a +1/+1 counter on this creature." (CR 122.1 counter.)
// "Exile three cards from your graveyard: This creature gains flying until end
//  of turn." (CR 118.5 exile-from-graveyard cost; CR 611.2a temporary keyword
//  grant via `grantStaticAbility`.)
//
// FLAGGED SIMPLIFICATION (CR 602.1 / 118.3): the cost union has no "discard a (out of scope)
// CHOSEN card" activation cost (only `discardLastDrawn` / `discardAtRandom`), so
// the discard ability is modelled as a stack ability with an empty cost whose
// resolve performs the discard via a `requestChoice` and only adds the counter
// when a card is actually discarded. This mirrors the established Necropolis
// idiom (cost→resolve-time pick) and keeps gameplay faithful; the only deviation
// is that the discard happens on resolution rather than at activation.
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
        // Migrated resolve()→effects[] (ADR 0045, closes #1280): the
        // combat-damage draw rides `damageDealtTrigger`'s `effects` site.
        // The recipient class is the whole printed clause (issue #1855): a
        // planeswalker is a permanent (CR 110.1) and combat damage to one
        // removes loyalty (CR 120.3c), so it reaches the trigger as a
        // `permanent` target and needs the disjunctive discriminator — a
        // plain `kind: "player"` silently dropped "or planeswalker".
        damageDealtTrigger({
            id: "psychic-frog-combat-draw",
            oracleText:
                "Whenever this creature deals combat damage to a player or planeswalker, draw a card.",
            source: "self",
            isCombat: true,
            target: { kind: "player-or-planeswalker" },
            effects: [{ op: "draw", player: "controller", count: 1 }],
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
            cost: { exileFromGraveyard: { count: 3, owner: "you" } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #843): self-grant flying
            // until end of turn (CR 611.2a). The three-card graveyard exile is
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

// CR 702.138b — "sacrifice it unless it escaped": sacrifice $source when the
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
// any damageable permanent OR a player (CR 115.4); `{ target: 0 }` resolves to
// the same `{ type: "permanent" | "player", id }` ref `ctx.targets[0]` did, and
// the `dealDamage` Op no-ops identically when the target has left (CR 608.2b —
// `resolveObjectRef` mirrors the old `if (target)` guard). Migrated
// resolve()→effects[] (ADR 0045): plain fixed damage to an announced target +
// unconditional life gain, both registered Ops.
const phlageValueEffects: EffectOp[] = [
    { op: "dealDamage", amount: 3, to: { target: 0 } },
    { op: "gainLife", player: "controller", amount: 3 },
];

// Phlage, Titan of Fire's Fury — {1}{R}{W} Legendary Creature — Elder Giant 6/6.
// "When Phlage enters, sacrifice it unless it escaped." (CR 702.138b escaped.)
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
            effects: phlageValueEffects,
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
            effects: phlageValueEffects,
        },
    ],
    // CR 702.138 — Escape. {R}{R}{W}{W} + exile five OTHER graveyard cards.
    escape: { mana: { R: 2, W: 2 }, exile: { count: 5 } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Nadu, Winged Wisdom — {1}{G}{U} Legendary Creature — Bird Wizard 3/4.
// "Flying
//  Creatures you control have 'Whenever this creature becomes the target of a
//  spell or ability, reveal the top card of your library. If it's a land card,
//  put it onto the battlefield. Otherwise, put it into your hand. This ability
//  triggers only twice each turn.'"
//
// Three engine seams, none of them new machinery invented for this card:
//
// 1. The battlefield-wide GRANT (CR 113.1 granted ability + CR 611 continuous
//    filtered set) is the `triggered-grant` static effect Energy Flux
//    (`atq/blue.ts`) and The Tabernacle at Pendrell Vale (`leg/colorless.ts`)
//    already prove: the template lives on `triggeredGrantTemplates[]` (NOT on
//    `triggeredAbilities`, so the recipients own it and Nadu does not fire a
//    separate copy of its own), `effectiveTriggeredAbilities` unions it into
//    each recipient, and the trigger collector scans it AS IF PRINTED on that
//    creature — so `self` inside the template IS the targeted creature and
//    `"controller"` inside its Effect Script is that creature's controller
//    ("YOUR library"). Nadu itself is a creature it controls, so it receives
//    the grant too — correct, the Oracle text says "creatures you control".
//
// 2. The TRIGGER CONDITION is `BECAME_TARGET` (CR 603.2b, issue #1265) — the
//    same target-declaration event Leovold and Ward read, emitted for a cast
//    spell's locked targets (`gre/state.ts`) AND for an activated/triggered
//    ability's (`game.ts`), which is exactly the "spell or ability" span the
//    Oracle text asks for. Narrowed to THIS permanent (`event.target.id ===
//    self.id`), like Ward and unlike Leovold's controller-scoped match. NOT
//    narrowed to an opponent's spell/ability: Nadu (unlike Ward, CR 702.21a)
//    says plainly "becomes the target of a spell or ability", so targeting
//    your own creature triggers it — which is the whole engine of the card.
//
// 3. The PER-TURN CAP is `maxTriggersPerTurn: 2` (CR 603.2 — "This ability
//    triggers only twice each turn"). Counted PER SOURCE OBJECT on
//    `CardInstanceState.triggersThisTurn`, the trigger twin of
//    `activationsThisTurn`: each creature you control gets its OWN two
//    triggers per turn (which is what "this ability" means on a granted
//    ability), the cap is checked in `collectTriggers` BEFORE the ability
//    fires — so an over-quota trigger never reaches the stack at all, rather
//    than going on the stack and fizzling — and the tally resets at the turn
//    boundary (`gre/phases.ts`).
//
/** CR 205 / 611 — "creatures you control": the affected set is every creature
 *  under the SAME controller as Nadu, read off the LIVE types/controller so a
 *  permanent animated into a creature (or one that changes controller) joins or
 *  leaves the set as the layer system recomputes it. Mirrors Energy Flux's
 *  `IS_ARTIFACT` predicate shape exactly. */
const NADU_AFFECTS_YOUR_CREATURES: (
    target: PermanentView,
    source: PermanentView,
    ctx: StaticEffectContext
) => boolean = (target, source) =>
    target.types.includes("Creature") &&
    target.controllerId === source.controllerId;

// The effect itself is a plain Effect Script over the `revealTopAndRoute` Op
// (CR 701.20a reveal + CR 400.7 zone change): reveal the top card, route a
// land onto the battlefield, everything else into hand. The land ENTERS —
// it is not "played", so it costs no land drop (CR 305.2 / 400.7).
export const naduWingedWisdom: CardDefinition = {
    id: "94b67489-5eb0-4406-9bf3-27e50dc632eb",
    name: "Nadu, Winged Wisdom",
    rarity: "rare",
    oracleText:
        'Flying\nCreatures you control have "Whenever this creature becomes the target of a spell or ability, reveal the top card of your library. If it\'s a land card, put it onto the battlefield. Otherwise, put it into your hand. This ability triggers only twice each turn."',
    manaCost: { X: 1, G: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Bird", "Wizard"],
    power: 3,
    toughness: 4,
    staticAbilities: ["flying"],
    staticEffects: [
        // CR 113.1 / 611 — grant the became-target trigger to every creature
        // its controller controls, recomputed as creatures enter and leave.
        {
            kind: "triggered-grant",
            applies: NADU_AFFECTS_YOUR_CREATURES,
            abilityId: "nadu-became-target",
        },
    ],
    // Kept off `triggeredAbilities` so Nadu doesn't fire a SECOND copy of the
    // trigger on top of the one it receives as a creature its controller
    // controls — same convention as Energy Flux / Lavaspur Boots.
    triggeredGrantTemplates: [
        {
            id: "nadu-became-target",
            oracleText:
                "Whenever this creature becomes the target of a spell or ability, reveal the top card of your library. If it's a land card, put it onto the battlefield. Otherwise, put it into your hand. This ability triggers only twice each turn.",
            event: "BECAME_TARGET",
            // CR 603.2b — "whenever THIS CREATURE becomes the target of a
            // spell or ability". Pinned to this exact permanent, and
            // deliberately NOT filtered by the targeting source's controller:
            // unlike Ward (CR 702.21a, "an opponent controls") Nadu fires on
            // your own spells and abilities too.
            matches: (event, self) =>
                event.type === "BECAME_TARGET" &&
                event.target.type === "permanent" &&
                event.target.id === self.id,
            // CR 603.2 — "This ability triggers only twice each turn", tallied
            // per source object, so each creature has its own quota.
            maxTriggersPerTurn: 2,
            effects: [
                {
                    op: "revealTopAndRoute",
                    // The granted trigger's controller is the CREATURE's
                    // controller, so this is "your library" from the point of
                    // view of the Oracle text printed on that creature.
                    player: "controller",
                    routes: [{ filter: { type: "Land" }, to: "battlefield" }],
                    fallback: "hand",
                },
            ],
        },
    ],
};
