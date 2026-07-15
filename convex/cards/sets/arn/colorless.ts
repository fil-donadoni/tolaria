// Arabian Nights (ARN), split by colour per ADR 0043. The first MTG
// expansion (78 unique cards); every entry is a CardDefinition — ARN has no
// LEA reprints, so there are no CardPrint stubs (ADR 0014). Modern Scryfall
// oracle text is authoritative (ADR 0004). Generic mana is encoded as
// `X: n` (e.g. {2}{R} → { X: 2, R: 1 }). Cards are classified by the colour
// identity of their mana cost (CR 202.2); lands and artifacts (no coloured
// cost) live in colorless.ts.

import type { CardDefinition, SpellContext } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

export const dancingScimitar: CardDefinition = {
    id: "1eb2e494-1414-4d1f-91d2-7cb20acdb128",
    rarity: "rare",
    name: "Dancing Scimitar",
    oracleText: "Flying",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Spirit"],
    power: 1,
    toughness: 5,
    staticAbilities: ["flying"],
};

export const jandorsSaddlebags: CardDefinition = {
    id: "bc4f4b92-7d4e-4b03-8cb4-e6b356c338b4",
    rarity: "rare",
    name: "Jandor's Saddlebags",
    oracleText: "{3}, {T}: Untap target creature.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "jandors-saddlebags-untap",
            oracleText: "{3}, {T}: Untap target creature.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #842): untap the
            // announced creature target (CR 701.26b).
            effects: [
                { op: "tapUntap", action: "untap", target: { target: 0 } },
            ],
        },
    ],
};

