// Fallen Empires (FEM) — the 1994 faction-war expansion (102 unique cards, 187
// prints across its famous multi-art commons). This file follows the
// established set-file pattern (ADR 0014): every in-scope card is a new
// `CardDefinition` (FEM has zero reprints of already-implemented cards), and
// FEM's signature multi-artwork commons ship as ONE shared `CardDefinition`
// plus one `CardPrint` per additional artwork — all `setCode: "fem"`, all
// resolving to the single definition (mechanics come from the one def).
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical names /
// costs / P/T / subtypes are sourced from Scryfall `set:fem` (modern Oracle).
//
// THIS slice is the walking skeleton (#567): it registers the `fem` set and
// wires one thin end-to-end tracer — Vodalian Soldiers ({1}{U} 1/2 vanilla
// Merfolk Soldier) — together with its three alternate-art FEM prints. It
// proves the set file, the registry entry, the multi-art `CardPrint` plumbing,
// pool/deck availability, projection, and the test harness all work before the
// six thematic faction clusters land (see PRD #566).
//
// Generic mana is encoded as `X: n` (e.g. {1}{U} → { X: 1, U: 1 }).

import type { CardDefinition, CardPrint, SpellContext } from "../types";
import { enteredTrigger } from "../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../abilities/triggers/phaseTrigger";

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla creatures (CR 302 — Creature cards with no rules text are pure data:
// types/subtypes + P/T only; they resolve from the stack onto the battlefield
// via the generic permanent-resolution path, CR 608.3).
// ─────────────────────────────────────────────────────────────────────────────

// Vodalian Soldiers — {1}{U} 1/2 vanilla Merfolk Soldier. FEM printed it with
// four distinct artworks (collector numbers 31a–31d). The canonical
// `CardDefinition` uses the 31a print's Scryfall UUID as its id; the remaining
// three artworks are `CardPrint` entries below, all resolving to this one def.
export const vodalianSoldiers: CardDefinition = {
    id: "7eb50256-9113-4b03-bcef-9aea24be8493", // FEM 31a (canonical art)
    rarity: "common",
    name: "Vodalian Soldiers",
    oracleText: "",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Soldier"],
    power: 1,
    toughness: 2,
};

// ─────────────────────────────────────────────────────────────────────────────
// Multi-art prints (ADR 0014). Each additional FEM artwork is a `CardPrint`
// resolving to the shared definition above. The registry maps every `printId`
// to the same `CardDefinition`, so a deck/instance referencing any artwork gets
// the identical mechanics while rendering the chosen art (the instance keeps
// `card.id === printId`).
// ─────────────────────────────────────────────────────────────────────────────

export const vodalianSoldiersFemB: CardPrint = {
    printId: "bc85a68c-14d6-4447-a894-0e48d1662bc3", // FEM 31b
    definitionId: vodalianSoldiers.id,
    setCode: "fem",
    rarity: "common",
};

export const vodalianSoldiersFemC: CardPrint = {
    printId: "d8d1ceac-bb75-4c46-9ab4-1ef623ed3027", // FEM 31c
    definitionId: vodalianSoldiers.id,
    setCode: "fem",
    rarity: "common",
};

export const vodalianSoldiersFemD: CardPrint = {
    printId: "99d22f83-1171-4b5c-8a72-956db26d7c60", // FEM 31d
    definitionId: vodalianSoldiers.id,
    setCode: "fem",
    rarity: "common",
};

// ═════════════════════════════════════════════════════════════════════════════
// C3 — White: Icatians & Order of Leitbur (PRD #566, issue #568). The white
// faction is the Icatian Empire: soldier tribal, banding, combat-damage
// prevention, and counter-based utility. Two new engine capabilities ship with
// this cluster:
//   D — `tapOtherFilter` activation cost (Hand of Justice).
//   G — non-tap repeatable mana ability + activation-count delayed sacrifice
//       (Farrelite Priest), reusing the per-instance `activationsThisTurn`
//       counter (Dragon Whelp pattern) + `scheduleDelayedTrigger`.
// Every other card composes existing primitives.
// ═════════════════════════════════════════════════════════════════════════════

// --- Combat Medic ({2}{W} 0/2 Human Cleric Soldier) ---------------------------
// "{1}{W}: Prevent the next 1 damage that would be dealt to any target this
// turn." (CR 615 prevention shield via `preventNextNDamageToTarget`; identical
// shape to Samite Healer but with a {1}{W} mana cost instead of {T}.)
export const combatMedic: CardDefinition = {
    id: "9cfd96cb-03d6-4845-8595-50bf17b35726", // FEM 1a
    rarity: "common",
    name: "Combat Medic",
    oracleText:
        "{1}{W}: Prevent the next 1 damage that would be dealt to any target this turn.",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric", "Soldier"],
    power: 0,
    toughness: 2,
    activatedAbilities: [
        {
            id: "combat-medic-prevent",
            oracleText:
                "{1}{W}: Prevent the next 1 damage that would be dealt to any target this turn.",
            cost: { mana: { X: 1, W: 1 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.preventNextNDamageToTarget(target, 1, {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};

export const combatMedicFemB: CardPrint = {
    printId: "2a324a98-31c2-470a-b792-96b6b098a58c", // FEM 1b
    definitionId: combatMedic.id,
    setCode: "fem",
    rarity: "common",
};
export const combatMedicFemC: CardPrint = {
    printId: "ee9d1eac-3ac2-4881-a984-e40d87f60784", // FEM 1c
    definitionId: combatMedic.id,
    setCode: "fem",
    rarity: "common",
};
export const combatMedicFemD: CardPrint = {
    printId: "8f26c079-61ea-436d-89ae-2f1c6f863e91", // FEM 1d
    definitionId: combatMedic.id,
    setCode: "fem",
    rarity: "common",
};

// --- Farrel's Mantle ({2}{W} Aura) --------------------------------------------
// "Enchant creature\nWhenever enchanted creature attacks and isn't blocked, its
// controller may have it deal damage equal to its power plus 2 to another target
// creature. If that player does, the attacking creature assigns no combat damage
// this turn." (CR 509.1h ATTACKER_UNBLOCKED; CR 603.3d optional targeted trigger
// resolved imperatively via `requestChoice`; CR 510.1c `markAssignsNoCombatDamage`.)
const FARRELS_MANTLE_ID = "af092da3-8713-4a59-86d3-827b942d6456"; // FEM 2
export const farrelsMantle: CardDefinition = {
    id: FARRELS_MANTLE_ID,
    rarity: "common",
    name: "Farrel's Mantle",
    oracleText:
        "Enchant creature\nWhenever enchanted creature attacks and isn't blocked, its controller may have it deal damage equal to its power plus 2 to another target creature. If that player does, the attacking creature assigns no combat damage this turn.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        {
            id: "farrels-mantle-unblocked",
            oracleText:
                "Whenever enchanted creature attacks and isn't blocked, its controller may have it deal damage equal to its power plus 2 to another target creature. If that player does, the attacking creature assigns no combat damage this turn.",
            event: "ATTACKER_UNBLOCKED",
            matches: (event, self) =>
                event.type === "ATTACKER_UNBLOCKED" &&
                self.attachedTo !== undefined &&
                event.attackerId === self.attachedTo,
            resolve: (ctx, event) => {
                if (event.type !== "ATTACKER_UNBLOCKED") return;
                const attackerId = event.attackerId;
                const attacker = { type: "permanent" as const, id: attackerId };
                const controllerId = ctx.getController(attacker);
                if (controllerId === undefined) return;
                // CR 603.3d — "another target creature": every creature except
                // the attacking creature itself.
                const candidates = ctx.allPlayerIds
                    .flatMap((p) =>
                        ctx.getBattlefieldIds(p, { types: "Creature" })
                    )
                    .filter((id) => id !== attackerId);
                if (candidates.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: controllerId,
                    choiceId: `farrels-mantle-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    allControllers: true,
                    candidateIds: candidates,
                    count: { min: 0, max: 1 },
                    prompt: "Farrel's Mantle: deal damage to another target creature? (decline to assign normal combat damage)",
                });
                if (picks === undefined) return; // suspended
                const targetId = picks[0];
                if (!targetId) return; // declined — combat damage assigned normally
                const power = ctx.getPower(attacker) ?? 0;
                ctx.dealDamage({ type: "permanent", id: targetId }, power + 2);
                // CR 510.1c — "the attacking creature assigns no combat damage
                // this turn."
                ctx.markAssignsNoCombatDamage(attacker);
            },
        },
    ],
};

// --- Farrel's Zealot ({1}{W}{W} 2/2 Human) ------------------------------------
// "Whenever this creature attacks and isn't blocked, you may have it deal 3
// damage to target creature. If you do, this creature assigns no combat damage
// this turn." (Same shape as Farrel's Mantle but self-scoped and a fixed 3.)
export const farrelsZealot: CardDefinition = {
    id: "0401bd23-9f81-40b7-a6c2-e3f9847d175c", // FEM 3a
    rarity: "common",
    name: "Farrel's Zealot",
    oracleText:
        "Whenever this creature attacks and isn't blocked, you may have it deal 3 damage to target creature. If you do, this creature assigns no combat damage this turn.",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "farrels-zealot-unblocked",
            oracleText:
                "Whenever this creature attacks and isn't blocked, you may have it deal 3 damage to target creature. If you do, this creature assigns no combat damage this turn.",
            event: "ATTACKER_UNBLOCKED",
            matches: (event, self) =>
                event.type === "ATTACKER_UNBLOCKED" &&
                event.attackerId === self.id,
            resolve: (ctx) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                const candidates = ctx.allPlayerIds.flatMap((p) =>
                    ctx.getBattlefieldIds(p, { types: "Creature" })
                );
                if (candidates.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `farrels-zealot-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    allControllers: true,
                    candidateIds: candidates,
                    count: { min: 0, max: 1 },
                    prompt: "Farrel's Zealot: deal 3 damage to target creature? (decline to assign normal combat damage)",
                });
                if (picks === undefined) return; // suspended
                const targetId = picks[0];
                if (!targetId) return; // declined
                ctx.dealDamage({ type: "permanent", id: targetId }, 3);
                ctx.markAssignsNoCombatDamage(self);
            },
        },
    ],
};

export const farrelsZealotFemB: CardPrint = {
    printId: "9e3aeee7-975c-419a-bfb3-45bb48ba6918", // FEM 3b
    definitionId: farrelsZealot.id,
    setCode: "fem",
    rarity: "common",
};
export const farrelsZealotFemC: CardPrint = {
    printId: "54252fd2-21a6-40d1-8515-697f18c78a06", // FEM 3c
    definitionId: farrelsZealot.id,
    setCode: "fem",
    rarity: "common",
};

// --- Farrelite Priest ({1}{W}{W} 1/3 Human Cleric) ----------------------------
// "{1}: Add {W}. If this ability has been activated four or more times this
// turn, sacrifice this creature at the beginning of the next end step."
// CAPABILITY G: a NON-tap repeatable mana ability (CR 605.1a) — resolved via
// `activateManaAbility`, which records the per-turn `activationsThisTurn` count
// before running this `resolve`. `getActivationCount` therefore includes the
// current activation (CR 602.5); on the 4th+ a delayed end-step self-sacrifice
// is scheduled (CR 603.7a, Dragon Whelp pattern). Each activation past the 3rd
// schedules a separate trigger; later ones are no-ops once the creature is gone.
const FARRELITE_PRIEST_ID = "e11bf79b-a951-4d0c-acdf-d8ba5290a648"; // FEM 4
export const farrelitePriest: CardDefinition = {
    id: FARRELITE_PRIEST_ID,
    rarity: "common",
    name: "Farrelite Priest",
    oracleText:
        "{1}: Add {W}. If this ability has been activated four or more times this turn, sacrifice this creature at the beginning of the next end step.",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 3,
    activatedAbilities: [
        {
            id: "farrelite-priest-mana",
            oracleText:
                "{1}: Add {W}. If this ability has been activated four or more times this turn, sacrifice this creature at the beginning of the next end step.",
            cost: { mana: { X: 1 } },
            // CR 605.1a — this adds mana and isn't a tap ability: it's a mana
            // ability (does NOT use the stack) but is repeatable (no {T}).
            useStack: false,
            manaProduced: { W: 1 },
            resolve: (ctx: SpellContext) => {
                ctx.addMana({ W: 1 });
                // CR 602.5 — count includes the current activation (recorded
                // before resolve runs).
                const count = ctx.getActivationCount("farrelite-priest-mana");
                if (count >= 4) {
                    ctx.scheduleDelayedTrigger(
                        FARRELITE_PRIEST_ID,
                        "farrelite-priest-sacrifice",
                        "next-end-step",
                        { targetId: ctx.sourceInstanceId }
                    );
                }
            },
        },
    ],
    delayedTriggers: [
        {
            id: "farrelite-priest-sacrifice",
            oracleText:
                "Sacrifice Farrelite Priest at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const targetId = payload.targetId;
                if (!targetId) return;
                ctx.sacrifice(targetId);
            },
        },
    ],
};

// --- Hand of Justice ({5}{W} 2/6 Avatar) --------------------------------------
// "{T}, Tap three untapped white creatures you control: Destroy target
// creature." CAPABILITY D: the `tapOtherFilter` activation cost (CR 602.1 /
// 118.8) taps three OTHER untapped white creatures (the source pays its own {T}
// separately). Enforced for legality and consumed on activation.
export const handOfJustice: CardDefinition = {
    id: "7a899b2d-825c-4929-a769-f4df70bf6a17", // FEM 5
    rarity: "rare",
    name: "Hand of Justice",
    oracleText:
        "{T}, Tap three untapped white creatures you control: Destroy target creature.",
    manaCost: { X: 5, W: 1 },
    types: ["Creature"],
    subtypes: ["Avatar"],
    power: 2,
    toughness: 6,
    activatedAbilities: [
        {
            id: "hand-of-justice-destroy",
            oracleText:
                "{T}, Tap three untapped white creatures you control: Destroy target creature.",
            cost: {
                tap: true,
                tapOtherFilter: {
                    filter: {
                        types: "Creature",
                        colors: "W",
                        controllerRelation: "you",
                    },
                    count: 3,
                },
            },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.destroy(target);
            },
        },
    ],
};

// --- Heroism ({2}{W} Enchantment) ---------------------------------------------
// "Sacrifice a white creature: For each attacking red creature, prevent all
// combat damage that would be dealt by that creature this turn unless its
// controller pays {2}{R}." CR 615 prevention scoped per attacking red creature,
// each gated by a `requestMayPay({2}{R})` to that creature's controller; an
// unpaid creature is marked to assign no combat damage this turn (CR 510.1c).
export const heroism: CardDefinition = {
    id: "08ee87a0-a7eb-4472-9045-85d11e8a1501", // FEM 6
    rarity: "common",
    name: "Heroism",
    oracleText:
        "Sacrifice a white creature: For each attacking red creature, prevent all combat damage that would be dealt by that creature this turn unless its controller pays {2}{R}.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "heroism-prevent",
            oracleText:
                "Sacrifice a white creature: For each attacking red creature, prevent all combat damage that would be dealt by that creature this turn unless its controller pays {2}{R}.",
            cost: {
                sacrificeFilter: {
                    types: "Creature",
                    colors: "W",
                    controllerRelation: "you",
                },
            },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 615 — for each attacking red creature, its controller may
                // pay {2}{R} to avoid the prevention; otherwise it assigns no
                // combat damage this turn.
                const attackers = ctx.allPlayerIds.flatMap((p) =>
                    ctx
                        .getBattlefieldIds(p, {
                            types: "Creature",
                            colors: "R",
                            isAttacking: true,
                        })
                        .map((id) => ({ id, owner: p }))
                );
                for (const { id, owner } of attackers) {
                    const paid = ctx.requestMayPay({
                        playerId: owner,
                        choiceId: `heroism-${ctx.sourceInstanceId}-${id}`,
                        cost: { X: 2, R: 1 },
                        prompt: "Heroism: pay {2}{R} or this attacking red creature assigns no combat damage this turn.",
                    });
                    if (paid === undefined) return; // suspended
                    if (!paid) {
                        ctx.markAssignsNoCombatDamage({
                            type: "permanent",
                            id,
                        });
                    }
                }
            },
        },
    ],
};

