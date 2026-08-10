// Emblem registry (CR 114) — issue #1221.
//
// The central, closure-bearing index of every emblem an effect can create,
// keyed by id. It is the emblem analogue of the card registry: game state
// stores an emblem only by KEY (`EmblemInstance.emblemId`), and the layer
// system / trigger scanner resolve the granted continuous / triggered
// abilities from here at read time. Keeping the closures out of `GameState`
// keeps it JSON-pure and serializable (ADR 0046).
//
// An emblem's abilities affect the game "from outside" the battlefield
// (CR 114.1, 113.6) — a continuous static ability is collected owner-scoped by
// `layers.ts` with the emblem as a source-less virtual source; a triggered
// ability is collected owner-scoped by `triggers.ts`. See ADR 0058 (loyalty
// framework, #700) for the planeswalker ultimates that create them.

import type { EmblemDefinition, GameEvent, PermanentView } from "./types";
import { PERMANENT_TYPES } from "./types";

const EMBLEM_REGISTRY = new Map<string, EmblemDefinition>();

/** Register an emblem definition. Idempotent per id (last write wins), so
 *  hot-reload / test re-registration is safe. */
export function registerEmblemDefinition(def: EmblemDefinition): void {
    EMBLEM_REGISTRY.set(def.id, def);
}

/** Look up an emblem definition by key, or `undefined` if unregistered. */
export function tryGetEmblemDefinition(
    id: string
): EmblemDefinition | undefined {
    return EMBLEM_REGISTRY.get(id);
}

/** Look up an emblem definition by key. Throws if unregistered — an emblem Op
 *  that names a missing key is a bug, not a silent no-op. */
export function getEmblemDefinition(id: string): EmblemDefinition {
    const def = EMBLEM_REGISTRY.get(id);
    if (!def) {
        throw new Error(`Unknown emblem id: ${id}`);
    }
    return def;
}

/** True if `id` names a registered emblem. */
export function isRegisteredEmblem(id: string): boolean {
    return EMBLEM_REGISTRY.has(id);
}

/** Every registered emblem definition — the catalogue-wide art/registration
 *  guard (`__tests__/emblemArt.test.ts`) sweeps this to assert each emblem
 *  ships with `imagePrintId` and renderable triggered-ability text. */
export function getAllEmblemDefinitions(): EmblemDefinition[] {
    return [...EMBLEM_REGISTRY.values()];
}

// ─────────────────────────────────────────────────────────────────────────
// Shipped emblems
// ─────────────────────────────────────────────────────────────────────────

/** Sorin, Lord of Innistrad −2 emblem (DKA, issue #1221 tracer). A CR 611.2c
 *  owner-scoped anthem (layer 7d `pt-buff`): "Creatures you control get +1/+0."
 *  Reuses the exact Crusade-style predicate (`controllerId` match) with the
 *  emblem's owner as the synthetic source's controller. */
export const SORIN_LORD_OF_INNISTRAD_EMBLEM_ID =
    "sorin-lord-of-innistrad-emblem";

registerEmblemDefinition({
    id: SORIN_LORD_OF_INNISTRAD_EMBLEM_ID,
    name: "Sorin, Lord of Innistrad emblem",
    text: "Creatures you control get +1/+0.",
    // Scryfall print of the emblem card (set `tdka`, layout `emblem`) — the art
    // the command-zone UI renders. Verified all renditions (grid/display/normal)
    // resolve on the Scryfall CDN.
    imagePrintId: "327ddaaf-b6a7-4c80-9b38-5ab68181b3d6",
    staticEffects: [
        {
            kind: "pt-buff",
            // CR 114.3 — "creatures you control": the emblem's owner is the
            // synthetic source's controller, so the standard anthem predicate
            // (target and source share a controller) scopes it correctly.
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.controllerId === source.controllerId,
            power: 1,
            toughness: 0,
        },
    ],
});

/** Chandra, Torch of Defiance −7 emblem (KLD, issue #1478 / #1252). The first
 *  TRIGGERED emblem (CR 114.4, 113.3): "Whenever you cast a spell, this emblem
 *  deals 5 damage to any target." Fires on the owner's own SPELL_CAST (CR
 *  603.2 — `self.controllerId` is the emblem's owner, so `casterId ===
 *  self.controllerId` scopes it to "you"); the "any target" (CR 115.4) is
 *  chosen when the trigger goes on the stack via the ability's
 *  `targetRequirement`, rid onto the emblem trigger item as
 *  `inlineTargetRequirement` (`buildEmblemTriggerItem`, triggers.ts). */
export const CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID =
    "chandra-torch-of-defiance-emblem";

