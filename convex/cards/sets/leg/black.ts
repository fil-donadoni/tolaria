// Legends (LEG) — Black (mono-B) cards, split by colour per ADR 0043.
// The registry's `import * as leg from "./sets/leg"` resolves through
// leg/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004);
// generic mana is encoded as `X: n` (e.g. {3}{G}{W} → { X: 3, G: 1, W: 1 }).
// Cards are classified by the colour identity of their mana cost (CR 202.2).

import type { CardDefinition, SpellContext } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";

// ─────────────────────────────────────────────────────────────────────────────
// Black free tranche (#373) — every mono-black Legends card expressible with
// existing primitives (keywords, staticEffects / layer system, trigger
// factories, regeneration shields, prevention shields, reanimation, SpellContext
// methods). Data + resolve() closures only; zero engine change (ADR 0014).
//
// Cards owned by feature clusters (#369 C1–C9) are NOT here:
//   • Nether Void → C8 (cast-tax "counter unless pay" World enchantment).
//   • Cosmic Horror, Mold Demon → C7 (upkeep / ETB pay-or-sacrifice).
//   • Spirit Shackle, Takklemaggot, All Hallow's Eve → C5 (named counters:
//     -0/-2, -0/-1, scream).
//   • Wall of Shadows → C6 (can't-be-the-target-of Wall-only spells/abilities).
//   • Pit Scorpion → C5 (poison counters — no named-counter primitive yet).
//   • Lesser Werewolf → C5 (-0/-1 counters on a combatant).
//
// Cards that genuinely need an unbuilt primitive are SKIPPED (not built here) (tracked-by: #2785):
//   • Transmutation — "switch power and toughness" has no swap primitive.
//   • Abomination, Infernal Medusa — "whenever this blocks / becomes blocked by
//     [a creature], destroy that creature at end of combat". UNBLOCKED by the
//     shared `combatPairKill` primitive (#486, combatPairKillTrigger.ts):
//     `combatant: "self"` + an `opponentFilter` (Abomination: non-black/non-
//     artifact; Infernal Medusa: blocked-by-only). Deferred to their tranche
//     only for the per-card filter wiring; the primitive now exists.
//   • Glyph of Doom — "at the next end of combat, destroy all creatures blocked
//     by that Wall this turn". The deferred-end-of-combat destroy now exists
//     (#486); it still needs per-combat "blocked by that Wall" set tracking,
//     so it stays deferred for that aggregation piece.
//   • Imprison — counters a {T} activation of the enchanted creature and removes
//     it from combat for {1}; no activate-an-ability "may pay to counter"
//     replacement.
//   • Chains of Mephistopheles — a draw replacement with a per-step exemption;
//     no draw-replacement primitive of this shape.
//   • Giant Slug — "{5}: at the beginning of your next upkeep, gain landwalk
//     of a chosen type" needs a delayed cross-turn keyword grant.
//   • Shimian Night Stalker — continuous combat-damage redirection from a chosen
//     attacker; no such redirection primitive.
//   • Underworld Dreams — "whenever an opponent draws a card" needs a card-drawn
//     trigger that doesn't exist yet.
//   • Vampire Bats — "{B}: +1/+0, activate no more than TWICE each turn" needs a
//     numeric per-turn activation cap (only `oncePerTurn` exists).
//   • Quagmire — "creatures with swampwalk can be blocked as though they didn't
//     have swampwalk" — buildable with the `landwalk-negation` static (Great
//     Wall / Undertow, #484), `subtypes: ["Swamp"]`. Deferred to its tranche.
//   • Demonic Torment, Evil Eye of Orms-by-Gore — emit can't-attack restrictions
//     onto OTHER creatures. UNBLOCKED by the `global-attack-restriction` static
//     shipped with Moat / Akron Legionnaire (#481): a battlefield-scanned
//     `forbids(attacker, source, state, ctx)` predicate can now lock attacks by
//     creatures other than the source. (These two cards remain unimplemented
//     for unrelated reasons — Demonic Torment is an Aura whose lock is scoped to
//     its host, Evil Eye gates on its own untapped/blocked state — but the
//     other-creature attack-lock primitive they were waiting on now exists.)
//   • Wall of Putrid Flesh — its "prevent all damage dealt to this by enchanted
//     creatures" clause is UNBLOCKED by the continuous, source-filtered
//     `combat-damage-prevention` static shipped with Enchanted Being / Wall of
//     Vapor (#485): reuse the `isEnchantedByAura` source filter. (Remains
//     unimplemented only because its other clauses/stats are out of this
//     batch's scope — the prevention primitive it waited on now exists.)
// ─────────────────────────────────────────────────────────────────────────────

// --- World enchantments with an upkeep trigger (CR 205.4a / 704.5m) --------

