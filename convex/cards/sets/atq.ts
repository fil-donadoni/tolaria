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
    TargetSelection,
} from "../types";
import { spellCastTrigger } from "../abilities/triggers/spellCastTrigger";
import { diedTrigger } from "../abilities/triggers/diedTrigger";
import { leftTrigger } from "../abilities/triggers/leftTrigger";
import { phaseTrigger } from "../abilities/triggers/phaseTrigger";

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
