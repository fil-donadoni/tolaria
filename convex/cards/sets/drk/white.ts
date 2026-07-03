// The Dark (DRK), split by colour per ADR 0043. The expansion after Legends
// (119 unique cards); every entry is a CardDefinition — The Dark has zero
// reprints of already-implemented cards, so there are no CardPrint stubs
// (ADR 0014). Modern Scryfall oracle text is authoritative (ADR 0004);
// canonical names / costs / P/T are sourced from MTGJSON `data/json/DRK.json`.
// Generic mana is encoded as `X: n` (e.g. {2}{R} → { X: 2, R: 1 }). Cards are
// classified by the colour identity of their mana cost (CR 202.2); lands and
// artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, SpellContext } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { drawTrigger } from "../../abilities/triggers/drawTrigger";

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla creatures (CR 302 — Creature cards with no rules text are pure data:
// types/subtypes + P/T only; they resolve from the stack onto the battlefield
// via the generic permanent-resolution path, CR 608.3).
// ─────────────────────────────────────────────────────────────────────────────

export const squire: CardDefinition = {
    id: "374df061-ebd2-4f1f-9a6e-7940a49197a9",
    rarity: "common",
    name: "Squire",
    oracleText: "",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 2,
};

// ─────────────────────────────────────────────────────────────────────────────
// Keyword creatures (CR 702 — keywords map to `staticAbilities[]`; combat /
// rules tests exercise them generically, so a definition snapshot suffices).
// ─────────────────────────────────────────────────────────────────────────────

// Knights of Thorn — Protection from red (CR 702.16) + banding (CR 702.22).
// Both are plain keywords already shipped; the banding engine (block-as-a-group
// + attacker damage division) was built for the LEG banding cycle.
export const knightsOfThorn: CardDefinition = {
    id: "ae541c73-9903-49e6-997a-db4701135145",
    rarity: "rare",
    name: "Knights of Thorn",
    oracleText: "Protection from red; banding",
    manaCost: { X: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 2,
    toughness: 2,
    staticAbilities: ["protection from red", "banding"],
};

// Pikemen — First strike (CR 702.7) + banding (CR 702.22). Plain keywords.
export const pikemen: CardDefinition = {
    id: "bf2f6936-b50c-4907-9b55-ebf8a3fba8f5",
    rarity: "common",
    name: "Pikemen",
    oracleText: "First strike; banding",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 1,
    staticAbilities: ["first strike", "banding"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Characteristic-defining P/T (CR 604.3, layer 7a) — Angry Mob
// ─────────────────────────────────────────────────────────────────────────────

// Angry Mob — "During your turn, ~'s power and toughness are each equal to 2
// plus the number of Swamps your opponents control. During turns other than
// yours, ~'s power and toughness are each 2." (CR 604.3 CDA, layer 7a board
// read; CR 102.1 turn ownership.) Base is 0/0 with the CDA supplying the whole
// body so the "2 plus N" / "2" arithmetic lives in one place. The CDA reads
// `state.activePlayerId` (a top-level GameState field that survives the wire
// projection) to gate the opponents'-Swamp bonus on whose turn it is.
export const angryMob: CardDefinition = {
    id: "9e14db1c-0a05-47d2-9f27-df881f7f37ab",
    rarity: "uncommon",
    name: "Angry Mob",
    oracleText:
        "Trample\nDuring your turn, Angry Mob's power and toughness are each equal to 2 plus the number of Swamps your opponents control. During turns other than yours, Angry Mob's power and toughness are each 2.",
    manaCost: { X: 2, W: 2 },
    types: ["Creature"],
    subtypes: ["Human"],
    // Base 0/0; the CDA supplies the full P/T (CR 604.3 sets, not adds, here —
    // expressed as base 0 + the computed total).
    power: 0,
    toughness: 0,
    staticAbilities: ["trample"],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: (target, source) => target.id === source.id,
            compute: (source, state) => {
                const isControllersTurn =
                    state.activePlayerId === source.controllerId;
                if (!isControllersTurn) return { power: 2, toughness: 2 };
                const swamps = state.players
                    .flatMap((pl) => pl.battlefield)
                    .filter(
                        (c) =>
                            c.controllerId !== source.controllerId &&
                            c.subtypes.includes("Swamp")
                    ).length;
                return { power: 2 + swamps, toughness: 2 + swamps };
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Activated-ability creatures (CR 605)
// ─────────────────────────────────────────────────────────────────────────────

// Exorcist — "{1}{W}, {T}: Destroy target black creature." (CR 605 activated
// ability; CR 202.2 colour filter; CR 701.7 destroy.)
export const exorcist: CardDefinition = {
    id: "184b7d52-e991-4668-9f6a-bcded97f51ac",
    rarity: "rare",
    name: "Exorcist",
    oracleText: "{1}{W}, {T}: Destroy target black creature.",
    manaCost: { W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "exorcist-destroy-black",
            oracleText: "{1}{W}, {T}: Destroy target black creature.",
            cost: { mana: { X: 1, W: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                colorFilter: "B",
                count: 1,
            },
            // Migrated resolve()→effects[] (ADR 0045, #832): destroy the
            // announced target black creature (CR 701.8).
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

// Miracle Worker — "{T}: Destroy target Aura attached to a creature you
// control." (CR 605 activated ability; CR 701.7 destroy.) `subtypeFilter` scopes
// targets to Auras; the "attached to a creature you control" constraint is
// enforced in the resolve body (mirrors Pyramids' "Aura attached to a land",
// which likewise checks the host post-target — there is no host-relation field
// on TargetRequirement).
export const miracleWorker: CardDefinition = {
    id: "35d29bda-096c-44d4-b45e-c2c507f8efbe",
    rarity: "common",
    name: "Miracle Worker",
    oracleText: "{T}: Destroy target Aura attached to a creature you control.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "miracle-worker-destroy-aura",
            oracleText:
                "{T}: Destroy target Aura attached to a creature you control.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Enchantment",
                subtypeFilter: "Aura",
                count: 1,
            },
            // NOT DSL-migratable (ADR 0045): the destroy is gated on the target
            // Aura's host being controlled by the controller (getAttachedTo +
            // getController), a host-relation predicate the destroy Op can't
            // express. Stays resolve().
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (!target || target.type !== "permanent") return;
                // CR 701.7 — only destroy if the Aura's host is a permanent this
                // player controls. `getAttachedTo` reads the Aura's host id; a
                // creature host is the only legal attachment for the Auras in
                // pool, so the operative constraint is the host's controller.
                const hostId = ctx.getAttachedTo(target.id);
                if (hostId === undefined) return;
                const host = { type: "permanent" as const, id: hostId };
                if (ctx.getController(host) === ctx.controller) {
                    ctx.destroy(target);
                }
            },
        },
    ],
};

// Witch Hunter — two activated abilities (CR 605): a {T} ping to a player and a
// {1}{W}{W}, {T} bounce of an opponent's creature (CR 701.10). Planeswalkers are
// out of scope, so the first ability targets `player` only.
export const witchHunter: CardDefinition = {
    id: "4eef9bb7-cd3c-422e-a93b-90d98684675a",
    rarity: "rare",
    name: "Witch Hunter",
    oracleText:
        "{T}: This creature deals 1 damage to target player or planeswalker.\n{1}{W}{W}, {T}: Return target creature an opponent controls to its owner's hand.",
    manaCost: { X: 2, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "witch-hunter-ping",
            oracleText:
                "{T}: This creature deals 1 damage to target player or planeswalker.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #832): 1 damage to the
            // announced target player (CR 120).
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
        {
            id: "witch-hunter-bounce",
            oracleText:
                "{1}{W}{W}, {T}: Return target creature an opponent controls to its owner's hand.",
            cost: { mana: { X: 1, W: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                controller: "opponent",
                count: 1,
            },
            // Migrated resolve()→effects[] (ADR 0045, #839): return the
            // targeted opponent-controlled creature to its owner's hand
            // (CR 701.10 / 400.7).
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
    ],
};

// Preacher — "You may choose not to untap this creature during your untap
// step.\n{T}: For as long as this creature remains tapped, gain control of
// target creature of an opponent's choice they control." (CR 605 activated
// ability; CR 611.2b conditional control gain.) The activating player targets an
// opponent (a player); on resolution that opponent chooses which of their
// creatures is taken, and control is held under the `source-tapped` condition —
// reverting the instant Preacher untaps or leaves (checkConditionalControlChanges
// SBA). The optional-untap clause is the shipped `may-choose-not-to-untap`
// static so the controller can keep Preacher tapped to hold the stolen creature.
export const preacher: CardDefinition = {
    id: "1e03d335-d259-4ab4-814f-9333cfd3afc9",
    rarity: "rare",
    name: "Preacher",
    oracleText:
        "You may choose not to untap this creature during your untap step.\n{T}: For as long as this creature remains tapped, gain control of target creature of an opponent's choice they control.",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 1,
    staticAbilities: ["may-choose-not-to-untap"],
    activatedAbilities: [
        {
            id: "preacher-steal",
            oracleText:
                "{T}: For as long as this creature remains tapped, gain control of target creature of an opponent's choice they control.",
            cost: { tap: true },
            useStack: true,
            // Target an opponent (CR 115.4 player target); that opponent picks
            // the creature at resolution (CR 601.3e "of an opponent's choice").
            targetRequirement: {
                type: "player",
                controller: "opponent",
                count: 1,
            },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (!target || target.type !== "player") return;
                const opponentId = target.id;
                const creatureIds = ctx.getBattlefieldIds(opponentId, {
                    types: "Creature",
                });
                if (creatureIds.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: opponentId,
                    choiceId: `preacher-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    zoneOwnerId: opponentId,
                    filter: { types: "Creature" },
                    count: 1,
                    prompt: "Preacher: choose a creature your opponent gains control of.",
                });
                if (picks === undefined) return; // suspended
                const chosenId = picks[0];
                if (!chosenId) return;
                ctx.gainControl(
                    { type: "permanent", id: chosenId },
                    ctx.controller,
                    { kind: "source-tapped" }
                );
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Spells (CR 601 / 608)
// ─────────────────────────────────────────────────────────────────────────────

// Dust to Dust — "Exile two target artifacts." (CR 701.18 exile; two distinct
// permanent targets, CR 601.2c.)
export const dustToDust: CardDefinition = {
    id: "ade075fd-73ee-4d12-a2da-48e5938043af",
    rarity: "common",
    name: "Dust to Dust",
    oracleText: "Exile two target artifacts.",
    manaCost: { X: 1, W: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "Artifact", count: 2 },
    // Migrated resolve()→effects[] (ADR 0045, #832): exile both announced
    // target artifacts (CR 701.13).
    effects: [
        { op: "exile", target: { target: 0 } },
        { op: "exile", target: { target: 1 } },
    ],
};

// Tivadar's Crusade — "Destroy all Goblins." (CR 701.7 mass destroy filtered on
// the Goblin creature subtype, CR 205.3.)
export const tivadarsCrusade: CardDefinition = {
    id: "8b6da540-6803-47e5-9af0-7ae8e2f84b6c",
    rarity: "uncommon",
    name: "Tivadar's Crusade",
    oracleText: "Destroy all Goblins.",
    manaCost: { X: 1, W: 2 },
    types: ["Sorcery"],
    // Migrated resolve()→effects[] (ADR 0045, #832): destroyAll(Goblins) →
    // forEach over every battlefield's Goblin creatures, destroy each (CR 701.8).
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature", subtype: "Goblin" },
            },
            effects: [{ op: "destroy", target: { ref: "$each" } }],
        },
    ],
};

// Holy Light — "Nonwhite creatures get -1/-1 until end of turn." (CR 611.2
// temporary P/T mod on a filtered set; CR 202.2 colour.) Computed as "all
// creatures" minus "white creatures" because PermanentFilter has no negative
// colour selector.
export const holyLight: CardDefinition = {
    id: "c3c8a850-bc99-4679-a316-45ecdea696b2",
    rarity: "common",
    name: "Holy Light",
    oracleText: "Nonwhite creatures get -1/-1 until end of turn.",
    manaCost: { X: 2, W: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        for (const pid of ctx.allPlayerIds) {
            const allCreatures = new Set(
                ctx.getBattlefieldIds(pid, { types: "Creature" })
            );
            const whiteCreatures = ctx.getBattlefieldIds(pid, {
                types: "Creature",
                colors: "W",
            });
            for (const w of whiteCreatures) allCreatures.delete(w);
            for (const id of allCreatures) {
                ctx.addTemporaryPTBuff({ type: "permanent", id }, -1, -1, {
                    phase: "end-of-turn",
                });
            }
        }
    },
};

// Morale — "Attacking creatures get +1/+1 until end of turn." (CR 611.2 combat
// pump; the shipped `pump-combat` declarative effect, side "attacking".)
export const morale: CardDefinition = {
    id: "c4104546-abd9-4bfb-a65e-5928cdd4522f",
    rarity: "common",
    name: "Morale",
    oracleText: "Attacking creatures get +1/+1 until end of turn.",
    manaCost: { X: 1, W: 2 },
    types: ["Instant"],
    effect: { kind: "pump-combat", side: "attacking", power: 1, toughness: 1 },
};

// Martyr's Cry — "Exile all white creatures. For each creature exiled this way,
// its controller draws a card." (CR 701.18 exile + CR 121.1 draw; snapshot the
// per-controller count before exiling so the draws reflect what was removed.)
export const martyrsCry: CardDefinition = {
    id: "e2c9f463-d1cc-4f11-aad2-d4a4520aa978",
    rarity: "rare",
    name: "Martyr's Cry",
    oracleText:
        "Exile all white creatures. For each creature exiled this way, its controller draws a card.",
    manaCost: { W: 2 },
    types: ["Sorcery"],
    // NOT DSL-migratable (ADR 0045): "all white creatures" needs a colour
    // filter (EffectCardFilter is type/subtype only), and the per-controller
    // draw count is a snapshot the value grammar can't express. Stays resolve().
    resolve: (ctx: SpellContext) => {
        // Snapshot per-controller white creatures first (CR 608.2g — the count
        // is fixed by what is exiled, not by post-exile board state).
        const exiledByController: Record<string, number> = {};
        for (const pid of ctx.allPlayerIds) {
            const whites = ctx.getBattlefieldIds(pid, {
                types: "Creature",
                colors: "W",
            });
            for (const id of whites) {
                ctx.exile({ type: "permanent", id });
                exiledByController[pid] = (exiledByController[pid] ?? 0) + 1;
            }
        }
        for (const pid of ctx.allPlayerIds) {
            const n = exiledByController[pid] ?? 0;
            if (n > 0) ctx.drawCards(pid, n);
        }
    },
};

// Fire and Brimstone — "~ deals 4 damage to target player who attacked this
// turn and 4 damage to you." (CR 506.2 "attacked this turn" player filter; CR
// 119 damage.) The target filter is enforced by getLegalTargets / selectTarget
// via `playerAttackedThisTurn`.
export const fireAndBrimstone: CardDefinition = {
    id: "d5208dbb-63d2-4789-8ef9-f82499a43b3a",
    rarity: "uncommon",
    name: "Fire and Brimstone",
    oracleText:
        "Fire and Brimstone deals 4 damage to target player who attacked this turn and 4 damage to you.",
    manaCost: { X: 3, W: 2 },
    types: ["Instant"],
    targetRequirement: {
        type: "player",
        count: 1,
        playerAttackedThisTurn: true,
    },
    // Migrated resolve()→effects[] (ADR 0045, #832): 4 damage to the announced
    // target player, then 4 to the controller (CR 120).
    effects: [
        { op: "dealDamage", amount: 4, to: { target: 0 } },
        { op: "dealDamage", amount: 4, to: { player: "controller" } },
    ],
};

// Fasting — DRK C7 skip-draw-step enchantment. Modern Scryfall oracle text
// (ADR 0004) — the printed Alpha/DRK wording ("draw phase") is superseded:
//   1. "At the beginning of your upkeep, put a hunger counter on this
//      enchantment. Then destroy this enchantment if it has five or more hunger
//      counters on it." — CR 603.6a upkeep trigger + CR 122 counters; the
//      destroy is part of the same trigger resolution, gated on the count.
//   2. "If you would begin your draw step, you may skip that step instead. If
//      you do, you gain 2 life." — CR 504 / 614 draw-step skip. Reuses the
//      Island Sanctuary precedent: `drawStepReplacement: true` suppresses the
//      turn-based draw, and a DRAW phaseTrigger offers the may-skip choice via
//      `requestMayPay` (no cost). Decline draws the card normally.
//   3. "When you draw a card, destroy this enchantment." — CR 121.1 draw event
//      trigger via the new `drawTrigger` factory (CARD_DRAWN). Fires on ANY
//      draw the controller makes (the natural draw if they decline the skip,
//      or any effect-driven draw), then destroys Fasting.
export const fasting: CardDefinition = {
    id: "8da35f9f-e72c-4154-a212-7de98f84ad7d",
    rarity: "uncommon",
    name: "Fasting",
    oracleText:
        "At the beginning of your upkeep, put a hunger counter on this enchantment. Then destroy this enchantment if it has five or more hunger counters on it.\nIf you would begin your draw step, you may skip that step instead. If you do, you gain 2 life.\nWhen you draw a card, destroy this enchantment.",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    // CR 504 — suppresses the automatic turn-based draw so the DRAW phaseTrigger
    // below can offer the "you may skip" choice (Island Sanctuary precedent).
    drawStepReplacement: true,
    triggeredAbilities: [
        // 1. Upkeep hunger-counter accrual + destroy-at-five (CR 603.6a).
        phaseTrigger({
            id: "fasting-upkeep-hunger",
            oracleText:
                "At the beginning of your upkeep, put a hunger counter on this enchantment. Then destroy this enchantment if it has five or more hunger counters on it.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): Fasting adds/reads hunger counters
            // (counters Op, still `planned`) and destroys itself on a counter
            // threshold; its clauses are factory-built triggers with no
            // `effects[]` site. Stays resolve().
            resolve: (ctx) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                // CR 122.1 — add one hunger counter.
                ctx.addCounter(self, "hunger", 1);
                // CR 603 — "Then destroy ~ if it has five or more". Part of the
                // same resolution, gated on the fresh count.
                if (ctx.getCounterCount(self, "hunger") >= 5) {
                    ctx.destroy(self);
                }
            },
        }),
        // 2. "You may skip your draw step; if you do, gain 2 life" (CR 504/614).
        phaseTrigger({
            id: "fasting-draw-skip",
            oracleText:
                "If you would begin your draw step, you may skip that step instead. If you do, you gain 2 life.",
            phase: "DRAW",
            scope: "your",
            resolve: (ctx) => {
                const skip = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: `fasting-skip-${ctx.sourceInstanceId}`,
                    prompt: "Skip your draw step to gain 2 life? (Fasting)",
                });
                if (skip === undefined) return; // suspended for the choice
                if (skip) {
                    // CR 119.3 — gain 2 life, no card drawn.
                    ctx.gainLife(ctx.controller, 2);
                } else {
                    // Declined: take the normal draw step draw (CR 504.1). This
                    // emits CARD_DRAWN, which fires the self-destruct trigger
                    // below — exactly "if you draw a card, destroy this".
                    ctx.drawCards(ctx.controller, 1);
                }
            },
        }),
        // 3. "When you draw a card, destroy this enchantment" (CR 121.1).
        drawTrigger({
            id: "fasting-draw-destroy",
            oracleText: "When you draw a card, destroy this enchantment.",
            scope: "your",
            resolve: (ctx) => {
                ctx.destroy({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        }),
    ],
};