// --- Icatian Infantry ({W} 1/1 Human Soldier) ---------------------------------
// "{1}: This creature gains first strike until end of turn.\n{1}: This creature
// gains banding until end of turn." (CR 611.1b layer-6 keyword grants scoped to
// end of turn; banding is CR 702.22.)
export const icatianInfantry: CardDefinition = {
    id: "f95d42d8-ba75-43bf-81b8-b02374f03e83", // FEM 7a
    rarity: "common",
    name: "Icatian Infantry",
    oracleText:
        "{1}: This creature gains first strike until end of turn.\n{1}: This creature gains banding until end of turn.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "icatian-infantry-first-strike",
            oracleText:
                "{1}: This creature gains first strike until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantStaticAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "first strike",
                    { phase: "end-of-turn" }
                );
            },
        },
        {
            id: "icatian-infantry-banding",
            oracleText: "{1}: This creature gains banding until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantStaticAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "banding",
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

export const icatianInfantryFemB: CardPrint = {
    printId: "e0e4a9d2-ea43-46ac-8b8b-00496a478103", // FEM 7b
    definitionId: icatianInfantry.id,
    setCode: "fem",
    rarity: "common",
};
export const icatianInfantryFemC: CardPrint = {
    printId: "efac583d-a492-45ee-8c52-60a6422b2168", // FEM 7c
    definitionId: icatianInfantry.id,
    setCode: "fem",
    rarity: "common",
};
export const icatianInfantryFemD: CardPrint = {
    printId: "96b2a8d4-7c06-454c-9923-553294aada4f", // FEM 7d
    definitionId: icatianInfantry.id,
    setCode: "fem",
    rarity: "common",
};

// --- Icatian Javelineers ({W} 1/1 Human Soldier) ------------------------------
// "This creature enters with a javelin counter on it.\n{T}, Remove a javelin
// counter from this creature: It deals 1 damage to any target." (CR 122
// entersWith; CR 602.1 removeCounter cost; CR 119 damage.)
export const icatianJavelineers: CardDefinition = {
    id: "f04b8356-2384-4743-80dd-f15ca7ec65f7", // FEM 8a
    rarity: "common",
    name: "Icatian Javelineers",
    oracleText:
        "This creature enters with a javelin counter on it.\n{T}, Remove a javelin counter from this creature: It deals 1 damage to any target.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 1,
    entersWith: { counters: [{ type: "javelin", count: 1 }] },
    activatedAbilities: [
        {
            id: "icatian-javelineers-throw",
            oracleText:
                "{T}, Remove a javelin counter from this creature: It deals 1 damage to any target.",
            cost: {
                tap: true,
                removeCounter: { type: "javelin", count: 1 },
            },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.dealDamage(target, 1);
            },
        },
    ],
};

