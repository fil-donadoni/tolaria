// m12 — blue cards (ADR 0043 colour split). Magic 2012 (2011) is the home
// set for exactly one Vintage Cube residue card so far: Phantasmal Image
// (issue #1563, split off #1528's clone cluster — PRD #1525). Routed to its
// earliest paper printing per ADR 0041's cross-set convention: the card was
// NEVER printed in Innistrad despite #1563's target-file note (verified
// against Scryfall — Phantasmal Image's actual first printing is M12,
// 2011-07-15, scryfallId 98e7bf8f-dba7-4005-8cee-634c9153931d; its most
// recent printing is Arena Cube "afc", which is where a bare Scryfall lookup
// with no set filter lands).
import type {
    CardDefinition,
    SpellContext,
    TriggeredAbility,
} from "../../types";

// Phantasmal Image — {1}{U} 0/0 Creature — Illusion (M12). "You may have
// this creature enter as a copy of any creature on the battlefield, except
// it's an Illusion in addition to its other types and it has 'When this
// creature becomes the target of a spell or ability, sacrifice it.'"
//
// CR 707.2 copy effect (Clone-parity, `clone` in lea/blue.ts): the "may" +
// choose-any-creature-on-the-battlefield flow runs in a `resolveSteps` step
// while still on the stack — `requestMayPay` + `requestChoice` +
// `becomeCopyOf` — mirroring Clone / Copy Artifact exactly.
//
// protocol card: `resolveSteps` is used here, not `effects: EffectOp[]`,
// because there is no Op for "optionally become a copy of a chosen
// battlefield permanent" — no `becomeCopyOf` Op exists in the Mechanics
// Registry. This is the SAME established copy-effect shape every clone card
// in this catalogue already uses (Clone, Copy Artifact, drk/blue.ts,
// nph/blue.ts), not a novel imperative invention.
//
// The two-part "except" clause is the engine gap issue #1563 closes
// (`CopyEffectOptions`, `convex/cards/types.ts`): `additionalSubtypes:
// ["Illusion"]` rides alongside the copied object's own subtypes (CR 707.2 —
// the Oracle wording says "types" but Illusion is a creature SUBTYPE), and
// `additionalTriggeredAbilityIds` grants the self-sacrifice trigger below
// (`phantasmalImageSacrifice`) via the existing anthem-style
// triggered-ability-grant machinery (`grantedTriggeredAbilities` /
// `effectiveTriggeredAbilities`, `gre/copy.ts`) — so the granted trigger
// survives on the COPY exactly as if printed there.
//
// Declining the copy (or no creatures in play) leaves Phantasmal Image a
// printed 0/0 Illusion, which dies to SBA immediately (CR 704.5f) — same as
// Clone's 0/0 fallback. The self-sac trigger is NOT present in that case: it
// is part of the copy effect's "except" clause, not printed on the base
// card outside the copy choice.
const phantasmalImageSacrifice: TriggeredAbility = {
    id: "phantasmal-image-sacrifice",
    oracleText:
        "When this creature becomes the target of a spell or ability, sacrifice it.",
    // CR 603.2b / 115.5 — the same BECAME_TARGET event Ward (CR 702.21a) and
    // Leovold read (`emitBecameTargetEvents`, gre/state.ts / gre/rules.ts /
    // game.ts — fires for a targeted spell, a targeted activated ability,
    // AND a targeted triggered ability alike). Unlike Ward there is no "an
    // opponent controls" restriction — the Oracle text says "a spell or
    // ability", full stop.
    event: "BECAME_TARGET",
    matches: (event, self) =>
        event.type === "BECAME_TARGET" &&
        event.target.type === "permanent" &&
        event.target.id === self.id,
    // No targetRequirement: unlike Ward, this trigger's own effect doesn't
    // target the causing spell/ability — it just sacrifices its own source.
    effects: [{ op: "sacrifice", target: { ref: "$source" } }],
};

export const phantasmalImage: CardDefinition = {
    id: "98e7bf8f-dba7-4005-8cee-634c9153931d", // M12 72
    rarity: "rare",
    name: "Phantasmal Image",
    oracleText:
        'You may have this creature enter as a copy of any creature on the battlefield, except it\'s an Illusion in addition to its other types and it has "When this creature becomes the target of a spell or ability, sacrifice it."',
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion"],
    power: 0,
    toughness: 0,
    // Bot-only cast prune (Clone/Copy Artifact precedent, #938): copies a
    // creature on ETB — a wasted cast (enters a 0/0 that dies to SBA) when
    // no creature is in play.
    copySourceFilter: { types: "Creature" },
    // The granted trigger's template lives here (kept off `triggeredAbilities`
    // — the `StaticTriggeredGrant`/`grantedTriggeredAbilities` convention —
    // so the un-copied base card doesn't fire it), referenced by
    // `additionalTriggeredAbilityIds: [phantasmalImageSacrifice.id]` below.
    triggeredGrantTemplates: [phantasmalImageSacrifice],
    resolveSteps: [
        (ctx: SpellContext) => {
            let candidates = 0;
            for (const pid of ctx.allPlayerIds) {
                candidates += ctx.getBattlefieldIds(pid, {
                    types: "Creature",
                }).length;
            }
            if (candidates === 0) return; // enters as a 0/0 Illusion
            const accept = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: "phantasmal-image-may-copy",
                prompt: "Have Phantasmal Image enter as a copy of a creature?",
            });
            if (accept === undefined) return; // suspended
            if (!accept) return;
            const picks = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: "phantasmal-image-copy-target",
                kind: "choose-permanents",
                zone: "battlefield",
                allControllers: true,
                filter: { types: "Creature" },
                count: 1,
                prompt: "Choose a creature for Phantasmal Image to copy.",
            });
            if (picks === undefined) return; // suspended
            if (picks.length === 1) {
                ctx.becomeCopyOf(picks[0], {
                    additionalSubtypes: ["Illusion"],
                    additionalTriggeredAbilityIds: [
                        phantasmalImageSacrifice.id,
                    ],
                });
            }
        },
    ],
};
