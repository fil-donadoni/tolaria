// Antiquities (ATQ) — the game's first artifact-centric expansion, split by
// colour per ADR 0043. Every entry is a new CardDefinition (ATQ has no
// reprints of already-implemented cards, so there are no CardPrint stubs).
// Modern Scryfall oracle text is authoritative (ADR 0004); the canonical
// card list, mana costs, and types are sourced from MTGJSON `ATQ.json`.
// Generic mana is encoded as `X: n` (e.g. {3} → { X: 3 }); {0} is an empty
// mana cost `{}`. Cards are classified by the colour identity of their mana
// cost (CR 202.2); lands and artifacts (no coloured cost) live in
// colorless.ts.

import type { CardDefinition, PermanentView } from "../../types";
import { EFFECT_AFFECTS_SELF } from "../../types";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";
import { abilityActivatedTrigger } from "../../abilities/triggers/abilityActivatedTrigger";

// ─────────────────────────────────────────────────────────────────────────────
// Artifact removal & bounce (free tranche, #274) — CR 701.8 destroy, CR
// 400.7 return to hand, CR 701.6a counter, CR 202.3 mana value. Modern
// Scryfall oracle text is authoritative (ADR 0004); mana costs / type lines
// come from MTGJSON ATQ.json. All effects compose existing SpellContext
// primitives (no new primitive, no engine change).
// ─────────────────────────────────────────────────────────────────────────────

// Crumble — {G} Instant. "Destroy target artifact. It can't be regenerated.
// That artifact's controller gains life equal to its mana value." Order
// matters: read the controller and the mana value BEFORE the destroy moves the
// permanent off the battlefield (CR 608.2c — the effect uses last-known
// information once the object has left). `cantBeRegenerated: true` suppresses
// the regen-shield replacement (CR 701.19c); indestructible still protects.
// Migrated to Effect Script (ADR 0045): `destroy`'s `bind` snapshots the
// target's controller + mana value BEFORE it leaves the battlefield (CR
// 608.2h/608.2c), mirroring Reanimate's `bind` + `{ ref: "$x.manaValue" }`
// shape (tmp/black.ts).
export const crumble: CardDefinition = {
    id: "d2101f86-8d3c-4ba8-ac42-bd3df0644280",
    rarity: "common",
    name: "Crumble",
    oracleText:
        "Destroy target artifact. It can't be regenerated. That artifact's controller gains life equal to its mana value.",
    manaCost: { G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Artifact", count: 1 },
    effects: [
        {
            op: "destroy",
            target: { target: 0 },
            bind: "$c",
            cantBeRegenerated: true,
        },
        {
            op: "gainLife",
            player: { ref: "$c.controller" },
            amount: { ref: "$c.manaValue" },
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
            // Migrated to Effect Script (ADR 0045): `spellCastTrigger` now
            // exposes an `effects[]` site (mutually exclusive with `resolve`)
            // for a spell-cast trigger whose effect doesn't need to inspect
            // the firing spell. `counters` `target: { ref: "$source" }` is
            // the same self-counter shape Kavu Monarch uses (inv/red.ts).
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
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

// Powerleech — {G}{G} Enchantment. "Whenever an artifact an opponent controls
// becomes tapped or an opponent activates an artifact's ability without {T} in
// its activation cost, you gain 1 life." (CR 603.2.) `scope: "opponents"`
// encodes "an opponent controls"; the life goes to the enchantment's
// controller (`ctx.controller`).
// NOT DSL-migratable (ADR 0045) today: the ability-activated half is built
// via `abilityActivatedTrigger`, which declares `resolve` as a MANDATORY
// field with no `effects[]` site (unlike `spellCastTrigger`/`enteredTrigger`,
// which already accept `effects`). The TAPPED half is no longer blocked —
// `tappedTrigger` gained its `effects?: EffectOp[]` param in 85d5c1075 — but
// a card migrates whole or not at all, so Powerleech stays imperative until
// its second factory catches up. Blocked on: `abilityActivatedTrigger`
// gaining an `effects?: EffectOp[]` param — an out-of-scope engine change for
// a single-file card migration. The sibling ATQ cards using the identical
// pattern (Haunting Wind, Artifact Possession — `atq/black.ts`) are in the
// same state. tracked-by: #1437.
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
}): import("../../types").ReplacementEffect {
    return {
        id: opts.id,
        oracleText: opts.oracleText,
        eventKind: "damage",
        damageEffectKind: "prevention",
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
    ctx: import("../../types").StaticEffectContext
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
// DIVERGENCE (tracked-by: #2064) (flagged, no engine change): "becomes an
// artifact creature" only needs to ADD Creature — the affected permanents are
// already artifacts, so no Artifact type-add is required. The leave-the-battlefield "continues until end
// of turn" linger clause is NOT modeled: when the Song leaves play the engine
// reverts the type/ability changes immediately (the standard
// `unapplySourceStaticEffects` path). This is observable only in the window
// between the Song leaving and the cleanup step; the common play pattern keeps
// the Song in play, so the simplification is acceptable for ATQ scope. The
// missing piece is a "this continuous effect survives its own source until end
// of turn" DURATION — a lifetime that can only exist once continuous effects
// are materialised with their own timestamp and duration rather than recomputed
// from the live battlefield sources (tracked-by: #2064, ADR 0082).
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