export const icatianJavelineersFemB: CardPrint = {
    printId: "c70f8f50-866a-4889-b986-48636225638a", // FEM 8b
    definitionId: icatianJavelineers.id,
    setCode: "fem",
    rarity: "common",
};
export const icatianJavelineersFemC: CardPrint = {
    printId: "2be5ab7a-e7db-4c09-8df2-6fe55fa4a116", // FEM 8c
    definitionId: icatianJavelineers.id,
    setCode: "fem",
    rarity: "common",
};

// --- Icatian Lieutenant ({W}{W} 1/2 Human Soldier) ----------------------------
// "{1}{W}: Target Soldier creature gets +1/+0 until end of turn." (CR 611 layer
// 7c temporary buff on a Soldier-subtype target.)
export const icatianLieutenant: CardDefinition = {
    id: "39fec59a-4ade-4c6f-ae7d-911fbe6da26d", // FEM 9
    rarity: "uncommon",
    name: "Icatian Lieutenant",
    oracleText: "{1}{W}: Target Soldier creature gets +1/+0 until end of turn.",
    manaCost: { W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "icatian-lieutenant-pump",
            oracleText:
                "{1}{W}: Target Soldier creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 1, W: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Soldier",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.addTemporaryPTBuff(target, 1, 0, { phase: "end-of-turn" });
            },
        },
    ],
};

