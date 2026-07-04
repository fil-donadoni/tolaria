// Limited Edition Alpha (LEA), the base set of Magic, split by colour per
// ADR 0043. Every entry is a CardDefinition — LEA is the root set whose cards
// later editions (LEB, 2ED, 3ED, …) reprint via CardPrint, resolving printId →
// definitionId → the shared LEA definition (ADR 0014). Modern Scryfall oracle
// text is authoritative (ADR 0004). Generic mana is encoded as `X: n`
// (e.g. {2}{R} → { X: 2, R: 1 }). Cards are classified by the colour identity
// of their mana cost (CR 202.2); lands and artifacts (no coloured cost) live in
// colorless.ts.

import type {
    ActivatedAbilityContext,
    CardDefinition,
    Color,
    Rarity,
    SpellContext,
    TargetSelection,
} from "../../types";
import { TARGET_ACL_PERMANENT } from "../../types";
import { makeDualLand, makeTapForMana } from "../../abilities";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { untapRestriction } from "../../abilities/static/untapRestriction";
import { tokenPrintIdFor } from "../../tokenPrintLookup";

export const ankhOfMishra: CardDefinition = {
    id: "f594b7aa-d44e-47c4-989b-565f881e25f1",
    rarity: "rare",
    name: "Ankh of Mishra",
    oracleText:
        "Whenever a land enters the battlefield, Ankh of Mishra deals 2 damage to that land's controller.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    triggeredAbilities: [
        enteredTrigger({
            id: "ankh-of-mishra-land-etb",
            oracleText:
                "Whenever a land enters the battlefield, Ankh of Mishra deals 2 damage to that land's controller.",
            scope: "any",
            filter: { types: "Land" },
            resolve: (ctx, _event, entered) => {
                ctx.dealDamage({ type: "player", id: entered.controllerId }, 2);
            },
        }),
    ],
};

// Basalt Monolith — "This artifact doesn't untap during your untap step.
// {T}: Add {C}{C}{C}. {3}: Untap this artifact." (CR 502.1 untap restriction,
// 605.1a/605.3a mana ability useStack: false, 605 activated abilities).
// The `does-not-untap` keyword is read by `untapStep` in `phases.ts`. The
// {3} untap is a non-mana activated ability that uses the stack so it can be
// responded to (the canonical {3} → reuse-for-mana combo with Power Artifact
// is out of scope of LEA's printed catalog, kept correct anyway).
export const basaltMonolith: CardDefinition = {
    id: "66a74c89-6f86-4ec8-af17-391cd5026054",
    rarity: "uncommon",
    name: "Basalt Monolith",
    oracleText:
        "This artifact doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{3}: Untap this artifact.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    staticAbilities: ["does-not-untap"],
    activatedAbilities: [
        makeTapForMana({
            id: "basalt-monolith-mana",
            oracleText: "{T}: Add {C}{C}{C}.",
            produces: { C: 3 },
        }),
        {
            id: "basalt-monolith-untap",
            oracleText: "{3}: Untap this artifact.",
            cost: { mana: { X: 3 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #842): untap the source
            // artifact (CR 701.26b). `$source` is the resolving permanent.
            effects: [
                { op: "tapUntap", action: "untap", target: { ref: "$source" } },
            ],
        },
    ],
};

export const blackLotus: CardDefinition = {
    id: "b0faa7f2-b547-42c4-a810-839da50dadfe",
    rarity: "rare",
    name: "Black Lotus",
    oracleText:
        "{T}, Sacrifice this artifact: Add three mana of any one color.",
    manaCost: { X: 0 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "black-lotus-mana",
            oracleText:
                "{T}, Sacrifice Black Lotus: Add three mana of any one color.",
            cost: { tap: true, sacrifice: true },
            effect: (ctx: ActivatedAbilityContext) => {
                // Color chosen at activation time, applied by engine
                ctx.addMana({ W: 3 });
            },
            useStack: false,
            manaChoices: [{ W: 3 }, { U: 3 }, { B: 3 }, { R: 3 }, { G: 3 }],
        },
    ],
};

export const blackVise: CardDefinition = {
    id: "76ac72f8-5b1e-4d67-a796-ef69cde27424",
    rarity: "uncommon",
    name: "Black Vise",
    oracleText:
        "As Black Vise enters the battlefield, choose an opponent.\nAt the beginning of the chosen player's upkeep, Black Vise deals X damage to that player, where X is the number of cards in their hand minus 4, minimum 0.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        phaseTrigger({
            id: "black-vise-upkeep",
            oracleText:
                "At the beginning of the chosen player's upkeep, Black Vise deals X damage to that player, where X is the number of cards in their hand minus 4, minimum 0.",
            phase: "UPKEEP",
            scope: "opponents",
            condition: (_event, _self, state) => {
                if (!state) return false;
                const opp = state.players.find(
                    (p) => p.id === _event.activePlayerId
                );
                if (!opp) return false;
                return opp.hand.length > 4;
            },
            resolve: (ctx, _event, scopedPlayerId) => {
                const handSize = ctx.getHandSize(scopedPlayerId);
                const damage = handSize - 4;
                if (damage > 0) {
                    ctx.dealDamage(
                        { type: "player", id: scopedPlayerId },
                        damage
                    );
                }
            },
        }),
    ],
};

// Celestial Prism — "{2}, {T}: Add one mana of any color." (CR 605.1a mana
// ability, 605.3a useStack: false). The choice of color is presented to the
// activator at activation time via `manaChoices`.
export const celestialPrism: CardDefinition = {
    id: "a47417cb-1ea7-4f65-ba06-e27a99373114",
    rarity: "uncommon",
    name: "Celestial Prism",
    oracleText: "{2}, {T}: Add one mana of any color.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "celestial-prism-mana",
            oracleText: "{2}, {T}: Add one mana of any color.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ W: 1 });
            },
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// Out of scope — see ADR 0010
// export const chaosOrb: CardDefinition = {
//     id: "92274971-7c4a-4326-b0fe-75e2d124f718",
//     name: "Chaos Orb",
//     oracleText: "{1}, {T}: If this artifact is on the battlefield, flip it onto the battlefield from a height of at least one foot. If this artifact turns over completely at least once during the flip, destroy all nontoken permanents it touches. Then destroy this artifact.",
//     manaCost: { X: 2 },
//     types: ["Artifact"],
// };

