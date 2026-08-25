// usg — blue cards (ADR 0043 colour split).

import type { CardDefinition, SpellContext } from "../../types";

// Annul — {U} Instant. "Counter target artifact or enchantment spell."
// (CR 701.6a counter; CR 114.1 spell targeting.) A conditional Counterspell
// restricted to a subset of spell CARD TYPES. Expressed DSL-first (ADR 0045):
// the `counter` Op reused unchanged, and the artifact-OR-enchantment
// restriction rides the existing `spellTypeFilter` on a `type: "spell"`
// target — the same filter Fork uses for "instant or sorcery spell". An array
// filter matches a spell whose `types` include AT LEAST ONE of the listed
// types (OR semantics, CR 202.2 / 114.1), and abilities on the stack are never
// legal spell targets (CR 701.6a). No new Op or TargetRequirement type.
//
// First Premodern-legal printing in Tolaria's pool is Urza's Saga (usg); Annul
// was NOT printed in Nemesis despite the umbrella issue's file hint, so it
// lives here to keep the print id (`id`) consistent with its set.
export const annul: CardDefinition = {
    id: "3f8c73ff-be92-41ca-93a7-76f9823adb38",
    rarity: "common",
    name: "Annul",
    oracleText: "Counter target artifact or enchantment spell.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: ["Artifact", "Enchantment"],
    },
    effects: [{ op: "counter", target: { target: 0 } }],
};

// Hibernation — {2}{U} Instant. "Return all green permanents to their owners'
// hands." (CR 400.7 zone change; CR 105 / 202.2 colour; CR 111.7 a bounced
// token ceases to exist, SBA-enforced.) A colour-filtered mass bounce — the
// Upheaval pattern (forEach over EVERY battlefield + `moveZone` to hand,
// ody/blue.ts) narrowed by a `filter: { color: "G" }` on the `forEach`
// selector. No `controller` scope — "all green permanents", every player's;
// no type restriction — any permanent type that is green. The colour predicate
// rides the existing `EffectCardFilter.color` field, matched against EFFECTIVE
// colours (`getBattlefieldIds` populates layer-5 colour via the shared
// static-effect derivation, CR 202.2), so a permanent made green by another
// effect is caught and a green card made colourless is spared. Reuse-only Ops
// (`forEach` + `moveZone`, both censused): the interpreter suite already
// exercises forEach-with-filter and the forEach+moveZone mass bounce; a
// dedicated colour-filtered-bounce assertion lives in the interpreter test.
//
// First printing is Urza's Saga (usg), 1998 — Hibernation was NOT printed in
// Nemesis despite the umbrella issue's nem/blue.ts file hint, so it lives here
// to keep the print id (`id`) consistent with its set (cf. Annul above).
export const hibernation: CardDefinition = {
    id: "68b7444c-fabb-4437-8db9-a1008ea09415", // USG 79
    rarity: "uncommon",
    name: "Hibernation",
    oracleText: "Return all green permanents to their owners' hands.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { color: "G" },
            },
            effects: [{ op: "moveZone", target: { ref: "$each" }, to: "hand" }],
        },
    ],
};

// Show and Tell — {2}{U} Sorcery (Cube FREE residue, issue #1308). "Each
// player may put an artifact, creature, enchantment, or land card from their
// hand onto the battlefield." A per-player OPTIONAL hand-to-battlefield put —
// the Sneak Attack `moveZone.cards` shape (usg/red.ts's `sneakAttack`),
// scoped to EVERY player instead of just the controller: a `forEach { set:
// "players" }` (CR 101.4 APNAP order, the Innocent Blood shape,
// ody/black.ts) whose body raises a `choose-hand-card` choice with
// `count: { min: 0, max: 1 }` ("may put ... a card", CR 608.2b — a 0-count
// pick is a legal decline) restricted to the four named card types (`type`
// is an OR-within-field array, issue #677), then moves the pick from hand to
// the battlefield via the SAME `moveZone` shape Sneak Attack uses (no `bind`
// needed here — nothing acts on the entered permanent afterward).
export const showAndTell: CardDefinition = {
    id: "4b851c17-55ed-4671-b471-dc7b34944432", // USG 96
    rarity: "rare",
    name: "Show and Tell",
    oracleText:
        "Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.",
    manaCost: { X: 2, U: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: { ref: "$each" },
                    zone: "hand",
                    filter: {
                        type: ["Artifact", "Creature", "Enchantment", "Land"],
                    },
                    count: { min: 0, max: 1 },
                    prompt: "Show and Tell: put an artifact, creature, enchantment, or land card from your hand onto the battlefield (or none).",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: { ref: "$each" },
                    from: "hand",
                    to: "battlefield",
                },
            ],
        },
    ],
};