// --- Icatian Moneychanger ({W} 0/2 Human) -------------------------------------
// "This creature enters with three credit counters on it.\nWhen this creature
// enters, it deals 3 damage to you.\nAt the beginning of your upkeep, put a
// credit counter on this creature.\nSacrifice this creature: You gain 1 life for
// each credit counter on this creature. Activate only during your upkeep."
export const icatianMoneychanger: CardDefinition = {
    id: "b3d502d4-4a96-47b3-ae26-8b2c9f36623d", // FEM 10a
    rarity: "common",
    name: "Icatian Moneychanger",
    oracleText:
        "This creature enters with three credit counters on it.\nWhen this creature enters, it deals 3 damage to you.\nAt the beginning of your upkeep, put a credit counter on this creature.\nSacrifice this creature: You gain 1 life for each credit counter on this creature. Activate only during your upkeep.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 0,
    toughness: 2,
    entersWith: { counters: [{ type: "credit", count: 3 }] },
    triggeredAbilities: [
        enteredTrigger({
            id: "icatian-moneychanger-etb-damage",
            oracleText: "When this creature enters, it deals 3 damage to you.",
            scope: "self",
            resolve: (ctx) => {
                ctx.dealDamage({ type: "player", id: ctx.controller }, 3);
            },
        }),
        phaseTrigger({
            id: "icatian-moneychanger-upkeep-counter",
            oracleText:
                "At the beginning of your upkeep, put a credit counter on this creature.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "credit",
                    1
                );
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "icatian-moneychanger-cash-out",
            oracleText:
                "Sacrifice this creature: You gain 1 life for each credit counter on this creature. Activate only during your upkeep.",
            cost: { sacrifice: true },
            useStack: true,
            controllerTurnOnly: true,
            activationPhaseRestriction: ["UPKEEP"],
            resolve: (ctx: SpellContext) => {
                // Read the counter count from the source BEFORE the sacrifice
                // cost removes it (the cost is paid at activation, so by resolve
                // the permanent is gone — read via last-known is unavailable, so
                // the ability records nothing extra: count is captured here from
                // the resolving stack item's snapshot of counters).
                const count = ctx.getCounterCount(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "credit"
                );
                if (count > 0) ctx.gainLife(ctx.controller, count);
            },
        },
    ],
};

