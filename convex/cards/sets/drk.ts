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

import type {
    CardDefinition,
    Color,
    ManaCost,
    PermanentView,
    SpellContext,
    StaticEffectContext,
    StaticEffectStateView,
    TargetSelection,
    TriggeredAbility,
} from "../types";
import { phaseTrigger } from "../abilities/triggers/phaseTrigger";
import { drawTrigger } from "../abilities/triggers/drawTrigger";
import { stateTrigger } from "../abilities/triggers/stateTrigger";
import { spellCastTrigger } from "../abilities/triggers/spellCastTrigger";
import { damageDealtTrigger } from "../abilities/triggers/damageDealtTrigger";
import { enteredTrigger } from "../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../abilities/triggers/leftTrigger";
import { tappedTrigger } from "../abilities/triggers/tappedTrigger";
// CR 603.6a — reuse the shipped LEG C7 "sacrifice this unless you pay [cost]"
// upkeep trigger (the Elder Dragon maintenance-cost family) for Dance of Many's
// {U}{U} upkeep clause. NOT reimplemented here.
import { payOrSacrificeUpkeepTrigger } from "./leg";

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

// ═════════════════════════════════════════════════════════════════════════════
// BLUE free tranche (#412) — 13 of the 15 DRK Blue cards. Two (Leviathan, Tangle
// Kelp) need an unbuilt engine capability and are deferred in the footer below.
// Modern Scryfall oracle text (ADR 0004); stats validated against DRK.json.
// ═════════════════════════════════════════════════════════════════════════════

/** Shared upkeep "do X unless you pay [mana]" maintenance trigger (CR 603.6a +
 *  CR 117.3a). Mirrors lea.ts's `makeUpkeepPayOrElse` (the Stasis / Phantasmal
 *  Forces helper) so Sunken City and Psychic Allergy don't repeat the body. On
 *  the controller's upkeep the controller MAY pay `cost`; declining (or being
 *  unable to pay) runs `onDecline`. */
function upkeepPayOrElse(args: {
    id: string;
    oracleText: string;
    cost: ManaCost;
    prompt: string;
    onDecline: (ctx: SpellContext) => void;
}): TriggeredAbility {
    return phaseTrigger({
        id: args.id,
        oracleText: args.oracleText,
        phase: "UPKEEP",
        scope: "your",
        resolve: (ctx) => {
            const accept = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: ctx.controller,
                cost: args.cost,
                prompt: args.prompt,
            });
            if (accept === undefined) return; // suspended for the choice
            if (!accept) args.onDecline(ctx);
        },
    });
}

/** "When you control no Islands, sacrifice ~" state trigger (CR 603.8) — the
 *  Dandân / Island Fish Jasconius clause, reused by Giant Shark. */
function sacrificeWhenNoIslands(
    id: string,
    cardName: string
): TriggeredAbility {
    return stateTrigger({
        id,
        oracleText: `When you control no Islands, sacrifice ${cardName}.`,
        condition: (self, state) => {
            const controller = state.players.find(
                (p) => p.id === self.controllerId
            );
            return !controller?.battlefield.some((c) =>
                c.subtypes.includes("Island")
            );
        },
        resolve: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
    });
}

// Amnesia — "Target player reveals their hand and discards all nonland cards."
// (CR 701.8 discard + CR 701.x reveal.) Reveals the whole hand to all players,
// then discards every card whose printed types contain no Land type. Lands are
// kept; everything else (instants, sorceries, creatures, artifacts,
// enchantments) is discarded.
export const amnesia: CardDefinition = {
    id: "fb8a5b56-7c2e-4d3a-9c41-2d80d1f4a8e1",
    name: "Amnesia",
    oracleText:
        "Target player reveals their hand and discards all nonland cards.",
    manaCost: { X: 3, U: 3 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const [target] = ctx.targets;
        if (target?.type !== "player") return;
        const playerId = target.id;
        // CR 701.x — the whole hand is revealed to all players first.
        ctx.revealHand(playerId);
        // CR 701.8 — discard every nonland card (a card is "land" iff its
        // printed types include a Land type; CR 305).
        const handCards = ctx.getHandCards(playerId);
        for (const c of handCards) {
            if (!c.types.includes("Land")) ctx.discardCard(playerId, c.id);
        }
    },
};

// Apprentice Wizard — "{U}, {T}: Add {C}{C}{C}." (CR 605.1a mana ability —
// resolves immediately, no stack, CR 605.3a.) Pays one blue to filter into
// three colorless.
export const apprenticeWizard: CardDefinition = {
    id: "c0a8d6f2-1e4b-4f7a-8b3c-9d2e5a7c1f60",
    name: "Apprentice Wizard",
    oracleText: "{U}, {T}: Add {C}{C}{C}.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 0,
    toughness: 1,
    activatedAbilities: [
        {
            id: "apprentice-wizard-mana",
            oracleText: "{U}, {T}: Add {C}{C}{C}.",
            cost: { tap: true, mana: { U: 1 } },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 3 }),
            manaProduced: { C: 3 },
        },
    ],
};

// Erosion — Aura enchant land. "At the beginning of the upkeep of enchanted
// land's controller, destroy that land unless that player pays {1} or 1 life."
// (CR 603.6a upkeep trigger scoped to the HOST's controller + CR 117.3a do-X-
// unless-you-pay with a choice of {1} OR 1 life — CR 118.4 life payment.) The
// "pay {1} or 1 life" alternatives are offered as two sequential may-pay
// prompts: mana first, then (if declined) 1 life; declining both destroys the
// land.
export const erosion: CardDefinition = {
    id: "a1d7f3e5-2c9b-4e6a-8f1d-3b5c7e9a2d40",
    name: "Erosion",
    oracleText:
        "Enchant land\nAt the beginning of the upkeep of enchanted land's controller, destroy that land unless that player pays {1} or 1 life.",
    manaCost: { U: 3 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    triggeredAbilities: [
        phaseTrigger({
            id: "erosion-upkeep-tax",
            oracleText:
                "At the beginning of the upkeep of enchanted land's controller, destroy that land unless that player pays {1} or 1 life.",
            phase: "UPKEEP",
            // Scoped to the enchanted land's controller (CR 603.10 — read at
            // resolve); the factory resolves `host-controller` to the host's
            // current controller.
            scope: "host-controller",
            resolve: (ctx, _event, scopedPlayerId) => {
                const hostId = ctx.getAttachedToId();
                if (hostId === undefined) return; // host gone — nothing to tax
                // CR 117.3a — first offer to pay {1}.
                const paidMana = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `erosion-mana-${ctx.sourceInstanceId}`,
                    cost: { X: 1 },
                    prompt: "Pay {1} to keep the enchanted land?",
                });
                if (paidMana === undefined) return; // suspended
                if (paidMana) return;
                // Declined the mana — offer 1 life instead (CR 118.4).
                if (ctx.getLife(scopedPlayerId) >= 1) {
                    const paidLife = ctx.requestMayPay({
                        playerId: scopedPlayerId,
                        choiceId: `erosion-life-${ctx.sourceInstanceId}`,
                        prompt: "Pay 1 life to keep the enchanted land?",
                    });
                    if (paidLife === undefined) return; // suspended
                    if (paidLife) {
                        ctx.loseLife(scopedPlayerId, 1);
                        return;
                    }
                }
                ctx.destroy({ type: "permanent", id: hostId });
            },
        }),
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

// Flood — "{U}{U}: Tap target creature without flying." (CR 605 activated
// ability; CR 701.20a tap; CR 702.9 the "without flying" filter excludes
// flyers from legal targets via `excludeAbility`.)
export const flood: CardDefinition = {
    id: "d4b8a1c6-3f7e-4a9d-8c2b-1e6f5a3d7b90",
    name: "Flood",
    oracleText: "{U}{U}: Tap target creature without flying.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "flood-tap",
            oracleText: "{U}{U}: Tap target creature without flying.",
            cost: { mana: { U: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                excludeAbility: "flying",
            },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (target?.type === "permanent") ctx.tap(target);
            },
        },
    ],
};

// Ghost Ship — "Flying\n{U}{U}{U}: Regenerate this creature." (CR 702.9 flying;
// CR 605 activated ability; CR 701.15a regenerate via a shield consumed by the
// next destroy.)
export const ghostShip: CardDefinition = {
    id: "e7c2f5a8-4b9d-4e1a-9f3c-2d8b6a1e5c70",
    name: "Ghost Ship",
    oracleText: "Flying\n{U}{U}{U}: Regenerate this creature.",
    manaCost: { X: 2, U: 2 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 2,
    toughness: 4,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "ghost-ship-regenerate",
            oracleText: "{U}{U}{U}: Regenerate this creature.",
            cost: { mana: { U: 3 } },
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

// Giant Shark — "This creature can't attack unless defending player controls an
// Island.\nWhenever this creature blocks or becomes blocked by a creature that
// has been dealt damage this turn, this creature gets +2/+0 and gains trample
// until end of turn.\nWhen you control no Islands, sacrifice this creature."
// (CR 508.1c attack restriction; CR 509.1h combat-pairing trigger gated on the
// opponent creature's marked damage — `getMarkedDamage` > 0 means it has been
// dealt damage this turn (CR 120.3, cleared at CLEANUP); CR 603.8 state-trigger
// sacrifice.)
export const giantShark: CardDefinition = {
    id: "f0a3c6e9-5d1b-4f8a-8e2c-3a7b9d1f6e80",
    name: "Giant Shark",
    oracleText:
        "This creature can't attack unless defending player controls an Island.\nWhenever this creature blocks or becomes blocked by a creature that has been dealt damage this turn, this creature gets +2/+0 and gains trample until end of turn.\nWhen you control no Islands, sacrifice this creature.",
    manaCost: { X: 5, U: 1 },
    types: ["Creature"],
    subtypes: ["Shark"],
    power: 4,
    toughness: 4,
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "giant-shark-island-restriction",
            oracleText:
                "This creature can't attack unless defending player controls an Island.",
            predicate: (_self, defenderBattlefield) =>
                defenderBattlefield.some((c) => c.subtypes.includes("Island")),
        },
    ],
    triggeredAbilities: [
        {
            id: "giant-shark-combat-pump",
            oracleText:
                "Whenever this creature blocks or becomes blocked by a creature that has been dealt damage this turn, this creature gets +2/+0 and gains trample until end of turn.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                return (
                    event.attackerId === self.id || event.blockerId === self.id
                );
            },
            resolve: (ctx, event) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return;
                const isSelfAttacker =
                    event.attackerId === ctx.sourceInstanceId;
                const opponentId = isSelfAttacker
                    ? event.blockerId
                    : event.attackerId;
                // CR 120.3 — "has been dealt damage this turn": non-zero marked
                // damage on the paired creature (damage persists until CLEANUP).
                if (
                    ctx.getMarkedDamage({
                        type: "permanent",
                        id: opponentId,
                    }) <= 0
                ) {
                    return;
                }
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                ctx.addTemporaryPTBuff(self, 2, 0, { phase: "end-of-turn" });
                ctx.grantStaticAbility(self, "trample", {
                    phase: "end-of-turn",
                });
            },
        },
        sacrificeWhenNoIslands("giant-shark-no-islands", "Giant Shark"),
    ],
};

