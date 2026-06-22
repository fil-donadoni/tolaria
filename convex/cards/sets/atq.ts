// Antiquities (ATQ) — the game's first artifact-centric expansion. All entries
// are new `Card Definition`s: Antiquities has no reprints of already-implemented
// cards, so there are no `Card Print` stubs to add. Modern Scryfall oracle text
// is authoritative (ADR 0004); the canonical card list, mana costs, and types
// are sourced from MTGJSON `ATQ.json`.
//
// This file is built in dependency-ordered slices (see PRD #269). THIS slice
// (#270) is the walking skeleton: two vanilla keyword artifact creatures that
// prove the full pipeline (registry → GRE → wire projection → UI) end-to-end
// before the rest of the set lands. Bronze Tablet (ante) is out of scope and
// is intentionally absent (consistent with ADR 0010).
//
// Generic mana is encoded as `X: n` (e.g. {3} → { X: 3 }); {0} is an empty
// mana cost `{}`.

import type {
    ActivatedAbilityContext,
    CardDefinition,
    DelayedTriggerDef,
    ManaCost,
    PermanentView,
    SpellContext,
    TargetSelection,
    TokenSpec,
    TriggeredAbility,
} from "../types";
import { cantBeEnchantedSelfGuard, EFFECT_AFFECTS_SELF } from "../types";
import { spellCastTrigger } from "../abilities/triggers/spellCastTrigger";
import { diedTrigger } from "../abilities/triggers/diedTrigger";
import { enteredTrigger } from "../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../abilities/triggers/leftTrigger";
import { phaseTrigger } from "../abilities/triggers/phaseTrigger";
import { tappedTrigger } from "../abilities/triggers/tappedTrigger";
import { untapTrigger } from "../abilities/triggers/untapTrigger";
import { abilityActivatedTrigger } from "../abilities/triggers/abilityActivatedTrigger";
import { makeCircleOfProtection } from "../abilities";

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla / keyword artifact creatures (CR 702 — keywords map to
// `staticAbilities[]`; CR 301 — artifact creatures are both Artifact and
// Creature, affected by both artifact and creature rules)
// ─────────────────────────────────────────────────────────────────────────────

// Ornithopter — {0} Artifact Creature — Thopter, 0/2 with flying (CR 702.9).
// The classic free flyer; a zero-cost evasive blocker/chump.
export const ornithopter: CardDefinition = {
    id: "59cc9bdb-7cf2-4795-bac7-ffff605c9eb0",
    rarity: "common",
    name: "Ornithopter",
    oracleText: "Flying",
    manaCost: {},
    types: ["Artifact", "Creature"],
    subtypes: ["Thopter"],
    power: 0,
    toughness: 2,
    staticAbilities: ["flying"],
};

// Yotian Soldier — {3} Artifact Creature — Soldier, 1/4 with vigilance
// (CR 702.21). A durable attacker that stays back to block.
export const yotianSoldier: CardDefinition = {
    id: "27cf53e3-76f6-4831-800e-1259394d779d",
    rarity: "common",
    name: "Yotian Soldier",
    oracleText: "Vigilance",
    manaCost: { X: 3 },
    types: ["Artifact", "Creature"],
    subtypes: ["Soldier"],
    power: 1,
    toughness: 4,
    staticAbilities: ["vigilance"],
};

// Wall of Spears — {3} Artifact Creature — Wall, 2/3 with defender + first
// strike (CR 702.3 defender — can't attack; CR 702.7 first strike — deals
// combat damage in the first-strike step). Pure keyword mapping, no resolve().
export const wallOfSpears: CardDefinition = {
    id: "b1dda179-c49a-4995-ba5a-db93ac43dbe7",
    rarity: "uncommon",
    name: "Wall of Spears",
    oracleText: "Defender (This creature can't attack.)\nFirst strike",
    manaCost: { X: 3 },
    types: ["Artifact", "Creature"],
    subtypes: ["Wall"],
    power: 2,
    toughness: 3,
    staticAbilities: ["defender", "first strike"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Artifact creatures with activated abilities (CR 605 — activated abilities;
// CR 611.1 temp P/T mods; CR 701.15 regeneration; CR 502.1 untap restriction)
// ─────────────────────────────────────────────────────────────────────────────

// Dragon Engine — {3} Artifact Creature — Construct, 1/3 with "{2}: This
// creature gets +1/+0 until end of turn." (CR 611.1 temporary P/T modification,
// CR 514.2 cleanup expiry). Same shape as Wall of Water's pump (lea.ts).
export const dragonEngine: CardDefinition = {
    id: "07793a71-1106-4303-b620-e403bd378020",
    rarity: "common",
    name: "Dragon Engine",
    oracleText: "{2}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 3 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 1,
    toughness: 3,
    activatedAbilities: [
        {
            id: "dragon-engine-pump",
            oracleText: "{2}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Clay Statue — {4} Artifact Creature — Golem, 3/1 with "{2}: Regenerate this
// creature." (CR 701.15a regeneration shield — the next time this would be
// destroyed this turn, instead tap it, remove damage, and remove it from
// combat). The shield is armed via `applyRegenerationShield` on the source.
export const clayStatue: CardDefinition = {
    id: "64975352-8d35-4d02-94ac-fa0c6ee12409",
    rarity: "common",
    name: "Clay Statue",
    oracleText: "{2}: Regenerate this creature.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 3,
    toughness: 1,
    activatedAbilities: [
        {
            id: "clay-statue-regen",
            oracleText: "{2}: Regenerate this creature.",
            cost: { mana: { X: 2 } },
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

// Grapeshot Catapult — {4} Artifact Creature — Construct, 2/3 with "{T}: This
// creature deals 1 damage to target creature with flying." (CR 605 activated
// ability with a tap cost and a target; CR 120.3 damage; CR 702.9 the
// `requireAbility: "flying"` filter restricts legal targets to flyers).
export const grapeshotCatapult: CardDefinition = {
    id: "4c7a7348-c82e-453c-975c-e5365e152a3a",
    rarity: "common",
    name: "Grapeshot Catapult",
    oracleText:
        "{T}: This creature deals 1 damage to target creature with flying.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 2,
    toughness: 3,
    activatedAbilities: [
        {
            id: "grapeshot-catapult-bolt",
            oracleText:
                "{T}: This creature deals 1 damage to target creature with flying.",
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
                    ctx.dealDamage(target, 1);
                }
            },
        },
    ],
};

// Colossus of Sardia — {9} Artifact Creature — Golem, 9/9 with trample +
// "This creature doesn't untap during your untap step. {9}: Untap this
// creature. Activate only during your upkeep." (CR 702.19 trample; CR 502.1
// untap restriction via the `does-not-untap` keyword read by `untapStep` in
// phases.ts; CR 602.5b activation timing — `activationPhaseRestriction:
// ["UPKEEP"]` + `controllerTurnOnly` enforces "during your upkeep").
export const colossusOfSardia: CardDefinition = {
    id: "067c44e9-1b23-42fd-9acb-daafb62c32a2",
    rarity: "rare",
    name: "Colossus of Sardia",
    oracleText:
        "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)\nThis creature doesn't untap during your untap step.\n{9}: Untap this creature. Activate only during your upkeep.",
    manaCost: { X: 9 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 9,
    toughness: 9,
    staticAbilities: ["trample", "does-not-untap"],
    activatedAbilities: [
        {
            id: "colossus-of-sardia-untap",
            oracleText:
                "{9}: Untap this creature. Activate only during your upkeep.",
            cost: { mana: { X: 9 } },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            controllerTurnOnly: true,
            resolve: (ctx: SpellContext) => {
                ctx.untap({ type: "permanent", id: ctx.sourceInstanceId });
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Simple non-creature permanents (CR 305 lands, CR 301 artifacts)
// ─────────────────────────────────────────────────────────────────────────────

// Strip Mine — Land with "{T}: Add {C}." and "{T}, Sacrifice this land:
// Destroy target land." (CR 605.1a/605.3a mana ability useStack:false; CR
// 701.7 destroy via a sacrifice-cost activated ability that uses the stack so
// it can be responded to). The sac cost is paid at activation; the destroy
// resolves later from the stack.
export const stripMine: CardDefinition = {
    id: "e7880157-7f27-4f1b-9cdc-ab36a6252376",
    rarity: "uncommon",
    name: "Strip Mine",
    oracleText: "{T}: Add {C}.\n{T}, Sacrifice this land: Destroy target land.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "strip-mine-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ C: 1 });
            },
            manaProduced: { C: 1 },
        },
        {
            id: "strip-mine-destroy",
            oracleText: "{T}, Sacrifice this land: Destroy target land.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.destroy(target);
                }
            },
        },
    ],
};

// Obelisk of Undoing — Artifact with "{6}, {T}: Return target permanent you
// both own and control to your hand." (CR 701.10 return to hand; CR 605
// activated ability with mana + tap cost; the `controller: "you"` filter
// scopes legal targets to permanents the activator controls — and, since you
// can only own-and-control a permanent you also own, this is effectively "you
// both own and control"). `type: "any"` matches only damageable permanent
// types (CR 115.4 — creature/planeswalker/battle), so the target is declared
// as the explicit set of every permanent type to honor "target permanent" of
// any type. Mana cost {1} per MTGJSON ATQ.json (ADR 0004 authoritative).
export const obeliskOfUndoing: CardDefinition = {
    id: "1ba61ccd-4429-4f7c-b9f3-30867878d88e",
    rarity: "rare",
    name: "Obelisk of Undoing",
    oracleText:
        "{6}, {T}: Return target permanent you both own and control to your hand.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "obelisk-of-undoing-return",
            oracleText:
                "{6}, {T}: Return target permanent you both own and control to your hand.",
            cost: { tap: true, mana: { X: 6 } },
            useStack: true,
            targetRequirement: {
                type: [
                    "Artifact",
                    "Creature",
                    "Enchantment",
                    "Land",
                    "Planeswalker",
                    "Battle",
                ],
                count: 1,
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.returnToHand(target);
                }
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Artifact removal & bounce (free tranche, #274) — CR 701.7 destroy, CR
// 701.10 return to hand, CR 701.5a counter, CR 202.3 mana value. Modern
// Scryfall oracle text is authoritative (ADR 0004); mana costs / type lines
// come from MTGJSON ATQ.json. All effects compose existing SpellContext
// primitives (no new primitive, no engine change).
// ─────────────────────────────────────────────────────────────────────────────

// Crumble — {G} Instant. "Destroy target artifact. It can't be regenerated.
// That artifact's controller gains life equal to its mana value." Order
// matters: read the controller and the mana value BEFORE the destroy moves the
// permanent off the battlefield (CR 608.2c — the effect uses last-known
// information once the object has left). `cantBeRegenerated: true` suppresses
// the regen-shield replacement (CR 701.15c); indestructible still protects.
export const crumble: CardDefinition = {
    id: "d2101f86-8d3c-4ba8-ac42-bd3df0644280",
    rarity: "common",
    name: "Crumble",
    oracleText:
        "Destroy target artifact. It can't be regenerated. That artifact's controller gains life equal to its mana value.",
    manaCost: { G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Artifact", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        // Snapshot controller + mana value before the destroy (CR 608.2c).
        const controllerId = ctx.getController(target);
        const mv = ctx.getManaValue(target);
        ctx.destroy(target, { cantBeRegenerated: true });
        ctx.gainLife(controllerId, mv);
    },
};

// Detonate — {X}{R} Sorcery. "Destroy target artifact with mana value X. It
// can't be regenerated. Detonate deals X damage to that artifact's
// controller." `mvFilter: { equals: "X" }` resolves X at announcement against
// the chosen value and restricts legal targets to artifacts whose mana value
// equals X (CR 107.3 / 202.3). Snapshot the controller before the destroy so
// the X damage still lands on the right player via last-known information
// (CR 608.2c).
export const detonate: CardDefinition = {
    id: "ffd7eb90-ae95-49df-898a-9510187bce1c",
    rarity: "uncommon",
    name: "Detonate",
    oracleText:
        "Destroy target artifact with mana value X. It can't be regenerated. Detonate deals X damage to that artifact's controller.",
    manaCost: { X: "X", R: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Artifact",
        count: 1,
        mvFilter: { equals: "X" },
    },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        const controllerId = ctx.getController(target);
        const x = ctx.getX();
        ctx.destroy(target, { cantBeRegenerated: true });
        ctx.dealDamage({ type: "player", id: controllerId }, x);
    },
};

// Shatterstorm — {2}{R}{R} Sorcery. "Destroy all artifacts. They can't be
// regenerated." Mass destroy via `destroyAll("Artifact", { cantBeRegenerated:
// true })` (CR 701.7, 701.15c); indestructible artifacts are still spared.
export const shatterstorm: CardDefinition = {
    id: "0987461a-45c0-4956-8627-cd27a7e038d0",
    rarity: "rare",
    name: "Shatterstorm",
    oracleText: "Destroy all artifacts. They can't be regenerated.",
    manaCost: { X: 2, R: 2 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll("Artifact", { cantBeRegenerated: true });
    },
};

// Artifact Blast — {R} Instant. "Counter target artifact spell." Targets a
// spell on the stack restricted to the Artifact card type via
// `spellTypeFilter` (CR 114.1), then counters it (CR 701.5a). No-op if the
// target has left the stack (CR 608.2b, handled by `counter`).
export const artifactBlast: CardDefinition = {
    id: "1506d99d-7b2e-4101-84a5-c950dadb263a",
    rarity: "common",
    name: "Artifact Blast",
    oracleText: "Counter target artifact spell.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: "Artifact",
    },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "spell") ctx.counter(target);
    },
};

// Hurkyl's Recall — {1}{U} Instant. "Return all artifacts target player owns
// to their hand." Targets a player, then bounces every artifact that player
// owns (CR 701.10). `returnToHand` already routes each card to its OWNER's
// hand. Implementation note / divergence: `getBattlefieldIds(playerId, …)`
// enumerates artifacts on the TARGET PLAYER'S battlefield (i.e. those they
// control). For artifacts the target player owns but does NOT control (e.g.
// one stolen by an opponent via a control-change effect), this misses them,
// and it would wrongly bounce an artifact the target controls but another
// player owns. The current card pool has no artifact control-theft, so in
// practice owner == controller for artifacts; a strict owner-scoped
// enumeration would need a new engine query and is deferred (no engine change
// in this tranche).
export const hurkylsRecall: CardDefinition = {
    id: "f32373dd-06d8-45d1-8777-3b1411bcb30a",
    rarity: "rare",
    name: "Hurkyl's Recall",
    oracleText: "Return all artifacts target player owns to their hand.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        const artifactIds = ctx.getBattlefieldIds(target.id, {
            types: "Artifact",
        });
        for (const id of artifactIds) {
            ctx.returnToHand({ type: "permanent", id });
        }
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Graveyard / library recursion & card-flow (free tranche, #275) — CR 400.7
// zone changes, CR 401 library order, CR 701.20 shuffle, CR 121.1 draw, CR
// 701.8 discard, CR 701.20b untap. Modern Scryfall oracle text is authoritative
// (ADR 0004); mana costs / type lines come from MTGJSON ATQ.json. Every effect
// composes existing SpellContext primitives (moveCardById, moveZone,
// shuffleLibrary, reorderLibraryTop, peekLibraryTop, drawCards, discardCard,
// untap) — no new primitive, no engine change.
// ─────────────────────────────────────────────────────────────────────────────

// Reconstruction — {U} Sorcery. "Return target artifact card from your
// graveyard to your hand." Twin of Regrowth (lea.ts) narrowed to artifacts via
// the graveyard-zone target filter (CR 400.7 — the graveyard card becomes a new
// object on the zone change). `type: "Artifact"` + `zone: "graveyard"` +
// `controller: "you"` scopes legal targets to artifact cards in the caster's
// own graveyard (rules.ts graveyard branch). `moveCardById` routes the picked
// card graveyard → hand.
export const reconstruction: CardDefinition = {
    id: "1aa2d27b-cc25-4baa-86f4-4db45b30e2a4",
    rarity: "common",
    name: "Reconstruction",
    oracleText: "Return target artifact card from your graveyard to your hand.",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Artifact",
        count: 1,
        zone: "graveyard",
        controller: "you",
    },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (!t || t.type !== "graveyard-card" || !t.playerId) return;
        ctx.moveCardById(t.playerId, t.id, "graveyard", "hand");
    },
};

// Argivian Archaeologist — {1}{W}{W} Artifact Creature — Human Artificer, 1/2
// with "{W}{W}, {T}: Return target artifact card from your graveyard to your
// hand." (CR 605 activated ability; CR 400.7 zone change). The repeatable
// engine version of Reconstruction. Same graveyard-zone target filter; the
// {W}{W} + tap cost is paid at activation and the move resolves from the stack
// (useStack: true). MTGJSON ATQ.json: casting cost {1}{W}{W}, 1/2.
export const argivianArchaeologist: CardDefinition = {
    id: "ce83a3cb-467d-44f6-a051-4855c8cf52a6",
    rarity: "rare",
    name: "Argivian Archaeologist",
    oracleText:
        "{W}{W}, {T}: Return target artifact card from your graveyard to your hand.",
    manaCost: { X: 1, W: 2 },
    types: ["Artifact", "Creature"],
    subtypes: ["Human", "Artificer"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "argivian-archaeologist-return",
            oracleText:
                "{W}{W}, {T}: Return target artifact card from your graveyard to your hand.",
            cost: { tap: true, mana: { W: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Artifact",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (!t || t.type !== "graveyard-card" || !t.playerId) return;
                ctx.moveCardById(t.playerId, t.id, "graveyard", "hand");
            },
        },
    ],
};

// Feldon's Cane — {1} Artifact. "{T}, Exile this artifact: Shuffle your
// graveyard into your library." (CR 400.7 zone change + CR 701.20 shuffle.)
// Composition: moveZone(graveyard → library) appends the graveyard cards to the
// library, then shuffleLibrary randomizes — exactly "shuffle your graveyard
// into your library".
//
// PRIMITIVE GAP / DIVERGENCE (flagged, no engine change): there is no `exile`
// activation-cost kind on ActivatedAbility (only tap/mana/sacrifice/life/
// counter/discard). "Exile this artifact" is a *cost*, so strictly it should be
// paid at activation; here it's modeled inside resolve() via
// `exile(sourceInstanceId)`. Practical effect is identical for this card — the
// only observable difference is that, with the cost-vs-effect distinction, the
// source would already be in exile while the ability is on the stack. Since the
// ability shuffles the graveyard (not the source) and exiling self has no
// stack-interactive payoff, the resolve-body model is behaviourally equivalent
// for the current card pool. A general `exile`/`exileSelf` cost kind is
// deferred to a feature tranche.
export const feldonsCane: CardDefinition = {
    id: "bb6af436-bcfd-4d47-a1aa-e84b587a725a",
    rarity: "uncommon",
    name: "Feldon's Cane",
    oracleText:
        "{T}, Exile this artifact: Shuffle your graveyard into your library.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "feldons-cane-shuffle",
            oracleText:
                "{T}, Exile this artifact: Shuffle your graveyard into your library.",
            cost: { tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // Exile-as-cost modeled in the resolve body (no `exile` cost
                // kind — see divergence note above). Exile self FIRST so the
                // Cane is not among the cards shuffled into the library.
                ctx.exile({ type: "permanent", id: ctx.sourceInstanceId });
                ctx.moveZone(ctx.controller, "graveyard", "library");
                ctx.shuffleLibrary(ctx.controller);
            },
        },
    ],
};