// The Abyss — {3}{B} World Enchantment. "At the beginning of each player's
// upkeep, destroy target nonartifact creature that player controls of their
// choice. It can't be regenerated." (CR 603.6a each-player upkeep trigger.)
//
// The World supertype + its SBA shipped in C2 (#379); the world rule needs no
// per-card wiring. The destroy is modelled as an active-player CHOICE rather
// than the standard ability-controller target: the Oracle's "that player ...
// of their choice" names the upkeep's active player as the chooser (overriding
// the CR 603.3d default that the ability's controller picks targets), and the
// legal pool is that player's own nonartifact creatures. `requestChoice` with
// `playerId`/`zoneOwnerId` = the scoped (active) player expresses exactly that
// — no targeted-trigger machinery (which would default the chooser to The
// Abyss's controller) is needed. If the active player controls no nonartifact
// creature the ability does nothing (CR 603.2c — no legal choice).
//
// DIVERGENCE — out of scope for the CR 603.3d targeted-trigger conversion
// (branch fix/targeted-triggers-cr-603-3d): this is a genuine chooser≠controller
// trigger the declarative `targetRequirement` machinery CANNOT express, so the
// resolve()+requestChoice is kept deliberately (not overlooked by the sweep). A
// TriggeredAbility's `targetRequirement` always parks its PendingTarget on — and
// hands priority to — the ABILITY'S CONTROLLER: `raiseTriggerTargetSelection`
// (gre/rules.ts) sets both `pendingTarget.playerId` and `priorityPlayerId` to
// `item.controllerId`, and neither TargetRequirement nor PendingTarget carries a
// chooser≠controller field. The Oracle's "that player … of their choice" makes
// the ACTIVE player the chooser, who may not be The Abyss's controller — a
// declarative targetRequirement would target the active player's creature but
// let the WRONG player pick it. `requestChoice` parked on `scopedPlayerId` (the
// active player) is the only faithful expression.
//
// RE-ASSESSED (ADR 0045 effects[] migration pass): the chooser≠controller half
// above is no longer the binding constraint — a `choice` Op's `player` field
// CAN now be `{ ref: "$event.activePlayerId" }` (the `PHASE_BEGIN` row in
// `EVENT_FIELD_REGISTRY`, ADR 0049, shipped for exactly this `scope: "each"`
// shape). The card is STILL NOT DSL-migratable, for a narrower reason: the
// `destroy` Op's `target` is an `EffectObjectSelector` (an announced slot or a
// SNAPSHOT-family `$binding`, `SNAP_ID`-indexed) — it has no `permanents`-ref
// shape reading a `choice` Op's PICKS-family binding, unlike `sacrifice`'s
// `permanents?: EffectRef`. There is no way to feed the chosen creature id into
// `destroy` declaratively. Blocked on: a picks-ref shape on `destroy` (mirroring
// `sacrifice`'s `permanents` field). Stays resolve().
export const theAbyss: CardDefinition = {
    id: "86a27d68-3e58-4ade-976d-36381beed451",
    rarity: "rare",
    name: "The Abyss",
    oracleText:
        "At the beginning of each player's upkeep, destroy target nonartifact creature that player controls of their choice. It can't be regenerated.",
    manaCost: { X: 3, B: 1 },
    types: ["Enchantment"],
    supertypes: ["World"],
    triggeredAbilities: [
        phaseTrigger({
            id: "the-abyss-upkeep-destroy",
            oracleText:
                "At the beginning of each player's upkeep, destroy target nonartifact creature that player controls of their choice. It can't be regenerated.",
            phase: "UPKEEP",
            scope: "each",
            resolve: (ctx, _event, scopedPlayerId) => {
                // CR 603.2c — only the active player's nonartifact creatures
                // are legal; with none, the ability resolves doing nothing.
                const candidates = ctx.getBattlefieldIds(scopedPlayerId, {
                    types: "Creature",
                    excludeTypes: "Artifact",
                });
                if (candidates.length === 0) return;
                // The active player chooses which of their nonartifact
                // creatures dies ("of their choice").
                const chosen = ctx.requestChoice({
                    playerId: scopedPlayerId,
                    choiceId: "the-abyss-destroy",
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    zoneOwnerId: scopedPlayerId,
                    filter: { types: "Creature", excludeTypes: "Artifact" },
                    count: 1,
                    prompt: "Choose a nonartifact creature you control to destroy (The Abyss).",
                });
                if (chosen === undefined) return; // suspended on the choice
                const id = chosen[0];
                if (!id) return;
                // CR 701.19c — "It can't be regenerated."
                ctx.destroy(
                    { type: "permanent", id },
                    { cantBeRegenerated: true }
                );
            },
        }),
    ],
};

// --- Vanilla / keyword creatures (CR 702 — pure data) ---------------------

// Headless Horseman — vanilla 2/2 (CR 110.1 pure data).
export const headlessHorseman: CardDefinition = {
    id: "d1aa37c8-98fa-4984-b09b-cf65ad84e97b",
    rarity: "common",
    name: "Headless Horseman",
    oracleText: "",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie", "Knight"],
    power: 2,
    toughness: 2,
};

// Lost Soul — swampwalk (CR 702.14 landwalk variant).
export const lostSoul: CardDefinition = {
    id: "601eed5c-436d-425b-a45f-07881ad893c8",
    rarity: "common",
    name: "Lost Soul",
    oracleText:
        "Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Spirit", "Minion"],
    power: 2,
    toughness: 1,
    staticAbilities: ["swampwalk"],
};

// --- Activated-ability creatures (CR 605) ----------------------------------