// Mana Vortex — "When you cast this spell, counter it unless you sacrifice a
// land.\nAt the beginning of each player's upkeep, that player sacrifices a
// land of their choice.\nWhen there are no lands on the battlefield, sacrifice
// this enchantment." (CR 603.6e cast trigger that may counter the spell on the
// stack; CR 603.6a each-player upkeep land sacrifice; CR 603.8 state-trigger
// self-sacrifice.) The cast trigger uses `spellCastTrigger` scope "self".
export const manaVortex: CardDefinition = {
    id: "0b1c4d7e-6a2f-4b9c-8d3e-4f8a1b2c5d90",
    name: "Mana Vortex",
    oracleText:
        "When you cast this spell, counter it unless you sacrifice a land.\nAt the beginning of each player's upkeep, that player sacrifices a land of their choice.\nWhen there are no lands on the battlefield, sacrifice this enchantment.",
    manaCost: { X: 1, U: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        // CR 603.6e — "When you cast this spell, counter it unless you sacrifice
        // a land." The trigger goes above the Mana Vortex spell on the stack;
        // on resolution the controller may sacrifice a land to keep it,
        // otherwise the still-on-stack spell is countered (CR 117.3a).
        spellCastTrigger({
            id: "mana-vortex-cast-counter",
            oracleText:
                "When you cast this spell, counter it unless you sacrifice a land.",
            scope: "self",
            resolve: (ctx, _event, spell) => {
                const controller = ctx.controller;
                const spellRef = {
                    type: "spell" as const,
                    id: spell.instanceId,
                };
                const lands = ctx.getBattlefieldIds(controller, {
                    types: "Land",
                });
                // Can't afford the cost → the spell is countered (CR 117.3a).
                if (lands.length === 0) {
                    ctx.counter(spellRef);
                    return;
                }
                const accept = ctx.requestMayPay({
                    playerId: controller,
                    choiceId: `mana-vortex-cast-${ctx.sourceInstanceId}`,
                    prompt: "Sacrifice a land to keep Mana Vortex?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) {
                    ctx.counter(spellRef);
                    return;
                }
                const picked = ctx.requestChoice({
                    playerId: controller,
                    choiceId: `mana-vortex-cast-${ctx.sourceInstanceId}-land`,
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    filter: { types: "Land" },
                    count: 1,
                    prompt: "Sacrifice a land.",
                });
                if (picked === undefined) return; // suspended
                if (picked.length < 1) {
                    ctx.counter(spellRef);
                    return;
                }
                for (const id of picked) ctx.sacrifice(id);
            },
        }),
        // CR 603.6a — at each player's upkeep, the active player sacrifices a
        // land of their choice.
        phaseTrigger({
            id: "mana-vortex-upkeep-sac",
            oracleText:
                "At the beginning of each player's upkeep, that player sacrifices a land of their choice.",
            phase: "UPKEEP",
            scope: "each",
            resolve: (ctx, _event, scopedPlayerId) => {
                const lands = ctx.getBattlefieldIds(scopedPlayerId, {
                    types: "Land",
                });
                if (lands.length === 0) return; // nothing to sacrifice
                const picked = ctx.requestChoice({
                    playerId: scopedPlayerId,
                    choiceId: `mana-vortex-${ctx.sourceInstanceId}-${scopedPlayerId}`,
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    zoneOwnerId: scopedPlayerId,
                    filter: { types: "Land" },
                    count: 1,
                    prompt: "Mana Vortex: sacrifice a land.",
                });
                if (picked === undefined) return; // suspended
                for (const id of picked) ctx.sacrifice(id);
            },
        }),
        // CR 603.8 — when no lands remain on the battlefield, sacrifice Mana
        // Vortex.
        stateTrigger({
            id: "mana-vortex-no-lands",
            oracleText:
                "When there are no lands on the battlefield, sacrifice this enchantment.",
            condition: (_self, state) =>
                !state.players.some((p) =>
                    p.battlefield.some((c) => c.types.includes("Land"))
                ),
            resolve: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};

// Merfolk Assassin — "{T}: Destroy target creature with islandwalk." (CR 605
// activated ability; CR 701.7 destroy; `requireAbility: "islandwalk"` scopes
// legal targets to islandwalkers, CR 702.)
export const merfolkAssassin: CardDefinition = {
    id: "1c2d5e8f-7b3a-4c0d-9e4f-5a9b2c3d6e00",
    name: "Merfolk Assassin",
    oracleText: "{T}: Destroy target creature with islandwalk.",
    manaCost: { U: 2 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Assassin"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "merfolk-assassin-destroy",
            oracleText: "{T}: Destroy target creature with islandwalk.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                requireAbility: "islandwalk",
            },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (target?.type === "permanent") ctx.destroy(target);
            },
        },
    ],
};

// Mind Bomb — "Each player may discard up to three cards. Mind Bomb deals
// damage to each player equal to 3 minus the number of cards they discarded
// this way." (CR 701.8 optional discard per player + CR 119 damage.) Each
// player independently chooses 0–3 cards to discard; the damage is 3 minus the
// count they discarded. APNAP order via `allPlayerIds`.
export const mindBomb: CardDefinition = {
    id: "2d3e6f90-8c4b-4d1e-8f5a-6b0c3d4e7f10",
    name: "Mind Bomb",
    oracleText:
        "Each player may discard up to three cards. Mind Bomb deals damage to each player equal to 3 minus the number of cards they discarded this way.",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        for (const pid of ctx.allPlayerIds) {
            const handSize = ctx.getHandSize(pid);
            const max = Math.min(3, handSize);
            let discarded = 0;
            if (max > 0) {
                const picks = ctx.requestChoice({
                    playerId: pid,
                    choiceId: `mind-bomb-${ctx.sourceInstanceId}-${pid}`,
                    kind: "discard-hand",
                    zone: "hand",
                    count: { min: 0, max },
                    prompt: "Mind Bomb: discard up to three cards.",
                });
                if (picks === undefined) return; // suspended for this player
                for (const id of picks) ctx.discardCard(pid, id);
                discarded = picks.length;
            }
            const damage = 3 - discarded;
            if (damage > 0) ctx.dealDamage({ type: "player", id: pid }, damage);
        }
    },
};

const PSYCHIC_ALLERGY_COLOR_NAMES: Record<string, string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
};
const PSYCHIC_ALLERGY_COLORS = ["W", "U", "B", "R", "G"] as const;

// Psychic Allergy — "As this enchantment enters, choose a color.\nAt the
// beginning of each opponent's upkeep, this enchantment deals X damage to that
// player, where X is the number of nontoken permanents of the chosen color they
// control.\nAt the beginning of your upkeep, destroy this enchantment unless you
// sacrifice two Islands." (CR 700.2c modal colour pick stored as `chosenModeId`;
// CR 603.6a opponents'-upkeep damage trigger; CR 603.6a + CR 117.3a own-upkeep
// destroy-unless-sacrifice-two-Islands.)
export const psychicAllergy: CardDefinition = {
    id: "3e4f7091-9d5c-4e2f-9061-7c1d4e5f8021",
    name: "Psychic Allergy",
    oracleText:
        "As this enchantment enters, choose a color.\nAt the beginning of each opponent's upkeep, this enchantment deals X damage to that player, where X is the number of nontoken permanents of the chosen color they control.\nAt the beginning of your upkeep, destroy this enchantment unless you sacrifice two Islands.",
    manaCost: { X: 3, U: 2 },
    types: ["Enchantment"],
    // CR 700.2 — the colour is chosen as the enchantment enters (modal pick).
    modes: PSYCHIC_ALLERGY_COLORS.map((color) => ({
        id: color,
        label: PSYCHIC_ALLERGY_COLOR_NAMES[color],
        oracleText: `Deals damage equal to the number of nontoken ${PSYCHIC_ALLERGY_COLOR_NAMES[color]} permanents each opponent controls at their upkeep.`,
    })),
    triggeredAbilities: [
        phaseTrigger({
            id: "psychic-allergy-opponent-upkeep",
            oracleText:
                "At the beginning of each opponent's upkeep, this enchantment deals X damage to that player, where X is the number of nontoken permanents of the chosen color they control.",
            phase: "UPKEEP",
            scope: "opponents",
            resolve: (ctx, _event, scopedPlayerId) => {
                const color = ctx.getChosenModeId();
                if (!color) return;
                const ids = ctx.getBattlefieldIds(scopedPlayerId, {
                    colors: color as Color,
                    isToken: false,
                });
                if (ids.length > 0) {
                    ctx.dealDamage(
                        { type: "player", id: scopedPlayerId },
                        ids.length
                    );
                }
            },
        }),
        // CR 603.6a + CR 117.3a — the "pay" is an alternate cost (sacrifice two
        // Islands), not mana, so this composes `requestMayPay` (the yes/no gate)
        // with a `sacrifice-permanents` choice (the Mold Demon shape) rather
        // than `upkeepPayOrElse`.
        phaseTrigger({
            id: "psychic-allergy-own-upkeep",
            oracleText:
                "At the beginning of your upkeep, destroy this enchantment unless you sacrifice two Islands.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                const controller = ctx.controller;
                const islandIds = ctx.getBattlefieldIds(controller, {
                    subtypes: "Island",
                });
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                // Can't afford → the only legal outcome is to destroy Psychic
                // Allergy (CR 117.3a — an unpayable "unless" forces the
                // consequence). No prompt with no real choice.
                if (islandIds.length < 2) {
                    ctx.destroy(self);
                    return;
                }
                const accept = ctx.requestMayPay({
                    playerId: controller,
                    choiceId: `psychic-allergy-${ctx.sourceInstanceId}`,
                    prompt: "Sacrifice two Islands to keep Psychic Allergy?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) {
                    ctx.destroy(self);
                    return;
                }
                const picked = ctx.requestChoice({
                    playerId: controller,
                    choiceId: `psychic-allergy-${ctx.sourceInstanceId}-islands`,
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    filter: { subtypes: "Island" },
                    count: 2,
                    prompt: "Sacrifice two Islands.",
                });
                if (picked === undefined) return; // suspended
                if (picked.length < 2) {
                    ctx.destroy(self);
                    return;
                }
                for (const id of picked) ctx.sacrifice(id);
            },
        }),
    ],
};

// Riptide — "Tap all blue creatures." (CR 701.20a — tap every blue creature on
// the battlefield, either controller; CR 202.2 colour.)
export const riptide: CardDefinition = {
    id: "4f508192-0e6d-4f30-8172-8d2e5f607132",
    name: "Riptide",
    oracleText: "Tap all blue creatures.",
    manaCost: { U: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        for (const pid of ctx.allPlayerIds) {
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
                colors: "U",
            })) {
                ctx.tap({ type: "permanent", id });
            }
        }
    },
};