// Drafna's Restoration — {U} Sorcery. "Put any number of target artifact cards
// from target player's graveyard on top of their library in any order."
// (CR 601.2c variable target count, CR 400.7 zone change, CR 401 library
// order.) Targets one-or-more artifact graveyard cards (the engine's graveyard
// target branch already scopes to one player per card, and Antiquities' oracle
// reads "from a single graveyard"; `controller: "any"` lets the caster recur
// from any player's bin).
//
// Composition for "on top in any order" using existing primitives only: move
// every chosen card graveyard → library (they append to the BOTTOM, since
// moveCard pushes and drawCard reads index 0), then let the player order just
// those cards via a `reorder-library` choice gated by `candidateIds`, and
// finally `reorderLibraryTop` over the FULL library with the chosen cards first
// — placing them on top in the chosen order ahead of the pre-existing library.
export const drafnasRestoration: CardDefinition = {
    id: "4be2aa3b-207b-4d21-abfb-6788520c7676",
    rarity: "common",
    name: "Drafna's Restoration",
    oracleText:
        "Put any number of target artifact cards from target player's graveyard on top of their library in any order.",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Artifact",
        count: { min: 1 },
        zone: "graveyard",
        controller: "any",
    },
    resolveSteps: [
        (ctx: SpellContext) => {
            const targets = ctx.targets.filter(
                (t) => t.type === "graveyard-card" && t.playerId
            );
            if (targets.length === 0) return;
            // All targeted cards come from a single graveyard (one owner).
            const ownerId = targets[0].playerId!;
            const movedIds: string[] = [];
            for (const t of targets) {
                if (t.playerId !== ownerId) continue;
                ctx.moveCardById(ownerId, t.id, "graveyard", "library");
                movedIds.push(t.id);
            }
            if (movedIds.length === 0) return;
            // Player orders the moved cards (first = top). The allow-list pins
            // the choice to exactly the cards just put into the library.
            const ordered = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: "drafna-order",
                kind: "reorder-library",
                zone: "library",
                count: movedIds.length,
                zoneOwnerId: ownerId,
                candidateIds: movedIds,
                prompt: "Put these artifact cards on top in any order (first = top).",
            });
            if (!ordered) return;
            // Build the full library order: chosen cards first (top), then the
            // remainder of the library in its current order. peekLibraryTop with
            // a large N returns every id (slice clamps).
            const allIds = ctx.peekLibraryTop(ownerId, Number.MAX_SAFE_INTEGER);
            const orderedSet = new Set(ordered);
            const rest = allIds.filter((id) => !orderedSet.has(id));
            ctx.reorderLibraryTop(ownerId, [...ordered, ...rest]);
        },
    ],
};

// Millstone — {2} Artifact. "{2}, {T}: Target player mills two cards." (CR
// 701.13a mill — put the top N cards of a library into its owner's graveyard;
// CR 400.7 zone change.) Composition: move the top card library → graveyard,
// twice (moveCardById on the live top id each iteration), via the {2}+tap
// activated ability. Mill stops naturally when the library empties.
export const millstone: CardDefinition = {
    id: "107646bc-2181-49f4-8821-1eaa46291855",
    rarity: "uncommon",
    name: "Millstone",
    oracleText: "{2}, {T}: Target player mills two cards.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "millstone-mill",
            oracleText: "{2}, {T}: Target player mills two cards.",
            cost: { tap: true, mana: { X: 2 } },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "player") return;
                // Mill two: move the current top card to the graveyard twice
                // (CR 701.13a). Re-read the top id each pass; no-op once empty.
                for (let i = 0; i < 2; i++) {
                    const top = ctx.peekLibraryTop(target.id, 1);
                    if (top.length === 0) break;
                    ctx.moveCardById(target.id, top[0], "library", "graveyard");
                }
            },
        },
    ],
};

// Jalum Tome — {3} Artifact — Book. "{2}, {T}: Draw a card, then discard a
// card." (CR 121.1 draw, CR 701.8 discard; loot.) Composition: drawCards(1)
// then a `choose-hand-card` choice to pick which card to discard (modern oracle
// text: the player chooses). The discard happens "then" — sequenced via a
// two-step resolve so the drawn card is in hand before the discard pick.
export const jalumTome: CardDefinition = {
    id: "5a5b7c5a-ee63-4a1b-9a0f-fb0a309168df",
    rarity: "uncommon",
    name: "Jalum Tome",
    oracleText: "{2}, {T}: Draw a card, then discard a card.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    subtypes: ["Book"],
    activatedAbilities: [
        {
            id: "jalum-tome-loot",
            oracleText: "{2}, {T}: Draw a card, then discard a card.",
            cost: { tap: true, mana: { X: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.controller, 1);
                const handIds = ctx.getHandIds(ctx.controller);
                if (handIds.length === 0) return;
                const picked = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: "jalum-discard",
                    kind: "choose-hand-card",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                });
                if (!picked || picked.length === 0) return;
                ctx.discardCard(ctx.controller, picked[0]);
            },
        },
    ],
};

// Candelabra of Tawnos — {1} Artifact. "{X}, {T}: Untap X target lands." (CR
// 107.3 X chosen at activation, CR 601.2c X-bound target count, CR 701.20b
// untap.) `count: "X"` resolves the number of land targets against the chosen
// value of X at activation; resolve untaps each. A 0-X activation skips target
// selection and untaps nothing.
export const candelabraOfTawnos: CardDefinition = {
    id: "35a335bf-7358-460f-b7c9-1e8bc4300f64",
    rarity: "rare",
    name: "Candelabra of Tawnos",
    oracleText: "{X}, {T}: Untap X target lands.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "candelabra-untap",
            oracleText: "{X}, {T}: Untap X target lands.",
            cost: { tap: true, mana: { X: "X" } },
            useStack: true,
            targetRequirement: { type: "Land", count: "X" },
            resolve: (ctx: SpellContext) => {
                for (const target of ctx.targets) {
                    if (target.type === "permanent") ctx.untap(target);
                }
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Value triggers & counter creatures (free tranche, #276) — CR 603.2 triggered
// abilities (SPELL_CAST / CREATURE_DIED / PERMANENT_LEFT / PHASE_BEGIN), CR
// 117.3a optional may-pay, CR 122 counters (entersWith + removal cost), CR
// 113.3c any-player activation. Modern Scryfall oracle text is authoritative
// (ADR 0004); mana costs / type lines come from MTGJSON ATQ.json. Every effect
// reuses existing trigger factories and SpellContext primitives — no new
// primitive, no engine change.
// ─────────────────────────────────────────────────────────────────────────────

// Citanul Druid — {1}{G} Creature — Human Druid, 1/1. "Whenever an opponent
// casts an artifact spell, put a +1/+1 counter on this creature." (CR 603.2
// SPELL_CAST trigger scoped to opponents + filtered to Artifact spells; CR
// 122.1 +1/+1 counter feeding layer 7d P/T.)
export const citanulDruid: CardDefinition = {
    id: "f8a130dc-3b1f-4fae-8459-b26bb5647fec",
    rarity: "uncommon",
    name: "Citanul Druid",
    oracleText:
        "Whenever an opponent casts an artifact spell, put a +1/+1 counter on this creature.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Druid"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        spellCastTrigger({
            id: "citanul-druid-grow",
            oracleText:
                "Whenever an opponent casts an artifact spell, put a +1/+1 counter on this creature.",
            scope: "opponents",
            filter: { types: "Artifact" },
            resolve: (ctx) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "+1/+1",
                    1
                );
            },
        }),
    ],
};

// Urza's Chalice — {1} Artifact. "Whenever a player casts an artifact spell,
// you may pay {1}. If you do, you gain 1 life." (CR 603.2 SPELL_CAST trigger,
// scope "any"; CR 117.3a optional may-pay → gainLife.) Same shape as the LEA
// color-sphere cycle, filtered to artifact spells instead of a color.
export const urzasChalice: CardDefinition = {
    id: "f3728537-86d3-42be-9046-90bba1bfafc1",
    rarity: "common",
    name: "Urza's Chalice",
    oracleText:
        "Whenever a player casts an artifact spell, you may pay {1}. If you do, you gain 1 life.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "urzas-chalice-life",
            oracleText:
                "Whenever a player casts an artifact spell, you may pay {1}. If you do, you gain 1 life.",
            scope: "any",
            filter: { types: "Artifact" },
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: ctx.controller,
                    cost: { X: 1 },
                    prompt: "Pay {1} to gain 1 life from Urza's Chalice?",
                });
                if (accept === undefined) return;
                if (accept) ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
};

// Onulet — {3} Artifact Creature — Construct, 2/2. "When this creature dies,
// you gain 2 life." (CR 700.4 death = battlefield→graveyard; CR 603.2 death
// trigger scoped to self.)
export const onulet: CardDefinition = {
    id: "d77fe8e2-8438-473e-ace5-01baddd2c4ed",
    rarity: "uncommon",
    name: "Onulet",
    oracleText: "When this creature dies, you gain 2 life.",
    manaCost: { X: 3 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        diedTrigger({
            id: "onulet-life",
            oracleText: "When this creature dies, you gain 2 life.",
            scope: "self",
            resolve: (ctx) => {
                ctx.gainLife(ctx.controller, 2);
            },
        }),
    ],
};

// Su-Chi — {4} Artifact Creature — Construct, 4/4. "When this creature dies,
// add {C}{C}{C}{C}." (CR 603.2 death trigger scoped to self; CR 106.1 the
// added mana goes to the trigger's controller's pool via addManaTo.) The mana
// is added on resolution — it empties at end of the step/phase like any mana.
export const suChi: CardDefinition = {
    id: "a64d4f93-0c04-4078-aec0-7e9de92f260f",
    rarity: "uncommon",
    name: "Su-Chi",
    oracleText: "When this creature dies, add {C}{C}{C}{C}.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 4,
    toughness: 4,
    triggeredAbilities: [
        diedTrigger({
            id: "su-chi-mana",
            oracleText: "When this creature dies, add {C}{C}{C}{C}.",
            scope: "self",
            resolve: (ctx) => {
                ctx.addManaTo(ctx.controller, { C: 4 });
            },
        }),
    ],
};

// Tablet of Epityr — {1} Artifact. "Whenever an artifact you control is put
// into a graveyard from the battlefield, you may pay {1}. If you do, you gain
// 1 life." (CR 603.2 PERMANENT_LEFT trigger, toZone graveyard + scope "yours"
// + Artifact filter; CR 117.3a optional may-pay.)
export const tabletOfEpityr: CardDefinition = {
    id: "6d7a2718-301f-4191-b348-0c44c7c07d43",
    rarity: "common",
    name: "Tablet of Epityr",
    oracleText:
        "Whenever an artifact you control is put into a graveyard from the battlefield, you may pay {1}. If you do, you gain 1 life.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        leftTrigger({
            id: "tablet-of-epityr-life",
            oracleText:
                "Whenever an artifact you control is put into a graveyard from the battlefield, you may pay {1}. If you do, you gain 1 life.",
            scope: "yours",
            toZone: "graveyard",
            filter: { types: "Artifact" },
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: ctx.controller,
                    cost: { X: 1 },
                    prompt: "Pay {1} to gain 1 life from Tablet of Epityr?",
                });
                if (accept === undefined) return;
                if (accept) ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
};

// Ivory Tower — {1} Artifact. "At the beginning of your upkeep, you gain X
// life, where X is the number of cards in your hand minus 4." (CR 603.6a
// upkeep trigger scoped to "your"; gain is clamped at 0 — you never lose life
// when hand < 4.)
export const ivoryTower: CardDefinition = {
    id: "a5f23039-45ca-4c15-af50-bfd40ea26453",
    rarity: "uncommon",
    name: "Ivory Tower",
    oracleText:
        "At the beginning of your upkeep, you gain X life, where X is the number of cards in your hand minus 4.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        phaseTrigger({
            id: "ivory-tower-life",
            oracleText:
                "At the beginning of your upkeep, you gain X life, where X is the number of cards in your hand minus 4.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, playerId) => {
                const x = ctx.getHandSize(playerId) - 4;
                if (x > 0) ctx.gainLife(playerId, x);
            },
        }),
    ],
};

// Armageddon Clock — {6} Artifact. Doom-counter time bomb:
//  • "At the beginning of your upkeep, put a doom counter on this artifact."
//  • "At the beginning of your draw step, this artifact deals damage equal to
//    the number of doom counters on it to each player."
//  • "{4}: Remove a doom counter from this artifact. Any player may activate
//    this ability but only during any upkeep step."
// (CR 603.6a phase triggers; CR 122.1 doom counter — inert to P/T; CR 113.3c
// any-player activation via activatableByAnyPlayer + UPKEEP phase
// restriction.) The draw-step ping reads the live counter count and damages
// each player in APNAP order.
export const armageddonClock: CardDefinition = {
    id: "44a31889-6a8d-450c-a73d-381a7ff28bf9",
    rarity: "uncommon",
    name: "Armageddon Clock",
    oracleText:
        "At the beginning of your upkeep, put a doom counter on this artifact.\nAt the beginning of your draw step, this artifact deals damage equal to the number of doom counters on it to each player.\n{4}: Remove a doom counter from this artifact. Any player may activate this ability but only during any upkeep step.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    triggeredAbilities: [
        phaseTrigger({
            id: "armageddon-clock-add-doom",
            oracleText:
                "At the beginning of your upkeep, put a doom counter on this artifact.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "doom",
                    1
                );
            },
        }),
        phaseTrigger({
            id: "armageddon-clock-ping",
            oracleText:
                "At the beginning of your draw step, this artifact deals damage equal to the number of doom counters on it to each player.",
            phase: "DRAW",
            scope: "your",
            resolve: (ctx) => {
                const doom = ctx.getCounterCount(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "doom"
                );
                if (doom <= 0) return;
                for (const playerId of ctx.apNapOrder()) {
                    ctx.dealDamage({ type: "player", id: playerId }, doom);
                }
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "armageddon-clock-remove-doom",
            oracleText:
                "{4}: Remove a doom counter from this artifact. Any player may activate this ability but only during any upkeep step.",
            cost: { mana: { X: 4 } },
            useStack: true,
            // "only during any upkeep step" — any player's upkeep, so phase
            // restriction without controllerTurnOnly. "Any player may
            // activate" — CR 113.3c.
            activationPhaseRestriction: ["UPKEEP"],
            activatableByAnyPlayer: true,
            resolve: (ctx: SpellContext) => {
                ctx.removeCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "doom",
                    1
                );
            },
        },
    ],
};

