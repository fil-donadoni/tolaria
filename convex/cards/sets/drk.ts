// The Dark (DRK) — the next chronological expansion after Legends (119 unique
// cards). This file follows the established set-file pattern (ADR 0014): every
// in-scope card is a new `CardDefinition`. The Dark has zero reprints of
// already-implemented cards, so the file is effectively 100% new definitions,
// mirroring `leg.ts` / `arn.ts`. Modern Scryfall oracle text is authoritative
// (ADR 0004); canonical names / costs / P/T are sourced from MTGJSON
// `data/json/DRK.json`.
//
// THIS slice is the walking skeleton (#410): it registers the `drk` set and
// wires one thin end-to-end tracer — three vanilla creatures (Squire,
// Goblin Hero, Scarwood Goblins) that are playable from the card pool through a
// preset scenario. It proves the set file, the registry entry, the pool/deck
// availability, projection, and the test harness all work before the bulk free
// tranche and the 9 feature clusters land (see PRD #409).
//
// Generic mana is encoded as `X: n` (e.g. {2}{R} → { X: 2, R: 1 }).

import type { CardDefinition, SpellContext } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla creatures (CR 302 — Creature cards with no rules text are pure data:
// types/subtypes + P/T only; they resolve from the stack onto the battlefield
// via the generic permanent-resolution path, CR 608.3).
// ─────────────────────────────────────────────────────────────────────────────

export const squire: CardDefinition = {
    id: "aa6cdcc7-f5ea-47bf-9448-1c63e36b18d1",
    name: "Squire",
    oracleText: "",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 2,
};

export const goblinHero: CardDefinition = {
    id: "ee969637-a20e-4163-97c0-9fd5cb17b741",
    name: "Goblin Hero",
    oracleText: "",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 2,
};

export const scarwoodGoblins: CardDefinition = {
    id: "5314e57b-107c-4478-9cdb-51d1732f9468",
    name: "Scarwood Goblins",
    oracleText: "",
    manaCost: { R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
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
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (target?.type === "permanent") ctx.destroy(target);
            },
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
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (target?.type === "player") ctx.dealDamage(target, 1);
            },
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
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (target?.type === "permanent") ctx.returnToHand(target);
            },
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
    name: "Dust to Dust",
    oracleText: "Exile two target artifacts.",
    manaCost: { X: 1, W: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "Artifact", count: 2 },
    resolve: (ctx: SpellContext) => {
        for (const target of ctx.targets) {
            if (target.type === "permanent") ctx.exile(target);
        }
    },
};

// Tivadar's Crusade — "Destroy all Goblins." (CR 701.7 mass destroy filtered on
// the Goblin creature subtype, CR 205.3.)
export const tivadarsCrusade: CardDefinition = {
    id: "8b6da540-6803-47e5-9af0-7ae8e2f84b6c",
    name: "Tivadar's Crusade",
    oracleText: "Destroy all Goblins.",
    manaCost: { X: 1, W: 2 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll({ subtypes: "Goblin" });
    },
};

// Holy Light — "Nonwhite creatures get -1/-1 until end of turn." (CR 611.2
// temporary P/T mod on a filtered set; CR 202.2 colour.) Computed as "all
// creatures" minus "white creatures" because PermanentFilter has no negative
// colour selector.
export const holyLight: CardDefinition = {
    id: "c3c8a850-bc99-4679-a316-45ecdea696b2",
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
    name: "Martyr's Cry",
    oracleText:
        "Exile all white creatures. For each creature exiled this way, its controller draws a card.",
    manaCost: { W: 2 },
    types: ["Sorcery"],
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
    resolve: (ctx: SpellContext) => {
        const [target] = ctx.targets;
        if (target?.type === "player") ctx.dealDamage(target, 4);
        ctx.dealDamage({ type: "player", id: ctx.controller }, 4);
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Deferred — these four DRK White cards each need a genuinely new engine
// capability that the free tranche does NOT ship. They are intentionally NOT
// registered yet (no exported CardDefinition) to keep the card pool honest; the
// definitions land with their mechanic. Flagged in the PR. TODO(#411):
//
//   • Brainwash (Aura) — "Enchanted creature can't attack unless its controller
//     pays {3}." Needs an ATTACK TAX (an optional mana cost to declare a
//     creature as an attacker), sourced from an aura attached to the creature.
//     The shipped `attack-restriction` static is a hard predicate, not a cost,
//     and is read only from the creature's own definition (not its auras).
//
//   • Blood of the Martyr (Instant) — "Until end of turn, if damage would be
//     dealt to any creature, you may have that damage dealt to you instead."
//     Needs a turn-wide, ANY-creature, OPTIONAL damage-redirection shield. The
//     shipped redirect shields are one-shot and bound to a specific target
//     instance; none covers "every creature, repeatedly, may-redirect".
//
//   • Festival (Instant) — "Cast this spell only during an opponent's upkeep.
//     Creatures can't attack this turn." Needs (a) a CAST-TIMING restriction
//     ("only during an opponent's upkeep" — no casting-timing mechanism exists)
//     and (b) a turn-scoped GLOBAL "creatures can't attack" flag.
//
//   • Cleansing (Sorcery) — "For each land, destroy that land unless any player
//     pays 1 life." Needs a per-land loop offering EVERY player (APNAP) the
//     option to PAY LIFE to save it. `requestMayPay` pays mana for a single
//     player; there is no life-payment option primitive and no any-player loop.
// ─────────────────────────────────────────────────────────────────────────────