registerEmblemDefinition({
    id: CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID,
    name: "Chandra, Torch of Defiance emblem",
    text: "Whenever you cast a spell, this emblem deals 5 damage to any target.",
    // Scryfall print of the emblem card (set `tkld`, layout `emblem`) — the
    // KLD-era emblem printing matching Chandra's own set, per the token/emblem
    // art rule (the card's own printing where present). Rendered by the
    // command-zone UI.
    imagePrintId: "50ce1db3-417c-4c22-84e5-c463addde476",
    triggeredAbilities: [
        {
            id: "chandra-torch-of-defiance-emblem-cast",
            oracleText:
                "Whenever you cast a spell, this emblem deals 5 damage to any target.",
            event: "SPELL_CAST",
            // CR 603.2 — "you cast a spell": the emblem's owner is the caster.
            matches: (event: GameEvent, self: PermanentView): boolean =>
                event.type === "SPELL_CAST" &&
                event.casterId === self.controllerId,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 5, to: { target: 0 } }],
        },
    ],
});

/** Jace, Telepath Unbound −9 emblem (ORI, issue #2380). A TRIGGERED emblem
 *  (CR 114.4, 113.3) with a targeted trigger: "Whenever you cast a spell,
 *  target opponent mills five cards." Same seam as the two emblems around it —
 *  fires on the owner's own SPELL_CAST (CR 603.2, `casterId ===
 *  self.controllerId` scopes it to "you") and the target opponent (CR 115.1c)
 *  is chosen when the trigger goes on the stack, via the ability's
 *  `targetRequirement` ridden onto the emblem trigger item as
 *  `inlineTargetRequirement` (`buildEmblemTriggerItem`, triggers.ts). */
export const JACE_TELEPATH_UNBOUND_EMBLEM_ID = "jace-telepath-unbound-emblem";

registerEmblemDefinition({
    id: JACE_TELEPATH_UNBOUND_EMBLEM_ID,
    name: "Jace, Telepath Unbound emblem",
    text: "Whenever you cast a spell, target opponent mills five cards.",
    // Scryfall print of the emblem card (set `tori`, layout `emblem`) — the
    // ORI-era emblem printing matching Jace's own set, per the token/emblem art
    // rule (the card's own printing where present).
    imagePrintId: "458e37b1-a849-41ae-b63c-3e09ffd814e4",
    triggeredAbilities: [
        {
            id: "jace-telepath-unbound-emblem-cast",
            oracleText:
                "Whenever you cast a spell, target opponent mills five cards.",
            event: "SPELL_CAST",
            // CR 603.2 — "you cast a spell": the emblem's owner is the caster.
            matches: (event: GameEvent, self: PermanentView): boolean =>
                event.type === "SPELL_CAST" &&
                event.casterId === self.controllerId,
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            // CR 701.13 — the announced opponent slot mills five. An unfilled
            // slot resolves to undefined and the Op skips (CR 608.2b).
            effects: [{ op: "mill", player: { target: 0 }, count: 5 }],
        },
    ],
});

/** Teferi, Hero of Dominaria −8 emblem (DOM, issue #1726). A TRIGGERED emblem
 *  (CR 114.4, 113.3) with a targeted trigger: "Whenever you draw a card,
 *  exile target permanent an opponent controls." Fires on the owner's own
 *  CARD_DRAWN (CR 603.2 — `self.controllerId` is the emblem's owner); the
 *  target (CR 115.1c) is chosen when the trigger goes on the stack via the
 *  ability's `targetRequirement`, rid onto the emblem trigger item as
 *  `inlineTargetRequirement` (`buildEmblemTriggerItem`, triggers.ts) —
 *  same seam as Chandra, Torch of Defiance's emblem above. A batch draw
 *  ("draw two") emits one CARD_DRAWN per card (CR 121.2 — `emitCardDrawn`
 *  fans out per-card events), so the trigger fires once per card drawn. */
export const TEFERI_HERO_OF_DOMINARIA_EMBLEM_ID =
    "teferi-hero-of-dominaria-emblem";

registerEmblemDefinition({
    id: TEFERI_HERO_OF_DOMINARIA_EMBLEM_ID,
    name: "Teferi, Hero of Dominaria emblem",
    text: "Whenever you draw a card, exile target permanent an opponent controls.",
    // Scryfall print of the emblem card (set `tdom`, layout `emblem`) — the
    // DOM-era emblem printing matching Teferi's own set, per the token/emblem
    // art rule (the card's own printing where present). Verified all
    // renditions (normal/large/png) resolve on the Scryfall CDN.
    imagePrintId: "b82ac152-5df1-46c9-98e9-ad5585f7e799",
    triggeredAbilities: [
        {
            id: "teferi-hero-of-dominaria-emblem-draw",
            oracleText:
                "Whenever you draw a card, exile target permanent an opponent controls.",
            event: "CARD_DRAWN",
            // CR 603.2 — "you draw a card": the emblem's owner is the drawer.
            matches: (event: GameEvent, self: PermanentView): boolean =>
                event.type === "CARD_DRAWN" &&
                event.playerId === self.controllerId,
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: 1,
                controller: "opponent",
            },
            effects: [{ op: "exile", target: { target: 0 } }],
        },
    ],
});