// Sunken City — "At the beginning of your upkeep, sacrifice this enchantment
// unless you pay {U}{U}.\nBlue creatures get +1/+1." (CR 603.6a + CR 117.3a
// upkeep maintenance cost; CR 611 layer 7c anthem filtered on blue, CR 202.2.)
export const sunkenCity: CardDefinition = {
    id: "5061829a-1f7e-4041-8263-9e3f60718243",
    name: "Sunken City",
    oracleText:
        "At the beginning of your upkeep, sacrifice this enchantment unless you pay {U}{U}.\nBlue creatures get +1/+1.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.getColors(target).includes("U"),
            power: 1,
            toughness: 1,
        },
    ],
    triggeredAbilities: [
        upkeepPayOrElse({
            id: "sunken-city-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless you pay {U}{U}.",
            cost: { U: 2 },
            prompt: "Pay {U}{U} or sacrifice Sunken City?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};

// Water Wurm — "This creature gets +0/+1 as long as an opponent controls an
// Island." (CR 611 layer 7d conditional buff via a `pt-cda` whose `compute`
// reads the board — the Kird Ape pattern.)
export const waterWurm: CardDefinition = {
    id: "61728ab1-2081-4152-8374-0f4071829354",
    name: "Water Wurm",
    oracleText:
        "This creature gets +0/+1 as long as an opponent controls an Island.",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Wurm"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: (target, source) => target.id === source.id,
            compute: (source, state) => {
                const opponentHasIsland = state.players.some((p) =>
                    p.battlefield.some(
                        (c) =>
                            c.controllerId !== source.controllerId &&
                            c.subtypes.includes("Island")
                    )
                );
                // CR 613.4 layer 7a: `pt-cda` contributes a DELTA on top of the
                // printed 1/1 base (effective = base + Σ pt-cda). The +0/+1 is
                // applied only while an opponent controls an Island.
                return opponentHasIsland
                    ? { power: 0, toughness: 1 }
                    : { power: 0, toughness: 0 };
            },
        },
    ],
};

// ═════════════════════════════════════════════════════════════════════════════
// BLUE C4 — Copy-as-token (Dance of Many, #421).
// ═════════════════════════════════════════════════════════════════════════════

// Dance of Many — "{U}{U} Enchantment. When this enchantment enters, create a
// token that's a copy of target nontoken creature. When this enchantment leaves
// the battlefield, exile the token. When the token leaves the battlefield,
// sacrifice this enchantment. At the beginning of your upkeep, sacrifice this
// enchantment unless you pay {U}{U}." (Modern Scryfall oracle, ADR 0004.)
//
// Implementation (CR 707.2 copy + CR 603.10 leave-linkage + CR 603.6a upkeep):
//
//   • ETB trigger (`enteredTrigger` scope:self) — the controller chooses a
//     nontoken creature (`requestChoice` filter `{ types: "Creature",
//     isToken: false }`, the same choose-a-creature path Clone uses; CR 707.2
//     copies copiable values only). `createTokenCopyOf` is the token-recipient
//     form of the clone path: it makes a fresh token and runs `applyCopy` on it
//     (the SAME `applyCopy` `becomeCopyOf` uses), stamping `createdBy` so the
//     enchantment can find its token, and storing the reverse `linkedTokenId`
//     on the enchantment so it can identify the token after it leaves play.
//
//   • Enchantment-leaves → exile token (`leftTrigger` scope:self) — the token
//     is still on the battlefield at this point, so it is located by
//     `createdBy` provenance and exiled (CR 603.10). A token in any zone but
//     the battlefield ceases to exist (CR 111.7 SBA), so exile is permanent.
//
//   • Token-leaves → sacrifice enchantment (`leftTrigger` scope:any with a
//     `linkedTokenId` condition) — the leaving permanent's id is matched
//     against the enchantment's stored `linkedTokenId` (the `PermanentLeftEvent`
//     does not carry `createdBy`, and the token has already left), then the
//     enchantment is sacrificed (CR 701.16).
//
//   • Upkeep {U}{U}-or-sacrifice — REUSES the shipped LEG C7
//     `payOrSacrificeUpkeepTrigger` (the Elder Dragon maintenance-cost family);
//     not reimplemented (CR 603.6a + CR 117.3a).
//
// The two leave triggers are mutual no-ops on the second hop: when the
// enchantment leaves it exiles the token, whose departure tries to sacrifice
// the already-gone enchantment (silent no-op, CR 608.2b); and vice versa.
export const danceOfMany: CardDefinition = {
    id: "54d5d755-403a-4e81-837e-f516eb17e819",
    name: "Dance of Many",
    oracleText:
        "When this enchantment enters, create a token that's a copy of target nontoken creature.\nWhen this enchantment leaves the battlefield, exile the token.\nWhen the token leaves the battlefield, sacrifice this enchantment.\nAt the beginning of your upkeep, sacrifice this enchantment unless you pay {U}{U}.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "dance-of-many-etb",
            oracleText:
                "When this enchantment enters, create a token that's a copy of target nontoken creature.",
            scope: "self",
            resolve: (ctx: SpellContext) => {
                // CR 707.2 — choose a nontoken creature to copy. Mirrors the
                // Clone copy-target picker; `isToken: false` enforces the
                // "nontoken" clause (CR 111.5).
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `dance-of-many-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    allControllers: true,
                    filter: { types: "Creature", isToken: false },
                    count: 1,
                    prompt: "Dance of Many: choose a nontoken creature to copy.",
                });
                if (picks === undefined) return; // suspended for the choice
                const targetId = picks[0];
                if (!targetId) return; // no legal creature → no token
                ctx.createTokenCopyOf(
                    targetId,
                    ctx.controller,
                    ctx.sourceInstanceId
                );
            },
        }),
        leftTrigger({
            id: "dance-of-many-exile-token",
            oracleText:
                "When this enchantment leaves the battlefield, exile the token.",
            scope: "self",
            resolve: (ctx: SpellContext, _event, leaving) => {
                // CR 603.10 — the token (still on the battlefield) is found by
                // its `createdBy` provenance link to this enchantment.
                for (const pid of ctx.allPlayerIds) {
                    const tokens = ctx.getBattlefieldIds(pid, {
                        createdBy: leaving.id,
                    });
                    for (const tokenId of tokens) {
                        ctx.exile({ type: "permanent", id: tokenId });
                    }
                }
            },
        }),
        leftTrigger({
            id: "dance-of-many-sacrifice-self",
            oracleText:
                "When the token leaves the battlefield, sacrifice this enchantment.",
            scope: "any",
            // CR 603.10 — fire only for THIS enchantment's token. The token has
            // already left, so it is identified by the `linkedTokenId` stored
            // on the enchantment when the token was created.
            condition: (event, self) =>
                self.linkedTokenId !== undefined &&
                event.instanceId === self.linkedTokenId,
            resolve: (ctx: SpellContext) => {
                ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
        payOrSacrificeUpkeepTrigger({
            id: "dance-of-many-upkeep",
            cardName: "Dance of Many",
            cost: { U: 2 },
            costText: "{U}{U}",
        }),
    ],
};

// ═════════════════════════════════════════════════════════════════════════════
// BLACK free tranche (#413) — all 17 DRK Black cards. Every card is expressible
// with shipped primitives plus three small orthogonal engine reads/writes
// (getHandCards colours, discardAtRandom type filter, failToEnter) and one new
// combat event (ATTACKER_UNBLOCKED). Modern Scryfall oracle (ADR 0004); stats
// validated against DRK.json.
// ═════════════════════════════════════════════════════════════════════════════

// Ashes to Ashes — "Exile two target nonartifact creatures. Ashes to Ashes
// deals 5 damage to you." (CR 701.18 exile two distinct creature targets, CR
// 601.2c; `excludeTypes: "Artifact"` enforces "nonartifact"; CR 119 the 5
// damage to the caster.)
export const ashesToAshes: CardDefinition = {
    id: "f8b1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c40",
    name: "Ashes to Ashes",
    oracleText:
        "Exile two target nonartifact creatures. Ashes to Ashes deals 5 damage to you.",
    manaCost: { X: 1, B: 2 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Creature",
        count: 2,
        excludeTypes: "Artifact",
    },
    resolve: (ctx: SpellContext) => {
        for (const target of ctx.targets) {
            if (target.type === "permanent") ctx.exile(target);
        }
        ctx.dealDamage({ type: "player", id: ctx.controller }, 5);
    },
};

// Banshee — "{X}, {T}: This creature deals half X damage, rounded down, to any
// target, and half X damage, rounded up, to you." (CR 605 activated ability
// with an {X} cost read at activation via `ctx.getX()`; CR 115.4 "any target";
// CR 119 the floor/ceil split of half X.)
export const banshee: CardDefinition = {
    id: "a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c50",
    name: "Banshee",
    oracleText:
        "{X}, {T}: This creature deals half X damage, rounded down, to any target, and half X damage, rounded up, to you.",
    manaCost: { X: 2, B: 2 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 0,
    toughness: 1,
    activatedAbilities: [
        {
            id: "banshee-half-x",
            oracleText:
                "{X}, {T}: This creature deals half X damage, rounded down, to any target, and half X damage, rounded up, to you.",
            cost: { tap: true, mana: { X: 1 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const x = ctx.getX();
                const toTarget = Math.floor(x / 2);
                const toSelf = Math.ceil(x / 2);
                const [target] = ctx.targets;
                if (
                    toTarget > 0 &&
                    (target?.type === "player" || target?.type === "permanent")
                ) {
                    ctx.dealDamage(target, toTarget);
                }
                if (toSelf > 0) {
                    ctx.dealDamage(
                        { type: "player", id: ctx.controller },
                        toSelf
                    );
                }
            },
        },
    ],
};

// Bog Imp — vanilla flier (CR 702.9). Keyword on `staticAbilities[]`.
export const bogImp: CardDefinition = {
    id: "b2c3d4e5-6f7a-4b8c-9d0e-1f2a3b4c5d60",
    name: "Bog Imp",
    oracleText: "Flying",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Imp"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
};

// Bog Rats — "This creature can't be blocked by Walls." (CR 509.1b block
// restriction, `side: "attacker"`: a candidate blocker that is a Wall is
// rejected. CR 205.3 the Wall subtype.)
export const bogRats: CardDefinition = {
    id: "c3d4e5f6-7a8b-4c9d-8e1f-2a3b4c5d6e70",
    name: "Bog Rats",
    oracleText: "This creature can't be blocked by Walls.",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Rat"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "block-restriction",
            id: "bog-rats-no-wall-blockers",
            oracleText: "This creature can't be blocked by Walls.",
            side: "attacker",
            // self = Bog Rats (attacker), opponent = candidate blocker. The
            // block is legal unless the blocker is a Wall.
            predicate: (_self, opponent) => !opponent.subtypes.includes("Wall"),
        },
    ],
};

// Curse Artifact — Aura enchant artifact. "At the beginning of the upkeep of
// enchanted artifact's controller, this Aura deals 2 damage to that player
// unless they sacrifice that artifact." (CR 603.6a upkeep trigger scoped to the
// HOST's controller + CR 117.3a do-X-unless-you-sacrifice; mirrors Erosion's
// host-controller scope, but the "unless" is a sacrifice of the host, not a
// mana/life payment, and the consequence is 2 damage rather than destroy.)
export const curseArtifact: CardDefinition = {
    id: "d4e5f6a7-8b9c-4d0e-9f2a-3b4c5d6e7f80",
    name: "Curse Artifact",
    oracleText:
        "Enchant artifact\nAt the beginning of the upkeep of enchanted artifact's controller, this Aura deals 2 damage to that player unless they sacrifice that artifact.",
    manaCost: { X: 2, B: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Artifact", count: 1 },
    triggeredAbilities: [
        phaseTrigger({
            id: "curse-artifact-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted artifact's controller, this Aura deals 2 damage to that player unless they sacrifice that artifact.",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (ctx, _event, scopedPlayerId) => {
                const hostId = ctx.getAttachedToId();
                if (hostId === undefined) return; // host gone — nothing to do
                // CR 117.3a — offer to sacrifice the enchanted artifact;
                // declining (or being unable) takes 2 damage.
                const sacrifice = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `curse-artifact-${ctx.sourceInstanceId}`,
                    prompt: "Sacrifice the enchanted artifact to avoid 2 damage?",
                });
                if (sacrifice === undefined) return; // suspended
                if (sacrifice) {
                    ctx.sacrifice(hostId);
                    return;
                }
                ctx.dealDamage({ type: "player", id: scopedPlayerId }, 2);
            },
        }),
    ],
};

// Eater of the Dead — "{0}: If this creature is tapped, exile target creature
// card from a graveyard and untap this creature." (CR 605 activated ability
// with a free {0} cost gated on the source being tapped via `canActivate`; CR
// 701.18 exile the graveyard-card target; CR 701.20b untap. The famous "untap
// loop" is harmless here — each activation requires a distinct creature card in
// a graveyard, so it terminates when graveyards run dry.)
export const eaterOfTheDead: CardDefinition = {
    id: "e5f6a7b8-9c0d-4e1f-8a3b-4c5d6e7f8a90",
    name: "Eater of the Dead",
    oracleText:
        "{0}: If this creature is tapped, exile target creature card from a graveyard and untap this creature.",
    manaCost: { X: 4, B: 1 },
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 3,
    toughness: 4,
    activatedAbilities: [
        {
            id: "eater-of-the-dead-exile-untap",
            oracleText:
                "{0}: If this creature is tapped, exile target creature card from a graveyard and untap this creature.",
            cost: {},
            useStack: true,
            // CR 605 — the "if tapped" clause gates legality; activating while
            // untapped is illegal.
            canActivate: (source) => source.isTapped === true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "any",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (!t || t.type !== "graveyard-card" || !t.playerId) return;
                ctx.moveCardById(t.playerId, t.id, "graveyard", "exile");
                ctx.untap({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};

// Frankenstein's Monster — DEFERRED (TODO(#413)). "As this creature enters,
// exile X creature cards from your graveyard. ... For each creature card exiled
// this way, this creature enters with a +2/+0, +1/+1, or +0/+2 counter on it."
// Needs an "as it enters, choose-and-exile X cards from YOUR GRAVEYARD" pick at
// resolution: a graveyard-zone `requestChoice` kind. The PendingChoice zone-pick
// plumbing (requestChoice `zone` union, the submit-validator zone branches in
// `pendingChoiceSubmit.ts`) supports battlefield/hand/library only — there is no
// graveyard pick. Modeling the exile as cast-time TARGETS would change the
// timing semantics ("as it enters" → targeted on the stack) and the per-counter
// choice cadence, so it would be a fake. The counter placement and CDA-from-
// counters parts are all shipped; only the graveyard pick is missing. Defer the
// whole card until the graveyard-pick choice kind lands. NOT registered (no
// exported CardDefinition) to keep the pool honest.

// Grave Robbers — "{B}, {T}: Exile target artifact card from a graveyard. You
// gain 2 life." (CR 605 activated ability; CR 701.18 exile the graveyard-card
// target filtered to artifacts; CR 119.3 lifegain.)
export const graveRobbers: CardDefinition = {
    id: "a7b8c9d0-1e2f-4a3b-8c5d-6e7f8a9b0c10",
    name: "Grave Robbers",
    oracleText:
        "{B}, {T}: Exile target artifact card from a graveyard. You gain 2 life.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Rogue"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "grave-robbers-exile-artifact",
            oracleText:
                "{B}, {T}: Exile target artifact card from a graveyard. You gain 2 life.",
            cost: { tap: true, mana: { B: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Artifact",
                count: 1,
                zone: "graveyard",
                controller: "any",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (!t || t.type !== "graveyard-card" || !t.playerId) return;
                ctx.moveCardById(t.playerId, t.id, "graveyard", "exile");
                ctx.gainLife(ctx.controller, 2);
            },
        },
    ],
};

// Inquisition — "Target player reveals their hand. Inquisition deals damage to
// that player equal to the number of white cards in their hand." (CR 701.x
// reveal; CR 202.2 colour count via `getHandCards().colors`; CR 119 damage.)
export const inquisition: CardDefinition = {
    id: "b8c9d0e1-2f3a-4b4c-9d6e-7f8a9b0c1d20",
    name: "Inquisition",
    oracleText:
        "Target player reveals their hand. Inquisition deals damage to that player equal to the number of white cards in their hand.",
    manaCost: { X: 2, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const [target] = ctx.targets;
        if (target?.type !== "player") return;
        const playerId = target.id;
        ctx.revealHand(playerId);
        const whiteCount = ctx
            .getHandCards(playerId)
            .filter((c) => c.colors.includes("W")).length;
        if (whiteCount > 0)
            ctx.dealDamage({ type: "player", id: playerId }, whiteCount);
    },
};

// Marsh Gas — "All creatures get -2/-0 until end of turn." (CR 611.2 temporary
// P/T mod on every creature; mirrors Holy Light's iterate-all-creatures shape.)
export const marshGas: CardDefinition = {
    id: "c9d0e1f2-3a4b-4c5d-8e7f-8a9b0c1d2e30",
    name: "Marsh Gas",
    oracleText: "All creatures get -2/-0 until end of turn.",
    manaCost: { B: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        for (const pid of ctx.allPlayerIds) {
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
            })) {
                ctx.addTemporaryPTBuff({ type: "permanent", id }, -2, 0, {
                    phase: "end-of-turn",
                });
            }
        }
    },
};

// Murk Dwellers — "Whenever this creature attacks and isn't blocked, it gets
// +2/+0 until end of combat." (CR 509.1h — the new ATTACKER_UNBLOCKED combat
// event fires once per unblocked attacker when the block graph is finalized;
// CR 611.2 the +2/+0 pump scoped to end of combat.)
export const murkDwellers: CardDefinition = {
    id: "d0e1f2a3-4b5c-4d6e-9f8a-9b0c1d2e3f40",
    name: "Murk Dwellers",
    oracleText:
        "Whenever this creature attacks and isn't blocked, it gets +2/+0 until end of combat.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "murk-dwellers-unblocked-pump",
            oracleText:
                "Whenever this creature attacks and isn't blocked, it gets +2/+0 until end of combat.",
            event: "ATTACKER_UNBLOCKED",
            matches: (event, self) =>
                event.type === "ATTACKER_UNBLOCKED" &&
                event.attackerId === self.id,
            resolve: (ctx) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    2,
                    0,
                    { phase: "end-of-combat" }
                );
            },
        },
    ],
};

// Nameless Race — "Trample\nAs this creature enters, pay any amount of life.
// The amount you pay can't be more than the total number of white nontoken
// permanents your opponents control plus the total number of white cards in
// their graveyards.\nNameless Race's power and toughness are each equal to the
// life paid as it entered." (CR 702.19 trample; CR 614.12 "as it enters" pay-
// life choice capped by an opponent-board count; CR 604.3 the CDA reading the
// paid amount, stored as a named counter so it survives the wire projection.)
// The cap and the paid amount are computed in a `resolveSteps` body; the chosen
// amount is written as "life-paid" counters and the base P/T is set from it via
// `setSelfBody`.
export const namelessRace: CardDefinition = {
    id: "e1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a50",
    name: "Nameless Race",
    oracleText:
        "Trample\nAs this creature enters, pay any amount of life. The amount you pay can't be more than the total number of white nontoken permanents your opponents control plus the total number of white cards in their graveyards.\nNameless Race's power and toughness are each equal to the life paid as it entered.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    power: 0,
    toughness: 0,
    staticAbilities: ["trample"],
    resolveSteps: [
        (ctx: SpellContext) => {
            // CR 614.12 — compute the cap: white nontoken permanents opponents
            // control + white cards in their graveyards.
            let cap = 0;
            for (const pid of ctx.allPlayerIds) {
                if (pid === ctx.controller) continue;
                cap += ctx.getBattlefieldIds(pid, {
                    colors: "W",
                    isToken: false,
                }).length;
                cap += ctx
                    .getGraveyardCards(pid)
                    .filter((c) => c.colors.includes("W")).length;
            }
            // The player also can't pay more life than they have (CR 118.4 —
            // can't pay life you don't have).
            const maxPayable = Math.min(cap, ctx.getLife(ctx.controller));
            if (maxPayable <= 0) {
                // Enters as a 0/0; the lethal-toughness SBA puts it in the
                // graveyard immediately (CR 704.5f). Nothing to choose.
                ctx.setSelfBody({ power: 0, toughness: 0 });
                return;
            }
            const options = Array.from({ length: maxPayable + 1 }, (_, n) => ({
                id: String(n),
                label: `Pay ${n} life`,
            }));
            const choice = ctx.requestOptionChoice({
                playerId: ctx.controller,
                choiceId: `nameless-race-life-${ctx.sourceInstanceId}`,
                options,
                prompt: "Pay any amount of life (caps Nameless Race's P/T).",
            });
            if (choice === undefined) return; // suspended
            const paid = Number(choice);
            if (paid > 0) ctx.loseLife(ctx.controller, paid);
            // CR 604.3 — base P/T set from the life paid as it entered.
            ctx.setSelfBody({ power: paid, toughness: paid });
        },
    ],
};

// Rag Man — "{B}{B}{B}, {T}: Target opponent reveals their hand and discards a
// creature card at random. Activate only during your turn." (CR 605 activated
// ability with `controllerTurnOnly`; CR 701.x reveal; CR 701.8a the filtered
// random discard via `discardAtRandom(..., "Creature")`.)
export const ragMan: CardDefinition = {
    id: "f2a3b4c5-6d7e-4f8a-9b0c-1d2e3f4a5b60",
    name: "Rag Man",
    oracleText:
        "{B}{B}{B}, {T}: Target opponent reveals their hand and discards a creature card at random. Activate only during your turn.",
    manaCost: { X: 2, B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Minion"],
    power: 2,
    toughness: 1,
    activatedAbilities: [
        {
            id: "rag-man-discard",
            oracleText:
                "{B}{B}{B}, {T}: Target opponent reveals their hand and discards a creature card at random. Activate only during your turn.",
            cost: { tap: true, mana: { B: 3 } },
            useStack: true,
            controllerTurnOnly: true,
            targetRequirement: {
                type: "player",
                controller: "opponent",
                count: 1,
            },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (target?.type !== "player") return;
                ctx.revealHand(target.id);
                ctx.discardAtRandom(target.id, 1, "Creature");
            },
        },
    ],
};

// Season of the Witch — "At the beginning of your upkeep, sacrifice this
// enchantment unless you pay 2 life.\nAt the beginning of the end step, destroy
// all untapped creatures that didn't attack this turn, except for creatures
// that couldn't attack." (CR 603.6a + CR 118.4 upkeep pay-2-life-or-sacrifice;
// CR 603.6a each end step a mass destroy of untapped creatures that didn't
// attack — excepting those that "couldn't attack": creatures with defender or
// that were summoning-sick this turn.)
export const seasonOfTheWitch: CardDefinition = {
    id: "a3b4c5d6-7e8f-4a9b-8c1d-2e3f4a5b6c70",
    name: "Season of the Witch",
    oracleText:
        "At the beginning of your upkeep, sacrifice this enchantment unless you pay 2 life.\nAt the beginning of the end step, destroy all untapped creatures that didn't attack this turn, except for creatures that couldn't attack.",
    manaCost: { B: 3 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "season-of-the-witch-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless you pay 2 life.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                const controller = ctx.controller;
                // CR 118.4 — can't pay 2 life you don't have: forced sacrifice.
                if (ctx.getLife(controller) < 2) {
                    ctx.sacrifice(ctx.sourceInstanceId);
                    return;
                }
                const pay = ctx.requestMayPay({
                    playerId: controller,
                    choiceId: `season-of-the-witch-${ctx.sourceInstanceId}`,
                    prompt: "Pay 2 life to keep Season of the Witch?",
                });
                if (pay === undefined) return; // suspended
                if (pay) {
                    ctx.loseLife(controller, 2);
                    return;
                }
                ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
        phaseTrigger({
            id: "season-of-the-witch-end-step",
            oracleText:
                "At the beginning of the end step, destroy all untapped creatures that didn't attack this turn, except for creatures that couldn't attack.",
            phase: "END_STEP",
            scope: "each",
            resolve: (ctx) => {
                // CR 603.6a — every untapped creature that didn't attack this
                // turn and could have attacked is destroyed. "Couldn't attack"
                // is approximated by the two structural reasons in this pool: a
                // creature with defender, or one that was summoning-sick this
                // turn (CR 508.1a). Tapped creatures are excluded by the
                // `tapped: false` filter (CR 508.1g).
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        types: "Creature",
                        tapped: false,
                    })) {
                        const ref = { type: "permanent" as const, id };
                        if (ctx.hasAttackedThisTurn(ref)) continue;
                        if (ctx.hasStaticAbility(ref, "defender")) continue;
                        if (ctx.isSummoningSick(ref)) continue;
                        ctx.destroy(ref);
                    }
                }
            },
        }),
    ],
};

// The Fallen — "At the beginning of your upkeep, this creature deals 1 damage to
// each opponent and planeswalker it has dealt damage to this game." (CR 603.6a
// upkeep trigger; "dealt damage to this game" is tracked with a named flag
// counter — a `damageDealtTrigger` stamps "fallen-marked" the first time The
// Fallen damages an opponent, and the upkeep trigger deals 1 to that opponent
// while the flag is set. Planeswalkers are out of scope, so only the opponent
// player is tracked — exactly one opponent in a 2-player game.)
export const theFallen: CardDefinition = {
    id: "b4c5d6e7-8f9a-4b0c-9d2e-3f4a5b6c7d80",
    name: "The Fallen",
    oracleText:
        "At the beginning of your upkeep, this creature deals 1 damage to each opponent and planeswalker it has dealt damage to this game.",
    manaCost: { X: 1, B: 3 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 3,
    triggeredAbilities: [
        // Stamp a persistent "has dealt damage to an opponent this game" flag
        // the first (and every) time The Fallen deals damage to a player.
        damageDealtTrigger({
            id: "the-fallen-mark",
            oracleText:
                "Marks each opponent The Fallen has dealt damage to this game.",
            source: "self",
            target: { kind: "player", player: { relation: "opponent" } },
            resolve: (ctx) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "fallen-marked",
                    1
                );
            },
        }),
        phaseTrigger({
            id: "the-fallen-upkeep",
            oracleText:
                "At the beginning of your upkeep, this creature deals 1 damage to each opponent and planeswalker it has dealt damage to this game.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                // The flag is a non-zero "fallen-marked" counter (set on first
                // damage). One opponent in a 2-player game.
                const marked =
                    ctx.getCounterCount(
                        { type: "permanent", id: ctx.sourceInstanceId },
                        "fallen-marked"
                    ) > 0;
                if (!marked) return;
                for (const pid of ctx.allPlayerIds) {
                    if (pid === ctx.controller) continue;
                    ctx.dealDamage({ type: "player", id: pid }, 1);
                }
            },
        }),
    ],
};

// Uncle Istvan — "Prevent all damage that would be dealt to this creature by
// creatures." (CR 615 — a continuous damage-prevention replacement that
// consumes any damage event whose source is a creature and whose target is
// Uncle Istvan; the Desert Nomads shape but filtered on `sourceTypes` rather
// than `sourceSubtypes`.)
export const uncleIstvan: CardDefinition = {
    id: "c5d6e7f8-9a0b-4c1d-8e3f-4a5b6c7d8e90",
    name: "Uncle Istvan",
    oracleText:
        "Prevent all damage that would be dealt to this creature by creatures.",
    manaCost: { X: 1, B: 3 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 1,
    toughness: 3,
    replacementEffects: [
        {
            id: "uncle-istvan-prevent-creature-damage",
            oracleText:
                "Prevent all damage that would be dealt to this creature by creatures.",
            eventKind: "damage",
            appliesTo: (event, self) =>
                event.kind === "damage" &&
                event.target.type === "permanent" &&
                event.target.id === self.id &&
                event.sourceTypes.includes("Creature"),
            replace: () => ({ kind: "consumed" }),
        },
    ],
};

// Word of Binding — "Tap X target creatures." (CR 601.2c a variable number of
// creature targets fixed at announcement by X; CR 701.20a tap each.)
export const wordOfBinding: CardDefinition = {
    id: "d6e7f8a9-0b1c-4d2e-9f4a-5b6c7d8e9f00",
    name: "Word of Binding",
    oracleText: "Tap X target creatures.",
    manaCost: { X: 1, B: 2 },
    types: ["Sorcery"],
    // CR 601.2c — "X target creatures": the number of targets equals X. The
    // engine resolves the count from `chosenX` at announcement.
    targetRequirement: { type: "Creature", count: "X" },
    resolve: (ctx: SpellContext) => {
        for (const target of ctx.targets) {
            if (target.type === "permanent") ctx.tap(target);
        }
    },
};

// ═════════════════════════════════════════════════════════════════════════════
// Free tranche — Artifacts, Lands & colorless (#417). Every card here is data +
// resolve()/effect() closures over existing SpellContext primitives. Four small,
// orthogonal engine primitives were added for this batch (all reusable, none
// card-shaped): `skipNextUntap` (Barl's Cage), `addPlayerDamagePreventionShield`
// (Dark Sphere half-from-source + Scarecrow flying-source-all), and the
// `manaAmount`-from-counters read (City of Shadows). Costs/types/subtypes/P/T
// validated against MTGJSON data/json/DRK.json; modern Scryfall oracle text is
// authoritative (ADR 0004). Two cards are deferred at the foot of this section
// (Runesword, War Barge) — they need a "note a creature, destroy it if THIS
// leaves the battlefield this turn" delayed-self-LTB mechanism the engine lacks.
// ═════════════════════════════════════════════════════════════════════════════

// Barl's Cage — "{3}: Target creature doesn't untap during its controller's next
// untap step." (CR 605 activated ability; CR 302.6 / 502.1 one-shot
// untap-prevention via the new `skipNextUntap` flag, cleared after exactly one
// untap step.)
export const barlsCage: CardDefinition = {
    id: "a1b2c3d4-0001-4aaa-9111-100000000001",
    name: "Barl's Cage",
    oracleText:
        "{3}: Target creature doesn't untap during its controller's next untap step.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "barls-cage-lock",
            oracleText:
                "{3}: Target creature doesn't untap during its controller's next untap step.",
            cost: { mana: { X: 3 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") ctx.skipNextUntap(t);
            },
        },
    ],
};

// Bone Flute — "{2}, {T}: All creatures get -1/-0 until end of turn." (CR 605
// activated ability; CR 611.2 / 613 layer 7c temporary P/T mod on every
// creature, scoped to end of turn. Mirrors Marsh Gas' all-creatures pump.)
export const boneFlute: CardDefinition = {
    id: "a1b2c3d4-0002-4aaa-9111-100000000002",
    name: "Bone Flute",
    oracleText: "{2}, {T}: All creatures get -1/-0 until end of turn.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "bone-flute-shrink",
            oracleText: "{2}, {T}: All creatures get -1/-0 until end of turn.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        types: "Creature",
                    })) {
                        ctx.addTemporaryPTBuff(
                            { type: "permanent", id },
                            -1,
                            0,
                            { phase: "end-of-turn" }
                        );
                    }
                }
            },
        },
    ],
};

// Book of Rass — "{2}, Pay 2 life: Draw a card." (CR 605 activated ability;
// CR 118.4 life payment as part of the cost; CR 121.1 draw. Same shape as
// Greed.)
export const bookOfRass: CardDefinition = {
    id: "a1b2c3d4-0003-4aaa-9111-100000000003",
    name: "Book of Rass",
    oracleText: "{2}, Pay 2 life: Draw a card.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    subtypes: ["Book"],
    activatedAbilities: [
        {
            id: "book-of-rass-draw",
            oracleText: "{2}, Pay 2 life: Draw a card.",
            cost: { mana: { X: 2 }, life: 2 },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.controller, 1);
            },
        },
    ],
};

// Dark Sphere — "{T}, Sacrifice this artifact: The next time a source of your
// choice would deal damage to you this turn, prevent half that damage, rounded
// down." (CR 605 activated ability; CR 615.1 one-shot, source-matched
// prevent-half shield via the new `addPlayerDamagePreventionShield`. The "source
// of your choice" is a permanent target — typically the attacker/burn source —
// scoped to the activating player.)
export const darkSphere: CardDefinition = {
    id: "a1b2c3d4-0004-4aaa-9111-100000000004",
    name: "Dark Sphere",
    oracleText:
        "{T}, Sacrifice this artifact: The next time a source of your choice would deal damage to you this turn, prevent half that damage, rounded down.",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "dark-sphere-prevent-half",
            oracleText:
                "{T}, Sacrifice this artifact: The next time a source of your choice would deal damage to you this turn, prevent half that damage, rounded down.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            // "A source of your choice" — any permanent (CR 609.7). The shield
            // matches that source instance and prevents half its next hit to
            // the activating player.
            targetRequirement: {
                type: "any",
                count: 1,
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "permanent") return;
                ctx.addPlayerDamagePreventionShield(
                    ctx.controller,
                    { sourceInstanceId: t.id },
                    "half-down",
                    { phase: "end-of-turn" },
                    1
                );
            },
        },
    ],
};

// Diabolic Machine — "{3}: Regenerate this creature." (CR 702.9 n/a; CR 605
// activated ability; CR 701.15a regenerate via a shield consumed by the next
// destroy. Same shape as Clay Statue.)
export const diabolicMachine: CardDefinition = {
    id: "a1b2c3d4-0005-4aaa-9111-100000000005",
    name: "Diabolic Machine",
    oracleText: "{3}: Regenerate this creature.",
    manaCost: { X: 7 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 4,
    toughness: 4,
    activatedAbilities: [
        {
            id: "diabolic-machine-regenerate",
            oracleText: "{3}: Regenerate this creature.",
            cost: { mana: { X: 3 } },
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

// Fountain of Youth — "{2}, {T}: You gain 1 life." (CR 605 activated ability;
// CR 119.3 lifegain.)
export const fountainOfYouth: CardDefinition = {
    id: "a1b2c3d4-0006-4aaa-9111-100000000006",
    name: "Fountain of Youth",
    oracleText: "{2}, {T}: You gain 1 life.",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "fountain-of-youth-gain",
            oracleText: "{2}, {T}: You gain 1 life.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.gainLife(ctx.controller, 1);
            },
        },
    ],
};

// Living Armor — "{T}, Sacrifice this artifact: Put X +0/+1 counters on target
// creature, where X is that creature's mana value." (CR 605 activated ability;
// CR 122.1 counters; CR 202.3 mana value of the targeted permanent. +0/+1 is a
// layer-7d P/T-modifying counter.)
export const livingArmor: CardDefinition = {
    id: "a1b2c3d4-0007-4aaa-9111-100000000007",
    name: "Living Armor",
    oracleText:
        "{T}, Sacrifice this artifact: Put X +0/+1 counters on target creature, where X is that creature's mana value.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "living-armor-counters",
            oracleText:
                "{T}, Sacrifice this artifact: Put X +0/+1 counters on target creature, where X is that creature's mana value.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "permanent") return;
                const x = ctx.getManaValue(t);
                if (x > 0) ctx.addCounter(t, "+0/+1", x);
            },
        },
    ],
};

// Necropolis — "Defender\nExile a creature card from your graveyard: Put X +0/+1
// counters on this creature, where X is the exiled card's mana value." (CR 702.3
// defender; CR 605 activated ability whose "exile a creature card from your
// graveyard" is modeled here as a graveyard-card TARGET — a benign timing
// simplification, flagged: the cost union has no graveyard-exile-as-cost field.
// `getManaValue` returns 0 for graveyard cards, so X is read from
// `getGraveyardCards`. CR 122.1 counters; +0/+1 is a layer-7d counter.)
export const necropolis: CardDefinition = {
    id: "a1b2c3d4-0008-4aaa-9111-100000000008",
    name: "Necropolis",
    oracleText:
        "Defender (This creature can't attack.)\nExile a creature card from your graveyard: Put X +0/+1 counters on this creature, where X is the exiled card's mana value.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 1,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "necropolis-counters",
            oracleText:
                "Exile a creature card from your graveyard: Put X +0/+1 counters on this creature, where X is the exiled card's mana value.",
            cost: {},
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "graveyard-card" || !t.playerId) return;
                const gc = ctx
                    .getGraveyardCards(t.playerId)
                    .find((c) => c.id === t.id);
                const x = gc?.manaValue ?? 0;
                ctx.moveCardById(t.playerId, t.id, "graveyard", "exile");
                if (x > 0) {
                    ctx.addCounter(
                        { type: "permanent", id: ctx.sourceInstanceId },
                        "+0/+1",
                        x
                    );
                }
            },
        },
    ],
};

// Reflecting Mirror — "{X}, {T}: Change the target of target spell with a single
// target if that target is you. The new target must be a player. X is twice the
// mana value of that spell." (CR 605 activated ability; CR 114.6 changing the
// target of a spell already on the stack — the ORIGINAL object, not a copy
// (distinct from Fork's copy-retarget). The ability targets the spell (which
// must be single-target and currently target you, CR 115.10), and {X} is forced
// to twice the targeted spell's mana value via `xFromTargetSpellMv` rather than
// player-chosen (CR 107.3). On resolution the new player target is chosen and
// written onto the original stack item via `requestRetarget`.)
export const reflectingMirror: CardDefinition = {
    id: "d551ff93-d8da-4c21-bc3c-6451c0dde07e",
    name: "Reflecting Mirror",
    oracleText:
        "{X}, {T}: Change the target of target spell with a single target if that target is you. The new target must be a player. X is twice the mana value of that spell.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "reflecting-mirror-retarget",
            oracleText:
                "{X}, {T}: Change the target of target spell with a single target if that target is you. The new target must be a player. X is twice the mana value of that spell.",
            cost: {
                mana: { X: "X" },
                tap: true,
                xFromTargetSpellMv: { multiplier: 2 },
            },
            useStack: true,
            targetRequirement: {
                type: "spell",
                count: 1,
                spellSingleTargetingController: true,
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target || target.type !== "spell") return;
                // CR 114.6 — the new target must be a player; the change is
                // applied to the original spell on the stack (not a copy).
                ctx.requestRetarget(target.id, { type: "player", count: 1 });
            },
        },
    ],
};

// Scarecrow — "{6}, {T}: Prevent all damage that would be dealt to you this turn
// by creatures with flying." (CR 605 activated ability; CR 615.1 per-player,
// source-keyword-matched prevent-all shield via `addPlayerDamagePreventionShield`
// matching the "flying" static ability, lasting the rest of the turn — high
// `remaining` so it prevents every flyer's hit, not just the first.)
export const scarecrow: CardDefinition = {
    id: "a1b2c3d4-0009-4aaa-9111-100000000009",
    name: "Scarecrow",
    oracleText:
        "{6}, {T}: Prevent all damage that would be dealt to you this turn by creatures with flying.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Scarecrow"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "scarecrow-prevent-flying",
            oracleText:
                "{6}, {T}: Prevent all damage that would be dealt to you this turn by creatures with flying.",
            cost: { mana: { X: 6 }, tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addPlayerDamagePreventionShield(
                    ctx.controller,
                    { sourceStaticAbility: "flying" },
                    "all",
                    { phase: "end-of-turn" },
                    // Prevents every flying-source damage event this turn.
                    999
                );
            },
        },
    ],
};

// Skull of Orm — "{5}, {T}: Return target enchantment card from your graveyard
// to your hand." (CR 605 activated ability; CR 400.7 graveyard→hand zone move.
// Same shape as Raise Dead, filtered to Enchantment cards in your graveyard.)
export const skullOfOrm: CardDefinition = {
    id: "a1b2c3d4-0010-4aaa-9111-100000000010",
    name: "Skull of Orm",
    oracleText:
        "{5}, {T}: Return target enchantment card from your graveyard to your hand.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "skull-of-orm-return",
            oracleText:
                "{5}, {T}: Return target enchantment card from your graveyard to your hand.",
            cost: { mana: { X: 5 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Enchantment",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "graveyard-card" || !t.playerId) return;
                ctx.moveCardById(t.playerId, t.id, "graveyard", "hand");
            },
        },
    ],
};

// Standing Stones — "{1}, {T}, Pay 1 life: Add one mana of any color." (CR 605.1
// mana ability — resolves immediately, useStack: false, CR 605.3a; CR 106.1 mana
// of any color via `manaChoices`; CR 118.4 life payment as part of the cost.)
export const standingStones: CardDefinition = {
    id: "a1b2c3d4-0011-4aaa-9111-100000000011",
    name: "Standing Stones",
    oracleText: "{1}, {T}, Pay 1 life: Add one mana of any color.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "standing-stones-mana",
            oracleText: "{1}, {T}, Pay 1 life: Add one mana of any color.",
            cost: { mana: { X: 1 }, tap: true, life: 1 },
            useStack: false,
            effect: (ctx) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// Stone Calendar — "Spells you cast cost {1} less to cast." (CR 601.2f cost
// reduction; CR 118.7 generic-only reduction. A `cost-modifier` static scoped to
// the controller's own spells via `card.controllerId === effectSource.controllerId`.)
export const stoneCalendar: CardDefinition = {
    id: "a1b2c3d4-0012-4aaa-9111-100000000012",
    name: "Stone Calendar",
    oracleText: "Spells you cast cost {1} less to cast.",
    manaCost: { X: 5 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "cost-modifier",
            // CR 601.2f — only the caster's own spells are reduced. The
            // effectSource is Stone Calendar; the spell's controllerId is the
            // caster.
            appliesToSpell: (card, _ctx, effectSource) =>
                !!effectSource &&
                card.controllerId === effectSource.controllerId,
            costReduction: { X: 1 },
        },
    ],
};

// Tormod's Crypt — "{T}, Sacrifice this artifact: Exile target player's
// graveyard." (CR 605 activated ability; CR 406 / 400.7 — move the whole target
// player's graveyard to exile via `moveZone`.)
export const tormodsCrypt: CardDefinition = {
    id: "a1b2c3d4-0013-4aaa-9111-100000000013",
    name: "Tormod's Crypt",
    oracleText:
        "{T}, Sacrifice this artifact: Exile target player's graveyard.",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "tormods-crypt-exile-graveyard",
            oracleText:
                "{T}, Sacrifice this artifact: Exile target player's graveyard.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "player") return;
                ctx.moveZone(t.id, "graveyard", "exile");
            },
        },
    ],
};

// Tower of Coireall — "{T}: Target creature can't be blocked by Walls this turn."
// (CR 605 activated ability; CR 509.1b block restriction. The shipped
// `cant-be-blocked-by-subtype` until-EOT marker — same family as Tawnos's Wand's
// can't-be-blocked. Scoped to the Wall subtype.)
export const towerOfCoireall: CardDefinition = {
    id: "a1b2c3d4-0014-4aaa-9111-100000000014",
    name: "Tower of Coireall",
    oracleText: "{T}: Target creature can't be blocked by Walls this turn.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "tower-of-coireall-evasion",
            oracleText:
                "{T}: Target creature can't be blocked by Walls this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") {
                    ctx.setCantBeBlockedBySubtypeThisTurn(t, "Wall");
                }
            },
        },
    ],
};

// Wand of Ith — DEFERRED (TODO(#417)). "{3}, {T}: Target player reveals a card
// at random from their hand. If it's a land card, that player discards it unless
// they pay 1 life. If it isn't a land card, the player discards it unless they
// pay life equal to its mana value. Activate only during your turn." Needs two
// primitives the engine does not ship: (a) a "reveal a card chosen AT RANDOM
// from a hand" pick using the seeded PRNG (the only random-from-hand surface is
// the `discardAtRandom` COST, which discards rather than reveals and targets the
// activating player's own hand), and (b) a may-PAY-LIFE prompt (`requestMayPay`
// only offers a mana cost; there is no life-payment prompt — every shipped
// "unless you pay N life" is a fixed-amount upkeep tax, not a per-card,
// mana-value-scaled prompt during resolution). Both are general primitives, not
// card-shaped; deferred until they land. NOT registered to keep the pool honest.

// City of Shadows — "{T}, Exile a creature you control: Put a storage counter on
// this land.\n{T}: Add {C} for each storage counter on this land." (CR 605
// activated abilities. The first's "Exile a creature you control" is modeled as
// a creature TARGET you control (benign timing simplification, flagged: the cost
// union has no exile-a-permanent cost). The second is a mana ability whose
// colorless output is computed from the source's storage counters via
// `manaAmount`, CR 106.1 / 605.1a.)
export const cityOfShadows: CardDefinition = {
    id: "a1b2c3d4-0016-4aaa-9111-100000000016",
    name: "City of Shadows",
    oracleText:
        "{T}, Exile a creature you control: Put a storage counter on this land.\n{T}: Add {C} for each storage counter on this land.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "city-of-shadows-store",
            oracleText:
                "{T}, Exile a creature you control: Put a storage counter on this land.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "permanent") return;
                ctx.exile(t);
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "storage",
                    1
                );
            },
        },
        {
            id: "city-of-shadows-mana",
            oracleText: "{T}: Add {C} for each storage counter on this land.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
            // CR 106.1 — colorless equal to the number of storage counters,
            // read off the source PermanentView's counters at activation.
            manaAmount: (source) => ({
                C: source.counters?.storage ?? 0,
            }),
        },
    ],
};

// Maze of Ith — "{T}: Untap target attacking creature. Prevent all combat damage
// that would be dealt to and dealt by that creature this turn." (CR 605 activated
// ability; CR 701.20b untap; CR 615.1 / Ebony Horse-style
// `preventAllCombatDamageToAndBy`. Untapping an attacker does NOT remove it from
// combat, CR 506.4c — the prevention is what neutralizes it.)
export const mazeOfIth: CardDefinition = {
    id: "a1b2c3d4-0017-4aaa-9111-100000000017",
    name: "Maze of Ith",
    oracleText:
        "{T}: Untap target attacking creature. Prevent all combat damage that would be dealt to and dealt by that creature this turn.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "maze-of-ith-neutralize",
            oracleText:
                "{T}: Untap target attacking creature. Prevent all combat damage that would be dealt to and dealt by that creature this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "permanent") return;
                ctx.untap(t);
                ctx.preventAllCombatDamageToAndBy(t, { phase: "end-of-turn" });
            },
        },
    ],
};

// Safe Haven — "{2}, {T}: Exile target creature you control.\nAt the beginning of
// your upkeep, you may sacrifice this land. If you do, return each card exiled
// with this land to the battlefield under its owner's control." (CR 605 activated
// ability that exiles a creature you control with an exile-and-return bundle
// keyed to the source via `exileForSource`; CR 603 upkeep trigger that, on
// sacrifice, returns the bundled cards via `returnExiledForSource`.)
export const safeHaven: CardDefinition = {
    id: "a1b2c3d4-0018-4aaa-9111-100000000018",
    name: "Safe Haven",
    oracleText:
        "{2}, {T}: Exile target creature you control.\nAt the beginning of your upkeep, you may sacrifice this land. If you do, return each card exiled with this land to the battlefield under its owner's control.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "safe-haven-exile",
            oracleText: "{2}, {T}: Exile target creature you control.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "permanent") return;
                // CR 603.7a / ADR 0028 — exile keyed to this land; returned by
                // the upkeep trigger via `returnExiledForSource`. Safe Haven
                // returns creatures untapped (no "tapped" clause).
                ctx.exileWithAttachments(t.id, {
                    sourceId: ctx.sourceInstanceId,
                    returnTapped: false,
                });
            },
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "safe-haven-return",
            oracleText:
                "At the beginning of your upkeep, you may sacrifice this land. If you do, return each card exiled with this land to the battlefield under its owner's control.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                // CR 603.3 — "you may sacrifice"; on yes, sacrifice and return
                // the bundled cards (CR 110.2 — under each owner's control).
                const doIt = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: `safe-haven-${ctx.sourceInstanceId}`,
                    prompt: "Sacrifice Safe Haven to return the exiled creatures?",
                });
                if (doIt === undefined) return; // suspended
                if (!doIt) return;
                ctx.returnExiledForSource(ctx.sourceInstanceId);
                ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Deferred — two DRK artifacts (#417) each need a "note a creature, then destroy
// it if THIS artifact leaves the battlefield this turn" delayed-self-LTB
// mechanism the engine does not ship. `scheduleDelayedTrigger` only fires at
// phase boundaries (end-step / end-of-combat / draw-step), not on a source's
// PERMANENT_LEFT, and there is no serializable "noted target" field on an
// instance a self `leftTrigger` could read. Both are intentionally NOT registered
// to keep the pool honest; flagged in the PR. TODO(#417):
//
//   • Runesword — "{3}, {T}: Target attacking creature gets +2/+0 until end of
//     turn. When that creature leaves the battlefield this turn, sacrifice this
//     artifact. ..." Beyond the delayed-self-LTB, it also needs per-creature
//     combat-damage-interaction tracking ("if the creature deals damage to a
//     creature this turn, the creature dealt damage can't be regenerated"; "if a
//     creature dealt damage by the targeted creature would die this turn, exile
//     it instead") — there is no per-damage-pair tally surface.
//
//   • War Barge — "{3}: Target creature gains islandwalk until end of turn. When
//     this artifact leaves the battlefield this turn, destroy that creature. A
//     creature destroyed this way can't be regenerated." The islandwalk grant is
//     free-tranche, but the "destroy the noted creature when THIS leaves the
//     battlefield this turn" clause needs the same noted-target delayed-self-LTB
//     primitive Runesword does. Defer the whole card until it lands.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// RED (#413 / #419)
// ─────────────────────────────────────────────────────────────────────────────

// Blood Moon — "Nonbasic lands are Mountains." (CR 305.7 type-changing effect,
// CR 611/613 layers.) Every NONBASIC land on the battlefield loses its other
// land types and ALL of its printed abilities, has its subtype set to Mountain,
// and gains the intrinsic "{T}: Add {R}" basic-land mana ability (CR 305.6,
// which falls out of `LAND_SUBTYPE_MANA` once the subtype is Mountain). Basic
// lands (including basic Mountains) are untouched.
//
// Composed from two existing static-effect primitives (no new engine kind):
//   • `ability-loss` (CR 613.1f layer 6) — strips the land's printed activated
//     mana abilities, triggered abilities, and keywords. This is the same
//     generic "loses all abilities" static introduced for Titania's Song; the
//     payment path (`getActivatedManaAbility` and the producible-mana planner)
//     is suppression-gated, so a dual land under Blood Moon stops offering its
//     original colors and falls through to the intrinsic Mountain {R}.
//   • `subtype-set` (CR 305.7 layer 4) — replaces the land's subtypes with
//     `["Mountain"]`, which makes `getBasicLandMana` return {R}.
// The layer system recomputes both live and `unapplySourceStaticEffects`
// reverts them cleanly when Blood Moon leaves the battlefield.
const IS_NONBASIC_LAND: (
    target: PermanentView,
    source: PermanentView,
    ctx: StaticEffectContext
) => boolean = (target, _source, ctx) =>
    ctx.getPrintedTypes(target).includes("Land") &&
    !ctx.hasSupertype(target, "Basic");

export const bloodMoon: CardDefinition = {
    id: "78373616-e2d6-4ccf-998f-09f02bea45b4",
    name: "Blood Moon",
    oracleText: "Nonbasic lands are Mountains.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    staticEffects: [
        // CR 613.1f — strip all printed abilities (and other land types) BEFORE
        // the subtype change so the only ability the land has afterward is the
        // intrinsic Mountain mana ability granted by its new subtype.
        {
            kind: "ability-loss",
            applies: IS_NONBASIC_LAND,
        },
        // CR 305.7 — the land's land types become Mountain (and only Mountain).
        {
            kind: "subtype-set",
            applies: IS_NONBASIC_LAND,
            subtypes: ["Mountain"],
        },
    ],
};

// Worms of the Earth — {2}{B}{B}{B} Enchantment.
// "Players can't play lands.\nLands can't enter the battlefield.\nAt the
//  beginning of each upkeep, any player may sacrifice two lands of their choice
//  or have this enchantment deal 5 damage to that player. If a player does
//  either, destroy this enchantment."
//
// Two prohibitions (CR 614 — a land that would enter is prevented; a player
// can't take the land-play special action, CR 305.1):
//   • `preventsLandPlayAndETB: true` — a CardDefinition marker scanned live
//     from the battlefield (like Fastbond's `extraLandDrops`). `getLegalActions`
//     suppresses the "play" land action and every battlefield-entry site
//     (`canLandEnterBattlefield`) prevents a land from entering. The lock lifts
//     automatically the instant Worms leaves play (no LTB cleanup); the engine
//     mirrors it into `state.landPlayLocked` for serialization.
//
// Upkeep clause (CR 603.6a "each" upkeep; CR 117.3a optional; CR 701.16
// sacrifice): on EVERY player's upkeep, that player MAY (a) sacrifice two of
// their lands, OR (b) take 5 damage from Worms; if they do EITHER, destroy
// Worms. Modeled as a three-way option pick (sacrifice / take 5 / decline);
// the "sacrifice two lands" option is offered only when the player controls at
// least two lands. `resolveSteps` checkpoints the irreversible
// sacrifice/damage before `destroy`, so a suspended choice never re-applies.
export const wormsOfTheEarth: CardDefinition = {
    id: "65a97821-ca5b-46fb-af08-86de81d0daac",
    name: "Worms of the Earth",
    oracleText:
        "Players can't play lands.\nLands can't enter the battlefield.\nAt the beginning of each upkeep, any player may sacrifice two lands of their choice or have this enchantment deal 5 damage to that player. If a player does either, destroy this enchantment.",
    manaCost: { X: 2, B: 3 },
    types: ["Enchantment"],
    preventsLandPlayAndETB: true,
    triggeredAbilities: [
        phaseTrigger({
            id: "worms-of-the-earth-upkeep",
            oracleText:
                "At the beginning of each upkeep, any player may sacrifice two lands of their choice or have this enchantment deal 5 damage to that player. If a player does either, destroy this enchantment.",
            phase: "UPKEEP",
            scope: "each",
            resolveSteps: [
                (ctx, playerId) => {
                    const self: TargetSelection = {
                        type: "permanent",
                        id: ctx.sourceInstanceId,
                    };
                    const landIds = ctx.getBattlefieldIds(playerId, {
                        types: "Land",
                    });
                    // CR 117.3a — the upkeep player chooses. "Sacrifice two
                    // lands" is offered only when they control at least two.
                    const options = [
                        ...(landIds.length >= 2
                            ? [
                                  {
                                      id: "sacrifice",
                                      label: "Sacrifice two lands (destroys Worms of the Earth)",
                                  },
                              ]
                            : []),
                        {
                            id: "damage",
                            label: "Take 5 damage (destroys Worms of the Earth)",
                        },
                        { id: "decline", label: "Do nothing" },
                    ];
                    const choice = ctx.requestOptionChoice({
                        playerId,
                        choiceId: `worms-${playerId}`,
                        options,
                        prompt: "Worms of the Earth: sacrifice two lands or take 5 damage?",
                    });
                    if (choice === undefined) return;
                    if (choice === "sacrifice") {
                        const picked = ctx.requestChoice({
                            playerId,
                            choiceId: `worms-sac-${playerId}`,
                            kind: "sacrifice-permanents",
                            zone: "battlefield",
                            filter: { types: "Land" },
                            count: 2,
                            prompt: "Sacrifice two lands.",
                        });
                        if (picked === undefined) return;
                        for (const id of picked) ctx.sacrifice(id);
                        ctx.destroy(self);
                    } else if (choice === "damage") {
                        ctx.dealDamage({ type: "player", id: playerId }, 5);
                        ctx.destroy(self);
                    }
                    // decline: do nothing; Worms survives.
                },
            ],
        }),
    ],
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

// ─────────────────────────────────────────────────────────────────────────────
// Deferred — two DRK BLUE cards (#412) each need an unbuilt engine capability
// that the free tranche does NOT ship. Intentionally NOT registered (no exported
// CardDefinition) to keep the pool honest; flagged in the PR. TODO(#412):
//
//   • Leviathan (Creature) — "Trample\nThis creature enters tapped and doesn't
//     untap during your untap step.\nAt the beginning of your upkeep, you may
//     sacrifice two Islands. If you do, untap this creature.\nThis creature
//     can't attack unless you sacrifice two Islands. (This cost is paid as
//     attackers are declared.)" Every clause but the last is free-tranche
//     (entersTapped + `does-not-untap` keyword + may-pay-to-untap upkeep
//     trigger — the Island Fish Jasconius template). The last clause is an
//     ATTACK COST: sacrificing two Islands as a cost paid WHEN attackers are
//     declared. `attack-restriction` is a pure board predicate (no cost
//     payment), and `validateAttackerEligibility` has no cost-payment plumbing
//     at declaration. Shipping Leviathan without an enforced attack cost would
//     be a free attacker — defer the whole card until the attack-cost primitive
//     lands.
//
//   • Tangle Kelp (Aura) — "Enchant creature\nWhen this Aura enters, tap
//     enchanted creature.\nEnchanted creature doesn't untap during its
//     controller's untap step if it attacked during its controller's last
//     turn." The ETB tap is free-tranche, but the untap-prevention is
//     CONDITIONAL on "attacked during its controller's LAST turn" — a
//     cross-turn attack history that the engine does not persist
//     (`hasAttackedThisTurn` is cleared at every CLEANUP) — AND it must be a
//     conditional, host-scoped untap restriction re-evaluated each untap step
//     (the `does-not-untap` keyword is unconditional; `keyword-grant` applies
//     once at attach, not per-step). Both are unbuilt; defer the whole card.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// C3 — Mana-production lookup / replacement (#420). Three cards that read or
// rewrite mana production rather than producing fixed mana. They reuse the
// existing mana-ability machinery generalized along two new, orthogonal axes:
//   • board-conditional mana CHOICES (`getManaChoices`) — the choice analog of
//     the shipped board-conditional `manaAmount` (Urza lands). Fellwar Stone.
//   • a per-turn land-mana TYPE replacement (`replaceLandManaWithBlue`, CR 614)
//     funnelled through the single `applyLandManaReplacement` hook every tap
//     path already routes its produced mana through. Deep Water.
//   • a generic hand → battlefield zone move (`putFromHandOntoBattlefield`,
//     CR 400.7), mirroring `putFromLibraryOntoBattlefield`. Gaea's Touch.
// ─────────────────────────────────────────────────────────────────────────────

// Fellwar Stone — "{T}: Add one mana of any color that a land an opponent
// controls could produce." (CR 605.1a mana ability; CR 106.4 "could produce".
// The colour set is board-conditional, so the ability declares a
// `getManaChoices` hook — the choice analog of the Urza lands' `manaAmount` —
// that reads every opponent's lands' producible colours at activation time. The
// static `manaChoices` is the representative / fallback list for best-effort
// callers without a board snapshot (affordability, autoTap).)
export const fellwarStone: CardDefinition = {
    id: "6722c0e0-13c7-5a24-bd60-f89836d48ef9",
    name: "Fellwar Stone",
    oracleText:
        "{T}: Add one mana of any color that a land an opponent controls could produce.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "fellwar-stone-mana",
            oracleText:
                "{T}: Add one mana of any color that a land an opponent controls could produce.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ W: 1 }),
            // Fallback / representative options (any single colour). The engine
            // overrides this with `getManaChoices` when a board snapshot exists.
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
            // CR 106.4 — "any color a land an opponent controls could produce":
            // union the producible colours of every LAND controlled by a player
            // other than Fellwar Stone's controller, then offer one mana of each.
            // `producibleColors` is precomputed by the engine (colourless {C}
            // already excluded — CR 202.2). Empty when no opponent controls a
            // colour-producing land (the ability is still activatable per
            // CR 605.1a, but yields no legal choice).
            getManaChoices: (_source, controllerId, battlefields) => {
                const colors = new Set<Color>();
                for (const { playerId, permanents } of battlefields) {
                    if (playerId === controllerId) continue;
                    for (const { permanent, producibleColors } of permanents) {
                        if (!permanent.types.includes("Land")) continue;
                        for (const c of producibleColors) colors.add(c);
                    }
                }
                return (["W", "U", "B", "R", "G"] as const)
                    .filter((c) => colors.has(c))
                    .map((c) => ({ [c]: 1 }) as ManaCost);
            },
        },
    ],
};

// Deep Water — "{U}: Until end of turn, if you tap a land you control for mana,
// it produces {U} instead of any other type." (CR 605 activated ability that
// resolves on the stack; CR 614 self-replacement of the mana TYPE — the same
// total quantity is produced, only the colour becomes {U}. The replacement is a
// per-turn, controller-scoped flag (`replaceLandManaWithBlue`) consumed by the
// engine's single `applyLandManaReplacement` mana funnel; expires at CLEANUP,
// CR 514.2.)
export const deepWater: CardDefinition = {
    id: "22fc22cd-5b76-5f93-bbb2-e15af8c0768b",
    name: "Deep Water",
    oracleText:
        "{U}: Until end of turn, if you tap a land you control for mana, it produces {U} instead of any other type.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "deep-water-replace",
            oracleText:
                "{U}: Until end of turn, if you tap a land you control for mana, it produces {U} instead of any other type.",
            cost: { mana: { U: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 614 — arm the controller's land-mana → {U} replacement for
                // the rest of the turn.
                ctx.replaceLandManaWithBlue(ctx.controller);
            },
        },
    ],
};

// Gaea's Touch — "{0}: You may put a basic Forest card from your hand onto the
// battlefield. Activate only as a sorcery and only once each turn.\nSacrifice
// this enchantment: Add {G}{G}." (CR 605: the first ability uses the stack —
// "as a sorcery" timing (CR 605.3b is for mana abilities; this is the
// sorcery-speed gate: own main phase, empty stack, `controllerTurnOnly` +
// `activationPhaseRestriction`) and `oncePerTurn`; CR 400.7 hand → battlefield
// via `putFromHandOntoBattlefield`. The second is a mana ability with a
// sacrifice cost, CR 605.1a.)
export const gaeasTouch: CardDefinition = {
    id: "766b09da-d1e1-568c-a543-88fc63f61896",
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

// CR 611.2c — shared source-gate for the Goblin Caves / Goblin Shrine anthems:
// "as long as enchanted land is a basic Mountain". Reads the Aura's host
// (`source.attachedTo`) from the live board and returns true only when that host
// is a permanent with the Basic supertype and the Mountain subtype (CR 205.4a /
// 205.3). False when the Aura is unattached or the host isn't a basic Mountain.
function enchantedLandIsBasicMountain(
    source: PermanentView,
    state: StaticEffectStateView,
    ctx: StaticEffectContext
): boolean {
    const hostId = source.attachedTo;
    if (hostId === undefined) return false;
    for (const player of state.players) {
        const host = player.battlefield.find((c) => c.id === hostId);
        if (host) {
            return (
                ctx.hasSupertype(host, "Basic") &&
                host.subtypes.includes("Mountain")
            );
        }
    }
    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// RED (#414) — free-tranche reuse. Every card here is expressible with shipped
// primitives: keywords (trample/haste/flying via `staticAbilities`), phase /
// state / attack triggers, activated abilities (damage to target+self, pump,
// landwalk grant, protection grant, mana, sacrifice-for-mana), layer-7 anthems
// (`pt-buff` with `applies`/`condition`), `attack-restriction` statics, the
// `does-not-untap` family (`skipNextUntap` armed on attack), `dealDamageToEach`
// sweepers, and the coin-flip RNG (`flipCoin`). No new engine capability.
// Modern Scryfall oracle text (ADR 0004); ids are scryfallOracleId from DRK.json.
// ─────────────────────────────────────────────────────────────────────────────

// Ball Lightning — "Trample, haste\nAt the beginning of the end step, sacrifice
// this creature." (CR 702.19 trample + CR 702.10 haste as keywords; CR 603.6a
// end-step phaseTrigger scoped to `each` so it fires on the active player's end
// step regardless of whose turn it is — Ball Lightning is sacrificed on the end
// step of the turn it was cast, and on any end step thereafter if it somehow
// survives.)
export const ballLightning: CardDefinition = {
    id: "7485cf25-eb41-4397-be13-7f0b8c10c70a",
    name: "Ball Lightning",
    oracleText:
        "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)\nHaste (This creature can attack and {T} as soon as it comes under your control.)\nAt the beginning of the end step, sacrifice this creature.",
    manaCost: { R: 3 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 6,
    toughness: 1,
    staticAbilities: ["trample", "haste"],
    triggeredAbilities: [
        phaseTrigger({
            id: "ball-lightning-end-step-sac",
            oracleText:
                "At the beginning of the end step, sacrifice this creature.",
            phase: "END_STEP",
            scope: "each",
            resolve: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};

// Brothers of Fire — "{1}{R}{R}: This creature deals 1 damage to any target and
// 1 damage to you." (CR 605 activated ability on the stack; CR 115.4 "any
// target"; the rider deals 1 to the controller — CR 120.3.)
export const brothersOfFire: CardDefinition = {
    id: "ee9208e7-2075-45b9-9ed7-b18e1a280d79",
    name: "Brothers of Fire",
    oracleText:
        "{1}{R}{R}: This creature deals 1 damage to any target and 1 damage to you.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Shaman"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "brothers-of-fire-bolt",
            oracleText:
                "{1}{R}{R}: This creature deals 1 damage to any target and 1 damage to you.",
            cost: { mana: { X: 1, R: 2 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.dealDamage(target, 1);
                // CR 120.3 — the rider always damages the controller.
                ctx.dealDamage({ type: "player", id: ctx.controller }, 1);
            },
        },
    ],
};

// Cave People — "Whenever this creature attacks, it gets +1/-2 until end of
// turn.\n{1}{R}{R}, {T}: Target creature gains mountainwalk until end of turn."
// (CR 508 attack trigger applying a temporary P/T mod to itself; CR 605
// activated ability granting the `mountainwalk` keyword to a target until EOT —
// the Part Water grant pattern.)
export const cavePeople: CardDefinition = {
    id: "6a4e8d44-e6ee-40f7-8df4-52fa4cb346aa",
    name: "Cave People",
    oracleText:
        "Whenever this creature attacks, it gets +1/-2 until end of turn.\n{1}{R}{R}, {T}: Target creature gains mountainwalk until end of turn.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 1,
    toughness: 4,
    triggeredAbilities: [
        {
            id: "cave-people-attack-pump",
            oracleText:
                "Whenever this creature attacks, it gets +1/-2 until end of turn.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    -2,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
    activatedAbilities: [
        {
            id: "cave-people-grant-mountainwalk",
            oracleText:
                "{1}{R}{R}, {T}: Target creature gains mountainwalk until end of turn.",
            cost: { tap: true, mana: { X: 1, R: 2 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.grantStaticAbility(target, "mountainwalk", {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Eternal Flame — "Eternal Flame deals X damage to target opponent or
// planeswalker and half X damage, rounded up, to you, where X is the number of
// Mountains you control." (CR 120 damage; X is a board count read at resolve,
// NOT a cast-time {X}; the self-damage is half rounded up — CR 107.4-style
// rounding, Math.ceil(X/2).) Modern oracle (ADR 0004): target is an opponent or
// planeswalker.
export const eternalFlame: CardDefinition = {
    id: "b3119f27-45fd-4411-8a09-5f8d3cd8d927",
    name: "Eternal Flame",
    oracleText:
        "Eternal Flame deals X damage to target opponent or planeswalker and half X damage, rounded up, to you, where X is the number of Mountains you control.",
    manaCost: { X: 2, R: 2 },
    types: ["Sorcery"],
    // CR 115.4 — "target opponent or planeswalker": an OPPONENT player target
    // (`controller: "opponent"`, honored for player targets here — see Jovial
    // Evil / Mana Clash) or a Planeswalker permanent. The free-tranche engine
    // has no planeswalkers in pool, so the practical legal target is an opponent.
    targetRequirement: {
        type: ["player", "Planeswalker"],
        count: 1,
        controller: "opponent",
    },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target) return;
        // X = Mountains the controller controls, read at resolution (CR 608.2).
        const x = ctx
            .getBattlefieldIds(ctx.controller, { types: "Land" })
            .filter((id) =>
                ctx.hasSubtype({ type: "permanent", id }, "Mountain")
            ).length;
        ctx.dealDamage(target, x);
        // Half X rounded up to the controller.
        const half = Math.ceil(x / 2);
        if (half > 0) {
            ctx.dealDamage({ type: "player", id: ctx.controller }, half);
        }
    },
};

// Fire Drake — "Flying\n{R}: This creature gets +1/+0 until end of turn.
// Activate only once each turn." (CR 702.9 flying keyword; CR 605 pump activated
// ability with `oncePerTurn`.)
export const fireDrake: CardDefinition = {
    id: "fd3bcc9b-7d84-478e-aef5-2e44610107c7",
    name: "Fire Drake",
    oracleText:
        "Flying\n{R}: This creature gets +1/+0 until end of turn. Activate only once each turn.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Drake"],
    power: 1,
    toughness: 2,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "fire-drake-pump",
            oracleText:
                "{R}: This creature gets +1/+0 until end of turn. Activate only once each turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            oncePerTurn: true,
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

// Fissure — "Destroy target creature or land. It can't be regenerated."
// (CR 701.7 destroy with the regen-shield suppression; CR 114 multi-type
// target.)
export const fissure: CardDefinition = {
    id: "c8b1e9f3-b014-4e57-b278-6d84a7e88b23",
    name: "Fissure",
    oracleText: "Destroy target creature or land. It can't be regenerated.",
    manaCost: { X: 3, R: 2 },
    types: ["Instant"],
    targetRequirement: { type: ["Creature", "Land"], count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target) ctx.destroy(target, { cantBeRegenerated: true });
    },
};

// Goblin Caves — Aura. "Enchant land\nAs long as enchanted land is a basic
// Mountain, Goblin creatures get +0/+2." (CR 303.4 Aura enchant land; CR 611
// layer 7c conditional anthem — a `pt-buff` whose `applies` filters Goblin
// creatures and whose `condition` gates on the enchanted land being a BASIC
// Mountain, read from the Aura's host via `attachedTo`.)
export const goblinCaves: CardDefinition = {
    id: "3ab5c3a7-12e7-4394-a495-0bc7c310bf9c",
    name: "Goblin Caves",
    oracleText:
        "Enchant land\nAs long as enchanted land is a basic Mountain, Goblin creatures get +0/+2.",
    manaCost: { X: 1, R: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.hasSubtype(target, "Goblin"),
            // CR 611.2c — active only while the enchanted land is a basic
            // Mountain. Re-evaluated each read against the live board.
            condition: enchantedLandIsBasicMountain,
            power: 0,
            toughness: 2,
        },
    ],
};

// Goblin Digging Team — "{T}, Sacrifice this creature: Destroy target Wall."
// (CR 605 activated ability with tap + self-sacrifice cost; CR 701.7 destroy
// restricted to Wall-subtyped creatures via `subtypeFilter`.)
export const goblinDiggingTeam: CardDefinition = {
    id: "8408f2a1-e321-43f5-a7d1-1911eba9d706",
    name: "Goblin Digging Team",
    oracleText: "{T}, Sacrifice this creature: Destroy target Wall.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "goblin-digging-team-destroy-wall",
            oracleText: "{T}, Sacrifice this creature: Destroy target Wall.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Wall",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.destroy(target);
            },
        },
    ],
};

// Goblin Rock Sled — "Trample\nThis creature doesn't untap during your untap
// step if it attacked during your last turn.\nThis creature can't attack unless
// defending player controls a Mountain." (CR 702.19 trample; the conditional
// untap restriction is implemented by ARMING a one-shot `skipNextUntap` when
// the Sled attacks — its controller's NEXT untap step is the "your next turn"
// untap, so a Sled that attacked this turn stays tapped next turn, CR 302.6 /
// 502.1; the attack restriction is a pure board predicate, CR 508.1c.)
export const goblinRockSled: CardDefinition = {
    id: "ada3247e-ec5e-499d-bc15-1d9dd80a59ae",
    name: "Goblin Rock Sled",
    oracleText:
        "Trample\nThis creature doesn't untap during your untap step if it attacked during your last turn.\nThis creature can't attack unless defending player controls a Mountain.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 3,
    toughness: 1,
    staticAbilities: ["trample"],
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "goblin-rock-sled-mountain-restriction",
            oracleText:
                "This creature can't attack unless defending player controls a Mountain.",
            predicate: (_self, defenderBattlefield) =>
                defenderBattlefield.some((c) =>
                    c.subtypes.includes("Mountain")
                ),
        },
    ],
    triggeredAbilities: [
        {
            id: "goblin-rock-sled-arm-skip-untap",
            oracleText:
                "This creature doesn't untap during your untap step if it attacked during your last turn.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx) => {
                // CR 302.6 / 502.1 — arm a one-shot "doesn't untap next untap
                // step" on the Sled. The controller's next untap step is their
                // next turn's, so a Sled that attacked this turn stays tapped
                // then. Cleared automatically after exactly one untap step.
                ctx.skipNextUntap({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};

// Goblin Shrine — Aura. "Enchant land\nAs long as enchanted land is a basic
// Mountain, Goblin creatures get +1/+0.\nWhen this Aura leaves the battlefield,
// it deals 1 damage to each Goblin creature." (CR 611 conditional anthem +
// CR 603.6 LTB trigger dealing 1 to each Goblin via `dealDamageToEach`.)
export const goblinShrine: CardDefinition = {
    id: "5e35df8a-2404-4b3b-888a-25d663bd4383",
    name: "Goblin Shrine",
    oracleText:
        "Enchant land\nAs long as enchanted land is a basic Mountain, Goblin creatures get +1/+0.\nWhen this Aura leaves the battlefield, it deals 1 damage to each Goblin creature.",
    manaCost: { X: 1, R: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.hasSubtype(target, "Goblin"),
            condition: enchantedLandIsBasicMountain,
            power: 1,
            toughness: 0,
        },
    ],
    triggeredAbilities: [
        leftTrigger({
            id: "goblin-shrine-leaves",
            oracleText:
                "When this Aura leaves the battlefield, it deals 1 damage to each Goblin creature.",
            scope: "self",
            resolve: (ctx: SpellContext) => {
                // CR 120.3 — 1 damage to every Goblin creature on the
                // battlefield (any controller).
                ctx.dealDamageToEach(1, {
                    creatures: { subtypes: "Goblin" },
                });
            },
        }),
    ],
};

// Goblin Wizard — "{T}: You may put a Goblin permanent card from your hand onto
// the battlefield.\n{R}: Target Goblin gains protection from white until end of
// turn." (CR 605: the first is a non-mana activated ability — a hand →
// battlefield zone move, CR 400.7, via `putFromHandOntoBattlefield`; the second
// grants the `protection from white` keyword to a Goblin until EOT, CR 702.16.)
export const goblinWizard: CardDefinition = {
    id: "912c99a0-ee97-4bb9-8ab7-2e469d74fa03",
    name: "Goblin Wizard",
    oracleText:
        "{T}: You may put a Goblin permanent card from your hand onto the battlefield.\n{R}: Target Goblin gains protection from white until end of turn.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Goblin", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "goblin-wizard-put-goblin",
            oracleText:
                "{T}: You may put a Goblin permanent card from your hand onto the battlefield.",
            cost: { tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 205.3 — a "Goblin permanent card" is a card that is a
                // permanent type (not Instant/Sorcery) and has the Goblin
                // subtype. Restrict the optional pick to those in hand.
                const candidateIds = ctx
                    .getHandCards(ctx.controller)
                    .filter(
                        (c) =>
                            c.subtypes.includes("Goblin") &&
                            !c.types.includes("Instant") &&
                            !c.types.includes("Sorcery")
                    )
                    .map((c) => c.id);
                if (candidateIds.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `goblin-wizard-${ctx.sourceInstanceId}`,
                    kind: "choose-hand-card",
                    zone: "hand",
                    candidateIds,
                    count: { min: 0, max: 1 },
                    prompt: "You may put a Goblin permanent from your hand onto the battlefield.",
                });
                if (picks === undefined) return; // suspended
                const id = picks[0];
                if (!id) return; // declined
                ctx.putFromHandOntoBattlefield(ctx.controller, id);
            },
        },
        {
            id: "goblin-wizard-protection",
            oracleText:
                "{R}: Target Goblin gains protection from white until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Goblin",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.grantStaticAbility(target, "protection from white", {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Goblins of the Flarg — "Mountainwalk\nWhen you control a Dwarf, sacrifice this
// creature." (CR 702.19 landwalk keyword; CR 603.8 state-trigger self-sacrifice
// when the controller controls a Dwarf.)
export const goblinsOfTheFlarg: CardDefinition = {
    id: "3a620d92-ec92-4733-8c05-7fa1b956bab6",
    name: "Goblins of the Flarg",
    oracleText:
        "Mountainwalk (This creature can't be blocked as long as defending player controls a Mountain.)\nWhen you control a Dwarf, sacrifice this creature.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Warrior"],
    power: 1,
    toughness: 1,
    staticAbilities: ["mountainwalk"],
    triggeredAbilities: [
        stateTrigger({
            id: "goblins-flarg-dwarf-sac",
            oracleText: "When you control a Dwarf, sacrifice this creature.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                return (
                    controller?.battlefield.some((c) =>
                        c.subtypes.includes("Dwarf")
                    ) ?? false
                );
            },
            resolve: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};

// Inferno — "Inferno deals 6 damage to each creature and each player."
// (CR 120.3 mass damage to every creature and both players via
// `dealDamageToEach`.)
export const inferno: CardDefinition = {
    id: "69e2df4e-c7f3-4c3a-be5b-1c4afb29cead",
    name: "Inferno",
    oracleText: "Inferno deals 6 damage to each creature and each player.",
    manaCost: { X: 5, R: 2 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        ctx.dealDamageToEach(6, { creatures: true, players: true });
    },
};

// Mana Clash — "You and target opponent each flip a coin. Mana Clash deals 1
// damage to each player whose coin comes up tails. Repeat this process until
// both players' coins come up heads on the same flip." (CR 705 coin flips via
// the seeded `flipCoin`; the loop repeats until BOTH coins are heads in the same
// round. Synchronous flips — no per-flip reveal pause — keep the loop a single
// deterministic resolution.)
export const manaClash: CardDefinition = {
    id: "a2f5a5fd-14dc-48e8-bdb0-984a83288023",
    name: "Mana Clash",
    oracleText:
        "You and target opponent each flip a coin. Mana Clash deals 1 damage to each player whose coin comes up tails. Repeat this process until both players' coins come up heads on the same flip.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        const you = ctx.controller;
        const opponent = target.id;
        // CR 705.2 — repeat: each flips a coin; a tails takes 1 damage; stop
        // only when BOTH come up heads on the same flip. The seeded PRNG makes
        // the loop deterministic under replay; each iteration has a 1/4 chance
        // to terminate, so a 10000-round cap is an unreachable safety bound that
        // also prevents a degenerate seed from hanging the mutation.
        for (let i = 0; i < 10000; i++) {
            const youHeads = ctx.flipCoin();
            const oppHeads = ctx.flipCoin();
            if (!youHeads) ctx.dealDamage({ type: "player", id: you }, 1);
            if (!oppHeads) ctx.dealDamage({ type: "player", id: opponent }, 1);
            if (youHeads && oppHeads) break;
        }
    },
};

// Orc General — "{T}, Sacrifice another Orc or Goblin: Other Orc creatures get
// +1/+1 until end of turn." (CR 605 activated ability with tap + a
// "sacrifice another [Orc or Goblin]" cost via `sacrificeFilter`; the buff is a
// team pump on OTHER Orcs the controller controls, CR 611.1.)
export const orcGeneral: CardDefinition = {
    id: "1f696446-30ba-42ab-b4fc-ee9c956b0a62",
    name: "Orc General",
    oracleText:
        "{T}, Sacrifice another Orc or Goblin: Other Orc creatures get +1/+1 until end of turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Orc", "Warrior"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "orc-general-pump",
            oracleText:
                "{T}, Sacrifice another Orc or Goblin: Other Orc creatures get +1/+1 until end of turn.",
            cost: {
                tap: true,
                // "another Orc or Goblin": a creature with the Orc OR Goblin
                // subtype, other than Orc General itself (CR 602.1 — "another"
                // excludes the source, enforced at activation).
                sacrificeFilter: {
                    types: "Creature",
                    subtypes: ["Orc", "Goblin"],
                    excludeInstanceIds: [],
                },
            },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 611.1 — +1/+1 EOT to OTHER Orc creatures the controller
                // controls (excluding Orc General itself).
                const orcs = ctx
                    .getBattlefieldIds(ctx.controller, {
                        types: "Creature",
                        subtypes: "Orc",
                    })
                    .filter((id) => id !== ctx.sourceInstanceId);
                for (const id of orcs) {
                    ctx.addTemporaryPTBuff({ type: "permanent", id }, 1, 1, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Sisters of the Flame — "{T}: Add {R}." (CR 605.1a mana ability — resolves
// immediately, no stack, CR 605.3a.)
export const sistersOfTheFlame: CardDefinition = {
    id: "389a9d46-d3fb-47f0-91cd-f6d487636916",
    name: "Sisters of the Flame",
    oracleText: "{T}: Add {R}.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Shaman"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "sisters-of-the-flame-mana",
            oracleText: "{T}: Add {R}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ R: 1 }),
            manaProduced: { R: 1 },
        },
    ],
};

// Coal Golem — "{3}, Sacrifice this creature: Add {R}{R}{R}." (CR 605.1a mana
// ability with a {3} + self-sacrifice cost — the Gaea's Touch sacrifice-for-mana
// shape, resolves immediately.)
export const coalGolem: CardDefinition = {
    id: "64b63847-27dd-469b-aad3-58e061f92817",
    name: "Coal Golem",
    oracleText: "{3}, Sacrifice this creature: Add {R}{R}{R}.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "coal-golem-sacrifice-mana",
            oracleText: "{3}, Sacrifice this creature: Add {R}{R}{R}.",
            cost: { mana: { X: 3 }, sacrifice: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ R: 3 }),
            manaProduced: { R: 3 },
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

// ─────────────────────────────────────────────────────────────────────────────
// C9 — Swap blockers (Sorrow's Path, PRD #409 / issue #426)
// ─────────────────────────────────────────────────────────────────────────────
//
// Sorrow's Path — "{T}: Choose two target blocking creatures controlled by the
// same opponent. If each of those creatures could block all creatures that the
// other is blocking, remove both of them from combat. Each one then blocks all
// creatures the other was blocking.\nWhenever this land becomes tapped, it deals
// 2 damage to you and each creature you control."
//
// Two abilities, both reusing shipped primitives — no Sorrow's-Path-shaped
// engine code:
//
//   1. Block reassignment (activated, {T}). The "two blocking creatures" choice
//      is a plain `targetRequirement` (count 2, `combatRoleFilter: "blocking"`,
//      `controller: "opponent"`). In a 2-player game there is exactly one
//      opponent, so "controlled by the same opponent" is already guaranteed by
//      `controller: "opponent"` (no cross-target same-controller constraint
//      needed). The swap-and-legality clause is the generic
//      `ctx.reassignBlocks(a, b)` combat primitive (CR 509.1 / 506.4): it reads
//      each blocker's assigned attacker set, verifies — via the same
//      `validateBlockerEligibility` the declare-blockers step uses — that each
//      could legally block the OTHER's set, and only then swaps. If the legality
//      gate fails it is a no-op, matching the card's "if each ... could block
//      all creatures the other is blocking" hard condition.
//
//   2. On-tap drawback (triggered, becomes-tapped). `tappedTrigger` scoped to
//      `self` (CR 701.20a). The "2 damage to you and each creature you control"
//      decomposes into `dealDamage` to the controller plus a loop over the
//      controller's creatures (`getBattlefieldIds` filtered to Creatures) —
//      reuse, no new sweep primitive. CR 120 damage path so prevention /
//      replacement effects apply. NB: tapping for the activated ability ALSO
//      fires this trigger (the cost taps the land → PERMANENT_TAPPED), which is
//      exactly the printed self-punishing interaction.
export const sorrowsPath: CardDefinition = {
    id: "5d4b3c2a-1f0e-49d8-b7a6-426000000009",
    name: "Sorrow's Path",
    oracleText:
        "{T}: Choose two target blocking creatures controlled by the same opponent. If each of those creatures could block all creatures that the other is blocking, remove both of them from combat. Each one then blocks all creatures the other was blocking.\nWhenever this land becomes tapped, it deals 2 damage to you and each creature you control.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "sorrows-path-swap-blockers",
            oracleText:
                "{T}: Choose two target blocking creatures controlled by the same opponent. If each of those creatures could block all creatures that the other is blocking, remove both of them from combat. Each one then blocks all creatures the other was blocking.",
            cost: { tap: true },
            useStack: true,
            // CR 509.1 — both targets must be blocking; `controller: "opponent"`
            // covers "controlled by the same opponent" in 2-player (one opp).
            targetRequirement: {
                type: "Creature",
                count: 2,
                combatRoleFilter: "blocking",
                controller: "opponent",
            },
            resolve: (ctx: SpellContext) => {
                const [a, b] = ctx.targets;
                if (a?.type !== "permanent" || b?.type !== "permanent") return;
                // The whole legality gate + atomic swap lives in the primitive
                // (CR 509.1 / 506.4); a failed gate is a clean no-op.
                ctx.reassignBlocks(a.id, b.id);
            },
        },
    ],
    triggeredAbilities: [
        tappedTrigger({
            id: "sorrows-path-tap-drawback",
            oracleText:
                "Whenever this land becomes tapped, it deals 2 damage to you and each creature you control.",
            // CR 701.20a — fires when THIS permanent becomes tapped (including
            // when its own {T} cost taps it).
            scope: "self",
            resolve: (ctx) => {
                // CR 120 — "you" = the controller; then each creature the
                // controller controls. Both go through the normal damage path.
                ctx.dealDamage({ type: "player", id: ctx.controller }, 2);
                const myCreatures = ctx.getBattlefieldIds(ctx.controller, {
                    types: "Creature",
                });
                for (const id of myCreatures) {
                    ctx.dealDamage({ type: "permanent", id }, 2);
                }
            },
        }),
    ],
};