// Clockwork Beast — "This creature enters with seven +1/+0 counters on it. /
// At end of combat, if this creature attacked or blocked this combat, remove
// a +1/+0 counter from it. / {X}, {T}: Put up to X +1/+0 counters on this
// creature. Activate only if it has fewer than seven +1/+0 counters on it."
// (CR 122.1, 614.1c ETB counters; CR 603.6a end-of-combat trigger; layer 7d).
// The recharge ability uses the {X} mana cost pipeline on activated abilities
// (chosenX) and a `canActivate` precondition for the "fewer than seven" gate.
export const clockworkBeast: CardDefinition = {
    id: "27f916a2-0ace-44b5-99dc-72979af34db9",
    rarity: "rare",
    name: "Clockwork Beast",
    oracleText:
        "This creature enters with seven +1/+0 counters on it.\nAt end of combat, if this creature attacked or blocked this combat, remove a +1/+0 counter from it.\n{X}, {T}: Put up to X +1/+0 counters on this creature. This ability can't cause the total number of +1/+0 counters on this creature to be greater than seven. Activate only during your upkeep.",
    manaCost: { X: 6 },
    types: ["Artifact", "Creature"],
    subtypes: ["Beast"],
    power: 0,
    toughness: 4,
    entersWith: { counters: [{ type: "+1/+0", count: 7 }] },
    triggeredAbilities: [
        phaseTrigger({
            id: "clockwork-beast-decay",
            oracleText:
                "At end of combat, if this creature attacked or blocked this combat, remove a +1/+0 counter from it.",
            phase: "END_OF_COMBAT",
            scope: "each",
            // CR 603.4d intervening-if — checked at both trigger time and
            // resolve. The "attacked or blocked this combat" markers persist
            // past END_OF_COMBAT so the resolve-time re-check sees the same
            // values.
            interveningIf: (_event, self) =>
                self.hasAttackedThisTurn === true ||
                self.hasBlockedThisTurn === true,
            // CR 122 (issue #841) — shed one +1/+0 counter from the source.
            effects: [
                {
                    op: "counters",
                    action: "remove",
                    counter: "+1/+0",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "clockwork-beast-recharge",
            oracleText:
                "{X}, {T}: Put up to X +1/+0 counters on this creature. Activate only if it has fewer than seven +1/+0 counters on it.",
            cost: { mana: { X: "X" }, tap: true },
            useStack: true,
            canActivate: (source) => (source.counters?.["+1/+0"] ?? 0) < 7,
            resolve: (ctx: SpellContext) => {
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                const current = ctx.getCounterCount(self, "+1/+0");
                // Up to X counters, capped so the total never exceeds 7.
                const room = Math.max(0, 7 - current);
                const add = Math.min(ctx.getX(), room);
                if (add > 0) ctx.addCounter(self, "+1/+0", add);
            },
        },
    ],
};

// Conservator — "{3}, {T}: Prevent the next 2 damage that would be dealt
// to you this turn." (CR 615.1). 2-damage shield on the activator.
export const conservator: CardDefinition = {
    id: "c7824e2a-4eff-4f72-9216-0db30a4f4252",
    rarity: "uncommon",
    name: "Conservator",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "conservator-prevent",
            oracleText:
                "{3}, {T}: Prevent the next 2 damage that would be dealt to you this turn.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #845): a prevent-the-next-N
            // shield on the activating controller (CR 615.1).
            effects: [
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: { player: "controller" },
                    amount: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Copper Tablet — "At the beginning of each player's upkeep, Copper Tablet
// deals 1 damage to that player." (CR 603.6a phase trigger, 120.1 damage).
// Symmetric ping at every upkeep — same shape as Karma but flat 1 damage,
// not Swamp-scaled.
export const copperTablet: CardDefinition = {
    id: "30935e4a-013e-4c46-ad05-304df8e5dfa4",
    rarity: "uncommon",
    name: "Copper Tablet",
    oracleText:
        "At the beginning of each player's upkeep, this artifact deals 1 damage to that player.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    triggeredAbilities: [
        phaseTrigger({
            id: "copper-tablet-upkeep",
            oracleText:
                "At the beginning of each player's upkeep, Copper Tablet deals 1 damage to that player.",
            phase: "UPKEEP",
            scope: "each",
            resolve: (ctx, _event, playerId) => {
                ctx.dealDamage({ type: "player", id: playerId }, 1);
            },
        }),
    ],
};

// Color-sphere cycle — "Whenever a player casts a [color] spell, you may pay
// {1}. If you do, you gain 1 life." (CR 603.2 spell-cast trigger; CR 117.3a
// optional may-pay). Five identical artifacts modulo the filtered color, so
// they share one factory.
function makeColorSphere(args: {
    id: string;
    name: string;
    rarity: Rarity;
    oracleText?: string;
    color: Color;
    abilityIdSuffix: string;
    colorWord: string;
}): CardDefinition {
    return {
        id: args.id,
        name: args.name,
        rarity: args.rarity,
        oracleText: args.oracleText,
        manaCost: { X: 1 },
        types: ["Artifact"],
        triggeredAbilities: [
            spellCastTrigger({
                id: `${args.abilityIdSuffix}-life`,
                oracleText: `Whenever a player casts a ${args.colorWord.toLowerCase()} spell, you may pay {1}. If you do, you gain 1 life.`,
                scope: "any",
                filter: { colors: args.color },
                resolve: (ctx) => {
                    const accept = ctx.requestMayPay({
                        playerId: ctx.controller,
                        choiceId: ctx.controller,
                        cost: { X: 1 },
                        prompt: `Pay {1} to gain 1 life from ${args.name}?`,
                    });
                    if (accept === undefined) return;
                    if (accept) ctx.gainLife(ctx.controller, 1);
                },
            }),
        ],
    };
}

export const crystalRod: CardDefinition = makeColorSphere({
    id: "76693233-7961-4b7e-80f2-ed90e494c4aa",
    rarity: "uncommon",
    name: "Crystal Rod",
    oracleText:
        "Whenever a player casts a blue spell, you may pay {1}. If you do, you gain 1 life.",
    color: "U",
    abilityIdSuffix: "crystal-rod",
    colorWord: "Blue",
});

// Cyclopean Tomb — "{2}, {T}: Put a mire counter on target non-Swamp land.
// That land is a Swamp for as long as it has a mire counter on it.
// When this is put into a graveyard from the battlefield, remove all mire
// counters and each land that had one becomes a Forest." (Simplified from
// the modern Oracle text for LEA scope.)
// CR 305.7 conditional subtype-set (mire counter > 0), CR 603.10 LTB.
export const cyclopeanTomb: CardDefinition = {
    id: "894c5cf2-8ae2-427a-bcbc-67df0bdfee9d",
    rarity: "rare",
    name: "Cyclopean Tomb",
    oracleText:
        "{2}, {T}: Put a mire counter on target non-Swamp land. That land is a Swamp for as long as it has a mire counter on it.\nWhen Cyclopean Tomb is put into a graveyard from the battlefield, remove all mire counters from all lands. Each land that had a mire counter removed this way becomes a Forest.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "cyclopean-tomb-mire",
            cost: { tap: true, mana: { X: 2 } },
            useStack: true,
            oracleText:
                "{2}, {T}: Put a mire counter on target non-Swamp land.",
            targetRequirement: {
                type: "Land",
                count: 1,
                excludeSubtypes: ["Swamp"],
            },
            // CR 122 (issue #841) — put a mire counter on the targeted land.
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "mire",
                    target: { target: 0 },
                    count: 1,
                },
            ],
        },
    ],
    staticEffects: [
        {
            kind: "subtype-set",
            applies: (target) => (target.counters?.mire ?? 0) > 0,
            subtypes: ["Swamp"],
        },
    ],
    triggeredAbilities: [
        leftTrigger({
            id: "cyclopean-tomb-ltb",
            oracleText:
                "When Cyclopean Tomb is put into a graveyard from the battlefield, remove all mire counters from all lands. Each land that had a mire counter removed this way becomes a Forest.",
            scope: "self",
            toZone: "graveyard",
            resolve: (ctx) => {
                for (const player of ctx.apNapOrder()) {
                    const lands = ctx.getBattlefieldIds(player, {
                        types: "Land",
                    });
                    for (const landId of lands) {
                        const target: TargetSelection = {
                            type: "permanent",
                            id: landId,
                        };
                        const count = ctx.removeCounter(target, "mire", 999);
                        if (count > 0) {
                            ctx.setSubtypes(target, ["Forest"]);
                        }
                    }
                }
            },
        }),
    ],
};

