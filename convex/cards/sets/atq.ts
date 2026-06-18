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
    SpellContext,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla / keyword artifact creatures (CR 702 — keywords map to
// `staticAbilities[]`; CR 301 — artifact creatures are both Artifact and
// Creature, affected by both artifact and creature rules)
// ─────────────────────────────────────────────────────────────────────────────

// Ornithopter — {0} Artifact Creature — Thopter, 0/2 with flying (CR 702.9).
// The classic free flyer; a zero-cost evasive blocker/chump.
export const ornithopter: CardDefinition = {
    id: "59cc9bdb-7cf2-4795-bac7-ffff605c9eb0",
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