// Triskelion — {6} Artifact Creature — Construct, 1/1, enters with three +1/+1
// counters. "Remove a +1/+1 counter from this creature: It deals 1 damage to
// any target." (CR 122.1 ETB counters via entersWith; CR 122.6 counter-removal
// cost; CR 115.4 "any target" = damageable permanent or player.)
export const triskelion: CardDefinition = {
    id: "a79c99e1-722a-44b6-8fa3-2be3f0c193d8",
    rarity: "rare",
    name: "Triskelion",
    oracleText:
        "This creature enters with three +1/+1 counters on it.\nRemove a +1/+1 counter from this creature: It deals 1 damage to any target.",
    manaCost: { X: 6 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 1,
    toughness: 1,
    entersWith: { counters: [{ type: "+1/+1", count: 3 }] },
    activatedAbilities: [
        {
            id: "triskelion-bolt",
            oracleText:
                "Remove a +1/+1 counter from this creature: It deals 1 damage to any target.",
            cost: { removeCounter: { type: "+1/+1", count: 1 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent" || target?.type === "player") {
                    ctx.dealDamage(target, 1);
                }
            },
        },
    ],
};

// Clockwork Avian — {5} Artifact Creature — Bird, 0/4 with flying, enters with
// four +1/+0 counters. (Twin of Clockwork Beast in lea.ts, capped at four
// instead of seven and with flying.)
//  • "At end of combat, if this creature attacked or blocked this combat,
//    remove a +1/+0 counter from it." (CR 603.6a END_OF_COMBAT + CR 603.4d
//    intervening-if on the attacked/blocked markers.)
//  • "{X}, {T}: Put up to X +1/+0 counters on this creature. This ability
//    can't cause the total ... to be greater than four. Activate only during
//    your upkeep." (CR 122.1; the {X} pipeline + add-capped-to-four resolve +
//    UPKEEP/your-turn activation restriction.)
export const clockworkAvian: CardDefinition = {
    id: "1dea8c2f-4aea-478d-aee7-cba1f74edd6c",
    rarity: "rare",
    name: "Clockwork Avian",
    oracleText:
        "Flying\nThis creature enters with four +1/+0 counters on it.\nAt end of combat, if this creature attacked or blocked this combat, remove a +1/+0 counter from it.\n{X}, {T}: Put up to X +1/+0 counters on this creature. This ability can't cause the total number of +1/+0 counters on this creature to be greater than four. Activate only during your upkeep.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Bird"],
    power: 0,
    toughness: 4,
    staticAbilities: ["flying"],
    entersWith: { counters: [{ type: "+1/+0", count: 4 }] },
    triggeredAbilities: [
        phaseTrigger({
            id: "clockwork-avian-decay",
            oracleText:
                "At end of combat, if this creature attacked or blocked this combat, remove a +1/+0 counter from it.",
            phase: "END_OF_COMBAT",
            scope: "each",
            // CR 603.4d intervening-if — the "attacked or blocked this combat"
            // markers persist past END_OF_COMBAT, so the resolve-time re-check
            // sees the same values (mirrors Clockwork Beast).
            interveningIf: (_event, self) =>
                self.hasAttackedThisTurn === true ||
                self.hasBlockedThisTurn === true,
            resolve: (ctx) => {
                ctx.removeCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "+1/+0",
                    1
                );
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "clockwork-avian-recharge",
            oracleText:
                "{X}, {T}: Put up to X +1/+0 counters on this creature. This ability can't cause the total number of +1/+0 counters on this creature to be greater than four. Activate only during your upkeep.",
            cost: { mana: { X: "X" }, tap: true },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            controllerTurnOnly: true,
            resolve: (ctx: SpellContext) => {
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                const current = ctx.getCounterCount(self, "+1/+0");
                // Up to X counters, capped so the total never exceeds four.
                const room = Math.max(0, 4 - current);
                const add = Math.min(ctx.getX(), room);
                if (add > 0) ctx.addCounter(self, "+1/+0", add);
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// P/T statics, combat & one-shot prevention shields (free tranche, #277) —
// CR 611 (layer 7c P/T buffs), CR 604.3 (characteristic-defining P/T), CR
// 611.1 (temporary P/T mods + animate), CR 615 (one-shot damage prevention),
// CR 702.21j (banding via grantStaticAbility), CR 117.3a (optional may-pay),
// CR 705 (coin flip). Modern Scryfall oracle text is authoritative (ADR 0004);
// mana costs / type lines come from MTGJSON ATQ.json. Every effect reuses
// existing staticEffects kinds, the COP factory, animateAsCreature, and
// SpellContext prevention/keyword primitives — no new primitive, no engine
// change. Divergences (animate can't add the Artifact type; Urza's Avenger's
// keyword choice modeled as fixed per-keyword abilities; Ashnod's "becomes an
// artifact" deferred) are flagged inline below.
// ─────────────────────────────────────────────────────────────────────────────

// Mightstone — {4} Artifact. "Attacking creatures get +1/+0." (CR 611 layer
// 7c anthem; CR 508.1 attacking — gated on `isAttacking`.) Affects EVERY
// attacking creature regardless of controller (no controller clause, unlike
// Orcish Oriflamme's "you control"). Same `pt-buff` + `isAttacking` shape.
export const mightstone: CardDefinition = {
    id: "b28ba599-5299-4831-a118-1712ada10ef6",
    rarity: "uncommon",
    name: "Mightstone",
    oracleText: "Attacking creatures get +1/+0.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && target.isAttacking === true,
            power: 1,
            toughness: 0,
        },
    ],
};

// Weakstone — {4} Artifact. "Attacking creatures get -1/-0." (CR 611 layer 7c;
// CR 508.1.) Mirror of Mightstone with a negative power buff. Effective power
// is floored at 0 by the layer reader (CR 107.1b — P/T can't be negative for
// rules purposes, but combat damage uses the floored value).
export const weakstone: CardDefinition = {
    id: "46adf48f-99d2-440e-9129-794584c1ea21",
    rarity: "uncommon",
    name: "Weakstone",
    oracleText: "Attacking creatures get -1/-0.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && target.isAttacking === true,
            power: -1,
            toughness: 0,
        },
    ],
};

// Gaea's Avenger — {1}{G}{G} Creature — Treefolk, 1+*/1+*. "Gaea's Avenger's
// power and toughness are each equal to 1 plus the number of artifacts your
// opponents control." (CR 604.3 characteristic-defining ability; the CDA
// `compute` result is ADDED to base P/T, so base is 1/1 and the contribution
// is the opponent-artifact count.) Recomputed live from the board on each
// stat read, so it tracks artifacts entering/leaving play.
export const gaeasAvenger: CardDefinition = {
    id: "39d763bd-b0a9-46ba-bcd2-9304063446f2",
    rarity: "rare",
    name: "Gaea's Avenger",
    oracleText:
        "Gaea's Avenger's power and toughness are each equal to 1 plus the number of artifacts your opponents control.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Treefolk"],
    // Base 1/1; the CDA adds the opponent-artifact count on top (the "*" part).
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                const n = state.players
                    .flatMap((pl) => pl.battlefield)
                    .filter(
                        (c) =>
                            c.controllerId !== source.controllerId &&
                            c.types.includes("Artifact")
                    ).length;
                return { power: n, toughness: n };
            },
        },
    ],
};