export const dingusEgg: CardDefinition = {
    id: "65eb6cda-e512-40a8-9c1f-335b713409ff",
    rarity: "rare",
    name: "Dingus Egg",
    oracleText:
        "Whenever a land is put into a graveyard from the battlefield, Dingus Egg deals 2 damage to that land's controller.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    triggeredAbilities: [
        leftTrigger({
            id: "dingus-egg-land-dies",
            oracleText:
                "Whenever a land is put into a graveyard from the battlefield, Dingus Egg deals 2 damage to that land's controller.",
            scope: "any",
            toZone: "graveyard",
            filter: { types: "Land" },
            resolve: (ctx, _event, leaving) => {
                ctx.dealDamage({ type: "player", id: leaving.controllerId }, 2);
            },
        }),
    ],
};

// Forcefield — "{1}: The next time an unblocked creature of your choice would
// deal combat damage to you this turn, prevent all but 1 of that damage."
// (CR 615.1 damage prevention, one-shot cap shield). Activated ability adds a
// damage-cap shield consumed at combat damage time.
export const forcefield: CardDefinition = {
    id: "3f2004c1-8efe-407f-bf48-27b807422eea",
    rarity: "rare",
    name: "Forcefield",
    oracleText:
        "{1}: The next time an unblocked creature of your choice would deal combat damage to you this turn, prevent all but 1 of that damage.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "forcefield-activate",
            oracleText:
                "{1}: Prevent all but 1 combat damage from the next unblocked creature.",
            cost: { mana: { X: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addDamageCapShield(ctx.controller, 1);
            },
        },
    ],
};

export const gauntletOfMight: CardDefinition = {
    id: "da248001-ed75-4b68-9532-37d3cd5afc4c",
    rarity: "rare",
    name: "Gauntlet of Might",
    oracleText:
        "Red creatures get +1/+1.\nWhenever a Mountain is tapped for mana, its controller adds an additional {R}.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.getColors(target).includes("R"),
            power: 1,
            toughness: 1,
        },
    ],
    triggeredAbilities: [
        tappedTrigger({
            id: "gauntlet-mana-bonus",
            oracleText:
                "Whenever a Mountain is tapped for mana, its controller adds an additional {R}.",
            scope: "any",
            filter: { subtypes: "Mountain" },
            forMana: true,
            resolve: (ctx, _event, tapped) => {
                ctx.addManaTo(tapped.controllerId, { R: 1 });
            },
        }),
    ],
};

// Glasses of Urza — {1} Artifact. "{T}: Look at target player's hand."
// (CR 401.4 — "look at" is a one-time reveal to the ability's controller).
// ADR 0026 / PRD #338 (slice 3): the look is a _hand_ knowledge grant. The
// controller legitimately learns the target's hand, so once the reveal is
// acknowledged each card currently in that hand becomes `knownTo` the
// controller (and only them). The knowledge persists after the ability
// resolves — projecting the known cards face-up to the controller and an eye
// icon to the hand owner — until a clear event (a random/owner-chosen discard
// reverts the whole hand to hidden, CR 701.8; entering a public zone clears
// the individual card). A drawn card the controller had not seen stays hidden.
export const glassesOfUrza: CardDefinition = {
    id: "cafc2350-5d64-4379-9198-79a114654d45",
    rarity: "uncommon",
    name: "Glasses of Urza",
    oracleText: "{T}: Look at target player's hand.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "glasses-look",
            cost: { tap: true },
            oracleText: "{T}: Look at target player's hand.",
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                // First call enqueues the reveal-hand display choice and
                // returns undefined (suspend; the resolve must return early).
                // The re-invocation after the controller acknowledges returns a
                // non-undefined value (the ack carries no ids of its own).
                const ack = ctx.revealHand(target.id);
                if (ack === undefined) return;
                // CR 401.4 — the controller now knows the hand. Stamp every
                // card currently in the target's hand `knownTo` the controller
                // so the knowledge outlives the ability.
                const handIds = ctx.getHandCards(target.id).map((c) => c.id);
                ctx.markKnown(target.id, handIds, ctx.controller);
            },
        },
    ],
};

