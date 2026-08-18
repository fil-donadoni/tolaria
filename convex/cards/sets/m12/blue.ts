// m12 — blue cards (ADR 0043 colour split). Magic 2012 (2011) is the home
// set for exactly one Vintage Cube residue card so far: Phantasmal Image
// (issue #1563, split off #1528's clone cluster — PRD #1525). Routed to its
// earliest paper printing per ADR 0041's cross-set convention: the card was
// NEVER printed in Innistrad despite #1563's target-file note (verified
// against Scryfall — Phantasmal Image's actual first printing is M12,
// 2011-07-15, scryfallId 98e7bf8f-dba7-4005-8cee-634c9153931d; its most
// recent printing is Arena Cube "afc", which is where a bare Scryfall lookup
// with no set filter lands).
import type { CardDefinition, TriggeredAbility } from "../../types";

// Phantasmal Image — {1}{U} 0/0 Creature — Illusion (M12). "You may have
// this creature enter as a copy of any creature on the battlefield, except
// it's an Illusion in addition to its other types and it has 'When this
// creature becomes the target of a spell or ability, sacrifice it.'"
//
// CR 707.2 copy effect (Clone-parity, `clone` in lea/blue.ts). The "may" +
// choose-any-creature-on-the-battlefield flow is DECLARED as an as-enters
// choice (`entersWith.asEnters`, ADR 0100 D3) rather than run imperatively:
// CR 614.1c makes it a replacement effect, and CR 614.12a puts the choice
// before the permanent enters on EVERY entry path. No Effect Script and no
// `becomeCopyOf` Op is involved — a replacement is a declaration, not an
// effect that resolves, the same reason `entersWith.counters` is data.
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
    // aiValue (PRD #1423, issue #1431) — NOT an `aiEffects` shadow script:
    // this is a CREATURE with no card-level spell script at all (its whole
    // effect is an as-enters DECLARATION, #2451), and
    // `latentValue`'s CREATURE branch (`gre/cardValue.ts`) only ever
    // consults `aiValue` or the ability-script value derived from
    // `activatedAbilities`/`triggeredAbilities` (`dslAbilityScriptValue`) —
    // it NEVER reads a creature's own card-level `effects`/`aiEffects`
    // (`dslSpellScriptValue` feeds only the NON-creature branch). A
    // top-level `aiEffects` sketch here would pass the catalogue guard but
    // be silently inert for valuation, which is exactly the class of bug
    // this mechanism exists to prevent — so the scalar override is the only
    // lever that actually moves this card off its printed 0/0 body.
    // Magnitude: a representative 2/2 body at this card's own mana value
    // (LATENT_DISCOUNT × creatureValueRaw(2, 2, 2, []) ≈ 143) — the same
    // "unknown copied body" representative stat `createTokenCopy`'s
    // `COPY_TOKEN_REPRESENTATIVE_STAT` uses for the analogous "copies an
    // unknowable creature" shape (`gre/ai/opValuers.ts`). Deliberately an
    // "average vanilla" figure rather than a bomb-sized one: it stands in
    // for "becomes a copy of a good but unpredictable creature", tempered by
    // the sacrifice-on-becoming-a-target drawback and the (rarer) whiff when
    // no legal copy target exists.
    aiValue: 143,
    // The granted trigger's template lives here (kept off `triggeredAbilities`
    // — the `StaticTriggeredGrant`/`grantedTriggeredAbilities` convention —
    // so the un-copied base card doesn't fire it), referenced by
    // `additionalTriggeredAbilityIds: [phantasmalImageSacrifice.id]` below.
    triggeredGrantTemplates: [phantasmalImageSacrifice],
    // CR 614.1c / 614.12a / 707.5 (ADR 0100 D3, issue #2451) — the copy choice
    // is a REPLACEMENT effect declared as data, so it is raised on every entry
    // path rather than only while a permanent spell resolves. This card is the
    // originating bug report: Reanimate on a Phantasmal Image put it onto the
    // battlefield as its printed 0/0 Illusion with no prompt, and the next
    // sweep binned it (CR 704.5f).
    //
    // Both halves of the two-part "except" clause ride on `opts`, byte-for-byte
    // what the pre-#2451 `becomeCopyOf` call passed: `additionalSubtypes`
    // (CR 707.2's "except" modifying a copiable value) and
    // `additionalTriggeredAbilityIds` granting the self-sacrifice trigger.
    entersWith: {
        asEnters: [
            {
                kind: "copy",
                filter: { types: "Creature" },
                opts: {
                    additionalSubtypes: ["Illusion"],
                    additionalTriggeredAbilityIds: [
                        phantasmalImageSacrifice.id,
                    ],
                },
            },
        ],
    },
};