export const icatianMoneychangerFemB: CardPrint = {
    printId: "cbf9194c-8e50-4f50-9a87-3b339a5bc279", // FEM 10b
    definitionId: icatianMoneychanger.id,
    setCode: "fem",
    rarity: "common",
};
export const icatianMoneychangerFemC: CardPrint = {
    printId: "cf9521ae-6fac-4d86-9c60-adecaae5687d", // FEM 10c
    definitionId: icatianMoneychanger.id,
    setCode: "fem",
    rarity: "common",
};

// --- Icatian Phalanx ({4}{W} 2/4 Human Soldier) -------------------------------
// "Banding" (CR 702.22) — pure data plus the banding keyword.
export const icatianPhalanx: CardDefinition = {
    id: "7bc02d30-3eef-4a48-8b11-b4f37219ab3a", // FEM 11
    rarity: "uncommon",
    name: "Icatian Phalanx",
    oracleText:
        "Banding (Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a group. If any creatures with banding you control are blocking or being blocked by a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking.)",
    manaCost: { X: 4, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 2,
    toughness: 4,
    staticAbilities: ["banding"],
};

// --- Icatian Priest ({W} 1/1 Human Cleric) ------------------------------------
// "{1}{W}{W}: Target creature gets +1/+1 until end of turn." (CR 611 layer 7c.)
export const icatianPriest: CardDefinition = {
    id: "d7690cdd-6610-4310-9e93-60dc4db2ae8d", // FEM 12
    rarity: "uncommon",
    name: "Icatian Priest",
    oracleText: "{1}{W}{W}: Target creature gets +1/+1 until end of turn.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "icatian-priest-pump",
            oracleText:
                "{1}{W}{W}: Target creature gets +1/+1 until end of turn.",
            cost: { mana: { X: 1, W: 2 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.addTemporaryPTBuff(target, 1, 1, { phase: "end-of-turn" });
            },
        },
    ],
};