// Helm of Chatzuk — "{1}, {T}: Target creature gains banding until end of
// turn." Temporary keyword grant (CR 611.1b) via grantStaticAbility with an
// end-of-turn duration, mirroring Jump (flying).
export const helmOfChatzuk: CardDefinition = {
    id: "3792c6ef-c4e6-4923-9a51-7d28fbc5c393",
    rarity: "rare",
    name: "Helm of Chatzuk",
    oracleText: "{1}, {T}: Target creature gains banding until end of turn.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "helm-of-chatzuk-grant-banding",
            oracleText:
                "{1}, {T}: Target creature gains banding until end of turn.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #843): grant banding to the
            // announced target creature until end of turn (CR 611.1b).
            effects: [
                {
                    op: "grantAbility",
                    ability: "banding",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Howling Mine — "At the beginning of each player's draw step, if this
// artifact is untapped, that player draws an additional card."
// CR 603.6a (beginning-of-step trigger), CR 603.4 (intervening-if: condition
// checked at trigger time AND again at resolution). Fires on DRAW for both
// players — the active player at the time of the trigger is the one who
// draws, not the artifact's controller.
export const howlingMine: CardDefinition = {
    id: "51f8f6e1-a451-4262-90d3-5107caf54175",
    rarity: "rare",
    name: "Howling Mine",
    oracleText:
        "At the beginning of each player's draw step, if this artifact is untapped, that player draws an additional card.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    triggeredAbilities: [
        phaseTrigger({
            id: "howling-mine-draw",
            oracleText:
                "At the beginning of each player's draw step, if Howling Mine is untapped, that player draws an additional card.",
            phase: "DRAW",
            scope: "each",
            // CR 603.4d intervening-if — checked at both trigger time and
            // resolve. If the artifact is tapped between trigger and
            // resolve (Icy Manipulator response), the trigger fizzles.
            interveningIf: (_event, self) => !self.isTapped,
            resolve: (ctx, _event, playerId) => {
                ctx.drawCards(playerId, 1);
            },
        }),
    ],
};

// Icy Manipulator — "{1}, {T}: Tap target artifact, creature, or land."
// CR 701.20a (tap), CR 605 (activated abilities), CR 602.2 (target selection
// at activation). Uses the stack (not a mana ability) so it can be responded to.
export const icyManipulator: CardDefinition = {
    id: "29dc1596-a2e7-4d60-9f99-89babaef8a06",
    rarity: "uncommon",
    name: "Icy Manipulator",
    oracleText: "{1}, {T}: Tap target artifact, creature, or land.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "icy-manipulator-tap",
            oracleText: "{1}, {T}: Tap target artifact, creature, or land.",
            cost: { tap: true, mana: { X: 1 } },
            useStack: true,
            targetRequirement: TARGET_ACL_PERMANENT,
            // Migrated resolve()→effects[] (ADR 0045, #842): tap the announced
            // artifact/creature/land target (CR 701.26a).
            effects: [{ op: "tapUntap", action: "tap", target: { target: 0 } }],
        },
    ],
};

// Illusionary Mask — masked-cast path (ADR 0013, #123). The activated
// ability spends {X}, lets the controller pick an eligible creature card from
// hand, and casts it face down as a 2/2 creature spell paying no mana cost
// (CR 708.2). It resolves into a face-down permanent (built in #122).
//
// Eligibility simplification: the card reads "creature card whose mana cost
// could be paid by some amount of, or all of, the mana you spent on {X}". The
// {X} is colourless/generic mana; a strict colour-pip match would make nearly
// no creature eligible, defeating the card's intent. We approximate with the
// standard digital reading — mana value <= X (CR 202.3b: X counts as 0 in the
// candidate's printed cost).
//
// "Activate only as a sorcery" is approximated by a main-phase + own-turn
// restriction; the empty-stack requirement is not enforced (minor).
//
// Turn-up (the "would deal/be dealt damage or become tapped -> turn face up"
// clause) is out of scope for this slice and lands in #124.
export const illusionaryMask: CardDefinition = {
    id: "62ef2f37-b8ad-47ad-89ca-d6abcb7ff21b",
    rarity: "rare",
    name: "Illusionary Mask",
    oracleText:
        "{X}: You may choose a creature card in your hand whose mana cost could be paid by some amount of, or all of, the mana you spent on {X}. If you do, you may cast that card face down as a 2/2 creature spell without paying its mana cost. If the creature that spell becomes as it resolves has not been turned face up and would assign or deal damage, be dealt damage, or become tapped, instead it's turned face up and assigns or deals damage, is dealt damage, or becomes tapped. Activate only as a sorcery.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "illusionary-mask-cast",
            oracleText:
                "{X}: You may choose a creature card in your hand whose mana cost could be paid by some amount of, or all of, the mana you spent on {X}. If you do, you may cast that card face down as a 2/2 creature spell without paying its mana cost. Activate only as a sorcery.",
            cost: { mana: { X: "X" } },
            useStack: true,
            controllerTurnOnly: true,
            activationPhaseRestriction: ["PRECOMBAT_MAIN", "POSTCOMBAT_MAIN"],
            resolve: (ctx: SpellContext) => {
                const x = ctx.getX();
                const eligible = ctx
                    .getHandCards(ctx.caster)
                    .filter(
                        (c) => c.types.includes("Creature") && c.manaValue <= x
                    )
                    .map((c) => c.id);
                if (eligible.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: ctx.caster,
                    choiceId: "illusionary-mask-pick",
                    kind: "choose-hand-card",
                    zone: "hand",
                    count: { min: 0, max: 1 },
                    candidateIds: eligible,
                    prompt: "Illusionary Mask: choose a creature to cast face down, or skip.",
                });
                if (picks === undefined) return; // suspended — resume later
                if (picks.length === 0) return; // declined ("you may")
                ctx.castFaceDown(picks[0]);
            },
        },
    ],
};

export const ironStar: CardDefinition = makeColorSphere({
    id: "5786de12-cade-43c2-a6b0-0c5b294b9d0e",
    rarity: "uncommon",
    name: "Iron Star",
    oracleText:
        "Whenever a player casts a red spell, you may pay {1}. If you do, you gain 1 life.",
    color: "R",
    abilityIdSuffix: "iron-star",
    colorWord: "Red",
});

export const ivoryCup: CardDefinition = makeColorSphere({
    id: "9964d8d8-dc97-4e5f-9f52-173f7e2c37fd",
    rarity: "uncommon",
    name: "Ivory Cup",
    oracleText:
        "Whenever a player casts a white spell, you may pay {1}. If you do, you gain 1 life.",
    color: "W",
    abilityIdSuffix: "ivory-cup",
    colorWord: "White",
});

// Jade Monolith — "{1}: The next time a source of your choice would deal
// damage to target creature this turn, that source deals that damage to you
// instead." (CR 614 one-shot transient redirection.) The activated ability
// targets the creature at activation (CR 601.2c) and resolves with a
// `requestChoice` step that asks the activator to name the specific source
// (CR 109.4 — typically a battlefield permanent). The chosen source id is
// baked into a `from-source-to-permanent-redirect-to-player` shield with
// `remaining: 1`. The shield self-purges either on first match or at end of
// turn. If the activator's `requestChoice` is skipped (the engine prompt
// can return an empty list when no candidates exist), the shield falls back
// to wildcard-source matching so the activation isn't wasted.
export const jadeMonolith: CardDefinition = {
    id: "4a77e0f1-449d-4a7d-9fa0-ba7598f7a73a",
    rarity: "rare",
    name: "Jade Monolith",
    oracleText:
        "{1}: The next time a source of your choice would deal damage to target creature this turn, that source deals that damage to you instead.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "jm-redirect",
            oracleText:
                "{1}: The next time a source of your choice would deal damage to target creature this turn, that source deals that damage to you instead.",
            cost: { mana: { X: 1 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (!t || t.type !== "permanent") return;
                const sourcePicks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `jm-source-${ctx.sourceInstanceId}`,
                    kind: "pick-source",
                    zone: "battlefield",
                    count: 1,
                    prompt: "Jade Monolith: pick the source whose next damage to the chosen creature is redirected to you.",
                });
                if (sourcePicks === undefined) return;
                const sourceId = sourcePicks[0];
                ctx.addDamageRedirectionShield({
                    kind: "from-source-to-permanent-redirect-to-player",
                    sourceInstanceId: sourceId,
                    targetInstanceId: t.id,
                    redirectToPlayerId: ctx.controller,
                    remaining: 1,
                    duration: { phase: "end-of-turn" },
                });
            },
        },
    ],
};