// Staff of Zegon — {4} Artifact. "{3}, {T}: Target creature gets -2/-0 until
// end of turn." (CR 605 activated ability; CR 611.1 temporary P/T mod; CR
// 514.2 cleanup expiry via the end-of-turn duration.) Same temp-buff shape as
// Dragon Engine's pump, applied to a chosen target with a negative power buff.
export const staffOfZegon: CardDefinition = {
    id: "a6bf858d-bba9-4a16-9045-55384b1de633",
    rarity: "common",
    name: "Staff of Zegon",
    oracleText: "{3}, {T}: Target creature gets -2/-0 until end of turn.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "staff-of-zegon-weaken",
            oracleText:
                "{3}, {T}: Target creature gets -2/-0 until end of turn.",
            cost: { tap: true, mana: { X: 3 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addTemporaryPTBuff(target, -2, 0, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Mishra's Factory — Land (the "manland"). Three abilities:
//  • "{T}: Add {C}." (CR 605.1a/605.3a mana ability, useStack:false.)
//  • "{1}: This land becomes a 2/2 Assembly-Worker artifact creature until end
//    of turn. It's still a land." (CR 611.1 animate; the engine restores the
//    original types/subtypes/P-T at end of turn.)
//  • "{T}: Target Assembly-Worker creature gets +1/+1 until end of turn."
//    (CR 611.1 temp buff, restricted to Assembly-Workers via subtypeFilter.)
//
// DIVERGENCE (flagged, no engine change): `animateAsCreature` adds the
// "Creature" type and the "Assembly-Worker" subtype but NOT the "Artifact"
// type (AnimateSpec has no type list; the engine only adds Creature). The
// animated land is therefore a 2/2 Assembly-Worker Creature Land, not an
// Artifact Creature, for the duration. This is observable only to
// artifact-matters effects targeting the animated Factory; the card's own
// abilities (mana, self-animate, Assembly-Worker pump) are unaffected. A
// general `AnimateSpec.additionalTypes` would close the gap and is deferred to
// a feature tranche.
export const mishrasFactory: CardDefinition = {
    id: "a696c5b6-f216-454d-8029-74e84bbd1428",
    rarity: "uncommon",
    name: "Mishra's Factory",
    oracleText:
        "{T}: Add {C}.\n{1}: This land becomes a 2/2 Assembly-Worker artifact creature until end of turn. It's still a land.\n{T}: Target Assembly-Worker creature gets +1/+1 until end of turn.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "mishras-factory-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ C: 1 });
            },
            manaProduced: { C: 1 },
        },
        {
            id: "mishras-factory-animate",
            oracleText:
                "{1}: This land becomes a 2/2 Assembly-Worker artifact creature until end of turn. It's still a land.",
            cost: { mana: { X: 1 } },
            useStack: true,
            animatesSelf: true,
            resolve: (ctx: SpellContext) => {
                ctx.animateAsCreature(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    {
                        power: 2,
                        toughness: 2,
                        subtype: "Assembly-Worker",
                        duration: { phase: "end-of-turn" },
                    }
                );
            },
        },
        {
            id: "mishras-factory-pump",
            oracleText:
                "{T}: Target Assembly-Worker creature gets +1/+1 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Assembly-Worker",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addTemporaryPTBuff(target, 1, 1, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Battering Ram — {2} Artifact Creature — Construct, 1/1. Two combat clauses:
//  • "At the beginning of combat on your turn, this creature gains banding
//    until end of combat." (CR 702.21 banding — a real engine capability,
//    `gre/banding.ts` reads `staticAbilities.includes("banding")`; granted for
//    the combat via `grantStaticAbility` with an end-of-combat duration.)
//  • "Whenever this creature becomes blocked by a Wall, destroy that Wall at
//    end of combat." (CR 509.1h pairing trigger on BLOCKERS_CONFIRMED, CR
//    511.3 end-of-combat timing.) Inverse of Cockatrice's combat-kill: fires
//    only when self is the BLOCKED ATTACKER and the blocker IS a Wall.
const BATTERING_RAM_ID = "f7a69e35-d209-41c0-aa3c-c78414617075";
function batteringRamWallTrigger(): TriggeredAbility {
    return {
        id: "battering-ram-wall-destroy",
        oracleText:
            "Whenever this creature becomes blocked by a Wall, destroy that Wall at end of combat.",
        event: "BLOCKERS_CONFIRMED",
        matches: (event, self) => {
            if (event.type !== "BLOCKERS_CONFIRMED") return false;
            // Self must be the blocked attacker; the blocker must be a Wall.
            return (
                event.attackerId === self.id &&
                event.blockerSubtypes.includes("Wall")
            );
        },
        resolve: (ctx, event) => {
            if (event.type !== "BLOCKERS_CONFIRMED") return;
            ctx.scheduleDelayedTrigger(
                BATTERING_RAM_ID,
                "battering-ram-wall-destroy-delayed",
                "next-end-of-combat",
                { targetId: event.blockerId }
            );
        },
    };
}
function batteringRamWallDelayed(): DelayedTriggerDef {
    return {
        id: "battering-ram-wall-destroy-delayed",
        oracleText: "Destroy that Wall at end of combat.",
        timing: "next-end-of-combat",
        resolve: (ctx, payload) => {
            if (!payload.targetId) return;
            ctx.destroy({ type: "permanent", id: payload.targetId });
        },
    };
}
export const batteringRam: CardDefinition = {
    id: BATTERING_RAM_ID,
    rarity: "common",
    name: "Battering Ram",
    oracleText:
        "At the beginning of combat on your turn, this creature gains banding until end of combat.\nWhenever this creature becomes blocked by a Wall, destroy that Wall at end of combat.",
    manaCost: { X: 2 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        phaseTrigger({
            id: "battering-ram-banding",
            oracleText:
                "At the beginning of combat on your turn, this creature gains banding until end of combat.",
            phase: "BEGINNING_OF_COMBAT",
            scope: "your",
            resolve: (ctx) => {
                ctx.grantStaticAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "banding",
                    { phase: "end-of-combat" }
                );
            },
        }),
        batteringRamWallTrigger(),
    ],
    delayedTriggers: [batteringRamWallDelayed()],
};

// Urza's Avenger — {6} Artifact Creature — Shapeshifter, 4/4. "{0}: This
// creature gets -1/-1 and gains your choice of banding, flying, first strike,
// or trample until end of turn." (CR 611.1 temp P/T mod + keyword grant.)
//
// DIVERGENCE (flagged, no engine change): the engine has no "choose one named
// option from a list" resolution-choice kind (ZonePickKind is all zone-picks;
// `modes` are spell-cast-time only). The single modal ability is therefore
// modeled as FOUR fixed-keyword activated abilities — the player picks which
// ability to activate, choosing the keyword that way. Each ability applies the
// same -1/-1 and grants its own keyword until end of turn. Behaviorally
// equivalent to the printed "your choice of …"; a general `choose-option`
// choice kind would let it collapse back to one ability and is deferred.
const URZAS_AVENGER_KEYWORDS = [
    "banding",
    "flying",
    "first strike",
    "trample",
] as const;
export const urzasAvenger: CardDefinition = {
    id: "448e1811-fb16-4390-ac22-b7066a4a019c",
    rarity: "rare",
    name: "Urza's Avenger",
    oracleText:
        "{0}: This creature gets -1/-1 and gains your choice of banding, flying, first strike, or trample until end of turn.",
    manaCost: { X: 6 },
    types: ["Artifact", "Creature"],
    subtypes: ["Shapeshifter"],
    power: 4,
    toughness: 4,
    activatedAbilities: URZAS_AVENGER_KEYWORDS.map((kw) => ({
        id: `urzas-avenger-${kw.replace(/\s+/g, "-")}`,
        oracleText: `{0}: This creature gets -1/-1 and gains ${kw} until end of turn.`,
        cost: {},
        useStack: true,
        resolve: (ctx: SpellContext) => {
            const self: TargetSelection = {
                type: "permanent",
                id: ctx.sourceInstanceId,
            };
            ctx.addTemporaryPTBuff(self, -1, -1, { phase: "end-of-turn" });
            ctx.grantStaticAbility(self, kw, { phase: "end-of-turn" });
        },
    })),
};

// Amulet of Kroog — {2} Artifact. "{2}, {T}: Prevent the next 1 damage that
// would be dealt to any target this turn." (CR 615.1/615.6 one-shot
// prevention shield via `preventNextNDamageToTarget`, purged end-of-turn.)
export const amuletOfKroog: CardDefinition = {
    id: "b094f8dd-0184-41a2-9767-e848a6e4eac1",
    rarity: "common",
    name: "Amulet of Kroog",
    oracleText:
        "{2}, {T}: Prevent the next 1 damage that would be dealt to any target this turn.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "amulet-of-kroog-prevent",
            oracleText:
                "{2}, {T}: Prevent the next 1 damage that would be dealt to any target this turn.",
            cost: { tap: true, mana: { X: 2 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent" || target?.type === "player") {
                    ctx.preventNextNDamageToTarget(target, 1, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Argivian Blacksmith — {1}{W}{W} Creature — Human Artificer, 2/2. "{T}:
// Prevent the next 2 damage that would be dealt to target artifact creature
// this turn." (CR 615.1 prevention shield.)
//
// DIVERGENCE (flagged): the target filter is "artifact creature" (AND of two
// card types), but `TargetRequirement.type` arrays are OR-of-types (rules.ts
// uses `.some()`), and there is no AND-of-types filter. The target is scoped to
// `type: "Creature"` here, so it can prevent damage to a non-artifact creature
// too — a loosening of the printed restriction. Closing this needs an
// AND-types target filter (engine/rules change) and is deferred.
export const argivianBlacksmith: CardDefinition = {
    id: "5f604338-5ee4-4c47-ad5a-5c805c96c8de",
    rarity: "common",
    name: "Argivian Blacksmith",
    oracleText:
        "{T}: Prevent the next 2 damage that would be dealt to target artifact creature this turn.",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Artificer"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "argivian-blacksmith-prevent",
            oracleText:
                "{T}: Prevent the next 2 damage that would be dealt to target artifact creature this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.preventNextNDamageToTarget(target, 2, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Rakalite — {6} Artifact. "{2}: Prevent the next 1 damage that would be dealt
// to any target this turn. Return this artifact to its owner's hand at the
// beginning of the next end step." (CR 615.1 prevention shield; CR 603.7a
// delayed trigger for the self-bounce.) The {2} ability is repeatable (no tap)
// and each activation schedules the next-end-step return.
const RAKALITE_ID = "0fd7c711-3ff4-4691-914f-242e6737066c";
export const rakalite: CardDefinition = {
    id: RAKALITE_ID,
    rarity: "uncommon",
    name: "Rakalite",
    oracleText:
        "{2}: Prevent the next 1 damage that would be dealt to any target this turn. Return this artifact to its owner's hand at the beginning of the next end step.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "rakalite-prevent",
            oracleText:
                "{2}: Prevent the next 1 damage that would be dealt to any target this turn. Return this artifact to its owner's hand at the beginning of the next end step.",
            cost: { mana: { X: 2 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent" || target?.type === "player") {
                    ctx.preventNextNDamageToTarget(target, 1, {
                        phase: "end-of-turn",
                    });
                }
                ctx.scheduleDelayedTrigger(
                    RAKALITE_ID,
                    "rakalite-return",
                    "next-end-step",
                    { instanceId: ctx.sourceInstanceId }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "rakalite-return",
            oracleText:
                "Return this artifact to its owner's hand at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                if (!payload.instanceId) return;
                ctx.returnToHand({ type: "permanent", id: payload.instanceId });
            },
        },
    ],
};

// Circle of Protection: Artifacts — {1}{W} Enchantment. "{2}: The next time an
// artifact source of your choice would deal damage to you this turn, prevent
// that damage." (CR 615.1/615.6.) Built from the shared `makeCircleOfProtection`
// factory generalized to an artifact-source filter (instead of a color).
export const circleOfProtectionArtifacts: CardDefinition =
    makeCircleOfProtection({
        id: "22ebd5a3-fef8-4097-b038-89a6cb38227d",
        rarity: "uncommon",
        name: "Circle of Protection: Artifacts",
        oracleText:
            "{2}: The next time an artifact source of your choice would deal damage to you this turn, prevent that damage.",
        source: { kind: "artifact", word: "artifact" },
    });

// Ashnod's Transmogrant — {1} Artifact. "{T}, Sacrifice this artifact: Put a
// +1/+1 counter on target nonartifact creature. That creature becomes an
// artifact in addition to its other types." (CR 122.1 +1/+1 counter; CR 205
// type-add.)
//
// DIVERGENCE (flagged, no engine change): the "becomes an artifact in addition
// to its other types" clause has NO resolve-time primitive — the only type-add
// is the source-bound continuous `StaticTypeAdd` (auras, reverts when the
// source leaves), which is wrong here since this artifact sacrifices ITSELF as
// a cost (the type-add must persist after the source is gone). There is no
// imperative `ctx.addCardType`. The card therefore ships the +1/+1 counter (the
// board-dominant, fully testable effect) and omits the permanent artifact-type
// grant. A resolve-time `addCardType` primitive is needed to close this and is
// flagged for a feature tranche.
// TODO #277: needs a resolve-time `addCardType` primitive for the permanent
// "becomes an artifact in addition to its other types" clause.
export const ashnodsTransmogrant: CardDefinition = {
    id: "2aa5b289-36ba-49b1-a5ac-f23bf71f8241",
    rarity: "uncommon",
    name: "Ashnod's Transmogrant",
    oracleText:
        "{T}, Sacrifice this artifact: Put a +1/+1 counter on target nonartifact creature. That creature becomes an artifact in addition to its other types.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "ashnods-transmogrant-counter",
            oracleText:
                "{T}, Sacrifice this artifact: Put a +1/+1 counter on target nonartifact creature. That creature becomes an artifact in addition to its other types.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                excludeTypes: "Artifact",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addCounter(target, "+1/+1", 1);
                    // "becomes an artifact" omitted — see DIVERGENCE note above.
                }
            },
        },
    ],
};

// Yawgmoth Demon — {4}{B}{B} Creature — Phyrexian Demon, 6/6 with flying +
// first strike. "At the beginning of your upkeep, you may sacrifice an
// artifact. If you don't, tap this creature and it deals 2 damage to you."
// (CR 603.6a upkeep trigger; CR 117.3a optional may; CR 701.16 sacrifice.)
// The may is gated on having an artifact to sacrifice; declining (or having no
// artifact) runs the else-branch: tap self + 2 damage to the controller.
export const yawgmothDemon: CardDefinition = {
    id: "04bbd231-0d5f-4cbf-92a7-10d2c5c4b82c",
    rarity: "rare",
    name: "Yawgmoth Demon",
    oracleText:
        "Flying\nFirst strike\nAt the beginning of your upkeep, you may sacrifice an artifact. If you don't, tap this creature and it deals 2 damage to you.",
    manaCost: { X: 4, B: 2 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Demon"],
    power: 6,
    toughness: 6,
    staticAbilities: ["flying", "first strike"],
    triggeredAbilities: [
        phaseTrigger({
            id: "yawgmoth-demon-upkeep",
            oracleText:
                "At the beginning of your upkeep, you may sacrifice an artifact. If you don't, tap this creature and it deals 2 damage to you.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, playerId) => {
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                const artifactIds = ctx.getBattlefieldIds(playerId, {
                    types: "Artifact",
                });
                if (artifactIds.length > 0) {
                    const accept = ctx.requestMayPay({
                        playerId,
                        choiceId: playerId,
                        prompt: "Sacrifice an artifact to Yawgmoth Demon?",
                    });
                    if (accept === undefined) return;
                    if (accept) {
                        const picked = ctx.requestChoice({
                            playerId,
                            choiceId: `${playerId}-sac`,
                            kind: "sacrifice-permanents",
                            zone: "battlefield",
                            filter: { types: "Artifact" },
                            count: 1,
                            prompt: "Sacrifice an artifact.",
                        });
                        if (picked === undefined) return;
                        if (picked.length > 0) ctx.sacrifice(picked[0]);
                        return;
                    }
                }
                // Declined or no artifact to sacrifice: tap + 2 damage to you.
                ctx.tap(self);
                ctx.dealDamage({ type: "player", id: playerId }, 2);
            },
        }),
    ],
};

// Mishra's War Machine — {7} Artifact Creature — Juggernaut, 5/5 with banding.
// "At the beginning of your upkeep, this creature deals 3 damage to you unless
// you discard a card. If it deals damage to you this way, tap it." (CR 702.21
// banding; CR 603.6a upkeep trigger; CR 117.3a pay-or-else with a discard
// cost.) Declining the discard runs the else-branch: 3 damage + tap self.
export const mishrasWarMachine: CardDefinition = {
    id: "8f6b4652-a1d4-418f-a89b-6a977a920a9e",
    rarity: "rare",
    name: "Mishra's War Machine",
    oracleText:
        "Banding\nAt the beginning of your upkeep, this creature deals 3 damage to you unless you discard a card. If it deals damage to you this way, tap it.",
    manaCost: { X: 7 },
    types: ["Artifact", "Creature"],
    subtypes: ["Juggernaut"],
    power: 5,
    toughness: 5,
    staticAbilities: ["banding"],
    triggeredAbilities: [
        phaseTrigger({
            id: "mishras-war-machine-upkeep",
            oracleText:
                "At the beginning of your upkeep, this creature deals 3 damage to you unless you discard a card. If it deals damage to you this way, tap it.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, playerId) => {
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                const handIds = ctx.getHandIds(playerId);
                if (handIds.length > 0) {
                    const accept = ctx.requestMayPay({
                        playerId,
                        choiceId: playerId,
                        prompt: "Discard a card to avoid 3 damage from Mishra's War Machine?",
                    });
                    if (accept === undefined) return;
                    if (accept) {
                        const picked = ctx.requestChoice({
                            playerId,
                            choiceId: `${playerId}-discard`,
                            kind: "choose-hand-card",
                            zone: "hand",
                            count: 1,
                            prompt: "Discard a card.",
                        });
                        if (picked === undefined) return;
                        if (picked.length > 0) {
                            ctx.discardCard(playerId, picked[0]);
                            return;
                        }
                    }
                }
                // No discard: 3 damage to you, then tap self ("if it deals
                // damage to you this way, tap it").
                ctx.dealDamage({ type: "player", id: playerId }, 3);
                ctx.tap(self);
            },
        }),
    ],
};

// Goblin Artisans — {R} Creature — Goblin Artificer, 1/1. "{T}: Flip a coin.
// If you win the flip, draw a card. If you lose the flip, counter target
// artifact spell you control..." (CR 705.1 coin flip; CR 121.1 draw; CR
// 701.5a counter.) The target is declared at activation (the ability always
// targets an artifact spell you control); on a coin-flip WIN the counter is
// simply not performed and you draw instead.
//
// DIVERGENCE (flagged): the printed "that isn't the target of an ability from
// another creature named Goblin Artisans" multi-copy clause is simplified
// (not enforced) — it only matters with two Goblin Artisans targeting the same
// spell, an edge the current pool/UI doesn't exercise.
export const goblinArtisans: CardDefinition = {
    id: "6669d96e-9a7b-4427-a477-f4e76831f593",
    rarity: "uncommon",
    name: "Goblin Artisans",
    oracleText:
        "{T}: Flip a coin. If you win the flip, draw a card. If you lose the flip, counter target artifact spell you control that isn't the target of an ability from another creature named Goblin Artisans.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Artificer"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "goblin-artisans-flip",
            oracleText:
                "{T}: Flip a coin. If you win the flip, draw a card. If you lose the flip, counter target artifact spell you control.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "spell",
                count: 1,
                spellTypeFilter: "Artifact",
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                if (ctx.flipCoin()) {
                    ctx.drawCards(ctx.controller, 1);
                } else {
                    const target = ctx.targets[0];
                    if (target?.type === "spell") ctx.counter(target);
                }
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster A — sacrifice-as-activation-cost on a filtered, non-self permanent
// (CR 602.1 / 118.5). The activated-ability cost gains `sacrificeFilter`: the
// player chooses which matching permanent to sacrifice while paying the cost,
// and the activation is illegal if no matching permanent is on their
// battlefield. The chosen permanent's pre-sacrifice mana value is snapshotted
// onto the stack item so `getAdditionalSacrificeMv()` reads it at resolve
// (Priest of Yawgmoth). See PRD #269 cluster A, issue #282.
//
// NOTE (CR 605.1a deviation): Ashnod's Altar and Priest of Yawgmoth are
// technically mana abilities (no target, can add mana). They are modeled here
// as `useStack: true` activated abilities because their cost requires a player
// CHOICE of which permanent to sacrifice, and the engine's instant mana-ability
// path (`tapUntap`) has no choice step. Routing them through the stack reuses
// the sacrifice-choice machinery wholesale. The practical cost is that their
// mana isn't available to pay for a spell mid-cast — acceptable within this
// card pool, where they are used as standalone value/ramp engines.
// ─────────────────────────────────────────────────────────────────────────────

// Atog — {1}{R} 1/2. "Sacrifice an artifact: This creature gets +2/+2 until
// end of turn." Self-pump (CR 611.1) funded by sacrificing a chosen artifact.
export const atog: CardDefinition = {
    id: "2249fc40-4412-48fd-800a-7ea3678aee3f",
    rarity: "common",
    name: "Atog",
    oracleText:
        "Sacrifice an artifact: This creature gets +2/+2 until end of turn.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Atog"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "atog-pump",
            oracleText:
                "Sacrifice an artifact: This creature gets +2/+2 until end of turn.",
            cost: { sacrificeFilter: { types: "Artifact" } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    2,
                    2,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Ashnod's Altar — {3} Artifact. "Sacrifice a creature: Add {C}{C}." A
// creature-to-colorless mana converter. Modeled as a stack ability (see the
// CR 605.1a note above) so the sacrifice choice can be made.
export const ashnodsAltar: CardDefinition = {
    id: "cdcccb0f-ce96-453b-9e82-41d87f52e58b",
    rarity: "uncommon",
    name: "Ashnod's Altar",
    oracleText: "Sacrifice a creature: Add {C}{C}.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "ashnods-altar-mana",
            oracleText: "Sacrifice a creature: Add {C}{C}.",
            cost: { sacrificeFilter: { types: "Creature" } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addManaTo(ctx.controller, { C: 2 });
            },
        },
    ],
};

// Orcish Mechanics — {2}{R} 1/1. "{T}, Sacrifice an artifact: This creature
// deals 2 damage to any target." Tap + filtered-sacrifice cost, targeted ping.
export const orcishMechanics: CardDefinition = {
    id: "5e34fc6b-5f00-4a22-9ee2-afc1caf99961",
    rarity: "common",
    name: "Orcish Mechanics",
    oracleText:
        "{T}, Sacrifice an artifact: This creature deals 2 damage to any target.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Orc"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "orcish-mechanics-bolt",
            oracleText:
                "{T}, Sacrifice an artifact: This creature deals 2 damage to any target.",
            cost: { tap: true, sacrificeFilter: { types: "Artifact" } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.dealDamage(target, 2);
            },
        },
    ],
};

// Sage of Lat-Nam — {1}{U} 1/2. "{T}, Sacrifice an artifact: Draw a card."
export const sageOfLatNam: CardDefinition = {
    id: "b4ff60ce-073c-46b8-807c-8b40467b960c",
    rarity: "common",
    name: "Sage of Lat-Nam",
    oracleText: "{T}, Sacrifice an artifact: Draw a card.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Artificer"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "sage-of-lat-nam-draw",
            oracleText: "{T}, Sacrifice an artifact: Draw a card.",
            cost: { tap: true, sacrificeFilter: { types: "Artifact" } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.controller, 1);
            },
        },
    ],
};

// Priest of Yawgmoth — {1}{B} 1/2. "{T}, Sacrifice an artifact: Add an amount
// of {B} equal to the sacrificed artifact's mana value." The mana-value-derived
// effect reads the sacrificed permanent's mv via getAdditionalSacrificeMv
// (snapshotted at commit). Modeled as a stack ability (see CR 605.1a note).
export const priestOfYawgmoth: CardDefinition = {
    id: "c9fd4054-42fc-4f95-a6f7-369a5da43dd5",
    rarity: "common",
    name: "Priest of Yawgmoth",
    oracleText:
        "{T}, Sacrifice an artifact: Add an amount of {B} equal to the sacrificed artifact's mana value.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Human", "Cleric"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "priest-of-yawgmoth-mana",
            oracleText:
                "{T}, Sacrifice an artifact: Add an amount of {B} equal to the sacrificed artifact's mana value.",
            cost: { tap: true, sacrificeFilter: { types: "Artifact" } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const mv = ctx.getAdditionalSacrificeMv() ?? 0;
                if (mv > 0) ctx.addManaTo(ctx.controller, { B: mv });
            },
        },
    ],
};

