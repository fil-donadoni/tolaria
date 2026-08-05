// The Dark (DRK), split by colour per ADR 0043. The expansion after Legends
// (119 unique cards); every entry is a CardDefinition — The Dark has zero
// reprints of already-implemented cards, so there are no CardPrint stubs
// (ADR 0014). Modern Scryfall oracle text is authoritative (ADR 0004);
// canonical names / costs / P/T are sourced from MTGJSON `data/json/DRK.json`.
// Generic mana is encoded as `X: n` (e.g. {2}{R} → { X: 2, R: 1 }). Cards are
// classified by the colour identity of their mana cost (CR 202.2); lands and
// artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, SpellContext } from "../../types";
import { EFFECT_AFFECTS_SELF } from "../../types";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";

// Gaea's Touch — "{0}: You may put a basic Forest card from your hand onto the
// battlefield. Activate only as a sorcery and only once each turn.\nSacrifice
// this enchantment: Add {G}{G}." (CR 605: the first ability uses the stack —
// "as a sorcery" timing (CR 605.3b is for mana abilities; this is the
// sorcery-speed gate: own main phase, empty stack, `controllerTurnOnly` +
// `activationPhaseRestriction`) and `oncePerTurn`; CR 400.7 hand → battlefield
// via `putFromHandOntoBattlefield`. The second is a mana ability with a
// sacrifice cost, CR 605.1a.)
export const gaeasTouch: CardDefinition = {
    id: "0e1ae3d6-6d96-4db6-bbc4-cee91bae6cf7",
    rarity: "common",
    name: "Gaea's Touch",
    oracleText:
        "{0}: You may put a basic Forest card from your hand onto the battlefield. Activate only as a sorcery and only once each turn.\nSacrifice this enchantment: Add {G}{G}.",
    manaCost: { G: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "gaeas-touch-forest",
            oracleText:
                "{0}: You may put a basic Forest card from your hand onto the battlefield. Activate only as a sorcery and only once each turn.",
            cost: {},
            useStack: true,
            // CR 605.3b sorcery-speed gate: own main phase, empty stack, and
            // once per turn.
            controllerTurnOnly: true,
            activationPhaseRestriction: ["PRECOMBAT_MAIN", "POSTCOMBAT_MAIN"],
            oncePerTurn: true,
            resolve: (ctx: SpellContext) => {
                // CR 205.4a / 305.6 — restrict the optional pick to basic Forest
                // cards currently in the controller's hand.
                const candidateIds = ctx
                    .getHandCards(ctx.controller)
                    .filter(
                        (c) =>
                            c.supertypes.includes("Basic") &&
                            c.subtypes.includes("Forest")
                    )
                    .map((c) => c.id);
                if (candidateIds.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: "gaeas-touch-forest",
                    kind: "choose-hand-card",
                    zone: "hand",
                    candidateIds,
                    // "You MAY put" (CR 601.3e) — an optional 0-or-1 pick.
                    count: { min: 0, max: 1 },
                    prompt: "You may put a basic Forest from your hand onto the battlefield.",
                });
                if (picks === undefined) return; // suspended
                const id = picks[0];
                if (!id) return; // declined
                ctx.putFromHandOntoBattlefield(ctx.controller, id);
            },
        },
        {
            id: "gaeas-touch-sacrifice-mana",
            oracleText: "Sacrifice this enchantment: Add {G}{G}.",
            cost: { sacrifice: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ G: 2 }),
            manaProduced: { G: 2 },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// GREEN (#414 / C5 #422)
// ─────────────────────────────────────────────────────────────────────────────