// Jade Statue — "{2}: This artifact becomes a 3/6 Golem artifact creature
// until end of combat. Activate only during combat." (CR 208.2, 611.1,
// 511.3, 602.5). The "activate only during combat" restriction is enforced
// via `activationPhaseRestriction`; the animate-self effect uses the shared
// parametric-duration system with `phase: "end-of-combat"` so it reverts
// automatically at the END_OF_COMBAT step.
export const jadeStatue: CardDefinition = {
    id: "8d82d94b-ceef-4533-a4f2-b6442a61b839",
    rarity: "uncommon",
    name: "Jade Statue",
    oracleText:
        "{2}: This artifact becomes a 3/6 Golem artifact creature until end of combat. Activate only during combat.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "jade-statue-animate",
            oracleText:
                "{2}: This artifact becomes a 3/6 Golem artifact creature until end of combat. Activate only during combat.",
            cost: { mana: { X: 2 } },
            useStack: true,
            animatesSelf: true,
            activationPhaseRestriction: [
                "BEGINNING_OF_COMBAT",
                "DECLARE_ATTACKERS",
                "DECLARE_BLOCKERS",
                "FIRST_STRIKE_DAMAGE",
                "COMBAT_DAMAGE",
                "END_OF_COMBAT",
            ],
            resolve: (ctx: SpellContext) => {
                ctx.animateAsCreature(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    {
                        power: 3,
                        toughness: 6,
                        subtype: "Golem",
                        duration: { phase: "end-of-combat" },
                    }
                );
            },
        },
    ],
};

// Jayemdae Tome — "{4}, {T}: Draw a card." CR 107.1 (mana cost symbols), CR
// 602.1 (activated abilities), CR 121.1 (drawing a card). Uses the stack
// (useStack: true) — this is a non-mana activated ability (CR 605.1a).
export const jayemdaeTome: CardDefinition = {
    id: "cac8c421-5b92-481d-b2de-560c0231ab58",
    rarity: "rare",
    name: "Jayemdae Tome",
    oracleText: "{4}, {T}: Draw a card.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "jayemdae-tome-draw",
            oracleText: "{4}, {T}: Draw a card.",
            cost: { tap: true, mana: { X: 4 } },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};

// Juggernaut — "This creature attacks each combat if able. This creature can't
// be blocked by Walls." CR 508.1d (attack requirement), CR 509.1b (block
// restriction by subtype).
export const juggernaut: CardDefinition = {
    id: "dcd6a291-5282-4f49-8203-d9b416083c48",
    rarity: "uncommon",
    name: "Juggernaut",
    oracleText:
        "This creature attacks each combat if able.\nThis creature can't be blocked by Walls.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Juggernaut"],
    power: 5,
    toughness: 3,
    staticAbilities: [],
    staticEffects: [
        {
            // CR 508.1d — attacks each combat if able
            kind: "attack-requirement" as const,
            id: "juggernaut-attacks-if-able",
            oracleText: "Juggernaut attacks each combat if able.",
        },
        {
            kind: "block-restriction",
            id: "juggernaut-no-walls",
            side: "attacker" as const,
            // CR 509.1b — can't be blocked by Walls
            predicate: (_self, opponent) => !opponent.subtypes.includes("Wall"),
            oracleText: "This creature can't be blocked by Walls.",
        },
    ],
};

// Kormus Bell — "All Swamps are 1/1 black creatures that are still lands."
// (CR 305.7 type-add + pt-cda + color-grant). Same pattern as Living Lands
// but for Swamps + grants black color.
export const kormusBell: CardDefinition = {
    id: "3f4ef7a1-148d-44ac-89ed-0ef379cca0c6",
    rarity: "rare",
    name: "Kormus Bell",
    oracleText: "All Swamps are 1/1 black creatures that are still lands.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "type-add",
            applies: (target) => target.subtypes.includes("Swamp"),
            types: ["Creature"],
        },
        {
            kind: "pt-cda",
            applies: (target) => target.subtypes.includes("Swamp"),
            compute: () => ({ power: 1, toughness: 1 }),
        },
        {
            kind: "color-grant",
            applies: (target) => target.subtypes.includes("Swamp"),
            colors: ["B"],
        },
    ],
};

// Library of Leng — "You have no maximum hand size. If an effect causes you
// to discard a card, discard it, but you may put it on top of your library
// instead of into your graveyard." (CR 402.2 / 514.1 + CR 614 discard
// replacement.) The first clause is a `StaticHandSizeOverride` ("unlimited")
// — read by `effectiveMaxHandSize` in `convex/gre/phases.ts` at CLEANUP, so
// the controller is never prompted to discard down to seven while the
// artifact is in play. No PlayerState mutation: the override is computed
// inline from the battlefield (mirror of the `untap-restriction` pattern),
// so multiple copies / mid-turn enter/leave events need no bookkeeping.
//
// The "may" clause is resolved via `state.playerPreferences[playerId]
// .libraryOfLengRouting`, which the UI can toggle through a dedicated
// mutation. The default is "library" (Library of Leng activates) — set to
// "graveyard" to opt OUT and route the discard normally. Modeling player
// choice this way (state-level preference) avoids the mid-event suspension
// that would be needed for a true requestMayPay flow inside a replacement
// effect; the preference is replay-stable and toggleable at any time.
export const libraryOfLeng: CardDefinition = {
    id: "2340edcb-8cd5-4ccd-99e2-b9a29f72c495",
    rarity: "uncommon",
    name: "Library of Leng",
    oracleText:
        "You have no maximum hand size.\nIf an effect causes you to discard a card, discard it, but you may put it on top of your library instead of into your graveyard.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "hand-size-override",
            value: "unlimited",
        },
    ],
    replacementEffects: [
        {
            id: "leng-discard",
            oracleText:
                "If an effect causes you to discard a card, you may put that card on top of your library instead of into your graveyard.",
            eventKind: "discard",
            appliesTo: (event, self, state) => {
                if (event.kind !== "discard") return false;
                if (event.playerId !== self.controllerId) return false;
                const player = state.players.find(
                    (p) => p.id === event.playerId
                );
                // "May" opt-out: the player can preset
                // libraryOfLengRouting: "graveyard" to bypass the redirect.
                // Default (undefined) routes to the library.
                return (
                    (player?.preferences?.libraryOfLengRouting ?? "library") ===
                    "library"
                );
            },
            replace: (event, ctx) => {
                if (event.kind !== "discard") return { kind: "consumed" };
                ctx.moveHandCardToLibraryTop(
                    event.playerId,
                    event.cardInstanceId
                );
                return { kind: "consumed" };
            },
        },
    ],
};