export const flyingCarpet: CardDefinition = {
    id: "4b71ff49-ee0a-4065-9131-380468d62a30",
    rarity: "uncommon",
    name: "Flying Carpet",
    oracleText: "{2}, {T}: Target creature gains flying until end of turn.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "flying-carpet-grant",
            oracleText:
                "{2}, {T}: Target creature gains flying until end of turn.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #843): grant flying to the
            // announced target creature until end of turn (CR 611.1b).
            effects: [
                {
                    op: "grantAbility",
                    ability: "flying",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

export const aladdinsRing: CardDefinition = {
    id: "bb2b74a2-cb74-4b54-b9c6-78c63f14cf5b",
    rarity: "rare",
    name: "Aladdin's Ring",
    oracleText: "{8}, {T}: Aladdin's Ring deals 4 damage to any target.",
    manaCost: { X: 8 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "aladdins-ring-bolt",
            oracleText:
                "{8}, {T}: Aladdin's Ring deals 4 damage to any target.",
            cost: { mana: { X: 8 }, tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
        },
    ],
};

export const jandorsRing: CardDefinition = {
    id: "71504078-a16f-4dc4-9626-0ecc42b1e93b",
    rarity: "rare",
    name: "Jandor's Ring",
    oracleText:
        "{2}, {T}, Discard the last card you drew this turn: Draw a card.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "jandors-ring-draw",
            oracleText:
                "{2}, {T}, Discard the last card you drew this turn: Draw a card.",
            // CR 118.3 — `discardLastDrawn` is an additional cost paid from a
            // fixed card (the last card drawn this turn). The engine validates
            // the card is still in hand and discards it at activation commit;
            // the ability is unactivatable when no such card exists.
            cost: { mana: { X: 2 }, tap: true, discardLastDrawn: true },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};

export const brassMan: CardDefinition = {
    id: "1a364362-e42b-415c-9d95-b6ec7139f5e7",
    rarity: "uncommon",
    name: "Brass Man",
    oracleText:
        "Brass Man doesn't untap during your untap step.\nAt the beginning of your upkeep, you may pay {1}. If you do, untap Brass Man.",
    manaCost: { X: 1 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 1,
    toughness: 3,
    // `does-not-untap` keyword skips the untap step for this permanent only.
    staticAbilities: ["does-not-untap"],
    triggeredAbilities: [
        phaseTrigger({
            id: "brass-man-untap-option",
            oracleText:
                "At the beginning of your upkeep, you may pay {1}. If you do, untap Brass Man.",
            phase: "UPKEEP",
            scope: "your",
            // Migrated resolve()→effects[] (ADR 0045, #842): may pay {1}; if
            // paid, untap the source (CR 117.3a, 701.26b). A `your`-scoped
            // phaseTrigger so the scoped player == controller.
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: { X: 1 },
                    prompt: "Pay {1} to untap Brass Man?",
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
    ],
};

export const cityOfBrass: CardDefinition = {
    id: "f4e32327-380d-471e-813b-4c27477787ce",
    rarity: "uncommon",
    name: "City of Brass",
    oracleText:
        "Whenever City of Brass becomes tapped, it deals 1 damage to you.\n{T}: Add one mana of any color.",
    types: ["Land"],
    triggeredAbilities: [
        {
            id: "city-of-brass-tap-damage",
            oracleText:
                "Whenever City of Brass becomes tapped, it deals 1 damage to you.",
            event: "PERMANENT_TAPPED",
            matches: (event, self) =>
                event.type === "PERMANENT_TAPPED" &&
                event.permanentId === self.id,
            effects: [
                { op: "dealDamage", amount: 1, to: { player: "controller" } },
            ],
        },
    ],
    activatedAbilities: [
        {
            id: "city-of-brass-mana",
            oracleText: "{T}: Add one mana of any color.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

export const elephantGraveyard: CardDefinition = {
    id: "18348df2-9037-4db4-bddb-76dc933229bf",
    rarity: "rare",
    name: "Elephant Graveyard",
    oracleText: "{T}: Add {C}.\n{T}: Regenerate target Elephant.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "elephant-graveyard-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "elephant-graveyard-regen",
            oracleText: "{T}: Regenerate target Elephant.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Elephant",
            },
            // Migrated resolve()→effects[] (ADR 0045, #846): regenerate the
            // announced creature target (CR 701.15a).
            effects: [{ op: "regenerate", target: { target: 0 } }],
        },
    ],
};

export const libraryOfAlexandria: CardDefinition = {
    id: "ee266113-34ce-4189-84e7-ee2c86a2722c",
    rarity: "uncommon",
    name: "Library of Alexandria",
    oracleText:
        "{T}: Add {C}.\n{T}: Draw a card. Activate this ability only if you have exactly seven cards in hand.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "library-of-alexandria-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "library-of-alexandria-draw",
            oracleText:
                "{T}: Draw a card. Activate this ability only if you have exactly seven cards in hand.",
            cost: { tap: true },
            useStack: true,
            canActivate: (source, state) => {
                const controller = state.players.find(
                    (p) => p.id === source.controllerId
                );
                return controller?.hand.length === 7;
            },
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};

// Bazaar of Baghdad — "{T}: Draw two cards, then discard three cards." (CR 305
// land, CR 121.6 draw, CR 701.8 discard.) A nonbasic land with no mana ability.
// The draw and the discard are split across `resolveSteps`: step 0 commits the
// draw, then step 1 suspends for the discard choice. A single `resolve` would
// re-run the draw every time the discard choice suspended — that re-draw bug is
// why this card was deferred until activated-ability `resolveSteps` shipped.
export const bazaarOfBaghdad: CardDefinition = {
    id: "ff37b863-f8c4-4584-8cc2-ac0e096e583f",
    rarity: "uncommon",
    name: "Bazaar of Baghdad",
    oracleText: "{T}: Draw two cards, then discard three cards.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "bazaar-of-baghdad-draw-discard",
            oracleText: "{T}: Draw two cards, then discard three cards.",
            cost: { tap: true },
            useStack: true,
            // DSL-expressible (draw → choice → discard) but NOT migrated: the
            // per-card test pins the internal choice id "bazaar-discard", which
            // the interpreter regenerates for a `choice` Op — migrating would
            // force a test edit, breaking the untouched-harness invariant.
            resolveSteps: [
                // Step 0 — draw two (CR 121.6). Isolated in its own step so a
                // suspension in the discard step never re-runs the draw.
                (ctx: SpellContext) => {
                    ctx.drawCards(ctx.controller, 2);
                },
                // Step 1 — discard three chosen cards (CR 701.8). Clamped to
                // hand size: with fewer than three in hand, all are discarded.
                (ctx: SpellContext) => {
                    const handIds = ctx.getHandIds(ctx.controller);
                    const count = Math.min(3, handIds.length);
                    if (count === 0) return;
                    const picks = ctx.requestChoice({
                        playerId: ctx.controller,
                        choiceId: "bazaar-discard",
                        kind: "choose-hand-card",
                        zone: "hand",
                        count,
                        prompt: `Discard ${count} card${count === 1 ? "" : "s"}.`,
                    });
                    if (picks === undefined) return;
                    for (const id of picks) {
                        ctx.discardCard(ctx.controller, id);
                    }
                },
            ],
        },
    ],
};

// Oasis — reuses the existing target-keyed prevention shield (CR 615.1). A
// nonbasic land with no mana ability, only the prevent activation.
export const oasis: CardDefinition = {
    id: "6f38565e-88b9-433d-b0e9-a3b9734f183f",
    rarity: "uncommon",
    name: "Oasis",
    oracleText:
        "{T}: Prevent the next 1 damage that would be dealt to target creature this turn.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "oasis-prevent",
            oracleText:
                "{T}: Prevent the next 1 damage that would be dealt to target creature this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #845): a prevent-the-next-N
            // shield on the announced target (CR 615.1).
            effects: [
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: { target: 0 },
                    amount: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Ebony Horse — untaps a controlled attacker and shields it from all combat
// damage both ways this turn (CR 615, per-instance transient shield).
export const ebonyHorse: CardDefinition = {
    id: "9ae81ec7-2b7d-4301-8114-032be5e6b663",
    rarity: "rare",
    name: "Ebony Horse",
    oracleText:
        "{2}, {T}: Untap target attacking creature you control. Prevent all combat damage that would be dealt to and dealt by that creature this turn.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "ebony-horse-untap",
            oracleText:
                "{2}, {T}: Untap target attacking creature you control. Prevent all combat damage that would be dealt to and dealt by that creature this turn.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
                combatRoleFilter: "attacking",
            },
            // Migrated resolve()→effects[] (ADR 0045, #845): untap the target
            // (tapUntap) then arm the two-way combat-damage prevention shield
            // (preventDamage "combat-to-and-by", CR 615). Two Ops, same order.
            effects: [
                { op: "tapUntap", action: "untap", target: { target: 0 } },
                {
                    op: "preventDamage",
                    mode: "combat-to-and-by",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Pyramids — modal. The engine models `modes` only on spells, so the "Choose
// one —" is expressed as two equally-priced ({2}) single-mode activated
// abilities: behaviorally identical to picking one mode (ADR 0020). Mode 1
// destroys an Aura; mode 2 records a one-shot destroy replacement on a land.
export const pyramids: CardDefinition = {
    id: "d2e9decf-47b7-44e0-b380-8055b6011021",
    rarity: "rare",
    name: "Pyramids",
    oracleText:
        "{2}: Choose one —\n• Destroy target Aura attached to a land.\n• The next time target land would be destroyed this turn, remove all damage marked on it instead.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "pyramids-destroy-aura",
            oracleText: "{2}: Destroy target Aura attached to a land.",
            cost: { mana: { X: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Enchantment",
                subtypeFilter: "Aura",
                count: 1,
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
        {
            id: "pyramids-save-land",
            oracleText:
                "{2}: The next time target land would be destroyed this turn, remove all damage marked on it instead.",
            cost: { mana: { X: 2 } },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (!target) return;
                ctx.addDestroyReplacementShield(target, {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};

export const islandOfWakWak: CardDefinition = {
    id: "f09cbd18-79f1-49a0-a3bd-b380ff5ecf03",
    rarity: "rare",
    name: "Island of Wak-Wak",
    oracleText:
        "{T}: Target creature with flying has base power 0 until end of turn.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "island-of-wak-wak-set-power",
            oracleText:
                "{T}: Target creature with flying has base power 0 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                requireAbility: "flying",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.setBasePT(target, 0, undefined, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Desert — a nonbasic Desert land: taps for {C}, or (only at end of combat)
// pings an attacking creature. The ping's source is a Desert, so Camel /
// Desert Nomads' "prevent damage Deserts would deal" replacements catch it.
export const desert: CardDefinition = {
    id: "201155ea-f474-4e13-acda-cb071a6ca977",
    rarity: "common",
    name: "Desert",
    oracleText:
        "{T}: Add {C}.\n{T}: Desert deals 1 damage to target attacking creature. Activate only during the end of combat step.",
    types: ["Land"],
    subtypes: ["Desert"],
    activatedAbilities: [
        {
            id: "desert-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "desert-ping",
            oracleText:
                "{T}: Desert deals 1 damage to target attacking creature. Activate only during the end of combat step.",
            cost: { tap: true },
            useStack: true,
            activationPhaseRestriction: ["END_OF_COMBAT"],
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
            },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};

export const bottleOfSuleiman: CardDefinition = {
    id: "c474cd6b-5610-49eb-ac98-918d900efe8b",
    rarity: "rare",
    name: "Bottle of Suleiman",
    oracleText:
        "{1}, Sacrifice this artifact: Flip a coin. If you win the flip, create a 5/5 colorless Djinn artifact creature token with flying. If you lose the flip, this artifact deals 5 damage to you.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "bottle-of-suleiman-flip",
            oracleText:
                "{1}, Sacrifice this artifact: Flip a coin. If you win the flip, create a 5/5 colorless Djinn artifact creature token with flying. If you lose the flip, this artifact deals 5 damage to you.",
            // Self-sacrifice paid at activation commit (CR 117.9); the source is
            // already off the battlefield by resolution, so the win branch
            // creates the token and the lose branch deals 5 to its controller.
            cost: { mana: { X: 1 }, sacrifice: true },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #851): a `coinFlip` Op —
            // the win branch creates the Djinn token, the loss branch deals 5 to
            // the controller (CR 705.2 / ADR 0023, the suspending reveal flip).
            // Self-sacrifice paid at activation commit (CR 117.9), so the source
            // is already gone by resolution; both branches act on the caster.
            // No `imagePrintId` on the Djinn token — Scryfall has no printed
            // counterpart for Bottle of Suleiman (`all_parts` is empty), so
            // this stays a placeholder-rendered token by design (issue #941
            // documented exception).
            effects: [
                {
                    op: "coinFlip",
                    win: {
                        consequence: "Create a 5/5 flying Djinn",
                        effects: [
                            {
                                op: "createToken",
                                token: {
                                    name: "Djinn",
                                    types: ["Artifact", "Creature"],
                                    subtypes: ["Djinn"],
                                    power: 5,
                                    toughness: 5,
                                    staticAbilities: ["flying"],
                                },
                                controller: "controller",
                            },
                        ],
                    },
                    loss: {
                        consequence: "Bottle of Suleiman deals 5 damage to you",
                        effects: [
                            {
                                op: "dealDamage",
                                amount: 5,
                                to: { player: "controller" },
                            },
                        ],
                    },
                },
            ],
        },
    ],
};

export const aladdinsLamp: CardDefinition = {
    id: "8fecc5d2-5298-4d47-b085-f160603f220e",
    rarity: "rare",
    name: "Aladdin's Lamp",
    oracleText:
        "{X}, {T}: The next time you would draw a card this turn, instead look at the top X cards of your library, put all but one of them on the bottom of your library in a random order, then draw a card. X can't be 0.",
    manaCost: { X: 10 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "aladdins-lamp-look",
            oracleText:
                "{X}, {T}: The next time you would draw a card this turn, instead look at the top X cards of your library, put all but one of them on the bottom of your library in a random order, then draw a card. X can't be 0.",
            cost: { mana: { X: "X" }, tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 107.3 — "X can't be 0": a 0 activation is a no-op.
                const x = ctx.getX();
                if (x <= 0) return;
                ctx.armNextDraw(ctx.controller, x);
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Deferred to later batches (tracked-by: #1215) — need engine work beyond existing primitives:
//
//   • Hurr Jackal — "{T}: Target creature can't be regenerated this turn"
//     needs a turn-scoped cant-be-regenerated marker primitive.
//   • Sindbad — "{T}: Draw a card and reveal it. If it isn't a land, discard
//     it" needs to inspect the just-drawn card's types from a resolve body.
//   • Diamond Valley — "{T}, Sacrifice a creature:" is a choose-another-to-
//     sacrifice activation cost, not yet modelled for activated abilities.
//   • Merchant Ship — "attacks and isn't blocked, gain 2 life" needs an
//     unblocked-attacker trigger event.
//   • Sandals of Abdallah — the "when that creature dies this turn, destroy
//     this artifact" rider needs a per-target death watch.
//
// Out of scope — ante / subgames depend on game modes the engine does not model
// (ADR 0010): Jeweled Bird, Ring of Ma'rûf, Shahrazad. City in a Bottle (#190)
// is out of scope (set-origin tracking infra not modelled).
// ─────────────────────────────────────────────────────────────────────────────