// Time Spiral — {4}{U}{U} Sorcery (Cube FREE residue, issue #1308). "Exile
// Time Spiral. Each player shuffles their hand and graveyard into their
// library, then draws seven cards. You untap up to six lands."
//
// NOT DSL-migratable (ADR 0045): the middle clause WAS the EXACT Timetwister
// shape (lea/blue.ts's `timetwister`, now migrated to `effects[]` on
// `moveZone`'s bulk whole-zone shape, issue #1279 — CLOSED), but Time Spiral
// itself stays `resolveSteps`. CORRECTED 2026-08-25 (#1841 audit): of the two
// clauses this comment listed as blockers, only ONE survives. "Exile Time
// Spiral" is NOT a blocker — `exileSelf` is a registered Op (see its
// EFFECT_OP_REGISTRY row) and `inv/green.ts` uses it. The single remaining
// blocker is "untap up to six lands": a ranged 0..6 pick over BOTH
// battlefields, which is exactly the gap Teferi, Hero of Dominaria is already
// deferred on. tracked-by: #1727
//
// Two more clauses ride the same `resolveSteps` body (CR 608.2) rather than a
// bare `resolve`, since the seven-card draws are IRREVERSIBLE and must run
// exactly once before the untap step's choice can suspend (the Bazaar of
// Baghdad re-draw class of bug, Sylvan Library precedent, leg/green.ts):
//   • "Exile Time Spiral" (CR 608.2m self-redirect) uses the existing
//     `SpellContext.exileSelf()` primitive (Recall's shape, lea/blue.ts) —
//     step 0, alongside the Timetwister shuffle, both irreversible and
//     choice-free.
//   • "You untap up to six lands" — no "you control" restriction printed, so
//     the candidate pool is every land on either player's battlefield
//     (`allControllers: true`, the Farrel's Mantle `choose-permanents`
//     shape, fem/white.ts); a ranged 0..6 pick, then `ctx.untap` each pick —
//     step 1, suspends on the choice and resumes without re-running step 0.
export const timeSpiral: CardDefinition = {
    id: "f3d62dbd-63db-4ac9-950f-9852627f23f2", // USG 103
    rarity: "rare",
    name: "Time Spiral",
    oracleText:
        "Exile Time Spiral. Each player shuffles their hand and graveyard into their library, then draws seven cards. You untap up to six lands.",
    manaCost: { X: 4, U: 2 },
    types: ["Sorcery"],
    resolveSteps: [
        // Step 0 — exile self + the Timetwister-shape shuffle for every
        // player. Isolated so a step-1 suspension never re-runs it.
        (ctx: SpellContext) => {
            ctx.exileSelf();
            ctx.forEachPlayer((pid) => {
                ctx.moveZone(pid, "hand", "library");
                ctx.moveZone(pid, "graveyard", "library");
                ctx.shuffleLibrary(pid);
                ctx.drawCards(pid, 7);
            });
        },
        // Step 1 — "You untap up to six lands."
        (ctx: SpellContext) => {
            const candidates = ctx.allPlayerIds.flatMap((p) =>
                ctx.getBattlefieldIds(p, { types: "Land" })
            );
            if (candidates.length === 0) return;
            const picks = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: `time-spiral-untap-${ctx.sourceInstanceId}`,
                kind: "choose-permanents",
                zone: "battlefield",
                allControllers: true,
                candidateIds: candidates,
                count: { min: 0, max: 6 },
                prompt: "Time Spiral: untap up to six lands.",
            });
            if (picks === undefined) return; // suspended
            for (const id of picks) {
                ctx.untap({ type: "permanent", id });
            }
        },
    ],
};