export const livingWall: CardDefinition = {
    id: "4a98ada6-923a-44a5-bdef-ea6a160b481e",
    rarity: "uncommon",
    name: "Living Wall",
    oracleText:
        "Defender (This creature can't attack.)\n{1}: Regenerate Living Wall.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 6,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "living-wall-regenerate",
            oracleText: "{1}: Regenerate Living Wall.",
            cost: { mana: { X: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};

// Mana Vault — "This artifact doesn't untap during your untap step. At the
// beginning of your upkeep, you may pay {4}. If you do, untap this artifact.
// At the beginning of your draw step, if this artifact is tapped, it deals 1
// damage to you. {T}: Add {C}{C}{C}." (CR 502.1, 603.4 intervening-if,
// 117.3a optional cost, 120.3 damage). The draw-step damage trigger uses an
// intervening-if at both trigger and resolve time per CR 603.4.
export const manaVault: CardDefinition = {
    id: "19499cb7-eccb-4e69-af32-6002d447a160",
    rarity: "rare",
    name: "Mana Vault",
    oracleText:
        "This artifact doesn't untap during your untap step.\nAt the beginning of your upkeep, you may pay {4}. If you do, untap this artifact.\nAt the beginning of your draw step, if this artifact is tapped, it deals 1 damage to you.\n{T}: Add {C}{C}{C}.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    staticAbilities: ["does-not-untap"],
    triggeredAbilities: [
        phaseTrigger({
            id: "mana-vault-upkeep",
            oracleText:
                "At the beginning of your upkeep, you may pay {4}. If you do, untap this artifact.",
            phase: "UPKEEP",
            scope: "your",
            // Migrated resolve()→effects[] (ADR 0045, #842): may pay {4}; if
            // paid, untap the source (CR 117.3a optional cost, 701.26b). A
            // `your`-scoped phaseTrigger so the scoped player == controller.
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: { X: 4 },
                    prompt: "Pay {4} to untap Mana Vault?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { binding: "$paid" },
                    then: [
                        {
                            op: "tapUntap",
                            action: "untap",
                            target: { ref: "$source" },
                        },
                    ],
                },
            ],
        }),
        phaseTrigger({
            id: "mana-vault-draw-damage",
            oracleText:
                "At the beginning of your draw step, if this artifact is tapped, it deals 1 damage to you.",
            phase: "DRAW",
            scope: "your",
            // CR 603.4d intervening-if — checked at both trigger time and
            // resolve. If the artifact has untapped between trigger and
            // resolve (e.g. paid upkeep), the ping fizzles.
            interveningIf: (_event, self) => self.isTapped === true,
            resolve: (ctx) => {
                ctx.dealDamage({ type: "player", id: ctx.controller }, 1);
            },
        }),
    ],
    activatedAbilities: [
        makeTapForMana({
            id: "mana-vault-mana",
            oracleText: "{T}: Add {C}{C}{C}.",
            produces: { C: 3 },
        }),
    ],
};

// Meekstone — "Creatures with power 3 or greater don't untap during their
// controllers' untap steps." (CR 502.1, 613 layer 7c). Encoded as a
// data-driven `untapRestriction` (ADR 0002 / 0005) on the Creature filter
// with `powerAtLeast: 3` and `maxUntap: 0`: the engine dispatcher reads
// effective power at untap time, so layer 7c buffs (Crusade, Holy Strength)
// flip eligibility correctly. Hard skip (cap=0) — no prompt, the matching
// creatures stay tapped.
export const meekstone: CardDefinition = {
    id: "13a68a17-22ee-47c9-870a-83e911862b94",
    rarity: "rare",
    name: "Meekstone",
    oracleText:
        "Creatures with power 3 or greater don't untap during their controllers' untap steps.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    staticEffects: [
        untapRestriction({
            id: "meekstone-power-skip",
            oracleText:
                "Creatures with power 3 or greater don't untap (Meekstone).",
            filter: { types: "Creature", powerAtLeast: 3 },
            maxUntap: 0,
        }),
    ],
};

export const moxEmerald: CardDefinition = {
    id: "b0e1427c-05cd-465b-be59-97ed6e39f7ba",
    rarity: "rare",
    name: "Mox Emerald",
    oracleText: "{T}: Add {G}.",
    manaCost: { X: 0 },
    types: ["Artifact"],
    activatedAbilities: [
        makeTapForMana({
            id: "mox-emerald-mana",
            oracleText: "{T}: Add {G}.",
            produces: { G: 1 },
        }),
    ],
};

export const moxJet: CardDefinition = {
    id: "92bcd1ce-19b1-4d78-8b09-95242ca08d76",
    rarity: "rare",
    name: "Mox Jet",
    oracleText: "{T}: Add {B}.",
    manaCost: { X: 0 },
    types: ["Artifact"],
    activatedAbilities: [
        makeTapForMana({
            id: "mox-jet-mana",
            oracleText: "{T}: Add {B}.",
            produces: { B: 1 },
        }),
    ],
};

export const moxPearl: CardDefinition = {
    id: "8ebe4be7-e12a-4596-a899-fbd5b152e879",
    rarity: "rare",
    name: "Mox Pearl",
    oracleText: "{T}: Add {W}.",
    manaCost: { X: 0 },
    types: ["Artifact"],
    activatedAbilities: [
        makeTapForMana({
            id: "mox-pearl-mana",
            oracleText: "{T}: Add {W}.",
            produces: { W: 1 },
        }),
    ],
};

export const moxRuby: CardDefinition = {
    id: "8945585f-4773-493d-a0fe-d707db910b38",
    rarity: "rare",
    name: "Mox Ruby",
    oracleText: "{T}: Add {R}.",
    manaCost: { X: 0 },
    types: ["Artifact"],
    activatedAbilities: [
        makeTapForMana({
            id: "mox-ruby-mana",
            oracleText: "{T}: Add {R}.",
            produces: { R: 1 },
        }),
    ],
};

export const moxSapphire: CardDefinition = {
    id: "82da0972-b17b-4600-9efd-e9430a0db04b",
    rarity: "rare",
    name: "Mox Sapphire",
    oracleText: "{T}: Add {U}.",
    manaCost: { X: 0 },
    types: ["Artifact"],
    activatedAbilities: [
        makeTapForMana({
            id: "mox-sapphire-mana",
            oracleText: "{T}: Add {U}.",
            produces: { U: 1 },
        }),
    ],
};