// Tracker — "{G}{G}, {T}: This creature deals damage equal to its power to
// target creature. That creature deals damage equal to its power to this
// creature." This is the pre-"fight" template (CR 701.12-style mutual damage):
// both creatures deal damage equal to their power to one another SIMULTANEOUSLY
// through the normal damage path (CR 120, 510-style), so replacement /
// prevention / protection effects apply and damage triggers fire. A creature
// that dies to the exchange still deals its damage (CR 701.12). The generic
// `ctx.fight(target)` primitive (state.ts → resolveFight) does the work; this
// card just wires its activated ability to it. CR 605 activated ability;
// CR 602.5 — the source ("this creature") is `ctx.sourceInstanceId`.
//
// Tracker may legally target ANY creature, including itself (2009-10-01 ruling
// in DRK.json): there is no self-exclusion on a "target creature" requirement,
// and `resolveFight` short-circuits the self-fight gracefully (both halves
// resolve against the same instance — it takes 2× its own power, matching the
// printed ruling that it "deals damage to itself ... then immediately do it
// again").
export const tracker: CardDefinition = {
    id: "35ffc69e-26f2-434f-8c89-2df108dd984a",
    rarity: "rare",
    name: "Tracker",
    oracleText:
        "{G}{G}, {T}: This creature deals damage equal to its power to target creature. That creature deals damage equal to its power to this creature.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "tracker-fight",
            oracleText:
                "{G}{G}, {T}: This creature deals damage equal to its power to target creature. That creature deals damage equal to its power to this creature.",
            cost: { mana: { G: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (target?.type === "permanent") ctx.fight(target);
            },
        },
    ],
};

// Elves of Deep Shadow — {G} 1/1 Elf Druid, "{T}: Add {B}. This creature deals
// 1 damage to you." A painland-style mana creature (CR 605.1a mana ability —
// `useStack: false`, resolves without the stack). The self-damage is wired as a
// separate PERMANENT_TAPPED trigger gated on `forMana: true` (CR 603.6),
// mirroring the engine's established painland idiom (City of Brass). Tapping for
// the mana ability is the only way this creature taps for mana, so the trigger
// fires exactly when the printed "deals 1 damage to you" clause should.
export const elvesOfDeepShadow: CardDefinition = {
    id: "f395278e-6d74-4f35-af9d-21bad7b19763",
    rarity: "uncommon",
    name: "Elves of Deep Shadow",
    oracleText: "{T}: Add {B}. This creature deals 1 damage to you.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        tappedTrigger({
            id: "elves-of-deep-shadow-pain",
            oracleText: "This creature deals 1 damage to you.",
            scope: "self",
            forMana: true,
            // NOT DSL-migratable (ADR 0045): built via the `tappedTrigger`
            // factory, which owns the `resolve` closure and exposes no
            // `effects[]` site. Stays resolve() until the trigger factories
            // accept effects.
            resolve: (ctx) => {
                ctx.dealDamage({ type: "player", id: ctx.controller }, 1);
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "elves-of-deep-shadow-mana",
            oracleText: "{T}: Add {B}. This creature deals 1 damage to you.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ B: 1 }),
            manaProduced: { B: 1 },
        },
    ],
};