// Dwarven Weaponsmith — {1}{R} 1/1. "{T}, Sacrifice an artifact: Put a +1/+1
// counter on target creature. Activate only during your upkeep." (CR 602.5b
// timing via activationPhaseRestriction + controllerTurnOnly.)
export const dwarvenWeaponsmith: CardDefinition = {
    id: "0848d94a-2704-460f-986b-b192dd6d26b7",
    rarity: "uncommon",
    name: "Dwarven Weaponsmith",
    oracleText:
        "{T}, Sacrifice an artifact: Put a +1/+1 counter on target creature. Activate only during your upkeep.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Dwarf", "Artificer"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "dwarven-weaponsmith-counter",
            oracleText:
                "{T}, Sacrifice an artifact: Put a +1/+1 counter on target creature. Activate only during your upkeep.",
            cost: { tap: true, sacrificeFilter: { types: "Artifact" } },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            controllerTurnOnly: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addCounter(target, "+1/+1", 1);
                }
            },
        },
    ],
};

// Gate to Phyrexia — {B}{B} Enchantment. "Sacrifice a creature: Destroy target
// artifact. Activate only during your upkeep and only once each turn."
// (CR 602.5 once-per-turn + upkeep timing.)
export const gateToPhyrexia: CardDefinition = {
    id: "1f372950-6693-4838-80ef-8fd9aa3e0349",
    rarity: "uncommon",
    name: "Gate to Phyrexia",
    oracleText:
        "Sacrifice a creature: Destroy target artifact. Activate only during your upkeep and only once each turn.",
    manaCost: { B: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "gate-to-phyrexia-destroy",
            oracleText:
                "Sacrifice a creature: Destroy target artifact. Activate only during your upkeep and only once each turn.",
            cost: { sacrificeFilter: { types: "Creature" } },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            controllerTurnOnly: true,
            oncePerTurn: true,
            targetRequirement: { type: "Artifact", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.destroy(target);
            },
        },
    ],
};

// Mishra's Workshop — Land. "{T}: Add {C}{C}{C}. Spend this mana only to cast
// artifact spells." (ATQ rare, modern oracle.)
//
// CR 106.6 — the produced mana carries an "artifact-spell" spend restriction.
// It floats in the controller's parallel `restrictedMana` pool (declared via
// the ability's `manaRestriction` field) instead of the fungible pool, empties
// at end of step/phase like any mana (CR 500.4), and the spell-cast payment
// sites accept it only for spells whose types include "Artifact"
// (restrictionAllowsSpell). It can never pay for an activated ability or a
// non-artifact spell. Per ADR 0022 this reuses the restricted-mana storage,
// serialization, emptying, and settlement machinery as-is — no new subsystem.
export const mishrasWorkshop: CardDefinition = {
    id: "135de5c7-6ac9-4b68-8f1a-97f120a4b125",
    rarity: "rare",
    name: "Mishra's Workshop",
    oracleText:
        "{T}: Add {C}{C}{C}. Spend this mana only to cast artifact spells.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "mishras-workshop-mana",
            oracleText:
                "{T}: Add {C}{C}{C}. Spend this mana only to cast artifact spells.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ C: 3 });
            },
            manaProduced: { C: 3 },
            manaRestriction: "artifact-spell",
        },
    ],
};

// Urza land trio — board-conditional mana (CR 106.1, 605.1a). Each taps for
// {C}, but adds extra colorless when the controller also controls the other
// two members of the set. The condition keys off the land *subtypes* (Urza's
// Mine / Urza's Power-Plant / Urza's Tower), matching the oracle text and the
// canonical CR treatment — not the card names. Output is recomputed from the
// controller's battlefield at activation time via the ability's `manaAmount`
// hook; `manaProduced` carries the {C}{C}... representative output (read by
// Mana Flare and by best-effort display callers without a battlefield view).
//
// Each land's base output is {C}; the assembled bonus differs by member:
//   Mine        → {C}{C}    (2)
//   Power Plant → {C}{C}    (2)
//   Tower       → {C}{C}{C} (3)
const URZA_MINE = "Urza's Mine";
const URZA_POWER_PLANT = "Urza's Power-Plant";
const URZA_TOWER = "Urza's Tower";

/** True when the controller's battlefield contains a land with the given Urza
 *  subtype (CR 205.3, 106.1). Reads the controller's own battlefield only —
 *  "you control" scopes to the activating player's permanents. */
function controlsUrzaSubtype(
    battlefield: ReadonlyArray<PermanentView>,
    subtype: string
): boolean {
    return battlefield.some((p) => p.subtypes.includes(subtype));
}

/** Builds an Urza land's `manaAmount`: {C}{C}... `assembled` colorless when the
 *  controller also controls both `others` subtypes, otherwise {C}. */
function urzaManaAmount(
    others: [string, string],
    assembled: number
): (
    source: PermanentView,
    battlefield: ReadonlyArray<PermanentView>
) => ManaCost {
    return (_source, battlefield) =>
        controlsUrzaSubtype(battlefield, others[0]) &&
        controlsUrzaSubtype(battlefield, others[1])
            ? ({ C: assembled } as ManaCost)
            : ({ C: 1 } as ManaCost);
}

export const urzasMine: CardDefinition = {
    id: "ddf85792-470b-4b42-99ac-9cb43a575523",
    rarity: "uncommon",
    name: "Urza's Mine",
    oracleText:
        "{T}: Add {C}. If you control an Urza's Power-Plant and an Urza's Tower, add {C}{C} instead.",
    manaCost: {},
    types: ["Land"],
    subtypes: [URZA_MINE],
    activatedAbilities: [
        {
            id: "urzas-mine-mana",
            oracleText:
                "{T}: Add {C}. If you control an Urza's Power-Plant and an Urza's Tower, add {C}{C} instead.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ C: 1 });
            },
            manaProduced: { C: 2 },
            manaAmount: urzaManaAmount([URZA_POWER_PLANT, URZA_TOWER], 2),
        },
    ],
};

export const urzasPowerPlant: CardDefinition = {
    id: "94896e0b-859c-47e4-bf27-35ed37b841e0",
    rarity: "common",
    name: "Urza's Power Plant",
    oracleText:
        "{T}: Add {C}. If you control an Urza's Mine and an Urza's Tower, add {C}{C} instead.",
    manaCost: {},
    types: ["Land"],
    subtypes: [URZA_POWER_PLANT],
    activatedAbilities: [
        {
            id: "urzas-power-plant-mana",
            oracleText:
                "{T}: Add {C}. If you control an Urza's Mine and an Urza's Tower, add {C}{C} instead.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ C: 1 });
            },
            manaProduced: { C: 2 },
            manaAmount: urzaManaAmount([URZA_MINE, URZA_TOWER], 2),
        },
    ],
};