// Carrion Ants — "{1}: This creature gets +1/+1 until end of turn." (CR 611.1
// repeatable temporary buff.)
export const carrionAnts: CardDefinition = {
    id: "cbc0b009-3951-4aa3-985a-97139882da7e",
    rarity: "rare",
    name: "Carrion Ants",
    oracleText: "{1}: This creature gets +1/+1 until end of turn.",
    manaCost: { X: 2, B: 2 },
    types: ["Creature"],
    subtypes: ["Insect"],
    power: 0,
    toughness: 1,
    activatedAbilities: [
        {
            id: "carrion-ants-pump",
            oracleText: "{1}: This creature gets +1/+1 until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #840): self-pump +1/+1
            // until end of turn (CR 611.1) via the `pump` Op.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Walking Dead — "{B}: Regenerate this creature." (CR 701.19a regeneration
// shield.)
export const walkingDead: CardDefinition = {
    id: "d7533a72-77d1-40cd-b3a1-7597d566c428",
    rarity: "common",
    name: "Walking Dead",
    oracleText: "{B}: Regenerate this creature.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "walking-dead-regenerate",
            oracleText: "{B}: Regenerate this creature.",
            cost: { mana: { B: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #846): a self-regenerate
            // shield on the source (CR 701.19a) via the implicit $source.
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

// Ghosts of the Damned — "{T}: Target creature gets -1/-0 until end of turn."
// (CR 611.1 temporary debuff via a tap ability.)
export const ghostsOfTheDamned: CardDefinition = {
    id: "20275678-3488-43d8-a93b-993e2267ab07",
    rarity: "common",
    name: "Ghosts of the Damned",
    oracleText: "{T}: Target creature gets -1/-0 until end of turn.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 0,
    toughness: 2,
    activatedAbilities: [
        {
            id: "ghosts-of-the-damned-debuff",
            oracleText: "{T}: Target creature gets -1/-0 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #840): -1/-0 to the
            // targeted creature until end of turn (CR 611.1) via `pump`.
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: -1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Fallen Angel — Flying; "Sacrifice a creature: This creature gets +2/+1 until
// end of turn." (CR 702.9 flying + CR 602.1 sacrifice-another cost via
// `sacrificeFilter`, CR 611.1 buff.)
export const fallenAngel: CardDefinition = {
    id: "0f4174e4-0be8-49b5-8c52-22001790f6eb",
    rarity: "uncommon",
    name: "Fallen Angel",
    oracleText:
        "Flying\nSacrifice a creature: This creature gets +2/+1 until end of turn.",
    manaCost: { X: 3, B: 2 },
    types: ["Creature"],
    subtypes: ["Angel"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "fallen-angel-feast",
            oracleText:
                "Sacrifice a creature: This creature gets +2/+1 until end of turn.",
            cost: { sacrificeFilter: { types: "Creature" } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #840): self-pump +2/+1
            // until end of turn (CR 611.1) via the `pump` Op.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Hell's Caretaker — "{T}, Sacrifice a creature: Return target creature card
// from your graveyard to the battlefield. Activate only during your upkeep."
// (CR 602.5b activation-window restriction + CR 400.7 reanimation.)
export const hellsCaretaker: CardDefinition = {
    id: "336b3b8f-d104-4f06-ad4f-c92b8a9038ca",
    rarity: "rare",
    name: "Hell's Caretaker",
    oracleText:
        "{T}, Sacrifice a creature: Return target creature card from your graveyard to the battlefield. Activate only during your upkeep.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "hells-caretaker-reanimate",
            oracleText:
                "{T}, Sacrifice a creature: Return target creature card from your graveyard to the battlefield. Activate only during your upkeep.",
            cost: { tap: true, sacrificeFilter: { types: "Creature" } },
            useStack: true,
            controllerTurnOnly: true,
            activationPhaseRestriction: ["UPKEEP"],
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            // Migrated resolve()→effects[] (ADR 0045, #839): return the
            // targeted graveyard creature card to the battlefield under its
            // owner's control (CR 400.7 reanimation).
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "battlefield" },
            ],
        },
    ],
};

// --- Auras (CR 303 — Enchant land) ----------------------------------------

// Blight — "Enchant land. When enchanted land becomes tapped, destroy it."
// (CR 303.4 host trigger via the tapped factory → CR 701.8 destroy.)
export const blight: CardDefinition = {
    id: "9ca19b39-4201-463c-bd40-fbffa31c9eda",
    rarity: "uncommon",
    name: "Blight",
    oracleText: "Enchant land\nWhen enchanted land becomes tapped, destroy it.",
    manaCost: { B: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    triggeredAbilities: [
        tappedTrigger({
            id: "blight-destroy-land",
            oracleText: "When enchanted land becomes tapped, destroy it.",
            scope: "any",
            // Fire only for the aura's own host (CR 303.4b).
            condition: (event, self) => event.permanentId === self.attachedTo,
            // NOT DSL-migratable (ADR 0045): `tappedTrigger`'s `effects[]` opt-in
            // binds only `ctx.controller` / `$source` (the Aura itself) — it does
            // NOT surface the tapped permanent's id, and "destroy it" here means
            // the ENCHANTED land (`ctx.getAttachedToId()`), not `$source`. There is
            // no `EffectObjectSelector` for "the permanent this Aura is attached
            // to", and `PERMANENT_TAPPED` has no `EVENT_FIELD_REGISTRY` row (ADR
            // 0049) to read the tapped permanent's id via `{ ref: "$event.<field>" }`
            // either. Blocked on: an "attached-to" object selector or a
            // PERMANENT_TAPPED event-field row. Stays resolve().
            resolve: (ctx) => {
                const host = ctx.getAttachedToId();
                if (host) ctx.destroy({ type: "permanent", id: host });
            },
        }),
    ],
};

// --- Removal / sweeper spells (CR 701.7) -----------------------------------

// Hell Swarm — "All creatures get -1/-0 until end of turn." (CR 611.1 one-shot
// team debuff applied per creature on the battlefield.)
export const hellSwarm: CardDefinition = {
    id: "64164d1b-75f4-456e-a717-90ce554dc16c",
    rarity: "common",
    name: "Hell Swarm",
    oracleText: "All creatures get -1/-0 until end of turn.",
    manaCost: { B: 1 },
    types: ["Instant"],
    // Migrated resolve()→effects[] (ADR 0045, #840): `forEach` over every
    // player's battlefield creatures (CR 110/205) → `pump` each -1/-0 until
    // end of turn (CR 611.1).
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature" },
            },
            effects: [
                {
                    op: "pump",
                    target: { ref: "$each" },
                    power: -1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Hellfire — "Destroy all nonblack creatures. Hellfire deals X plus 3 damage to
// you, where X is the number of creatures that died this way." (CR 701.7 mass
// destroy filtered on colour + CR 614.5 count of permanents destroyed this way,
// then CR 120.1 damage to caster.)
export const hellfire: CardDefinition = {
    id: "362f1fe9-20af-434c-9957-7a1a564d89e6",
    rarity: "rare",
    name: "Hellfire",
    oracleText:
        "Destroy all nonblack creatures. Hellfire deals X plus 3 damage to you, where X is the number of creatures that died this way.",
    manaCost: { X: 2, B: 3 },
    types: ["Sorcery"],
    // NOT DSL-migratable (ADR 0045): the damage amount is "the number of
    // creatures that DIED this way" (CR 614.5) — a tally of `ctx.destroy`'s
    // actual per-permanent outcome, not the static cardinality of a
    // declaratively-selected set. The `count` construct only counts a set's
    // size at selection time; it cannot express "how many of these were
    // actually destroyed" (a `forEach` over nonblack creatures would
    // overcount if any is indestructible or holds a regeneration shield).
    // Blocked on: no Op/predicate reads a destroy's success/failure to
    // accumulate a running total. Stays resolve().
    resolve: (ctx: SpellContext) => {
        // Colour-aware sweep: `destroyAll` doesn't populate colours, so drive
        // the destroy off the colour-aware id query (CR 202.2). "Nonblack" is
        // the set difference between all creatures and the black ones; tally
        // how many were actually put into a graveyard (CR 614.5).
        let died = 0;
        for (const pid of ctx.allPlayerIds) {
            const black = new Set(
                ctx.getBattlefieldIds(pid, {
                    types: "Creature",
                    colors: "B",
                })
            );
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
            })) {
                if (black.has(id)) continue;
                if (ctx.destroy({ type: "permanent", id })) died += 1;
            }
        }
        ctx.dealDamage({ type: "player", id: ctx.caster }, died + 3);
    },
};

// --- Drain / burn spells ---------------------------------------------------

// Syphon Soul — "Syphon Soul deals 2 damage to each other player. You gain life
// equal to the damage dealt this way." (CR 120.1 damage to each opponent → CR
// 119.3 lifegain; 2-player so a single opponent contributes 2.)
export const syphonSoul: CardDefinition = {
    id: "f3020304-7a39-411e-b055-3ade72b4bff8",
    rarity: "common",
    name: "Syphon Soul",
    oracleText:
        "Syphon Soul deals 2 damage to each other player. You gain life equal to the damage dealt this way.",
    manaCost: { X: 2, B: 1 },
    types: ["Sorcery"],
    // "each other player" resolves to the single opponent in this engine's
    // 2-player / solo-2-seat scope (3+ player multiplayer is out of scope):
    // 2 damage to the opponent, gain 2 life (the damage dealt this way).
    effects: [
        { op: "dealDamage", amount: 2, to: { player: "opponent" } },
        { op: "gainLife", player: "controller", amount: 2 },
    ],
};

// Jovial Evil — "Jovial Evil deals X damage to target opponent, where X is twice
// the number of white creatures that player controls." (CR 202.2 colour count
// snapshot at resolution → CR 120.1 damage.)
export const jovialEvil: CardDefinition = {
    id: "c993c74c-a574-423b-81c8-96b0a7a6e529",
    rarity: "rare",
    name: "Jovial Evil",
    oracleText:
        "Jovial Evil deals X damage to target opponent, where X is twice the number of white creatures that player controls.",
    manaCost: { X: 2, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    // Migrated resolve()→effects[] (ADR 0045): X = twice the count of white
    // creatures the targeted opponent controls (CR 202.2), via `count`'s
    // `times` multiplier (the same shape Price of Progress uses, exo/red.ts).
    effects: [
        {
            op: "dealDamage",
            amount: {
                count: {
                    zone: "battlefield",
                    controller: { target: 0 },
                    filter: { type: "Creature", color: "W" },
                    times: 2,
                },
            },
            to: { target: 0 },
        },
    ],
};

// --- Tricks / regeneration utility -----------------------------------------

// Touch of Darkness — "One or more target creatures become black until end of
// turn." (CR 305.7 layer-5 colour override, end-of-turn duration; variable
// target count, CR 601.2c.)
export const touchOfDarkness: CardDefinition = {
    id: "eda7177f-1354-4008-aaaa-2c8b823ed5e9",
    rarity: "uncommon",
    name: "Touch of Darkness",
    oracleText: "One or more target creatures become black until end of turn.",
    manaCost: { B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: { min: 1 } },
    // Migrated resolve()→effects[] (ADR 0045): `forEach { set: "targets" }`
    // iterates the variable-N announced target set (CR 601.2c), `setColor`
    // overrides each to black until end of turn (layer 5, CR 613.1e).
    effects: [
        {
            op: "forEach",
            select: { set: "targets" },
            effects: [
                {
                    op: "setColor",
                    target: { ref: "$each" },
                    colors: ["B"],
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Horror of Horrors — "Sacrifice a Swamp: Regenerate target black creature."
// (CR 602.1 sacrifice cost via `sacrificeFilter` + CR 701.19a regeneration
// shield on a colour-restricted target.)
export const horrorOfHorrors: CardDefinition = {
    id: "b9f68dc2-c048-41ec-b237-c36fdd99c27d",
    rarity: "uncommon",
    name: "Horror of Horrors",
    oracleText: "Sacrifice a Swamp: Regenerate target black creature.",
    manaCost: { X: 3, B: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "horror-of-horrors-regenerate",
            oracleText: "Sacrifice a Swamp: Regenerate target black creature.",
            cost: { sacrificeFilter: { types: "Land", subtypes: "Swamp" } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1, colorFilter: "B" },
            // Migrated resolve()→effects[] (ADR 0045, #846): regenerate the
            // announced creature target (CR 701.19a).
            effects: [{ op: "regenerate", target: { target: 0 } }],
        },
    ],
};

// --- Death triggers (CR 603.2) ---------------------------------------------

// Cyclopean Mummy — "When this creature dies, exile it." (CR 603.2 self death
// trigger → CR 406 exile of the card now in the graveyard.)
export const cyclopeanMummy: CardDefinition = {
    id: "479ccc50-2d72-4adc-901e-fbd4eef2cf92",
    rarity: "common",
    name: "Cyclopean Mummy",
    oracleText: "When this creature dies, exile it.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 1,
    triggeredAbilities: [
        diedTrigger({
            id: "cyclopean-mummy-exile",
            oracleText: "When this creature dies, exile it.",
            scope: "self",
            // NOT DSL-migratable (ADR 0045, #839): the moveZone Op acts on an
            // announced target or the `$source` snapshot (a permanent on the
            // battlefield). This trigger acts on the DIES event's dead-creature
            // payload — a card already in the graveyard — which no Op selector
            // references. Blocked on: a moveZone selector for a leaves-the-
            // battlefield / dies-trigger object. Stays resolve().
            resolve: (ctx, _event, deadCreature) => {
                // The card is in its owner's graveyard by the time the trigger
                // resolves (CR 603.10); move that exact object to exile
                // (CR 406 zone change).
                ctx.moveCardById(
                    deadCreature.controllerId,
                    deadCreature.id,
                    "graveyard",
                    "exile"
                );
            },
        }),
    ],
};

// Greed — "{B}, Pay 2 life: Draw a card." (CR 119.4 life payment + CR 121.1
// draw.)
export const greed: CardDefinition = {
    id: "111a16a2-e875-4756-80db-290f9e8606db",
    rarity: "rare",
    name: "Greed",
    oracleText: "{B}, Pay 2 life: Draw a card.",
    manaCost: { X: 3, B: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "greed-draw",
            oracleText: "{B}, Pay 2 life: Draw a card.",
            cost: { mana: { B: 1 }, life: 2 },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};

// Darkness — "Prevent all combat damage that would be dealt this turn."
// (CR 615 — the global combat-damage prevention used by Fog-style cards.)
export const darkness: CardDefinition = {
    id: "53b04dab-45b7-418b-a0f0-bcf35145fc53",
    rarity: "common",
    name: "Darkness",
    oracleText: "Prevent all combat damage that would be dealt this turn.",
    manaCost: { B: 1 },
    types: ["Instant"],
    // Migrated resolve()→effects[] (ADR 0045, #845): the "all-combat" mode of
    // preventDamage is a turn-scoped global Fog (CR 615).
    effects: [{ op: "preventDamage", mode: "all-combat" }],
};

// Cosmic Horror — {3}{B}{B}{B} 7/7 Horror, First strike. Destroy-variant of the
// upkeep tax with a self-damage rider: "At the beginning of your upkeep,
// destroy this creature unless you pay {3}{B}{B}{B}. If this creature is
// destroyed this way, it deals 7 damage to you." CR 603.6a + CR 117.3a +
// CR 701.8 destroy. The self-damage only fires on the destroy branch.
export const cosmicHorror: CardDefinition = {
    id: "18bc6ac2-19e0-4765-852b-e303a5bb4040",
    rarity: "rare",
    name: "Cosmic Horror",
    oracleText:
        "First strike\nAt the beginning of your upkeep, destroy this creature unless you pay {3}{B}{B}{B}. If this creature is destroyed this way, it deals 7 damage to you.",
    manaCost: { X: 3, B: 3 },
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 7,
    toughness: 7,
    staticAbilities: ["first strike"],
    triggeredAbilities: [
        phaseTrigger({
            id: "cosmic-horror-upkeep",
            oracleText:
                "At the beginning of your upkeep, destroy this creature unless you pay {3}{B}{B}{B}. If this creature is destroyed this way, it deals 7 damage to you.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): the self-damage rider ("If this
            // creature is destroyed this way, it deals 7 damage to you") is
            // conditioned on `ctx.destroy`'s ACTUAL runtime outcome (it can be
            // prevented by an indestructible/regeneration effect from another
            // card) — the frozen `if` predicate grammar (boolean-binding /
            // numeric-comparison / picksNonEmpty / targetIsAnother /
            // picksMatchFilter) has no form that reads a `destroy` Op's
            // success/failure. Blocked on: a destroy-outcome predicate.
            // Planned-migratable if one is added; stays resolve() until then.
            resolve: (ctx, _event, scopedPlayerId) => {
                const paid = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `cosmic-horror-${ctx.sourceInstanceId}`,
                    cost: { X: 3, B: 3 },
                    prompt: "Pay {3}{B}{B}{B} or destroy Cosmic Horror?",
                });
                if (paid === undefined) return; // suspended
                if (paid) return;
                // CR 701.8 destroy; the 7-damage rider only fires if the
                // creature is actually destroyed this way (an indestructible
                // Cosmic Horror survives and deals no damage).
                const destroyed = ctx.destroy({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
                if (destroyed) {
                    ctx.dealDamage({ type: "player", id: scopedPlayerId }, 7);
                }
            },
        }),
    ],
};

// Mold Demon — {5}{B}{B} 6/6 Fungus Demon. ETB sacrifice-as-cost variant of the
// do-X-unless-you-pay family: "When this creature enters, sacrifice it unless
// you sacrifice two Swamps." Not an upkeep trigger, but the same shape — the
// "pay" is an alternate cost (sacrifice two Swamps, CR 118.3) rather than mana.
// CR 603.6a ETB + CR 701.21 sacrifice. Composes `requestMayPay` (the yes/no
// gate) + a `sacrifice-permanents` `requestChoice` for the Swamp cost.
export const moldDemon: CardDefinition = {
    id: "649a33aa-7eac-4161-ae1a-fcbc758abccf",
    rarity: "rare",
    name: "Mold Demon",
    oracleText:
        "When this creature enters, sacrifice it unless you sacrifice two Swamps.",
    manaCost: { X: 5, B: 2 },
    types: ["Creature"],
    subtypes: ["Fungus", "Demon"],
    power: 6,
    toughness: 6,
    triggeredAbilities: [
        enteredTrigger({
            id: "mold-demon-etb",
            oracleText:
                "When this creature enters, sacrifice it unless you sacrifice two Swamps.",
            scope: "self",
            // Migrated resolve()→effects[] (ADR 0045): the unpayable-cost
            // short-circuit (CR 117.3a — fewer than two Swamps means no real
            // choice) is a `count`-vs-literal comparison predicate; the
            // pay-or-sacrifice decision composes `mayPay` + `choice(kind:
            // "sacrifice-permanents")` + `sacrifice`, the same primitives the
            // pre-migration closure called directly. Since the `then` branch
            // only runs with >=2 Swamps present, the `choice`'s exact
            // `count: 2` is always satisfiable — the closure's defensive
            // "picked.length < 2" fallback has no reachable counterpart.
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: {
                            count: {
                                zone: "battlefield",
                                controller: "controller",
                                filter: { subtype: "Swamp" },
                            },
                        },
                        op: "lt",
                        right: 2,
                    },
                    then: [{ op: "sacrifice", target: { ref: "$source" } }],
                    else: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Sacrifice two Swamps to keep Mold Demon?",
                            bind: "$moldDemonAccept",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$moldDemonAccept" },
                            then: [
                                {
                                    op: "choice",
                                    kind: "sacrifice-permanents",
                                    player: "controller",
                                    zone: "battlefield",
                                    filter: { subtype: "Swamp" },
                                    count: 2,
                                    prompt: "Sacrifice two Swamps.",
                                    bind: "$moldDemonSwamps",
                                },
                                {
                                    op: "sacrifice",
                                    permanents: { ref: "$moldDemonSwamps" },
                                },
                            ],
                            else: [
                                {
                                    op: "sacrifice",
                                    target: { ref: "$source" },
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// C7 deferred (tracked-by: #2785) — need a primitive not yet built; each lands when its primitive
// ships:
//   • Elder Spawn — "At the beginning of your upkeep, sacrifice an Island. If
//     you don't, sacrifice this and it deals 6 damage to you." The cost is a
//     sacrifice (expressible), but the else-branch chains a sacrifice AND a
//     self-damage like Cosmic Horror — shippable, but it also has an islandwalk
//     /"can't attack unless defending player controls an Island" clause owned by
//     a different cluster; deferred whole to avoid a partial card.
//   • Forethought Amulet — "If a source would deal 4 or more damage to you,
//     prevent all but 1" is a damage-prevention REPLACEMENT, not a pay-or-else
//     trigger (mis-bucketed in the free-tranche note); owned by the prevention
//     batch.
//   • Primordial Ooze — "+1/+1 counter each upkeep, then pay {X} where X is its
//     power or it doesn't attack/can't be blocked and deals damage to you" needs
//     a power-scaled {X} pay-or-else with an attack-restriction else-branch (C5
//     named-counter + variable-cost cluster).
//   • Pit Scorpion — poison counters, not a pay-or-sacrifice card. No longer
//     blocked (poison and the damage-dealt trigger both ship) — tracked-by:
//     #2230.
//   • Takklemaggot — an Aura that relocates itself when its host dies, or
//     returns as a non-Aura enchantment with rewritten text; not the
//     pay-or-sacrifice pattern, and blocked on CR 613 continuous-effect
//     capabilities rather than on counters — tracked-by: #2228.
// ─────────────────────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════════
// C5 — Named counters + counter-driven triggers (#384, CR 122).
//
// The engine already stored arbitrary named counters on a permanent
// (`CardInstanceState.counters: Record<string, number>`, CR 122.1) and exposed
// the parametric `addCounter` / `removeCounter` / `getCounterCount` primitives
// (CR 122.6) — +1/+1 and -1/-1 ride this same map and remain layer-7d P/T
// modifiers (CR 613.4d) plus the -1/-1 ⇄ +1/+1 annihilation SBA (CR 704.5q).
// This cluster adds the NAMED (non-P/T) counter cards and the upkeep cycles
// that add/remove them, all composed from existing primitives:
//   • "doesn't untap if it has a [kind] counter" = a `keyword-grant` static
//     effect granting `does-not-untap` (read by the untap step, CR 502.1)
//     gated on a counter-count predicate in `applies`.
//   • upkeep add / remove a counter = `phaseTrigger({ phase: "UPKEEP" })`.
//   • counter-gated activations = `canActivate` (CR 602.5b) / `cost.removeCounter`
//     (CR 122.6).
//   • "-0/-2 counter" = a new entry in the layer-7d P/T-counter table.
//   • "the game is a draw" (Divine Intervention) = the new `ctx.drawGame()`
//     primitive (CR 104.4a).
//   • "if ~ started the turn untapped" / "if ~ dealt damage to an opponent this
//     turn" = new turn-scoped per-instance flags (CR 502.1 / 120.3).
//
// Deferred (need a primitive owned by another cluster; documented at the end of
// this section): Glyph of Delusion (tracked-by: #2227), All Hallow's Eve
// (tracked-by: #2226), plus the C7-noted Takklemaggot (tracked-by: #2228).
// Pit Scorpion is NO LONGER deferred — its blockers shipped (tracked-by: #2230).
// ═════════════════════════════════════════════════════════════════════════════

// Spirit Shackle — {B}{B} Aura. "Whenever enchanted creature becomes tapped,
// put a -0/-2 counter on it." (CR 701.26a becomes-tapped trigger via the
// tapped-trigger factory; CR 122.1 / 613.4d the -0/-2 counter rides the layer-7d
// P/T pipeline, so the toughness drop is visible the moment the counter lands.)
export const spiritShackle: CardDefinition = {
    id: "a30bb266-5bd1-4998-ae94-56f0f3354167",
    rarity: "common",
    name: "Spirit Shackle",
    oracleText:
        "Enchant creature\nWhenever enchanted creature becomes tapped, put a -0/-2 counter on it.",
    manaCost: { B: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        tappedTrigger({
            id: "spirit-shackle-tap",
            oracleText:
                "Whenever enchanted creature becomes tapped, put a -0/-2 counter on it.",
            scope: "any",
            // CR 303.4b — only the aura's host firing matters.
            condition: (event, self) => event.permanentId === self.attachedTo,
            // NOT DSL-migratable (ADR 0045) — RE-ASSESSED: `tappedTrigger` now
            // DOES have an `effects[]` opt-in (it binds only `ctx.controller` /
            // `$source`, the Aura itself), so the stale "no effects[] site"
            // framing no longer applies. The actual blocker persists: the
            // counter target is the permanent that BECAME TAPPED (the aura's
            // host, delivered only via the trigger-event payload), which
            // `effects[]` cannot reach — `$source` resolves to the Aura, not its
            // host, and `PERMANENT_TAPPED` has no `EVENT_FIELD_REGISTRY` row
            // (ADR 0049) to read it via `{ ref: "$event.<field>" }` either.
            // Blocked on: an "attached-to"/host object selector or a
            // PERMANENT_TAPPED event-field row (same gap as Blight, above).
            // Stays resolve().
            resolve: (ctx, _event, tapped) => {
                ctx.addCounter(
                    { type: "permanent", id: tapped.id },
                    "-0/-2",
                    1
                );
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// C5 deferred — counter cards needing a primitive owned by another cluster.
// The umbrella tracker (#1213) is retired; each card now owns an issue, and two
// of its former entries turned out not to be gaps at all:
//   • Glyph of Delusion (tracked-by: #2227) — "target creature that target Wall
//     blocked this turn" needs the blocker→attacker pairing to survive past END
//     OF COMBAT (the engine records it, but combat-scoped) AND a cross-slot
//     target restriction filtering one announced slot against another's pick.
//     The named-counter half (glyph counters + does-not-untap + upkeep removal)
//     is expressible today, but neither of those is a counter feature;
//     deferred whole to avoid a partial card.
//   • All Hallow's Eve (tracked-by: #2226) — exiles ITSELF with two scream
//     counters and ticks them down from EXILE each upkeep, mass-reanimating all
//     creatures at zero. This is a suspend-like "card waits in exile with
//     counters and an upkeep trigger that functions from exile" mechanism
//     (CR 603.6e off-battlefield trigger + counters on an exiled card); the
//     engine's exile infrastructure today is the return-bundle (ADR 0028), not
//     a counter-ticking exiled spell. Owned by that substrate, not by Suspend
//     (CR 702.62), whose registry row stays `planned`.
//   • Voodoo Doll (tracked-by: #2225) — its named-counter core (upkeep pin
//     accrual + end-step self-destruct-and-ping) is fully expressible, and the
//     board-derived cost primitive its "{X}{X}, {T}" activation needs DOES now
//     exist (`cost.manaEqualToCounterCount`, board-fixed and never prompted —
//     Chromatic Armor). The one residual gap is that {X}{X} is TWICE the pin
//     count and that descriptor has no multiplier. Deferred (tracked-by: #2785) until it does,
//     rather than shipping a wrong cost.
//   • Takklemaggot (tracked-by: #2228) — an Aura that, when its host dies,
//     returns either attached to a creature chosen by the DYING CREATURE'S
//     controller (not its own), or as a NON-AURA enchantment that loses
//     "enchant creature" and gains a new upkeep trigger. Blocked on four
//     continuous-effect capabilities (CR 613), none of them counter-related.
//
// No longer deferred — their blockers shipped; both are ordinary DSL cards now
// and are tracked-by: #2230:
//   • Pit Scorpion — needs poison counters (`addPoisonCounters` + the ten-poison
//     SBA) and a damage-dealt trigger, both of which ship. It never needed a
//     named-counter primitive; it was mis-bucketed into this cluster.
//   • Triassic Egg — the hand→battlefield primitive it waited on
//     (`putFromHandOntoBattlefield`) ships and has consumers in several sets.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// C8 — Cast-tax "counter unless pay" World enchantments (#385)
//
// Two World enchantments (CR 205.4 World supertype; the world rule SBA shipped
// in C2, #379) that tax every relevant spell as it is cast: a triggered ability
// (CR 603.2 / 601.2i "whenever a player casts a spell") goes on the stack ABOVE
// the cast spell, and on resolution the spell's controller MAY pay a tax
// (CR 117.3a) — paying lets the spell remain on the stack and resolve normally,
// declining (or being unable to pay) counters it (CR 701.6a).
//
// ZERO engine change — this is the SAME composition Force Spike already uses
// (counter target spell unless its controller pays {1}), only fired from a
// SPELL_CAST trigger instead of a targeted instant:
//   spellCastTrigger (CR 601.2i) → ctx.requestMayPay (CR 117.3a, the C7
//   pending-may-pay → submitMayPay path) → ctx.counter on decline (CR 701.6a).
// No new SpellContext primitive, no new GameState field: the pay choice rides
// the existing `pendingChoices` may-pay queue, so serialization is untouched.
//
// Cards shipped here:
//   • Nether Void — "Whenever a player casts a spell, counter it unless that
//     player pays {3}." Flat {3} on every spell, any caster.
//   • In the Eye of Chaos — "Whenever a player casts an instant spell, counter
//     it unless that player pays {X}, where X is its mana value." Restricted to
//     instants; the tax is the cast spell's mana value, read at resolution from
//     the still-on-stack spell (CR 202.3 / 601.2b — getManaValue folds in the
//     chosen X), so an X spell taxes by its total cost on the stack.
//
// NOT a self-counter loop: the trigger filters by spell type, and neither
// enchantment is an instant (In the Eye of Chaos) nor — being a permanent
// already resolved onto the battlefield — on the stack when it fires.
// ─────────────────────────────────────────────────────────────────────────────

// Nether Void — {3}{B} World Enchantment. "Whenever a player casts a spell,
// counter it unless that player pays {3}." (CR 601.2i cast trigger → CR 117.3a
// may-pay billed to the spell's controller → CR 701.6a counter on decline.)
export const netherVoid: CardDefinition = {
    id: "2e72f8cb-5bc3-4711-9b7c-a6eea9a0beaf",
    rarity: "rare",
    name: "Nether Void",
    oracleText:
        "Whenever a player casts a spell, counter it unless that player pays {3}.",
    manaCost: { X: 3, B: 1 },
    types: ["Enchantment"],
    supertypes: ["World"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "nether-void-tax",
            oracleText:
                "Whenever a player casts a spell, counter it unless that player pays {3}.",
            scope: "any",
            // NOT DSL-migratable (ADR 0045): the ability must counter and bill
            // the tax to THE SPELL THAT CAUSED THIS TRIGGER, but a SPELL_CAST
            // trigger has no target-announcement mechanism naming that spell
            // (unlike Ward's `spellTargetsSelfSource` machinery, which is wired
            // to BECAME_TARGET, not SPELL_CAST) and `SPELL_CAST` has no
            // `EVENT_FIELD_REGISTRY` row (ADR 0049) to read `spell.instanceId` /
            // `spell.casterId` via `{ ref: "$event.<field>" }` either — both
            // `mayPay`'s `player` and `counter`'s `target` need exactly that.
            // Blocked on: a SPELL_CAST event-field row (or an equivalent
            // targeting mechanism) for the causing spell. Stays resolve().
            resolve: (ctx, _event, spell) => {
                // CR 117.3a — the spell's controller may pay {3} to keep it;
                // declining (or being unable to pay) counters it (CR 701.6a).
                const paid = ctx.requestMayPay({
                    playerId: spell.casterId,
                    choiceId: `nether-void-pay-${spell.instanceId}`,
                    cost: { X: 3 },
                    prompt: "Pay {3} or your spell is countered (Nether Void)?",
                });
                if (paid === undefined) return; // suspended on the may-pay
                if (!paid) ctx.counter({ type: "spell", id: spell.instanceId });
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic base-P/T set (layer 7b) with a stated duration (#487, CR 613.4b)
// ─────────────────────────────────────────────────────────────────────────────
//
// Both cards drive a layer-7b *set* (`ctx.setBasePT`) whose value is computed
// at resolution time and LOCKED thereafter (CR 611.2 — the value of "1 plus the
// number of creature cards in your graveyard" / "target creature's P/T" is read
// once when the ability resolves, not continuously recomputed). The set sits in
// sublayer 7b, so later +1/+1 counters (7c) and pump (7d) still stack on top
// (CR 613.4 ordering; see `evaluateLayer` in gre/layers.ts).
//
//   • Wall of Tombstones — INDEFINITE set (no expiry boundary). `setBasePT`
//     with `"indefinite"` pushes a `temporaryPTSet` entry that the cleanup tick
//     never purges; it persists until the source leaves or a later set wins.
//   • Halfdane — set scoped to "until your next upkeep": a `DurationSpec`
//     `{ phase: "upkeep", player: "controller" }`. `tickAllDurations` purges the
//     entry as the controller's NEXT upkeep begins (CR 500.2), reverting the P/T
//     to printed before that upkeep's own trigger re-fires.

// Wall of Tombstones — {1}{B} 0/1 Wall with Defender. "At the beginning of your
// upkeep, change this creature's base toughness to 1 plus the number of creature
// cards in your graveyard." The effect lasts indefinitely (CR 613.4b).
export const wallOfTombstones: CardDefinition = {
    id: "55da1e86-fe18-486a-b510-f941e6f6e378",
    rarity: "uncommon",
    name: "Wall of Tombstones",
    oracleText:
        "Defender (This creature can't attack.)\nAt the beginning of your upkeep, change this creature's base toughness to 1 plus the number of creature cards in your graveyard. (This effect lasts indefinitely.)",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 1,
    staticAbilities: ["defender"],
    triggeredAbilities: [
        phaseTrigger({
            id: "wall-of-tombstones-set-toughness",
            oracleText:
                "At the beginning of your upkeep, change this creature's base toughness to 1 plus the number of creature cards in your graveyard.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): the `setBasePT` Op (CR 613.4b layer
            // 7b, issue #1318) now ships, BUT it takes a LITERAL toughness. This
            // sets base toughness to "1 PLUS the number of creature cards in the
            // graveyard" — the `EffectValue` grammar is literal / bound-ref /
            // count with only `count`'s fixed `times` MULTIPLIER, no addition of
            // a literal offset to a count. Blocked on: an additive-count value
            // construct, NOT the setBasePT Op. Stays resolve().
            resolve: (ctx, _event, scopedPlayerId) => {
                // CR 611.2 — the count is read once, at resolution, and the
                // resulting set value is locked (it does NOT track the
                // graveyard afterwards).
                const creatureCards = ctx
                    .getGraveyardCards(scopedPlayerId)
                    .filter((c) => c.types.includes("Creature")).length;
                ctx.setBasePT(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    undefined, // power untouched
                    1 + creatureCards, // 1 + creature cards in graveyard
                    "indefinite"
                );
            },
        }),
    ],
};