// Wormwood Treefolk — {3}{G}{G} 4/4 Treefolk. "{G}{G}: This creature gains
// forestwalk until end of turn and deals 2 damage to you.\n{B}{B}: This creature
// gains swampwalk until end of turn and deals 2 damage to you." (CR 605
// activated abilities; CR 611.1b temporary keyword grants at layer 6 expiring at
// end of turn; CR 702.14 landwalk; each grant pays an additional self-damage.)
export const wormwoodTreefolk: CardDefinition = {
    id: "2fa20173-e88a-4b14-9c54-14567ca5571c",
    rarity: "rare",
    name: "Wormwood Treefolk",
    oracleText:
        "{G}{G}: This creature gains forestwalk until end of turn and deals 2 damage to you.\n{B}{B}: This creature gains swampwalk until end of turn and deals 2 damage to you.",
    manaCost: { X: 3, G: 2 },
    types: ["Creature"],
    subtypes: ["Treefolk"],
    power: 4,
    toughness: 4,
    activatedAbilities: [
        {
            id: "wormwood-treefolk-forestwalk",
            oracleText:
                "{G}{G}: This creature gains forestwalk until end of turn and deals 2 damage to you.",
            cost: { mana: { G: 2 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #843): self-grant
            // forestwalk until end of turn (CR 611.1b) + 2 damage to controller.
            effects: [
                {
                    op: "grantAbility",
                    ability: "forestwalk",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
                { op: "dealDamage", amount: 2, to: { player: "controller" } },
            ],
        },
        {
            id: "wormwood-treefolk-swampwalk",
            oracleText:
                "{B}{B}: This creature gains swampwalk until end of turn and deals 2 damage to you.",
            cost: { mana: { B: 2 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #843): self-grant
            // swampwalk until end of turn (CR 611.1b) + 2 damage to controller.
            effects: [
                {
                    op: "grantAbility",
                    ability: "swampwalk",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
                { op: "dealDamage", amount: 2, to: { player: "controller" } },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Free tranche — Green (#415). Every card here is pure CardDefinition data on
// already-shipped engine primitives: keyword statics (CR 702), the layer-6
// keyword-grant machinery (CR 611 — `keyword-grant` staticEffects, both group
// anthems and aura grants), the CDA P/T `pt-cda` layer (CR 613.4c), the
// permanent-guard targeting gate (CR 115 / 702.18-style), the activated-ability
// path (CR 605) with regeneration shields / destroy / control-change, the
// BLOCKERS_CONFIRMED combat-pairing trigger + end-of-combat delayed destroy
// (CR 509.1h / 511.3), and `setExileOnDeath` (CR 614.1a). Costs / types /
// subtypes / P/T are sourced from MTGJSON `data/json/DRK.json`; modern Scryfall
// oracle text is authoritative (ADR 0004).
// ─────────────────────────────────────────────────────────────────────────────

// Carnivorous Plant — vanilla Defender Plant Wall (CR 702.3 defender keyword;
// the body is pure stats + the can't-attack keyword, no rules text otherwise).
export const carnivorousPlant: CardDefinition = {
    id: "6a615650-4da3-4efc-aa5e-c1f2c4f79478",
    rarity: "common",
    name: "Carnivorous Plant",
    oracleText: "Defender (This creature can't attack.)",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Plant", "Wall"],
    power: 4,
    toughness: 5,
    staticAbilities: ["defender"],
};

// Land Leeches — vanilla First strike Leech (CR 702.7 first strike keyword).
export const landLeeches: CardDefinition = {
    id: "ff99543d-86a1-44f8-88ec-aaec071d6c05",
    rarity: "common",
    name: "Land Leeches",
    oracleText:
        "First strike (This creature deals combat damage before creatures without first strike.)",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Leech"],
    power: 2,
    toughness: 2,
    staticAbilities: ["first strike"],
};

// Hidden Path — global anthem grant: "Green creatures have forestwalk." (CR 611
// continuous keyword-grant, layer 6; CR 702.13c forestwalk evasion.) Modeled
// exactly like Zombie Master's group `keyword-grant` (lea.ts), but the predicate
// filters on effective color (CR 105 / 202.2 — `ctx.getColors` honors any
// color-changing effect, e.g. a green creature laced blue stops getting it). The
// grant applies to ALL green creatures, both players' (the printed text is not
// controller-scoped).
export const hiddenPath: CardDefinition = {
    id: "cbc93c0b-0ac8-4b8f-b2f6-96887d1acd77",
    rarity: "rare",
    name: "Hidden Path",
    oracleText:
        "Green creatures have forestwalk. (They can't be blocked as long as defending player controls a Forest.)",
    manaCost: { X: 2, G: 4 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.getColors(target).includes("G"),
            keyword: "forestwalk",
        },
    ],
};

// Lurker — "This creature can't be the target of spells unless it attacked or
// blocked this turn." (CR 115 targeting restriction.) A self permanent-guard
// (`source.id === target.id`) with `cantBeTargeted` narrowed to SPELLS only
// (`targetSourceMustBeSpell` — abilities may always target it, CR 113.3). The
// guard's `applies` reads the host's per-turn combat flags (`hasAttackedThisTurn`
// / `hasBlockedThisTurn` on PermanentView) so the shroud blinks off the instant
// Lurker is declared as an attacker or blocker. Mirrors Spectral Cloak's live
// host-state read (leg.ts), but self-targeted and combat-conditioned.
export const lurker: CardDefinition = {
    id: "b39eb671-e17e-4c5a-8913-1e3be7faedfb",
    rarity: "rare",
    name: "Lurker",
    oracleText:
        "This creature can't be the target of spells unless it attacked or blocked this turn.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 2,
    toughness: 3,
    staticEffects: [
        {
            kind: "permanent-guard",
            id: "lurker-spell-shroud",
            cantBeTargeted: true,
            // CR 113.3 — spells only; abilities still target.
            targetSourceMustBeSpell: true,
            applies: (target, source) =>
                target.id === source.id &&
                !target.hasAttackedThisTurn &&
                !target.hasBlockedThisTurn,
        },
    ],
};

// People of the Woods — characteristic-defining toughness: "toughness is equal
// to the number of Forests you control." (CR 613.4a CDA, layer 7a.) Printed
// power stays 1 and printed toughness is 0; the `pt-cda` contribution is ADDED
// on top of the printed base (layers.ts `getCDAContribution`), so the compute
// returns `{ power: 0, toughness: forests }` → effective power 1+0, toughness
// 0+forests. A subtype-count over the controller's battlefield (CR 305.6 —
// basic AND nonbasic Forests both count). Mirrors Nightmare / Dakkon's self-CDA
// layer but contributes only to toughness.
export const peopleOfTheWoods: CardDefinition = {
    id: "2fb5926f-9988-4bc0-b2b7-e286db208310",
    rarity: "uncommon",
    name: "People of the Woods",
    oracleText:
        "People of the Woods's toughness is equal to the number of Forests you control.",
    manaCost: { G: 2 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 1,
    toughness: 0,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                let forests = 0;
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (
                            p.controllerId === source.controllerId &&
                            p.subtypes.includes("Forest")
                        ) {
                            forests++;
                        }
                    }
                }
                return { power: 0, toughness: forests };
            },
        },
    ],
};

// Savaen Elves — "{G}{G}, {T}: Destroy target Aura attached to a land." (CR 605
// activated ability; CR 701.7 destroy.) The target is any Aura (`subtypeFilter`),
// and the "attached to a LAND" host constraint is enforced in the resolve body —
// there is no host-relation field on TargetRequirement, exactly as Pyramids
// (arn.ts) and Miracle Worker (drk.ts) do it via `ctx.getAttachedTo`.
export const savaenElves: CardDefinition = {
    id: "38fb3014-f631-4a75-92cd-7e626b13a4c3",
    rarity: "common",
    name: "Savaen Elves",
    oracleText: "{G}{G}, {T}: Destroy target Aura attached to a land.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Elf"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "savaen-elves-destroy-aura",
            oracleText: "{G}{G}, {T}: Destroy target Aura attached to a land.",
            cost: { mana: { G: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Enchantment",
                subtypeFilter: "Aura",
                count: 1,
            },
            // NOT DSL-migratable (ADR 0045): the destroy is gated on the target
            // Aura's host being a land (getAttachedTo + battlefield membership),
            // a host-relation predicate the destroy Op can't express. Stays
            // resolve().
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (!target || target.type !== "permanent") return;
                // CR 701.7 — only destroy if the Aura's host is a land. There
                // is no type-reading SpellContext helper, so test membership in
                // any player's Land battlefield (mirrors Pyramids' host check).
                const hostId = ctx.getAttachedTo(target.id);
                if (hostId === undefined) return;
                const hostIsLand = ctx.allPlayerIds.some((pid) =>
                    ctx
                        .getBattlefieldIds(pid, { types: "Land" })
                        .includes(hostId)
                );
                if (hostIsLand) ctx.destroy(target);
            },
        },
    ],
};

// Scavenger Folk — "{G}, {T}, Sacrifice this creature: Destroy target artifact."
// (CR 605 activated ability; CR 118.5 sacrifice-self as a cost; CR 701.7
// destroy.) `cost.sacrifice: true` sacrifices the source itself as part of
// activation; the destroy runs on resolution.
export const scavengerFolk: CardDefinition = {
    id: "8e99870c-b2b9-431b-b8a8-3f4a80aa8fa5",
    rarity: "common",
    name: "Scavenger Folk",
    oracleText: "{G}, {T}, Sacrifice this creature: Destroy target artifact.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "scavenger-folk-destroy-artifact",
            oracleText:
                "{G}, {T}, Sacrifice this creature: Destroy target artifact.",
            cost: { mana: { G: 1 }, tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "Artifact", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #832): destroy the
            // announced target artifact (CR 701.8). The self-sacrifice is an
            // activation cost, not part of the effect.
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

// Niall Silvain — "{G}{G}{G}{G}, {T}: Regenerate target creature." (CR 605
// activated ability; CR 701.15 regeneration shield.) Targets ANY creature
// (including itself). The regen primitive is `applyRegenerationShield`, the same
// one Walking Dead / Zombie Master use, here applied to the chosen target.
export const niallSilvain: CardDefinition = {
    id: "9d5911b5-a54e-4ebb-9c36-d4dc8e97bb4b",
    rarity: "rare",
    name: "Niall Silvain",
    oracleText: "{G}{G}{G}{G}, {T}: Regenerate target creature.",
    manaCost: { G: 3 },
    types: ["Creature"],
    subtypes: ["Ouphe"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "niall-silvain-regenerate",
            oracleText: "{G}{G}{G}{G}, {T}: Regenerate target creature.",
            cost: { mana: { G: 4 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #846): regenerate the
            // announced creature target (CR 701.15a).
            effects: [{ op: "regenerate", target: { target: 0 } }],
        },
    ],
};

// Scarwood Hag — two activated abilities granting / stripping forestwalk until
// end of turn (CR 605 activated abilities; CR 611 layer-6 keyword grant /
// removal; CR 702.13c forestwalk). The grant reuses `grantStaticAbility` with an
// end-of-turn DurationSpec (like Part Water, leg.ts); the strip reuses
// `removeStaticAbilities` (the duration-scoped counterpart, used by Shelkin
// Brownie / Tolaria).
export const scarwoodHag: CardDefinition = {
    id: "ac2655e4-3a4d-4f73-820a-02fab675d42e",
    rarity: "uncommon",
    name: "Scarwood Hag",
    oracleText:
        "{G}{G}{G}{G}, {T}: Target creature gains forestwalk until end of turn. (It can't be blocked as long as defending player controls a Forest.)\n{T}: Target creature loses forestwalk until end of turn.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Hag"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "scarwood-hag-grant-forestwalk",
            oracleText:
                "{G}{G}{G}{G}, {T}: Target creature gains forestwalk until end of turn.",
            cost: { mana: { G: 4 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #843): grant forestwalk to
            // the announced target creature until end of turn (CR 611.1b). The
            // sibling strip ability (removeStaticAbilities, a predicate closure)
            // stays resolve() — not JSON-expressible as an Op.
            effects: [
                {
                    op: "grantAbility",
                    ability: "forestwalk",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            id: "scarwood-hag-strip-forestwalk",
            oracleText:
                "{T}: Target creature loses forestwalk until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (target?.type === "permanent")
                    ctx.removeStaticAbilities(
                        target,
                        (kw) => kw === "forestwalk",
                        { phase: "end-of-turn" }
                    );
            },
        },
    ],
};

// Scarwood Bandits — forestwalk (CR 702.13c keyword) + "{2}{G}, {T}: Unless an
// opponent pays {2}, gain control of target artifact for as long as this creature
// remains on the battlefield." (CR 605 activated ability; CR 118.8 "unless ...
// pays" cost-on-opponent; CR 613.1b layer-2 control change.) The opponent's
// optional {2} is a `requestMayPay`; if unpaid, control is reassigned with the
// `controller-controls-source` condition (Aladdin's "for as long as you control
// ~" form, which the conditional-control SBA reverts when Scarwood Bandits leaves
// play).
export const scarwoodBandits: CardDefinition = {
    id: "46b762a7-a774-4cb4-8ecf-dd6486a066c3",
    rarity: "rare",
    name: "Scarwood Bandits",
    oracleText:
        "Forestwalk (This creature can't be blocked as long as defending player controls a Forest.)\n{2}{G}, {T}: Unless an opponent pays {2}, gain control of target artifact for as long as this creature remains on the battlefield.",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Rogue"],
    power: 2,
    toughness: 2,
    staticAbilities: ["forestwalk"],
    activatedAbilities: [
        {
            id: "scarwood-bandits-steal",
            oracleText:
                "{2}{G}, {T}: Unless an opponent pays {2}, gain control of target artifact for as long as this creature remains on the battlefield.",
            cost: { mana: { X: 2, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Artifact", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #848): the opponent may pay
            // {2} (CR 118.3 optional payment); if they don't, gain control of the
            // targeted artifact "for as long as this creature remains on the
            // battlefield" (CR 613.1b layer-2 control change; CR 611.2b revert).
            // The Force Spike mayPay + `if !$paid` shape (leg/blue.ts).
            effects: [
                {
                    op: "mayPay",
                    player: "opponent",
                    cost: { X: 2 },
                    prompt: "Pay {2} or Scarwood Bandits' controller gains control of the artifact?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { not: { binding: "$paid" } },
                    then: [
                        {
                            op: "gainControl",
                            target: { target: 0 },
                            controller: "controller",
                            duration: "while-you-control-source",
                        },
                    ],
                },
            ],
        },
    ],
};

// Spitting Slug — "Whenever this creature blocks or becomes blocked, you may pay
// {1}{G}. If you do, this creature gains first strike until end of turn.
// Otherwise, each creature blocking or blocked by this creature gains first
// strike until end of turn." (CR 509.1h combat-pairing trigger; CR 118.4
// optional payment; CR 611 layer-6 first-strike grant.) The trigger fires off
// BLOCKERS_CONFIRMED whenever the slug is either side of a block; the controller
// chooses to pay {1}{G} (→ slug gets first strike) or not (→ the paired
// creature does instead).
export const spittingSlug: CardDefinition = {
    id: "7011356e-7516-4ca0-ac54-d30af7ce03a2",
    rarity: "uncommon",
    name: "Spitting Slug",
    oracleText:
        "Whenever this creature blocks or becomes blocked, you may pay {1}{G}. If you do, this creature gains first strike until end of turn. Otherwise, each creature blocking or blocked by this creature gains first strike until end of turn.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Slug"],
    power: 2,
    toughness: 4,
    triggeredAbilities: [
        {
            id: "spitting-slug-first-strike",
            oracleText:
                "Whenever this creature blocks or becomes blocked, you may pay {1}{G}. If you do, this creature gains first strike until end of turn. Otherwise, each creature blocking or blocked by this creature gains first strike until end of turn.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                return (
                    event.attackerId === self.id || event.blockerId === self.id
                );
            },
            // NOT DSL-migratable (ADR 0045): reads trigger-event fields
            // (event.attackerId / blockerId) to compute the paired combat
            // creature, then grants first strike to self OR that runtime-
            // computed creature depending on the may-pay outcome — no DSL
            // construct captures trigger-event data or a computed (non-
            // announced) target. Blocked on: trigger-event field capture
            // (planned-migratable); grantStaticAbility itself is covered by
            // grantAbility (#843).
            resolve: (ctx, event) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return;
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                const isSelfAttacker =
                    event.attackerId === ctx.sourceInstanceId;
                const otherId = isSelfAttacker
                    ? event.blockerId
                    : event.attackerId;
                const paid = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: `spitting-slug-${ctx.sourceInstanceId}`,
                    cost: { X: 1, G: 1 },
                    prompt: "Pay {1}{G} so Spitting Slug gains first strike? (Otherwise the paired creature does.)",
                });
                if (paid === undefined) return; // suspended for the choice
                if (paid) {
                    ctx.grantStaticAbility(self, "first strike", {
                        phase: "end-of-turn",
                    });
                } else {
                    ctx.grantStaticAbility(
                        { type: "permanent", id: otherId },
                        "first strike",
                        { phase: "end-of-turn" }
                    );
                }
            },
        },
    ],
};

// Venom — Aura. "Enchant creature\nWhenever enchanted creature blocks or becomes
// blocked by a non-Wall creature, destroy the other creature at end of combat."
// (CR 303.4 aura; CR 509.1h combat-pairing trigger keyed to the host; CR 511.3
// end-of-combat timing; CR 701.7 destroy.) Reuses the LEA Basilisk / Cockatrice
// "destroy at end of combat" machinery (BLOCKERS_CONFIRMED trigger →
// `scheduleDelayedTrigger("next-end-of-combat")` → destroy), but the trigger is
// keyed to the aura's HOST (`self.attachedTo`) rather than the source itself.
const VENOM_ID = "bb0480f5-6aae-4297-afa6-3f7a5801bf95";
export const venom: CardDefinition = {
    id: VENOM_ID,
    rarity: "common",
    name: "Venom",
    oracleText:
        "Enchant creature\nWhenever enchanted creature blocks or becomes blocked by a non-Wall creature, destroy the other creature at end of combat.",
    manaCost: { X: 1, G: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    // Migrated resolve()→effects[] (ADR 0049, issue #865). "Destroy the OTHER
    // creature in the pair" is expressed as TWO triggered abilities rather than
    // an id-equality conditional pick (deferred as the `$id-equality` classifier
    // pseudo-blocker): role discrimination stays in the imperative `matches`
    // (host-is-attacker vs host-is-blocker), and each ability captures the
    // single relevant `$event` field (the blocker when the host attacks, the
    // attacker when the host blocks). BLOCKERS_CONFIRMED is emitted per
    // attacker-blocker pair (phases.ts), so the split fires correctly under
    // multi-block and banding. Each destroy runs at end of combat via an inline
    // delayedTrigger body (ADR 0048); the captured id is re-bound fresh at fire
    // time and a creature already gone is a no-op (CR 608.2b + 701.7c).
    triggeredAbilities: [
        {
            id: "venom-combat-kill-attacker",
            oracleText:
                "Whenever enchanted creature blocks or becomes blocked by a non-Wall creature, destroy the other creature at end of combat.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                if (!self.attachedTo) return false;
                // Host is the ATTACKER; the "other" creature is the blocker,
                // which must be a non-Wall (CR 509.1h pairing).
                return (
                    event.attackerId === self.attachedTo &&
                    !event.blockerSubtypes.includes("Wall")
                );
            },
            effects: [
                {
                    op: "delayedTrigger",
                    timing: "next-end-of-combat",
                    oracleText: "Destroy the other creature at end of combat.",
                    capture: { $other: { ref: "$event.blockerId" } },
                    effects: [{ op: "destroy", target: { ref: "$other" } }],
                },
            ],
        },
        {
            id: "venom-combat-kill-blocker",
            oracleText:
                "Whenever enchanted creature blocks or becomes blocked by a non-Wall creature, destroy the other creature at end of combat.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                if (!self.attachedTo) return false;
                // Host is the BLOCKER; the "other" creature is the attacker,
                // which must be a non-Wall (CR 509.1h pairing).
                return (
                    event.blockerId === self.attachedTo &&
                    !event.attackerSubtypes.includes("Wall")
                );
            },
            effects: [
                {
                    op: "delayedTrigger",
                    timing: "next-end-of-combat",
                    oracleText: "Destroy the other creature at end of combat.",
                    capture: { $other: { ref: "$event.attackerId" } },
                    effects: [{ op: "destroy", target: { ref: "$other" } }],
                },
            ],
        },
    ],
};

// Whippoorwill — "{G}{G}, {T}: Target creature can't be regenerated this turn.
// Damage that would be dealt to that creature this turn can't be prevented or
// dealt instead to another permanent or player. When the creature dies this
// turn, exile the creature." (CR 605 activated ability; CR 614.1a exile-instead-
// of-death + regeneration suppression.)
//
// The exile-on-death + no-regeneration clauses are the gameplay core and are
// implemented exactly via `setExileOnDeath` (the Disintegrate primitive: marks
// the creature so it is exiled rather than dying, and suppresses regeneration,
// cleared at CLEANUP). DEFERRED (documented simplification, NOT a new card-
// specific primitive, tracked-by: #2231): the middle clause — "damage ... can't
// be prevented or dealt instead to another permanent or player" — is an
// anti-prevention / anti-redirection lock (CR 615 / 614.9, and CR 702.16e —
// protection's damage leg is prevention) for which no engine primitive exists.
// Same gap as ICE Lava Burst, at the turn-scoped end: this one locks damage to
// the TARGETED creature from any source for the turn. Until the 2026-08-05
// #1212 audit this deferral carried no tracking ref at all.
export const whippoorwill: CardDefinition = {
    id: "e56146bf-5db0-4bef-83bb-efa5ebec6684",
    rarity: "uncommon",
    name: "Whippoorwill",
    oracleText:
        "{G}{G}, {T}: Target creature can't be regenerated this turn. Damage that would be dealt to that creature this turn can't be prevented or dealt instead to another permanent or player. When the creature dies this turn, exile the creature.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "whippoorwill-doom",
            oracleText:
                "{G}{G}, {T}: Target creature can't be regenerated this turn. When the creature dies this turn, exile the creature.",
            cost: { mana: { G: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (target?.type === "permanent") ctx.setExileOnDeath(target);
            },
        },
    ],
};

// Marsh Viper — "Whenever this creature deals damage to a player, that player
// gets two poison counters." (modern Oracle, ADR 0004). The trigger fires on
// ANY damage to a player (CR 120.3) — combat or otherwise — not combat-gated,
// so `damageDealtTrigger` carries a player target with NO `isCombat`
// constraint. Reuses the ARN poison precedent (Nafs Asp) and the C1.1 poison
// seam (ADR 0032): `addPoisonCounters` adds two counters to the damaged player;
// the >=10 loss is the global SBA (CR 704.5c), not the card's concern.
export const marshViper: CardDefinition = {
    id: "109cce7a-96f7-4e67-878a-bd5c93ea8643",
    rarity: "common",
    name: "Marsh Viper",
    oracleText:
        "Whenever this creature deals damage to a player, that player gets two poison counters.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Snake"],
    power: 1,
    toughness: 2,
    triggeredAbilities: [
        damageDealtTrigger({
            id: "marsh-viper-poison",
            oracleText:
                "Whenever this creature deals damage to a player, that player gets two poison counters.",
            source: "self",
            target: { kind: "player", player: { relation: "any" } },
            resolve: (ctx, event) => {
                if (event.target.type !== "player") return;
                ctx.addPoisonCounters(event.target.id, 2);
            },
        }),
    ],
};