// --- Icatian Scout ({W} 1/1 Human Soldier Scout) ------------------------------
// "{1}, {T}: Target creature gains first strike until end of turn." (CR 611.1b
// layer-6 keyword grant.)
export const icatianScout: CardDefinition = {
    id: "86bf4aaa-a9b1-4798-a96b-c3e35afb77f7", // FEM 13a
    rarity: "common",
    name: "Icatian Scout",
    oracleText:
        "{1}, {T}: Target creature gains first strike until end of turn.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier", "Scout"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "icatian-scout-first-strike",
            oracleText:
                "{1}, {T}: Target creature gains first strike until end of turn.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.grantStaticAbility(target, "first strike", {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};

export const icatianScoutFemB: CardPrint = {
    printId: "e9db3442-01cb-4db2-ac33-8eca6880c315", // FEM 13b
    definitionId: icatianScout.id,
    setCode: "fem",
    rarity: "common",
};
export const icatianScoutFemC: CardPrint = {
    printId: "6c461655-a05d-4eed-85b2-04d554f5ec50", // FEM 13c
    definitionId: icatianScout.id,
    setCode: "fem",
    rarity: "common",
};
export const icatianScoutFemD: CardPrint = {
    printId: "db63ad7f-6dc4-4249-b360-46ec5569a5a9", // FEM 13d
    definitionId: icatianScout.id,
    setCode: "fem",
    rarity: "common",
};

// --- Icatian Skirmishers ({3}{W} 1/1 Human Soldier) ---------------------------
// "First strike; banding\nWhenever this creature attacks, all creatures banded
// with it gain first strike until end of turn." The banded-creatures grant on
// attack is deferred (the engine has no per-band membership query exposed to
// card bodies); the static first strike + banding keywords are the load-bearing
// behaviour and are implemented.
export const icatianSkirmishers: CardDefinition = {
    id: "15f6d115-c02d-45a3-aa6d-402964df47dd", // FEM 14
    rarity: "uncommon",
    name: "Icatian Skirmishers",
    oracleText:
        "First strike; banding (Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a group. If any creatures with banding you control are blocking or being blocked by a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking.)\nWhenever this creature attacks, all creatures banded with it gain first strike until end of turn.",
    manaCost: { X: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 1,
    staticAbilities: ["first strike", "banding"],
};

// --- Icatian Town ({5}{W} Sorcery) --------------------------------------------
// "Create four 1/1 white Citizen creature tokens." (CR 707.2 token creation.)
export const icatianTown: CardDefinition = {
    id: "cbb7c28d-0366-4d01-84a2-f1bc9f38aa4a", // FEM 15
    rarity: "uncommon",
    name: "Icatian Town",
    oracleText: "Create four 1/1 white Citizen creature tokens.",
    manaCost: { X: 5, W: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.createToken(
            {
                name: "Citizen",
                types: ["Creature"],
                subtypes: ["Citizen"],
                power: 1,
                toughness: 1,
                colors: ["W"],
            },
            ctx.controller,
            4
        );
    },
};

// --- Order of Leitbur ({W}{W} 2/1 Human Cleric Knight) ------------------------
// "Protection from black\n{W}: This creature gains first strike until end of
// turn.\n{W}{W}: This creature gets +1/+0 until end of turn." (CR 702.16
// protection; CR 611 keyword grant + 7c buff.)
export const orderOfLeitbur: CardDefinition = {
    id: "ebd6e51e-f042-4673-a898-291607105829", // FEM 16a
    rarity: "uncommon",
    name: "Order of Leitbur",
    oracleText:
        "Protection from black\n{W}: This creature gains first strike until end of turn.\n{W}{W}: This creature gets +1/+0 until end of turn.",
    manaCost: { W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric", "Knight"],
    power: 2,
    toughness: 1,
    staticAbilities: ["protection from black"],
    activatedAbilities: [
        {
            id: "order-of-leitbur-first-strike",
            oracleText:
                "{W}: This creature gains first strike until end of turn.",
            cost: { mana: { W: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantStaticAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "first strike",
                    { phase: "end-of-turn" }
                );
            },
        },
        {
            id: "order-of-leitbur-pump",
            oracleText: "{W}{W}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { W: 2 } },
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

export const orderOfLeitburFemB: CardPrint = {
    printId: "fb537b5a-d725-420d-bc15-0d54ba23331c", // FEM 16b
    definitionId: orderOfLeitbur.id,
    setCode: "fem",
    rarity: "uncommon",
};
export const orderOfLeitburFemC: CardPrint = {
    printId: "1373dea4-3565-4612-8505-ab8fba3ddb67", // FEM 16c
    definitionId: orderOfLeitbur.id,
    setCode: "fem",
    rarity: "uncommon",
};