export const urzasTower: CardDefinition = {
    id: "8ed85655-fc59-4a57-bcf9-75e1899dff78",
    rarity: "common",
    name: "Urza's Tower",
    oracleText:
        "{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead.",
    manaCost: {},
    types: ["Land"],
    subtypes: [URZA_TOWER],
    activatedAbilities: [
        {
            id: "urzas-tower-mana",
            oracleText:
                "{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ C: 1 });
            },
            manaProduced: { C: 3 },
            manaAmount: urzaManaAmount([URZA_MINE, URZA_POWER_PLANT], 3),
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster B — "ability activated" trigger event (PRD #269 / issue #285)
//
// These three punishers react to BOTH halves of "an artifact is used":
//   • the artifact becomes tapped → PERMANENT_TAPPED (CR 701.20a), and
//   • a non-{T} activated ability of the artifact is used → ABILITY_ACTIVATED
//     (CR 602.1), the complement event emitted by the engine only when the
//     ability has no {T} component (so {T}-cost abilities aren't double-counted).
// Each card therefore declares two triggered abilities — one per event — that
// share an identical resolve body. `tappedTrigger`'s `forMana` is left
// undefined so both mana taps and non-mana taps (Twiddle, combat) count, per
// the oracle wording "becomes tapped".
// ─────────────────────────────────────────────────────────────────────────────

// Haunting Wind — {3}{B} Enchantment. "Whenever an artifact becomes tapped or a
// player activates an artifact's ability without {T} in its activation cost,
// this enchantment deals 1 damage to that artifact's controller." (CR 603.2.)
// `scope: "any"` + an Artifact type filter; damage goes to the artifact's
// controller (carried on each event payload).
export const hauntingWind: CardDefinition = {
    id: "a2f6ef2f-a3a2-4e1f-b7eb-59abc8414114",
    rarity: "uncommon",
    name: "Haunting Wind",
    oracleText:
        "Whenever an artifact becomes tapped or a player activates an artifact's ability without {T} in its activation cost, this enchantment deals 1 damage to that artifact's controller.",
    manaCost: { X: 3, B: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        tappedTrigger({
            id: "haunting-wind-tapped",
            oracleText:
                "Whenever an artifact becomes tapped, this enchantment deals 1 damage to that artifact's controller.",
            scope: "any",
            filter: { types: "Artifact" },
            resolve: (ctx, _event, tapped) => {
                ctx.dealDamage({ type: "player", id: tapped.controllerId }, 1);
            },
        }),
        abilityActivatedTrigger({
            id: "haunting-wind-ability",
            oracleText:
                "Whenever a player activates an artifact's ability without {T} in its activation cost, this enchantment deals 1 damage to that artifact's controller.",
            scope: "any",
            filter: { types: "Artifact" },
            resolve: (ctx, _event, activated) => {
                ctx.dealDamage(
                    { type: "player", id: activated.controllerId },
                    1
                );
            },
        }),
    ],
};

// Powerleech — {G}{G} Enchantment. "Whenever an artifact an opponent controls
// becomes tapped or an opponent activates an artifact's ability without {T} in
// its activation cost, you gain 1 life." (CR 603.2.) `scope: "opponents"`
// encodes "an opponent controls"; the life goes to the enchantment's
// controller (`ctx.controller`).
export const powerleech: CardDefinition = {
    id: "ae1d7b09-3a1f-410f-b330-04ae768b0455",
    rarity: "uncommon",
    name: "Powerleech",
    oracleText:
        "Whenever an artifact an opponent controls becomes tapped or an opponent activates an artifact's ability without {T} in its activation cost, you gain 1 life.",
    manaCost: { G: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        tappedTrigger({
            id: "powerleech-tapped",
            oracleText:
                "Whenever an artifact an opponent controls becomes tapped, you gain 1 life.",
            scope: "opponents",
            filter: { types: "Artifact" },
            resolve: (ctx) => {
                ctx.gainLife(ctx.controller, 1);
            },
        }),
        abilityActivatedTrigger({
            id: "powerleech-ability",
            oracleText:
                "Whenever an opponent activates an artifact's ability without {T} in its activation cost, you gain 1 life.",
            scope: "opponents",
            filter: { types: "Artifact" },
            resolve: (ctx) => {
                ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
};

// Artifact Possession — {2}{B} Enchantment — Aura. "Enchant artifact. Whenever
// enchanted artifact becomes tapped or a player activates an ability of
// enchanted artifact without {T} in its activation cost, this Aura deals 2
// damage to that artifact's controller." (CR 303.4 aura attachment, 603.2.)
// As with Psychic Venom, there is no `host` scope (ADR 0002) — `scope: "any"`
// plus a `self.attachedTo` host-check condition is the idiomatic expression.
export const artifactPossession: CardDefinition = {
    id: "587d6ac8-fad8-49e0-862e-636e06628ff9",
    rarity: "common",
    name: "Artifact Possession",
    oracleText:
        "Enchant artifact\nWhenever enchanted artifact becomes tapped or a player activates an ability of enchanted artifact without {T} in its activation cost, this Aura deals 2 damage to that artifact's controller.",
    manaCost: { X: 2, B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Artifact", count: 1 },
    triggeredAbilities: [
        tappedTrigger({
            id: "artifact-possession-tapped",
            oracleText:
                "Whenever enchanted artifact becomes tapped, this Aura deals 2 damage to that artifact's controller.",
            scope: "any",
            condition: (event, self) =>
                !!self.attachedTo && event.permanentId === self.attachedTo,
            resolve: (ctx, _event, tapped) => {
                ctx.dealDamage({ type: "player", id: tapped.controllerId }, 2);
            },
        }),
        abilityActivatedTrigger({
            id: "artifact-possession-ability",
            oracleText:
                "Whenever a player activates an ability of enchanted artifact without {T} in its activation cost, this Aura deals 2 damage to that artifact's controller.",
            scope: "any",
            condition: (event, self) =>
                !!self.attachedTo && event.permanentId === self.attachedTo,
            resolve: (ctx, _event, activated) => {
                ctx.dealDamage(
                    { type: "player", id: activated.controllerId },
                    2
                );
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster E (#286) — "for as long as this remains tapped" duration + tap-lock.
// CR 611.2 models a duration tied to a continuously re-evaluated game state
// rather than a phase boundary: the effect persists exactly while its source
// stays tapped and ends the instant the source untaps or leaves play
// (`checkSourceTappedEffects` SBA + live layer read). All three cards also use
// the `may-choose-not-to-untap` keyword (CR 502.1 optional untap), which is
// what lets the controller hold the source tapped to keep the effect alive.
// Modern Scryfall oracle text is authoritative (ADR 0004); costs / type lines
// come from MTGJSON ATQ.json.
// ─────────────────────────────────────────────────────────────────────────────

// Ashnod's Battle Gear — {2} Artifact. "{2}, {T}: Target creature you control
// gets +2/-2 for as long as this artifact remains tapped." (CR 611.2 state-tied
// duration via `addSourceTappedPTBuff`; CR 502.1 optional untap via the
// `may-choose-not-to-untap` keyword.) The buff is read live at layer 7d while
// the Battle Gear stays tapped and disappears the moment it untaps.
export const ashnodsBattleGear: CardDefinition = {
    id: "aeeec853-dd3f-4ac3-8b20-c07fada8888f",
    rarity: "uncommon",
    name: "Ashnod's Battle Gear",
    oracleText:
        "You may choose not to untap this artifact during your untap step.\n{2}, {T}: Target creature you control gets +2/-2 for as long as this artifact remains tapped.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    staticAbilities: ["may-choose-not-to-untap"],
    activatedAbilities: [
        {
            id: "ashnods-battle-gear-pump",
            oracleText:
                "{2}, {T}: Target creature you control gets +2/-2 for as long as this artifact remains tapped.",
            cost: { tap: true, mana: { X: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addSourceTappedPTBuff(target, 2, -2);
                }
            },
        },
    ],
};

// Tawnos's Weaponry — {2} Artifact. "{2}, {T}: Target creature gets +1/+1 for
// as long as this artifact remains tapped." (CR 611.2 state-tied duration; CR
// 502.1 optional untap.) Same shape as Battle Gear but any creature and a
// +1/+1 buff.
export const tawnossWeaponry: CardDefinition = {
    id: "3035cead-a501-4204-9154-5fd648577d32",
    rarity: "uncommon",
    name: "Tawnos's Weaponry",
    oracleText:
        "You may choose not to untap this artifact during your untap step.\n{2}, {T}: Target creature gets +1/+1 for as long as this artifact remains tapped.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    staticAbilities: ["may-choose-not-to-untap"],
    activatedAbilities: [
        {
            id: "tawnoss-weaponry-pump",
            oracleText:
                "{2}, {T}: Target creature gets +1/+1 for as long as this artifact remains tapped.",
            cost: { tap: true, mana: { X: 2 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addSourceTappedPTBuff(target, 1, 1);
                }
            },
        },
    ],
};

// Phyrexian Gremlins — {2}{B} Creature — Phyrexian Gremlin, 1/1. "{T}: Tap
// target artifact. It doesn't untap during its controller's untap step for as
// long as this creature remains tapped." (CR 611.2 untap-lock tied to the
// source's tapped state via `lockUntapWhileSourceTapped`; CR 502.1 optional
// untap.) The Gremlin taps the artifact AND records the lock; the artifact
// stays tapped through its controller's untap steps until the Gremlin untaps.
export const phyrexianGremlins: CardDefinition = {
    id: "21a985a9-5612-4844-982e-fd1aa6249770",
    rarity: "common",
    name: "Phyrexian Gremlins",
    oracleText:
        "You may choose not to untap this creature during your untap step.\n{T}: Tap target artifact. It doesn't untap during its controller's untap step for as long as this creature remains tapped.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Gremlin"],
    power: 1,
    toughness: 1,
    staticAbilities: ["may-choose-not-to-untap"],
    activatedAbilities: [
        {
            id: "phyrexian-gremlins-tap-lock",
            oracleText:
                "{T}: Tap target artifact. It doesn't untap during its controller's untap step for as long as this creature remains tapped.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Artifact", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.tap(target);
                    ctx.lockUntapWhileSourceTapped(target);
                }
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster C+D — continuous prevention/redirection of damage from artifact
// sources + per-turn artifact-damage tracking (PRD #269, issue #287)
//
// CR 615.1 — a prevention effect replaces a would-be damage event with
// nothing. The engine has no dedicated "prevention" event layer; instead a
// continuous prevention is expressed as a CR 614 damage replacement that
// `consumed`s the event when the source matches the filter. (Both layers run
// at the same damage sites via `runDamageReplacement`; consuming the event
// before the original action is observationally identical to prevention for a
// total "prevent all" effect.)
//
// CR 109.5 / 202.2 — the damage source's characteristics (`sourceTypes`) are
// snapshotted onto the `DamageReplacementEvent` by `runDamageReplacement`, so
// an "artifact source" filter is `event.sourceTypes.includes("Artifact")` and
// an "artifact creature" filter additionally requires `"Creature"`.
// ─────────────────────────────────────────────────────────────────────────────

/** Builds a continuous CR 614/615 damage-prevention replacement. `appliesToId`
 *  resolves which permanent's incoming damage is protected (self, or an aura's
 *  host). `isArtifactCreatureOnly` narrows the source filter from "artifact
 *  source" to "artifact creature" (Argothian Pixies). The effect consumes the
 *  whole event (prevent all). */
function artifactSourcePreventionEffect(opts: {
    id: string;
    oracleText: string;
    appliesToId: (self: PermanentView) => string | undefined;
    isArtifactCreatureOnly?: boolean;
}): import("../types").ReplacementEffect {
    return {
        id: opts.id,
        oracleText: opts.oracleText,
        eventKind: "damage",
        appliesTo: (event, self) => {
            if (event.kind !== "damage") return false;
            if (event.target.type !== "permanent") return false;
            if (event.target.id !== opts.appliesToId(self)) return false;
            const types = event.sourceTypes;
            if (!types.includes("Artifact")) return false;
            if (opts.isArtifactCreatureOnly && !types.includes("Creature")) {
                return false;
            }
            return true;
        },
        // CR 615 — prevent all damage from the matching source.
        replace: () => ({ kind: "consumed" }),
    };
}

// Argothian Pixies — {1}{G} Creature — Faerie, 2/1. "This creature can't be
// blocked by artifact creatures. Prevent all damage that would be dealt to
// this creature by artifact creatures." (CR 509.1b block restriction reusing
// the existing predicate machinery; CR 615 continuous prevention narrowed to
// artifact creatures.)
export const argothianPixies: CardDefinition = {
    id: "5712e87a-2381-4f5b-a853-6973841f9bf1",
    rarity: "common",
    name: "Argothian Pixies",
    oracleText:
        "This creature can't be blocked by artifact creatures.\nPrevent all damage that would be dealt to this creature by artifact creatures.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Faerie"],
    power: 2,
    toughness: 1,
    staticEffects: [
        {
            kind: "block-restriction",
            id: "argothian-pixies-no-artifact-creatures",
            side: "attacker" as const,
            // CR 509.1b — can't be blocked by artifact creatures.
            predicate: (_self, opponent) =>
                !opponent.types.includes("Artifact"),
            oracleText:
                "Argothian Pixies can't be blocked by artifact creatures.",
        },
    ],
    replacementEffects: [
        artifactSourcePreventionEffect({
            id: "argothian-pixies-prevent",
            oracleText:
                "Prevent all damage that would be dealt to Argothian Pixies by artifact creatures.",
            appliesToId: (self) => self.id,
            isArtifactCreatureOnly: true,
        }),
    ],
};

// Argothian Treefolk — {3}{G}{G} Creature — Treefolk, 3/5. "Prevent all damage
// that would be dealt to this creature by artifact sources." (CR 615
// continuous prevention narrowed to artifact sources.)
export const argothianTreefolk: CardDefinition = {
    id: "8db8882e-4db6-4e3c-9e9e-8c71d557a071",
    rarity: "common",
    name: "Argothian Treefolk",
    oracleText:
        "Prevent all damage that would be dealt to this creature by artifact sources.",
    manaCost: { X: 3, G: 2 },
    types: ["Creature"],
    subtypes: ["Treefolk"],
    power: 3,
    toughness: 5,
    replacementEffects: [
        artifactSourcePreventionEffect({
            id: "argothian-treefolk-prevent",
            oracleText:
                "Prevent all damage that would be dealt to Argothian Treefolk by artifact sources.",
            appliesToId: (self) => self.id,
        }),
    ],
};

// Artifact Ward — {W} Enchantment — Aura. "Enchant creature. Enchanted
// creature can't be blocked by artifact creatures. Prevent all damage that
// would be dealt to enchanted creature by artifact sources. Enchanted creature
// can't be the target of abilities from artifact sources." (CR 303.4 aura;
// CR 509.1b block restriction on the host; CR 615 continuous prevention on the
// host; CR 611 source-type-filtered targeting guard.)
export const artifactWard: CardDefinition = {
    id: "b3a5101a-ec66-4658-950c-9ad49c29b836",
    rarity: "common",
    name: "Artifact Ward",
    oracleText:
        "Enchant creature\nEnchanted creature can't be blocked by artifact creatures.\nPrevent all damage that would be dealt to enchanted creature by artifact sources.\nEnchanted creature can't be the target of abilities from artifact sources.",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "block-restriction",
            id: "artifact-ward-no-artifact-creatures",
            side: "attacker" as const,
            // CR 509.1b — enchanted creature can't be blocked by artifact
            // creatures (predicate runs against the host as the attacker).
            predicate: (_self, opponent) =>
                !opponent.types.includes("Artifact"),
            oracleText:
                "Enchanted creature can't be blocked by artifact creatures.",
        },
        {
            kind: "permanent-guard",
            id: "artifact-ward-cant-be-targeted-by-artifacts",
            // CR 611 — guard the host (attachedTo). Source-type filter narrows
            // it to artifact sources only (CR 109.5).
            applies: (target, source) => target.id === source.attachedTo,
            cantBeTargeted: true,
            targetSourceTypeFilter: ["Artifact"],
        },
    ],
    replacementEffects: [
        artifactSourcePreventionEffect({
            id: "artifact-ward-prevent",
            oracleText:
                "Prevent all damage that would be dealt to enchanted creature by artifact sources.",
            // The aura's `self` carries `attachedTo` — protect the host.
            appliesToId: (self) => self.attachedTo,
        }),
    ],
};

// Martyrs of Korlis — {3}{W}{W} Creature — Human, 1/6. "As long as this
// creature is untapped, all damage that would be dealt to you by artifacts is
// dealt to this creature instead." (CR 614 continuous redirection, gated on
// self.isTapped and the source being an artifact.)
export const martyrsOfKorlis: CardDefinition = {
    id: "bde037b9-4947-4ff7-8ea4-e9f1a7e4ab88",
    rarity: "uncommon",
    name: "Martyrs of Korlis",
    oracleText:
        "As long as this creature is untapped, all damage that would be dealt to you by artifacts is dealt to this creature instead.",
    manaCost: { X: 3, W: 2 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 1,
    toughness: 6,
    replacementEffects: [
        {
            id: "martyrs-of-korlis-redirect",
            oracleText:
                "All damage from artifacts that would be dealt to you is dealt to Martyrs of Korlis instead.",
            eventKind: "damage",
            appliesTo: (event, self) => {
                if (event.kind !== "damage") return false;
                // "Damage dealt to you" — the controller of Martyrs.
                if (event.target.type !== "player") return false;
                if (event.target.id !== self.controllerId) return false;
                // "As long as this creature is untapped" (read live).
                if (self.isTapped) return false;
                // "by artifacts" (CR 109.5 source-type snapshot).
                return event.sourceTypes.includes("Artifact");
            },
            replace: (event, ctx) => {
                if (event.kind !== "damage") return { kind: "consumed" };
                return {
                    kind: "modified",
                    event: {
                        ...event,
                        target: { type: "permanent", id: ctx.self.id },
                    },
                };
            },
        },
    ],
};

// Reverse Polarity — {W}{W} Instant. "You gain X life, where X is twice the
// damage dealt to you so far this turn by artifacts." (CR 119 lifegain; reads
// the artifact-narrowed per-turn damage tally.)
export const reversePolarity: CardDefinition = {
    id: "da7ed8ba-3886-4779-a9b3-6892a7ed3527",
    rarity: "common",
    name: "Reverse Polarity",
    oracleText:
        "You gain X life, where X is twice the damage dealt to you so far this turn by artifacts.",
    manaCost: { W: 2 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        const caster = ctx.controller;
        const artifactDamage = ctx.getArtifactDamageDealtThisTurn(caster);
        if (artifactDamage > 0) {
            ctx.gainLife(caster, artifactDamage * 2);
        }
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster F — animate noncreature artifact (#288). CR 613.1f (layer-6 ability
// removal), CR 205 (layer-4 type-add via the `type-add`/animate surrogate),
// CR 604.3 / 613.4a (P/T characteristic-defining ability = mana value), CR
// 500.2 (the "until your next upkeep" duration boundary). A noncreature
// artifact becomes an artifact creature with power and toughness each equal to
// its mana value; Titania's Song additionally strips all abilities and applies
// continuously to the whole filtered set (current + future entrants); Xenic
// Poltergeist is a single-target {T} animation that ends at the controller's
// next upkeep. `getPrintedTypes` discriminates a printed noncreature artifact
// from a printed artifact creature (Ornithopter) so the Song never animates an
// already-creature artifact and keeps matching its own targets after it has
// added Creature to them.
// ─────────────────────────────────────────────────────────────────────────────

/** CR 205 — true if `card` is a printed noncreature Artifact (Titania's Song's
 *  affected set). Reads the PRINTED type line so the predicate is stable after
 *  the Song adds the Creature type to its targets, and never matches a printed
 *  artifact creature. */
const IS_NONCREATURE_ARTIFACT: (
    target: PermanentView,
    source: PermanentView,
    ctx: import("../types").StaticEffectContext
) => boolean = (target, _source, ctx) => {
    const printed = ctx.getPrintedTypes(target);
    return printed.includes("Artifact") && !printed.includes("Creature");
};

// Titania's Song — {3}{G} Enchantment. "Each noncreature artifact loses all
// abilities and becomes an artifact creature with power and toughness each
// equal to its mana value. If this enchantment leaves the battlefield, this
// effect continues until end of turn." (CR 613.1f ability removal + CR 205
// type-add + CR 604.3 mana-value CDA, applied continuously to every printed
// noncreature artifact on the battlefield — including ones that enter after
// the Song resolves, via `applyExistingGrantsTo`.)
//
// DIVERGENCE (flagged, no engine change): "becomes an artifact creature" only
// needs to ADD Creature — the affected permanents are already artifacts, so no
// Artifact type-add is required. The leave-the-battlefield "continues until end
// of turn" linger clause is NOT modeled: when the Song leaves play the engine
// reverts the type/ability changes immediately (the standard
// `unapplySourceStaticEffects` path). This is observable only in the window
// between the Song leaving and the cleanup step; the common play pattern keeps
// the Song in play, so the simplification is acceptable for ATQ scope. A
// general "linger this continuous effect until EOT on source-leave" duration is
// deferred to a later tranche.
export const titaniasSong: CardDefinition = {
    id: "583a53af-2e2a-4f3f-8eab-bd874c6ed80a",
    rarity: "uncommon",
    name: "Titania's Song",
    oracleText:
        "Each noncreature artifact loses all abilities and becomes an artifact creature with power and toughness each equal to its mana value. If this enchantment leaves the battlefield, this effect continues until end of turn.",
    manaCost: { X: 3, G: 1 },
    types: ["Enchantment"],
    staticEffects: [
        // CR 613.1f — strip all abilities BEFORE the type/P-T changes.
        {
            kind: "ability-loss",
            applies: IS_NONCREATURE_ARTIFACT,
        },
        // CR 205 — add the Creature type (already an Artifact).
        {
            kind: "type-add",
            applies: IS_NONCREATURE_ARTIFACT,
            types: ["Creature"],
        },
        // CR 604.3 / 613.4a — power and toughness each equal to mana value.
        {
            kind: "pt-cda",
            applies: IS_NONCREATURE_ARTIFACT,
            compute: (_source, _state, ctx, target) => {
                const mv = ctx.getManaValue(target);
                return { power: mv, toughness: mv };
            },
        },
    ],
};

// Xenic Poltergeist — {1}{B}{B} Creature — Spirit, 1/1. "{T}: Until your next
// upkeep, target noncreature artifact becomes an artifact creature with power
// and toughness each equal to its mana value." (CR 605 activated ability + CR
// 205 animate + CR 604.3 mana-value P/T + CR 500.2 "until your next upkeep"
// duration.) Single-target one-shot animation that ends as the controller's
// upkeep begins. Does NOT strip abilities (unlike Titania's Song). The animated
// artifact's P/T is its mana value, snapshotted at resolution via
// `ctx.getManaValue` and stored as the animation's base P/T.
//
// DIVERGENCE (flagged, no engine change): `animateAsCreature` adds the Creature
// type only — the target is already an artifact, so the resulting "artifact
// creature" type line is correct without an Artifact type-add.
export const xenicPoltergeist: CardDefinition = {
    id: "5149ffff-d38f-458e-bcfa-a4b6b332a0b4",
    rarity: "uncommon",
    name: "Xenic Poltergeist",
    oracleText:
        "{T}: Until your next upkeep, target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "xenic-poltergeist-animate",
            oracleText:
                "{T}: Until your next upkeep, target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Artifact",
                count: 1,
                excludeTypes: "Creature",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                const mv = ctx.getManaValue(target);
                ctx.animateAsCreature(target, {
                    power: mv,
                    toughness: mv,
                    // CR 500.2 — ends as the controller's next upkeep begins.
                    duration: { phase: "upkeep", player: "controller" },
                });
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Choose-body-on-entry creatures (ATQ cluster G, issue #289). These pick their
// body "as they enter" (CR 614.12 replacement-style self-modification, resolved
// during the creature spell's own `resolveSteps` while it is still on the
// stack). The pick is an abstract `option-pick` PendingChoice (8 numbers for
// Shapeshifter, 3 modes for Primal Clay) and the resulting base P/T / subtypes /
// keywords are written onto the entering permanent via `ctx.setSelfBody`, which
// persists indefinitely (NOT a layer-7b temporary set). Shapeshifter re-chooses
// at each of its controller's upkeeps (CR 603.6a "may"), overwriting its base
// P/T. New engine capabilities introduced for this cluster: the `option-pick`
// PendingChoice kind (`ctx.requestOptionChoice`) and the persistent
// `ctx.setSelfBody` self-body primitive.
// ─────────────────────────────────────────────────────────────────────────────

// Primal Clay — {4} Artifact Creature — Shapeshifter, 0/0. "As this creature
// enters, it becomes your choice of a 3/3 artifact creature, a 2/2 artifact
// creature with flying, or a 1/6 Wall artifact creature with defender in
// addition to its other types." (CR 614.12 — the body choice is made as it
// enters; CR 702.3 defender; CR 702.9 flying. It is always an artifact
// creature; only the Wall mode adds subtype "Wall" + keyword "defender".)
export const primalClay: CardDefinition = {
    id: "ab9d0e3f-cf7c-41f8-bcd7-bb08ea8cc2f8",
    rarity: "uncommon",
    name: "Primal Clay",
    oracleText:
        "As this creature enters, it becomes your choice of a 3/3 artifact creature, a 2/2 artifact creature with flying, or a 1/6 Wall artifact creature with defender in addition to its other types.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Shapeshifter"],
    power: 0,
    toughness: 0,
    resolveSteps: [
        (ctx: SpellContext) => {
            // CR 614.12 — choose the body as the permanent enters. The pick is
            // made by the spell's controller during resolution; the resulting
            // base characteristics are written onto the still-on-stack
            // permanent and carry to the battlefield on `finalizeSpellResolution`.
            const mode = ctx.requestOptionChoice({
                playerId: ctx.controller,
                choiceId: "primal-clay-body",
                options: [
                    { id: "3-3", label: "3/3" },
                    { id: "2-2-flying", label: "2/2 flying" },
                    { id: "1-6-wall", label: "1/6 Wall (defender)" },
                ],
                prompt: "Choose Primal Clay's body.",
            });
            if (mode === undefined) return; // suspended — wait for the pick
            if (mode === "3-3") {
                ctx.setSelfBody({ power: 3, toughness: 3 });
            } else if (mode === "2-2-flying") {
                ctx.setSelfBody({
                    power: 2,
                    toughness: 2,
                    addKeywords: ["flying"],
                });
            } else if (mode === "1-6-wall") {
                ctx.setSelfBody({
                    power: 1,
                    toughness: 6,
                    addSubtypes: ["Wall"],
                    addKeywords: ["defender"],
                });
            }
        },
    ],
};

// Shapeshifter — {6} Artifact Creature — Shapeshifter, */7-*. "As this creature
// enters, choose a number between 0 and 7. At the beginning of your upkeep, you
// may choose a number between 0 and 7. Shapeshifter's power is equal to the last
// chosen number and its toughness is equal to 7 minus that number." (CR 614.12 —
// entry choice; CR 603.6a — optional upkeep re-choice. We model "power = N,
// toughness = 7 − N" by writing the chosen base P/T directly via `setSelfBody`,
// overwriting on each re-choice. The entry choice is mandatory; the upkeep
// re-choice is a "may".)
const SHAPESHIFTER_NUMBER_OPTIONS = Array.from({ length: 8 }, (_, n) => ({
    id: String(n),
    label: `${n}/${7 - n}`,
}));

export const shapeshifter: CardDefinition = {
    id: "cc278af4-b60d-41b7-b9d7-36c8aefca1a7",
    rarity: "rare",
    name: "Shapeshifter",
    oracleText:
        "As this creature enters, choose a number between 0 and 7.\nAt the beginning of your upkeep, you may choose a number between 0 and 7.\nShapeshifter's power is equal to the last chosen number and its toughness is equal to 7 minus that number.",
    manaCost: { X: 6 },
    types: ["Artifact", "Creature"],
    subtypes: ["Shapeshifter"],
    power: 0,
    toughness: 0,
    resolveSteps: [
        (ctx: SpellContext) => {
            // CR 614.12 — mandatory entry choice. Power = N, toughness = 7 − N.
            const choice = ctx.requestOptionChoice({
                playerId: ctx.controller,
                choiceId: "shapeshifter-entry-number",
                options: SHAPESHIFTER_NUMBER_OPTIONS,
                prompt: "Choose a number between 0 and 7.",
            });
            if (choice === undefined) return; // suspended — wait for the pick
            const n = Number(choice);
            ctx.setSelfBody({ power: n, toughness: 7 - n });
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "shapeshifter-upkeep-renumber",
            oracleText:
                "At the beginning of your upkeep, you may choose a number between 0 and 7. Shapeshifter's power becomes equal to the chosen number and its toughness becomes equal to 7 minus that number.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                // CR 603.6a — optional ("may") re-choice. requestMayPay with no
                // cost is the project's yes/no primitive; on accept, pick a new
                // number and overwrite the base P/T via setSelfBody (recipient
                // resolves to the source permanent on the battlefield).
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: `shapeshifter-renumber-may-${ctx.sourceInstanceId}`,
                    prompt: "Choose a new number for Shapeshifter?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) return;
                const choice = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: `shapeshifter-renumber-${ctx.sourceInstanceId}`,
                    options: SHAPESHIFTER_NUMBER_OPTIONS,
                    prompt: "Choose a number between 0 and 7.",
                });
                if (choice === undefined) return; // suspended
                const n = Number(choice);
                ctx.setSelfBody({ power: n, toughness: 7 - n });
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster J (#290) — activated-ability cost reduction. CR 601.2f models cost
// modification (reductions and increases) applied as the cost is calculated;
// 118.7 forbids a reduction from taking a cost below the floor its source
// declares. The `cost-modifier` static effect (originally increase-only, for
// Gloom) is extended with `costReduction` + `minTotalMana`: the engine reduces
// only the generic portion of a matching cost and clamps the post-reduction
// TOTAL mana up to the floor (colored pips are immovable). The effect's carrier
// permanent is passed to `appliesToAbility`, letting an Aura scope the modifier
// to its host. Modern Scryfall oracle text is authoritative (ADR 0004).
// ─────────────────────────────────────────────────────────────────────────────

// Power Artifact — {1}{U} Enchantment — Aura. "Enchant artifact. Enchanted
// artifact's activated abilities cost {2} less to activate. This effect can't
// reduce the mana in that cost to less than one mana." (CR 303.4 aura
// attachment, 601.2f cost reduction, 118.7 floor.) As with the other ATQ auras
// there is no `host` scope (ADR 0002): the `cost-modifier`'s `appliesToAbility`
// receives the Aura itself as `effectSource` and matches only abilities whose
// source is `effectSource.attachedTo`. The {2} reduction is generic-only and
// floored at one total mana, so a {T} mana ability like Mana Vault's
// "{T}: Add {C}{C}{C}" (no mana in its cost) is unaffected, "{3}: Untap" drops
// to {1}, and "{2}, {T}" drops to "{T}" only down to the one-mana floor.
export const powerArtifact: CardDefinition = {
    id: "e48bc89e-6da5-43da-b4e0-60d5f850199c",
    rarity: "uncommon",
    name: "Power Artifact",
    oracleText:
        "Enchant artifact\nEnchanted artifact's activated abilities cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Artifact", count: 1 },
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToAbility: (
                source: PermanentView,
                _ctx,
                effectSource?: PermanentView
            ) =>
                !!effectSource?.attachedTo &&
                effectSource.attachedTo === source.id,
            costReduction: { X: 2 },
            minTotalMana: 1,
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster N (#291) — grant a triggered ability to a filtered set. CR 113.1
// (granted abilities) + CR 611 (continuous effects): an anthem grants a
// triggered ability to every permanent matching a filter, continuously
// recomputed as permanents enter and leave. Modeled with a new
// `triggered-grant` static effect — the lord-style analogue of
// `activated-grant` for triggers. The granted trigger's template lives on the
// granting card's `triggeredGrantTemplates[]`; the grant is applied to current
// and future matching permanents via `applySourceStaticEffects` /
// `applyExistingGrantsTo` and reversed via `unapplySourceStaticEffects`, exactly
// like the keyword/activated grants. `effectiveTriggeredAbilities` unions the
// granted triggers into each recipient so the existing trigger collector and
// resolution lookup observe them as if printed on the recipient — no change to
// the scan loop itself. The granted trigger uses `scope: "your"`, whose
// `self.controllerId` is the artifact's controller (CR 603.6a "your upkeep"),
// and `ctx.sourceInstanceId` is the artifact ("sacrifice this artifact").
// ─────────────────────────────────────────────────────────────────────────────

/** CR 205 — true if `target` is an Artifact (Energy Flux's affected set). Reads
 *  the live `types` so an artifact animated by another effect still counts; the
 *  set is recomputed as artifacts enter/leave. */
const IS_ARTIFACT: (
    target: PermanentView,
    source: PermanentView,
    ctx: import("../types").StaticEffectContext
) => boolean = (target) => target.types.includes("Artifact");

// Energy Flux — {2}{U} Enchantment. "All artifacts have 'At the beginning of
// your upkeep, sacrifice this artifact unless you pay {2}.'" (CR 113.1 granted
// ability + CR 611 continuous filtered set + CR 603.6a upkeep trigger + CR
// 118 mana payment.) The granted trigger is attached to every artifact (either
// player's) while Energy Flux is in play and detaches when it leaves; new
// artifacts entering afterwards receive it too. Each artifact's controller, at
// the start of their own upkeep, may pay {2} to keep it — otherwise it is
// sacrificed. Each artifact gets its own trigger on the stack, so the
// pay-or-sacrifice decision is independent per artifact (CR 603.3b).
export const energyFlux: CardDefinition = {
    id: "bd1f624b-e8f2-462f-838a-7cb9e8fda988",
    rarity: "uncommon",
    name: "Energy Flux",
    oracleText:
        'All artifacts have "At the beginning of your upkeep, sacrifice this artifact unless you pay {2}."',
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    staticEffects: [
        // CR 113.1 / 611 — grant the upkeep trigger to every artifact.
        {
            kind: "triggered-grant",
            applies: IS_ARTIFACT,
            abilityId: "energy-flux-upkeep",
        },
    ],
    // The granted template lives here, NOT on `triggeredAbilities`, so Energy
    // Flux itself (an Enchantment, not an artifact) never fires it.
    triggeredGrantTemplates: [
        phaseTrigger({
            id: "energy-flux-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this artifact unless you pay {2}.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, scopedPlayerId) => {
                // CR 118 — the artifact's controller may pay {2}; if they
                // don't (or can't), the artifact is sacrificed (CR 701.16).
                const paid = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `energy-flux-${ctx.sourceInstanceId}`,
                    cost: { X: 2 },
                    prompt: "Pay {2} or sacrifice this artifact?",
                });
                if (paid === undefined) return; // suspended for the choice
                if (!paid) ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster O — minor isolated extensions (PRD #269, issue #292)
//
// Each card here exercises one small, orthogonal engine extension:
//  • chosen-opponent-on-entry stored for the rest of the game (Cursed Rack,
//    The Rack) — CR 603.6b / 614.12, `SpellContext.setChosenPlayer`.
//  • sacrifice-vs-other leave distinction (Urza's Miter) — the `PERMANENT_LEFT`
//    event now carries `cause: "sacrifice"`.
//  • random-discard as an activation cost (Coral Helm) — `cost.discardAtRandom`.
//  • "originally printed in [set]" mass sacrifice (Golgothian Sylex) —
//    `isPrintedInSet`.
//  • continuous-control activation precondition (Rocket Launcher) —
//    `tracksControlContinuity` + `canActivate`.
//  • can't-be-blocked-this-turn flag (Tawnos's Wand) —
//    `SpellContext.setCantBeBlockedThisTurn`.
// ─────────────────────────────────────────────────────────────────────────────

/** Resolves the player chosen as an "as ~ enters, choose an opponent" card
 *  entered. In the engine's 2-player games there is exactly one opponent, so
 *  the choice auto-resolves (Arena-style — no prompt for a zero-branch choice).
 *  Returns undefined if no opponent exists (solo edge case). */
function singleOpponentId(ctx: SpellContext): string | undefined {
    return ctx.allPlayerIds.find((id) => id !== ctx.controller);
}

// Cursed Rack — {4} Artifact. "As this artifact enters, choose an opponent.
// The chosen player's maximum hand size is four." (CR 603.6b on-entry choice
// stored via `setChosenPlayer`; CR 402.2 max-hand-size override read by
// `effectiveMaxHandSize` through the `appliesTo: "chosen-player"`
// `hand-size-override` static effect — the cap is applied at the chosen
// player's CLEANUP.)
export const cursedRack: CardDefinition = {
    id: "720d871d-1e7b-482e-bd1e-8ec79519fb86",
    rarity: "uncommon",
    name: "Cursed Rack",
    oracleText:
        "As this artifact enters, choose an opponent.\nThe chosen player's maximum hand size is four.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    // CR 402.2 — continuous override of the CHOSEN player's max hand size.
    // `effectiveMaxHandSize` resolves "chosen-player" to this instance's
    // stored `chosenPlayerId`.
    staticEffects: [
        {
            kind: "hand-size-override",
            value: 4,
            appliesTo: "chosen-player",
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "cursed-rack-choose-opponent",
            oracleText: "As this artifact enters, choose an opponent.",
            scope: "self",
            resolve: (ctx) => {
                const opponent = singleOpponentId(ctx);
                if (opponent) ctx.setChosenPlayer(opponent);
            },
        }),
    ],
};

// The Rack — {1} Artifact. "As this artifact enters, choose an opponent. At the
// beginning of the chosen player's upkeep, this artifact deals X damage to that
// player, where X is 3 minus the number of cards in their hand." (CR 603.6b
// on-entry choice; CR 603.6a upkeep trigger. `scope: "each"` fires on every
// player's upkeep; the `condition` narrows it to the stored chosen player so
// the trigger only enters the stack on their upkeep — CR 603.4.)
export const theRack: CardDefinition = {
    id: "ec0686ba-1277-4412-a397-7a6227808311",
    rarity: "uncommon",
    name: "The Rack",
    oracleText:
        "As this artifact enters, choose an opponent.\nAt the beginning of the chosen player's upkeep, this artifact deals X damage to that player, where X is 3 minus the number of cards in their hand.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        enteredTrigger({
            id: "the-rack-choose-opponent",
            oracleText: "As this artifact enters, choose an opponent.",
            scope: "self",
            resolve: (ctx) => {
                const opponent = singleOpponentId(ctx);
                if (opponent) ctx.setChosenPlayer(opponent);
            },
        }),
        phaseTrigger({
            id: "the-rack-upkeep-damage",
            oracleText:
                "At the beginning of the chosen player's upkeep, this artifact deals X damage to that player, where X is 3 minus the number of cards in their hand.",
            phase: "UPKEEP",
            // Fire on every player's upkeep, then narrow to the stored chosen
            // player (CR 603.4 — only fires when the active player is the one
            // chosen as this artifact entered).
            scope: "each",
            condition: (event, self) =>
                self.chosenPlayerId === event.activePlayerId,
            resolve: (ctx, _event, scopedPlayerId) => {
                const x = 3 - ctx.getHandSize(scopedPlayerId);
                if (x > 0) {
                    ctx.dealDamage({ type: "player", id: scopedPlayerId }, x);
                }
            },
        }),
    ],
};

// Urza's Miter — {3} Artifact. "Whenever an artifact you control is put into a
// graveyard from the battlefield, if it wasn't sacrificed, you may pay {3}. If
// you do, draw a card." (CR 603.10 LTB trigger; the `cause` field on
// `PERMANENT_LEFT` distinguishes sacrifice from every other departure — the
// trigger fires only when `event.cause !== "sacrifice"`. CR 117.3a optional
// payment via `requestMayPay`.)
export const urzasMiter: CardDefinition = {
    id: "438f0c61-a61d-4a9e-b21f-4e86420c7913",
    rarity: "rare",
    name: "Urza's Miter",
    oracleText:
        "Whenever an artifact you control is put into a graveyard from the battlefield, if it wasn't sacrificed, you may pay {3}. If you do, draw a card.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    triggeredAbilities: [
        leftTrigger({
            id: "urzas-miter-draw",
            oracleText:
                "Whenever an artifact you control is put into a graveyard from the battlefield, if it wasn't sacrificed, you may pay {3}. If you do, draw a card.",
            scope: "yours",
            toZone: "graveyard",
            filter: { types: "Artifact" },
            // CR 603.4 — only fires when the artifact was NOT sacrificed.
            condition: (event) => event.cause !== "sacrifice",
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: ctx.controller,
                    cost: { X: 3 },
                    prompt: "Pay {3} to draw a card from Urza's Miter?",
                });
                if (accept === undefined) return; // suspended for the choice
                if (accept) ctx.drawCards(ctx.controller, 1);
            },
        }),
    ],
};

// Coral Helm — {3} Artifact. "{3}, Discard a card at random: Target creature
// gets +2/+2 until end of turn." (CR 118.3 random-discard additional cost via
// `cost.discardAtRandom`; CR 611.1 "+2/+2 until end of turn" via
// `addTemporaryPTBuff`.)
export const coralHelm: CardDefinition = {
    id: "6c6df9db-0a46-40a5-ae9d-59f47dae9056",
    rarity: "rare",
    name: "Coral Helm",
    oracleText:
        "{3}, Discard a card at random: Target creature gets +2/+2 until end of turn.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "coral-helm-pump",
            oracleText:
                "{3}, Discard a card at random: Target creature gets +2/+2 until end of turn.",
            cost: { mana: { X: 3 }, discardAtRandom: 1 },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addTemporaryPTBuff(target, 2, 2, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Golgothian Sylex — {4} Artifact. "{1}, {T}: Each nontoken permanent with a
// name originally printed in the Antiquities expansion is sacrificed by its
// controller." (CR 701.16 sacrifice; the "originally printed in ATQ" origin
// filter is `isPrintedInSet(cardId, "atq")` — keyed off the home set of each
// permanent's card definition. Golgothian Sylex itself is an ATQ card, so it
// sacrifices itself too.)
export const golgothianSylex: CardDefinition = {
    id: "856be1dd-a20b-49c2-be9d-7db76c7efd8b",
    rarity: "rare",
    name: "Golgothian Sylex",
    oracleText:
        "{1}, {T}: Each nontoken permanent with a name originally printed in the Antiquities expansion is sacrificed by its controller.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "golgothian-sylex-wrath",
            oracleText:
                "{1}, {T}: Each nontoken permanent with a name originally printed in the Antiquities expansion is sacrificed by its controller.",
            cost: { tap: true, mana: { X: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // Snapshot the matching ids first; sacrificing mutates the
                // battlefield arrays. CR 701.16 — each is sacrificed by its
                // controller (ctx.sacrifice resolves the current controller).
                const toSacrifice: string[] = [];
                for (const playerId of ctx.allPlayerIds) {
                    // CR 111.5 — "nontoken permanent": exclude tokens via the
                    // battlefield filter.
                    for (const id of ctx.getBattlefieldIds(playerId, {
                        isToken: false,
                    })) {
                        if (ctx.isPrintedInSet(id, "atq")) {
                            toSacrifice.push(id);
                        }
                    }
                }
                for (const id of toSacrifice) ctx.sacrifice(id);
            },
        },
    ],
};

// Rocket Launcher — {4} Artifact. "{2}: This artifact deals 1 damage to any
// target. Destroy this artifact at the beginning of the next end step. Activate
// only if you've controlled this artifact continuously since the beginning of
// your most recent turn." (CR 115.4 any-target damage; CR 603.7a delayed
// self-destroy; the continuous-control precondition reuses the summoning-sick
// flag via `tracksControlContinuity` — the artifact is sick the turn it enters
// or changes control and clears at the controller's untap step, so
// `!isSummoningSick` on the controller's own turn means "controlled since my
// most recent turn began".)
export const rocketLauncher: CardDefinition = {
    id: "d5bb2093-78a8-4a6c-abe7-9a5afc181ec5",
    rarity: "uncommon",
    name: "Rocket Launcher",
    oracleText:
        "{2}: This artifact deals 1 damage to any target. Destroy this artifact at the beginning of the next end step. Activate only if you've controlled this artifact continuously since the beginning of your most recent turn.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    tracksControlContinuity: true,
    activatedAbilities: [
        {
            id: "rocket-launcher-ping",
            oracleText:
                "{2}: This artifact deals 1 damage to any target. Destroy this artifact at the beginning of the next end step. Activate only if you've controlled this artifact continuously since the beginning of your most recent turn.",
            cost: { mana: { X: 2 } },
            useStack: true,
            // CR 602.5b — "activate only ... since the beginning of your most
            // recent turn": only your turn, and not the turn it came under your
            // control (still summoning-sick).
            controllerTurnOnly: true,
            canActivate: (source) => source.isSummoningSick !== true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.dealDamage(target, 1);
                // CR 603.7a — schedule the self-destroy for the next end step.
                ctx.scheduleDelayedTrigger(
                    "d5bb2093-78a8-4a6c-abe7-9a5afc181ec5",
                    "rocket-launcher-end-step-destroy",
                    "next-end-step",
                    { sourceId: ctx.sourceInstanceId }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "rocket-launcher-end-step-destroy",
            oracleText:
                "Destroy Rocket Launcher at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                if (payload.sourceId) {
                    ctx.destroy({ type: "permanent", id: payload.sourceId });
                }
            },
        },
    ],
};

// Tawnos's Wand — {4} Artifact. "{2}, {T}: Target creature with power 2 or less
// can't be blocked this turn." (CR 509.1b can't-be-blocked, set on the attacker
// via `setCantBeBlockedThisTurn` and cleared at CLEANUP; the
// `powerFilter: { max: 2 }` restricts legal targets — CR 613 effective power.)
export const tawnossWand: CardDefinition = {
    id: "978f09dd-121a-4da5-ba16-5c03fbdce084",
    rarity: "uncommon",
    name: "Tawnos's Wand",
    oracleText:
        "{2}, {T}: Target creature with power 2 or less can't be blocked this turn.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "tawnoss-wand-unblockable",
            oracleText:
                "{2}, {T}: Target creature with power 2 or less can't be blocked this turn.",
            cost: { tap: true, mana: { X: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                powerFilter: { max: 2 },
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.setCantBeBlockedThisTurn(target);
                }
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster L (#293) — token provenance link. CR 111 / 707.1: a token records
// the permanent that created it (`createToken(..., ctx.sourceInstanceId)` →
// `CardInstanceState.createdBy`), so a source can later identify "tokens
// created with this creature" via the `PermanentFilter.createdBy` clause. The
// Tetravite token also carries a self-targeting `cantBeEnchanted`
// `permanent-guard` (CR 303.4 — reusing Guardian Beast's clause), registered on
// the synthesized token definition and rebuilt from the token id after a DB
// round-trip (`maybeSynthesizeToken`). Both upkeep abilities are optional
// ("may") choices over an arbitrary number (CR 603.6a): the counter→token
// direction picks a number 0..N via `requestOptionChoice`; the token→counter
// direction picks any subset of the linked tokens via a `choose-permanents`
// `requestChoice` scoped by `createdBy`.
// ─────────────────────────────────────────────────────────────────────────────

// The Tetravite token spec (CR 707.2). 1/1 colorless flying artifact creature
// that "can't be enchanted". The provenance link is stamped per-creation by
// `createToken`'s `createdBy` argument, not by the spec.
const TETRAVITE_TOKEN: TokenSpec = {
    name: "Tetravite",
    types: ["Artifact", "Creature"],
    subtypes: ["Tetravite"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    // CR 303.4 — "This token can't be enchanted." Self-targeting guard,
    // reconstructed deterministically from the token id (closures can't ride
    // the serialized id).
    staticEffects: [cantBeEnchantedSelfGuard()],
};

// Tetravus — {6} Artifact Creature — Construct, 1/1 flying, enters with three
// +1/+1 counters. Two optional upkeep abilities convert between counters and
// linked Tetravite tokens in either direction (modern Scryfall oracle, ADR
// 0004).
export const tetravus: CardDefinition = {
    id: "23eb19f9-2e8f-4bf0-9bf8-868e6da70e2d",
    rarity: "rare",
    name: "Tetravus",
    oracleText:
        'Flying\nThis creature enters with three +1/+1 counters on it.\nAt the beginning of your upkeep, you may remove any number of +1/+1 counters from this creature. If you do, create that many 1/1 colorless Tetravite artifact creature tokens. They each have flying and "This token can\'t be enchanted."\nAt the beginning of your upkeep, you may exile any number of tokens created with this creature. If you do, put that many +1/+1 counters on this creature.',
    manaCost: { X: 6 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    // CR 122.1 / 614.1c — ETB counters applied by finalizeSpellResolution.
    entersWith: { counters: [{ type: "+1/+1", count: 3 }] },
    triggeredAbilities: [
        phaseTrigger({
            id: "tetravus-counters-to-tokens",
            oracleText:
                'At the beginning of your upkeep, you may remove any number of +1/+1 counters from this creature. If you do, create that many 1/1 colorless Tetravite artifact creature tokens. They each have flying and "This token can\'t be enchanted."',
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                const available = ctx.getCounterCount(self, "+1/+1");
                // CR 608.2b — nothing to remove; no real choice, no prompt.
                if (available <= 0) return;
                // CR 603.6a "you may remove any number" — pick a count 0..N
                // (0 = remove none / decline). One prompt covers the "may" and
                // the "how many" together.
                const choice = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: `tetravus-make-${ctx.sourceInstanceId}`,
                    options: Array.from({ length: available + 1 }, (_, n) => ({
                        id: String(n),
                        label:
                            n === 0
                                ? "Remove none"
                                : `Remove ${n} (create ${n} Tetravite${n === 1 ? "" : "s"})`,
                    })),
                    prompt: "Remove any number of +1/+1 counters to create that many Tetravite tokens.",
                });
                if (choice === undefined) return; // suspended — await the pick
                const n = Number(choice);
                if (n <= 0) return;
                // CR 122.6 — remove the counters, then create that many linked
                // tokens (CR 111 / 707.1). The provenance link (`createdBy`)
                // lets the second ability find them later.
                const removed = ctx.removeCounter(self, "+1/+1", n);
                if (removed <= 0) return;
                ctx.createToken(
                    TETRAVITE_TOKEN,
                    ctx.controller,
                    removed,
                    ctx.sourceInstanceId
                );
            },
        }),
        phaseTrigger({
            id: "tetravus-tokens-to-counters",
            oracleText:
                "At the beginning of your upkeep, you may exile any number of tokens created with this creature. If you do, put that many +1/+1 counters on this creature.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                // CR 111 — "tokens created with this creature": tokens on the
                // controller's battlefield whose provenance link points here.
                const linked = ctx.getBattlefieldIds(ctx.controller, {
                    isToken: true,
                    createdBy: ctx.sourceInstanceId,
                });
                // CR 608.2b — no eligible tokens; no real choice, no prompt.
                if (linked.length === 0) return;
                const chosen = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `tetravus-exile-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    filter: {
                        isToken: true,
                        createdBy: ctx.sourceInstanceId,
                    },
                    count: { min: 0, max: linked.length },
                    prompt: "Exile any number of tokens created with Tetravus to put that many +1/+1 counters on it.",
                });
                if (chosen === undefined) return; // suspended — await the pick
                if (chosen.length === 0) return; // chose none
                // CR 701.18 exile, then CR 122.1 put back that many counters.
                for (const id of chosen) {
                    ctx.exile({ type: "permanent", id });
                }
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "+1/+1",
                    chosen.length
                );
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Library tutor → battlefield (ATQ cluster H, ADR 0027)
// ─────────────────────────────────────────────────────────────────────────────

// Transmute Artifact — {U}{U} Sorcery. "Sacrifice an artifact. If you do,
// search your library for an artifact card. If that card's mana value is less
// than or equal to the sacrificed artifact's mana value, put it onto the
// battlefield. If it's greater, you may pay {X}, where X is the difference. If
// you do, put it onto the battlefield. If you don't, put it into its owner's
// graveyard. Then shuffle." (CR 701.16 sacrifice, CR 701.19 search, CR 202.3
// mana value, CR 701.20 shuffle.)
//
// All board mutations run only after the LAST suspending choice (the search,
// or the optional pay-the-difference when it applies): a `resolveSteps` step
// re-runs from its top on every resume, so any mutation reached before a later
// suspend would fire twice. The sacrificed artifact stays on the battlefield
// until that final pass, so `getManaValue` reads its live mana value just
// before it leaves (CR 608.2g — the sacrifice and the comparison are part of
// the same resolution; no priority intervenes).
export const transmuteArtifact: CardDefinition = {
    id: "6eab6765-eba3-4844-81ca-ae37a6e903df",
    rarity: "uncommon",
    name: "Transmute Artifact",
    oracleText:
        "Sacrifice an artifact. If you do, search your library for an artifact card. If that card's mana value is less than or equal to the sacrificed artifact's mana value, put it onto the battlefield. If it's greater, you may pay {X}, where X is the difference. If you do, put it onto the battlefield. If you don't, put it into its owner's graveyard. Then shuffle.",
    manaCost: { U: 2 },
    types: ["Sorcery"],
    resolveSteps: [
        (ctx: SpellContext) => {
            // "Sacrifice an artifact." — mandatory if able; with no artifact to
            // sacrifice the whole effect ("If you do, …") does nothing.
            const artifacts = ctx.getBattlefieldIds(ctx.caster, {
                types: "Artifact",
            });
            if (artifacts.length === 0) return;
            const sacPick = ctx.requestChoice({
                playerId: ctx.caster,
                choiceId: "transmute-sac",
                kind: "sacrifice-permanents",
                zone: "battlefield",
                zoneOwnerId: ctx.caster,
                filter: { types: "Artifact" },
                count: 1,
                prompt: "Sacrifice an artifact.",
            });
            if (sacPick === undefined) return; // suspended
            const sacId = sacPick[0];
            if (!sacId) return;

            // "search your library for an artifact card" — the submit
            // validator does not apply a filter to hidden library cards, so the
            // artifact-card restriction is carried as a `candidateIds`
            // allow-list (CR 701.19; a fail-to-find is allowed, min 0).
            const libArtifacts = ctx
                .getLibraryCards(ctx.caster)
                .filter((c) => c.types.includes("Artifact"));
            const found = ctx.requestChoice({
                playerId: ctx.caster,
                choiceId: "transmute-search",
                kind: "search-library",
                zone: "library",
                candidateIds: libArtifacts.map((c) => c.id),
                count: { min: 0, max: 1 },
                prompt: "Search your library for an artifact card.",
            });
            if (found === undefined) return; // suspended

            // Read the sacrificed artifact's mana value while it is still on the
            // battlefield (CR 202.3), then resolve the comparison.
            const sacMv = ctx.getManaValue({ type: "permanent", id: sacId });
            const foundId = found[0];

            // Fail-to-find (or no artifact in library): sacrifice, then shuffle.
            if (!foundId) {
                ctx.sacrifice(sacId);
                ctx.shuffleLibrary(ctx.caster);
                return;
            }
            const foundMv =
                libArtifacts.find((c) => c.id === foundId)?.manaValue ?? 0;

            if (foundMv > sacMv) {
                // "you may pay {X}, where X is the difference."
                const diff = foundMv - sacMv;
                const paid = ctx.requestMayPay({
                    playerId: ctx.caster,
                    choiceId: "transmute-paydiff",
                    cost: { X: diff },
                    prompt: `Pay {${diff}} to put the artifact onto the battlefield?`,
                });
                if (paid === undefined) return; // suspended
                ctx.sacrifice(sacId);
                if (paid) {
                    ctx.putFromLibraryOntoBattlefield(ctx.caster, foundId);
                } else {
                    ctx.moveCardById(
                        ctx.caster,
                        foundId,
                        "library",
                        "graveyard"
                    );
                }
                ctx.shuffleLibrary(ctx.caster);
                return;
            }

            // mana value ≤ sacrificed mana value: straight onto the battlefield.
            ctx.sacrifice(sacId);
            ctx.putFromLibraryOntoBattlefield(ctx.caster, foundId);
            ctx.shuffleLibrary(ctx.caster);
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Exile-with-attachments + return (ATQ cluster K, ADR 0028)
// ─────────────────────────────────────────────────────────────────────────────

// Tawnos's Coffin — {4} Artifact. "You may choose not to untap this artifact
// during your untap step. {3},{T}: Exile target creature and all Auras attached
// to it. Note the number and kind of counters that were on that creature. When
// this artifact leaves the battlefield or becomes untapped, return that exiled
// card to the battlefield under its owner's control tapped with the noted
// number and kind of counters on it. If you do, return the other exiled cards
// to the battlefield under their owner's control attached to that permanent."
// (CR 502.1 optional untap, CR 701.18 exile, CR 122 counters, CR 603.7a
// delayed return, CR 303.4 aura attachment.)
//
// The exile-and-return is the general holding mechanism (ADR 0028): the
// activated ability arms an `ExileReturnBundle` keyed to this artifact, and the
// return is driven by TWO triggers on this same artifact — its leaves-the-
// battlefield (`leftTrigger`) and its becomes-untapped (`untapTrigger`,
// CR 701.20b). The bundle's existence is the delayed-trigger's armed flag, so
// both triggers gate on `state.exileHeld` to avoid firing with nothing held.
// "You may choose not to untap" reuses the existing `may-choose-not-to-untap`
// optional-untap static (ADR 0005) — declining keeps the creature exiled.
const tawnossCoffinHoldsSomething = (
    _event: unknown,
    self: { id: string },
    state?: { exileHeld?: ReadonlyArray<{ sourceId: string }> }
): boolean => !!state?.exileHeld?.some((b) => b.sourceId === self.id);

export const tawnossCoffin: CardDefinition = {
    id: "c27bc1de-8246-4dc8-af51-ec21def9e226",
    rarity: "rare",
    name: "Tawnos's Coffin",
    oracleText:
        "You may choose not to untap this artifact during your untap step.\n{3}, {T}: Exile target creature and all Auras attached to it. Note the number and kind of counters that were on that creature. When this artifact leaves the battlefield or becomes untapped, return that exiled card to the battlefield under its owner's control tapped with the noted number and kind of counters on it. If you do, return the other exiled cards to the battlefield under their owner's control attached to that permanent.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    staticAbilities: ["may-choose-not-to-untap"],
    activatedAbilities: [
        {
            id: "tawnoss-coffin-exile",
            oracleText:
                "{3}, {T}: Exile target creature and all Auras attached to it. Note the number and kind of counters that were on that creature.",
            cost: { tap: true, mana: { X: 3 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (!target || target.type !== "permanent") return;
                // CR 701.18 / 122 — exile the creature + its Auras and note its
                // counters; arm the return keyed to this artifact (ADR 0028).
                ctx.exileWithAttachments(target.id, {
                    sourceId: ctx.sourceInstanceId,
                    returnTapped: true,
                });
            },
        },
    ],
    triggeredAbilities: [
        leftTrigger({
            id: "tawnoss-coffin-return-on-leave",
            oracleText:
                "When this artifact leaves the battlefield, return the exiled card to the battlefield under its owner's control tapped with the noted counters, and reattach the other exiled cards to it.",
            scope: "self",
            condition: tawnossCoffinHoldsSomething,
            resolve: (ctx: SpellContext) => {
                ctx.returnExiledForSource(ctx.sourceInstanceId);
            },
        }),
        untapTrigger({
            id: "tawnoss-coffin-return-on-untap",
            oracleText:
                "When this artifact becomes untapped, return the exiled card to the battlefield under its owner's control tapped with the noted counters, and reattach the other exiled cards to it.",
            scope: "self",
            condition: tawnossCoffinHoldsSomething,
            resolve: (ctx: SpellContext) => {
                ctx.returnExiledForSource(ctx.sourceInstanceId);
            },
        }),
    ],
};
