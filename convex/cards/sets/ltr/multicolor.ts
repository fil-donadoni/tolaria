// LTR — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// TODO(issue #676 stub — the "choose one. If you control a Wizard, choose
// two instead" clause is a conditional modal count: neither the `optionChoice`
// Op (a fixed single pick) nor the legacy `modes: SpellMode[]` mechanism
// supports a caster-controlled-permanent-conditional mode COUNT. This is a
// bespoke structural gap, not a named keyword/Op — stop-and-issue per
// gre-development.md rather than an invented mechanism. Tracked stub.
// export const flameOfAnor: CardDefinition = {
//     id: "04779a7e-b453-48b9-b392-6d6fd0b8d283",
//     name: "Flame of Anor",
//     rarity: "rare",
//     manaCost: { X: 1, U: 1, R: 1 },
//     types: ["Instant"],
// };

// Arwen, Mortal Queen — {1}{G}{W} Legendary Creature — Elf Noble, 2/2 (LTR,
// issue #1318, closing tolaria#917's Arwen stub). Real Scryfall oracle text:
// "Arwen enters with an indestructible counter on it. {1}, Remove an
// indestructible counter from Arwen: Another target creature gains
// indestructible until end of turn. Put a +1/+1 counter and a lifelink
// counter on that creature and a +1/+1 counter and a lifelink counter on
// Arwen." Arwen carries no PRINTED keywords (Scryfall `keywords: []`) — her
// lifelink/indestructible are entirely a CR 122.1c consequence of the
// counters her own ability places, never a native `staticAbilities` entry.
//
// The original stub (ea8193fd, #921) called this blocked on
// `StaticEffectContext`/`PermanentView` having no counter-count access for
// static-effect predicates. That gap was independently closed by #1194's
// generic engine-level rule (CR 122.1c / 613.4d, `mechanicsRegistry.
// getKeywordCounterGrant` + `SpellContext.addCounter`/`removeCounter`): ANY
// permanent whose counter TYPE case-insensitively names an implemented
// keyword (flying, lifelink, indestructible, …) has that keyword for as long
// as the counter remains — no per-card `staticEffects[]` declaration needed
// or wanted (a redundant one here would double-grant onto `staticAbilities`
// via two provenances for the exact same rule). This is also the ONLY correct
// modeling for Arwen: her ability places a lifelink counter on an ARBITRARY
// other creature too, and only the board-agnostic engine rule (not a grant
// scoped to Arwen's own predicate) can grant that OTHER creature lifelink.
//
// What #1194 left unfinished for Arwen specifically — closed by #1318 in
// `gre/state.ts`:
//   (1) `entersWith.counters` (ETB) bypassed `addCounter`, so Arwen's own
//       "enters with an indestructible counter" never granted indestructible
//       at ETB. Fixed: the ETB-counter block now calls
//       `applyKeywordCounterGrant` on each type's 0 → present transition,
//       same guard `addCounter` uses.
//   (2) `payRemoveCounterCost` (the `cost.removeCounter` activation-cost
//       payment path — Arwen's OWN "Remove an indestructible counter from
//       Arwen" cost) bypassed `removeCounter`, so spending her last
//       indestructible counter to pay the cost never spliced indestructible
//       back out. Fixed: it now calls `unapplyKeywordCounterGrant` when the
//       paid type's count reaches zero.
// Issue #1318's other deliverable — `StaticEffectContext.getCounterCount`
// (`gre/layers.ts`) — is additional read-access infrastructure for a FUTURE
// staticEffects[] predicate that needs to condition a layer-6 grant on a
// permanent's counters (a non-exact-name-match case #1194 doesn't cover);
// Arwen doesn't consume it directly, for the reason above.
export const arwenMortalQueen: CardDefinition = {
    id: "547f92d4-cd1d-4ca7-a6e2-6473b4d3c832",
    name: "Arwen, Mortal Queen",
    rarity: "mythic",
    oracleText:
        "Arwen enters with an indestructible counter on it.\n{1}, Remove an indestructible counter from Arwen: Another target creature gains indestructible until end of turn. Put a +1/+1 counter and a lifelink counter on that creature and a +1/+1 counter and a lifelink counter on Arwen.",
    manaCost: { generic: 1, G: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elf", "Noble"],
    power: 2,
    toughness: 2,
    // CR 122.1, 614.1c — she enters with a single indestructible counter,
    // which (CR 122.1c, closed gap (1) above) grants indestructible from the
    // moment she enters, not just after a later ability resolves.
    entersWith: { counters: [{ type: "indestructible", count: 1 }] },
    activatedAbilities: [
        {
            id: "arwen-empower",
            oracleText:
                "{1}, Remove an indestructible counter from Arwen: Another target creature gains indestructible until end of turn. Put a +1/+1 counter and a lifelink counter on that creature and a +1/+1 counter and a lifelink counter on Arwen.",
            cost: {
                mana: { generic: 1 },
                // CR 122.6 — legal only while Arwen has at least one
                // indestructible counter; closed gap (2) above splices the
                // grant back out if this spends her last one.
                removeCounter: { type: "indestructible", count: 1 },
            },
            useStack: true,
            // Static fallback (no legal target without the source id); the
            // dynamic form excludes Arwen herself — the Sorceress Queen
            // `excludeInstanceIds` pattern (CR 603.3d "another target
            // creature").
            targetRequirement: { type: "Creature", count: 1 },
            getTargetRequirement: (source) => ({
                type: "Creature",
                count: 1,
                excludeInstanceIds: [source.id],
            }),
            effects: [
                // "Another target creature gains indestructible until end of
                // turn" (CR 611.1b / 613.1f layer 6, temporary — independent
                // of the counter-driven grant, purged at CLEANUP).
                {
                    op: "grantAbility",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                    ability: "indestructible",
                },
                // "Put a +1/+1 counter and a lifelink counter on that
                // creature" (CR 122.1; the lifelink counter grants lifelink
                // via CR 122.1c the instant it lands, engine-wide).
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { target: 0 },
                    count: 1,
                },
                {
                    op: "counters",
                    action: "add",
                    counter: "lifelink",
                    target: { target: 0 },
                    count: 1,
                },
                // "...and a +1/+1 counter and a lifelink counter on Arwen."
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 1,
                },
                {
                    op: "counters",
                    action: "add",
                    counter: "lifelink",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        },
    ],
};