export const nevinyrralsDisk: CardDefinition = {
    id: "12926dc8-8e6f-4a47-a12b-4d674189615a",
    rarity: "rare",
    name: "Nevinyrral's Disk",
    oracleText:
        "This artifact enters tapped.\n{1}, {T}: Destroy all artifacts, creatures, and enchantments.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "nevinyrral-destroy",
            oracleText:
                "{1}, {T}: Destroy all artifacts, creatures, and enchantments.",
            cost: { tap: true, mana: { X: 1 } },
            useStack: true,
            // destroyAll → forEach-per-type (CR 701.7). A permanent matching
            // more than one type (e.g. an artifact creature) is destroyed on
            // its first pass and skipped on later passes (CR 608.2b).
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Artifact" },
                    },
                    effects: [{ op: "destroy", target: { ref: "$each" } }],
                },
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [{ op: "destroy", target: { ref: "$each" } }],
                },
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Enchantment" },
                    },
                    effects: [{ op: "destroy", target: { ref: "$each" } }],
                },
            ],
        },
    ],
};

export const obsianusGolem: CardDefinition = {
    id: "4c8e9f5c-deba-4443-bf9d-fb2be75c5418",
    rarity: "uncommon",
    name: "Obsianus Golem",
    manaCost: { X: 6 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 4,
    toughness: 6,
};

// Rod of Ruin — "{3}, {T}: Rod of Ruin deals 1 damage to any target." (CR
// 605 activated ability, 120.1 damage). Same shape as Prodigal Sorcerer's
// ping but on an artifact body.
export const rodOfRuin: CardDefinition = {
    id: "af957200-c538-4f52-b105-6db7a7abb4dc",
    rarity: "uncommon",
    name: "Rod of Ruin",
    oracleText: "{3}, {T}: This artifact deals 1 damage to any target.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "rod-of-ruin-shoot",
            oracleText: "{3}, {T}: Rod of Ruin deals 1 damage to any target.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};

export const solRing: CardDefinition = {
    id: "c4300d24-1cae-4dd5-be7e-38cc677cf5bd",
    rarity: "uncommon",
    name: "Sol Ring",
    oracleText: "{T}: Add {C}{C}.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        makeTapForMana({
            id: "sol-ring-mana",
            oracleText: "{T}: Add {C}{C}.",
            produces: { C: 2 },
        }),
    ],
};

// Soul Net — "Whenever a creature dies, you may pay {1}. If you do, you gain
// 1 life." (CR 603.2 death trigger; CR 117.3a optional may-pay).
export const soulNet: CardDefinition = {
    id: "2b814198-814b-4619-a158-327af675f8f2",
    rarity: "uncommon",
    name: "Soul Net",
    oracleText:
        "Whenever a creature dies, you may pay {1}. If you do, you gain 1 life.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        diedTrigger({
            id: "soul-net-life",
            oracleText:
                "Whenever a creature dies, you may pay {1}. If you do, you gain 1 life.",
            scope: "any",
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: ctx.controller,
                    cost: { X: 1 },
                    prompt: "Pay {1} to gain 1 life from Soul Net?",
                });
                if (accept === undefined) return;
                if (accept) ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
};

// Sunglasses of Urza — "You may spend white mana as though it were red mana."
// (CR 609.4b mana substitution.) Declared as a `mana-substitution` static
// effect; `getManaSubstitutions` scans the controller's battlefield live at
// payment time, so removing the artifact reverts the substitution with no
// per-player persisted state.
export const sunglassesOfUrza: CardDefinition = {
    id: "c0d433a4-76c0-4f27-836d-4c0c13a511fb",
    rarity: "rare",
    name: "Sunglasses of Urza",
    oracleText: "You may spend white mana as though it were red mana.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    staticEffects: [{ kind: "mana-substitution", from: "W", to: "R" }],
};

// The Hive — "{5}, {T}: Create a 1/1 colorless Insect artifact creature
// token with flying named Wasp." (CR 111 / 707.1 token creation, 702.9
// flying.) Uses the new `createToken` primitive; the token is wiped from
// any non-battlefield zone by CR 704.5d (`checkTokenExistenceSBA`).
// Token print Scryfall id is resolved from
// `convex/cards/generated/token-prints.json` — refresh that mapping by
// running `node scripts/fetch-token-prints.mjs convex/cards/sets/*.ts`.
const HIVE_ID = "544a7138-eae8-4ff9-9e17-680bfa717183";

export const theHive: CardDefinition = {
    id: HIVE_ID,
    rarity: "rare",
    name: "The Hive",
    manaCost: { X: 5 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "the-hive-wasp",
            oracleText:
                "{5}, {T}: Create a 1/1 colorless Insect artifact creature token with flying named Wasp.",
            cost: { mana: { X: 5 }, tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.createToken(
                    {
                        name: "Wasp",
                        types: ["Artifact", "Creature"],
                        subtypes: ["Insect"],
                        power: 1,
                        toughness: 1,
                        staticAbilities: ["flying"],
                        imagePrintId: tokenPrintIdFor(HIVE_ID, "Wasp"),
                    },
                    ctx.controller
                );
            },
        },
    ],
};

export const throneOfBone: CardDefinition = makeColorSphere({
    id: "a2931ae0-7836-4000-b9ec-f2029ebf5d96",
    rarity: "uncommon",
    name: "Throne of Bone",
    oracleText:
        "Whenever a player casts a black spell, you may pay {1}. If you do, you gain 1 life.",
    color: "B",
    abilityIdSuffix: "throne-of-bone",
    colorWord: "Black",
});

// Winter Orb — modern Oracle (Scryfall, ADR 0004): "Players can't untap
// more than one land during their untap steps." (CR 502.1). Encoded as a
// data-driven `untapRestriction` (ADR 0002 / 0005): the engine dispatcher
// in `untapStep` collects the restriction, computes the active player's
// tapped-lands eligible set, and either auto-resolves the cap or enqueues
// an `untap-pick` `PendingChoice` for the active player to declare which
// land untaps. Non-land permanents (artifacts, creatures, enchantments)
// are unaffected — the printed "artifact, creature, or land" clause from
// the LEA printing is intentionally NOT followed (ADR 0004).
export const winterOrb: CardDefinition = {
    id: "9359f60c-9a27-4e53-b35b-964a121a6fba",
    rarity: "rare",
    name: "Winter Orb",
    oracleText:
        "Players can't untap more than one land during their untap steps.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    staticEffects: [
        untapRestriction({
            id: "winter-orb-land-cap",
            oracleText: "Untap up to one land (Winter Orb).",
            filter: { types: "Land" },
            maxUntap: 1,
        }),
    ],
};

export const woodenSphere: CardDefinition = makeColorSphere({
    id: "bcae01a2-171b-47cd-87be-f1e4e5314326",
    rarity: "uncommon",
    name: "Wooden Sphere",
    oracleText:
        "Whenever a player casts a green spell, you may pay {1}. If you do, you gain 1 life.",
    color: "G",
    abilityIdSuffix: "wooden-sphere",
    colorWord: "Green",
});

// --- Dual lands (LEA) ---
// Two basic land types for rules interactions (Armageddon, landwalk, etc.).
// The two mana abilities are modelled as a single choice ability so the
// frontend picker works the same as Birds of Paradise. `tapForPayment`
// requires a `manaChoiceIndex` for these; the bot's `planManaPayment` derives
// it from `getProducibleManaOptions`, which resolves the choice ability ahead
// of the intrinsic basic-land-subtype path so the index is never dropped.

export const badlands: CardDefinition = makeDualLand({
    id: "717f6d10-9144-4ade-9ac6-a481cc66b875",
    rarity: "rare",
    name: "Badlands",
    oracleText: "({T}: Add {B} or {R}.)",
    colors: ["B", "R"],
});

export const bayou: CardDefinition = makeDualLand({
    id: "412ceddd-2b9a-4551-a6bf-ae2830a2010a",
    rarity: "rare",
    name: "Bayou",
    oracleText: "({T}: Add {B} or {G}.)",
    colors: ["B", "G"],
});

export const plateau: CardDefinition = makeDualLand({
    id: "6eafa00b-c628-40f6-86eb-88e1361fc7a0",
    rarity: "rare",
    name: "Plateau",
    oracleText: "({T}: Add {R} or {W}.)",
    colors: ["R", "W"],
});

export const savannah: CardDefinition = makeDualLand({
    id: "94f7e24c-2546-41b6-81ad-5e920b07e64e",
    rarity: "rare",
    name: "Savannah",
    oracleText: "({T}: Add {G} or {W}.)",
    colors: ["G", "W"],
});

export const scrubland: CardDefinition = makeDualLand({
    id: "bebe39d4-21fb-46a4-a1ec-b97102e46c15",
    rarity: "rare",
    name: "Scrubland",
    oracleText: "({T}: Add {W} or {B}.)",
    colors: ["W", "B"],
});

export const taiga: CardDefinition = makeDualLand({
    id: "60df6592-0b3b-4b87-aeb2-8fa94b4fb7be",
    rarity: "rare",
    name: "Taiga",
    oracleText: "({T}: Add {R} or {G}.)",
    colors: ["R", "G"],
});

export const tropicalIsland: CardDefinition = makeDualLand({
    id: "a9c6c759-aabf-44e7-ba8c-33c5df232b56",
    rarity: "rare",
    name: "Tropical Island",
    oracleText: "({T}: Add {G} or {U}.)",
    colors: ["G", "U"],
});

export const tundra: CardDefinition = makeDualLand({
    id: "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb",
    rarity: "rare",
    name: "Tundra",
    oracleText: "({T}: Add {W} or {U}.)",
    colors: ["W", "U"],
});

export const undergroundSea: CardDefinition = makeDualLand({
    id: "ff76ac86-8a8a-47fe-9388-8950ca3e26c3",
    rarity: "rare",
    name: "Underground Sea",
    oracleText: "({T}: Add {U} or {B}.)",
    colors: ["U", "B"],
});

export const plains: CardDefinition = {
    id: "b1623d57-4729-4796-b3f7-f1837a05c6ed",
    rarity: "common",
    name: "Plains",
    oracleText: "({T}: Add {W}.)",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Plains"],
};

export const island: CardDefinition = {
    id: "90a57c0e-fa61-45ef-955d-d296403967d5",
    rarity: "common",
    name: "Island",
    oracleText: "({T}: Add {U}.)",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Island"],
};

export const swamp: CardDefinition = {
    id: "6176936d-72e2-4205-8871-4c5a4f1cb2d8",
    rarity: "common",
    name: "Swamp",
    oracleText: "({T}: Add {B}.)",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Swamp"],
};

export const mountain: CardDefinition = {
    id: "eace2c85-976c-425e-9800-5a6ccbd91b56",
    rarity: "common",
    name: "Mountain",
    oracleText: "({T}: Add {R}.)",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Mountain"],
};

export const forest: CardDefinition = {
    id: "6f1c8cb0-38eb-408b-94e8-16db83999b3b",
    rarity: "common",
    name: "Forest",
    oracleText: "({T}: Add {G}.)",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Forest"],
};

// Disrupting Scepter — {3} Artifact. "{3}, {T}: Target player discards a
// card. Activate only during your turn." (CR 701.8, 602.5b)
export const disruptingScepter: CardDefinition = {
    id: "ca571ee8-07a2-43b8-9acf-89cbfd3cf7c9",
    rarity: "rare",
    name: "Disrupting Scepter",
    oracleText:
        "{3}, {T}: Target player discards a card. Activate only during your turn.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "disrupting-scepter-discard",
            oracleText:
                "{3}, {T}: Target player discards a card. Activate only during your turn.",
            cost: { tap: true, mana: { X: 3 } },
            useStack: true,
            controllerTurnOnly: true,
            targetRequirement: { type: "player", count: 1 },
            effects: [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: { target: 0 },
                    zone: "hand",
                    count: 1,
                    prompt: "Choose a card to discard",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$discard" },
                },
            ],
        },
    ],
};

// ---------------------------------------------------------------------------
// W16: Exile-on-death + unlimited land drops
// ---------------------------------------------------------------------------

// Time Vault — {2} Artifact. Enters tapped. Doesn't untap during your untap
// step. "Skip your next turn: Untap Time Vault." "{T}: Take an extra turn
// after this one." (CR 614.10, 500.7)
export const timeVault: CardDefinition = {
    id: "902441dc-c976-4c92-b897-6376eaa0fe38",
    rarity: "rare",
    name: "Time Vault",
    oracleText:
        "Time Vault enters tapped.\nTime Vault doesn't untap during your untap step.\nSkip your next turn: Untap Time Vault.\n{T}: Take an extra turn after this one.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    entersTapped: true,
    staticAbilities: ["does-not-untap"],
    activatedAbilities: [
        {
            id: "time-vault-untap",
            oracleText: "Skip your next turn: Untap Time Vault.",
            cost: {},
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.setSkipNextTurn(ctx.controller);
                ctx.untap({ type: "permanent", id: ctx.sourceInstanceId });
            },
        },
        {
            id: "time-vault-extra-turn",
            oracleText: "{T}: Take an extra turn after this one.",
            cost: { tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.takeExtraTurn(ctx.controller);
            },
        },
    ],
};
