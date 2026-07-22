// clb — multicolor cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types/loyalty are from Scryfall (id = CLB paper printing).

import type { CardDefinition, EffectTokenSpec } from "../../types";

// ─────────────────────────────────────────────────────────────────────────
// Minsc & Boo, Timeless Heroes — the reflexive-trigger tracer (CR 603.3c)
// ─────────────────────────────────────────────────────────────────────────
//
// {2}{R}{G} Legendary Planeswalker — Minsc, starting loyalty 3 (CR 306.5b).
// Three clauses, each landing on already-declarative machinery:
//
//   • The Boo maker — ONE TriggeredAbility on TWO engine events (the
//     multi-event standard, CR 603.2): "when this enters AND at the beginning
//     of your upkeep" is a single Oracle line, so it is a single ability with
//     an `event` ARRAY whose `matches` discriminates per firing event, not two
//     near-duplicate abilities. "You may" is a bare cost-free `mayPay`
//     (CR 117.3a) gating a `createToken`.
//
//   • +1 — three +1/+1 counters via `counters`, on "up to one target creature
//     with trample OR haste". That disjunction is the new
//     `TargetRequirement.requireAbilityAny` (CR 702): the pre-existing
//     `requireAbility` takes ONE keyword and ANDs, which cannot express an
//     "or" of two. Registered in the ADR 0068 target-filter registry, so
//     `getLegalTargets` (offered) and `selectTarget` (accepted) get it from
//     the one implementation.
//
//   • −2 — the card this whole slice exists for. "Sacrifice a creature. WHEN
//     YOU DO, ~ deals X damage to any target" is a REFLEXIVE triggered
//     ability (CR 603.3c): a separate stack object, created by the resolving
//     ability, whose target is announced AFTER the sacrifice (CR 603.3d) —
//     which is the whole point, since you pick the damage target knowing what
//     died and therefore how big X is, and both players get priority before
//     it resolves. Expressed with the new `reflexiveTrigger` Op; `sacrifice`'s
//     new `bind` takes the CR 608.2h last-known-information snapshot before
//     the creature leaves the battlefield, so `$sacked.power` still reads its
//     power from the graveyard. The Hamster rider gates on `picksMatchFilter`
//     against the sacrificed card in its OWNER's graveyard (`$sacked.owner`,
//     CR 108.3 — not the controller, so a sacrificed creature that was under
//     someone else's control still checks the right graveyard).
//
// DIVERGENCE — "Minsc & Boo, Timeless Heroes can be your commander." is not
// modelled: the Commander format is out of scope for this engine (only
// 2-player and solo constructed play exists), so the line has no rule to
// attach to.

/** CR 707.2 — the Boo token. `imagePrintId` is the CLB Boo token printing, so
 *  the token renders with its own art rather than a generic placeholder. */
const BOO_TOKEN: EffectTokenSpec = {
    name: "Boo",
    types: ["Creature"],
    subtypes: ["Hamster"],
    supertypes: ["Legendary"],
    power: 1,
    toughness: 1,
    colors: ["R"],
    staticAbilities: ["trample", "haste"],
    imagePrintId: "0d0475e9-68ae-4553-a5ef-650091e04967",
};

export const minscAndBooTimelessHeroes: CardDefinition = {
    id: "928036c9-11b8-493e-b9f2-8fbd3487cd19",
    name: "Minsc & Boo, Timeless Heroes",
    rarity: "mythic",
    manaCost: { X: 2, R: 1, G: 1 },
    types: ["Planeswalker"],
    subtypes: ["Minsc"],
    supertypes: ["Legendary"],
    loyalty: 3,
    oracleText:
        "When Minsc & Boo enters and at the beginning of your upkeep, you may create Boo, a legendary 1/1 red Hamster creature token with trample and haste.\n+1: Put three +1/+1 counters on up to one target creature with trample or haste.\n−2: Sacrifice a creature. When you do, Minsc & Boo deals X damage to any target, where X is that creature's power. If the sacrificed creature was a Hamster, draw X cards.\nMinsc & Boo, Timeless Heroes can be your commander.",
    triggeredAbilities: [
        {
            id: "minsc-and-boo-create-boo",
            oracleText:
                "When Minsc & Boo enters and at the beginning of your upkeep, you may create Boo, a legendary 1/1 red Hamster creature token with trample and haste.",
            // CR 603.2 — ONE Oracle line spanning two engine events, so ONE
            // ability with an event ARRAY (never two near-duplicates, which
            // would render the same line twice on the stack).
            event: ["PERMANENT_ENTERED", "PHASE_BEGIN"],
            matches: (event, self) =>
                (event.type === "PERMANENT_ENTERED" &&
                    event.instanceId === self.id) ||
                (event.type === "PHASE_BEGIN" &&
                    event.phase === "UPKEEP" &&
                    event.activePlayerId === self.controllerId),
            effects: [
                // CR 117.3a — a bare cost-free "you may" decision.
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Create Boo, a legendary 1/1 red Hamster with trample and haste?",
                    bind: "$makeBoo",
                },
                {
                    op: "if",
                    predicate: { binding: "$makeBoo" },
                    then: [
                        {
                            op: "createToken",
                            token: BOO_TOKEN,
                            controller: "controller",
                            count: 1,
                        },
                    ],
                },
            ],
        },
    ],
    activatedAbilities: [
        {
            id: "minsc-and-boo-plus1",
            cost: { loyalty: 1 },
            useStack: true,
            oracleText:
                "+1: Put three +1/+1 counters on up to one target creature with trample or haste.",
            // CR 702 — "with trample or haste" is a DISJUNCTION of keywords,
            // hence `requireAbilityAny` (OR) rather than `requireAbility`
            // (a single keyword). "Up to one" is min 0: with no legal target
            // the ability still resolves and does nothing (CR 608.2b).
            targetRequirement: {
                type: "Creature",
                count: { min: 0, max: 1 },
                requireAbilityAny: ["trample", "haste"],
            },
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { target: 0 },
                    count: 3,
                },
            ],
        },
        {
            id: "minsc-and-boo-minus2",
            cost: { loyalty: -2 },
            useStack: true,
            oracleText:
                "−2: Sacrifice a creature. When you do, Minsc & Boo deals X damage to any target, where X is that creature's power. If the sacrificed creature was a Hamster, draw X cards.",
            effects: [
                // CR 701.16 — the sacrifice is an EFFECT (not a cost), so it
                // happens here, on resolution, and the player picks which
                // creature.
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: "controller",
                    zone: "battlefield",
                    filter: { type: "Creature" },
                    count: 1,
                    prompt: "Sacrifice a creature (Minsc & Boo).",
                    bind: "$sacPicks",
                },
                // `bind` snapshots the creature BEFORE it leaves the
                // battlefield (CR 608.2h) — the reflexive trigger below reads
                // its power from the graveyard.
                {
                    op: "sacrifice",
                    permanents: { ref: "$sacPicks" },
                    bind: "$sacked",
                },
                // CR 603.3c — the reflexive ability triggers off the sacrifice
                // having HAPPENED. Controlling no creature means nothing was
                // sacrificed, so nothing triggers.
                {
                    op: "if",
                    predicate: { picksNonEmpty: { ref: "$sacPicks" } },
                    then: [
                        {
                            op: "reflexiveTrigger",
                            oracleText:
                                "When you do, Minsc & Boo deals X damage to any target, where X is that creature's power. If the sacrificed creature was a Hamster, draw X cards.",
                            // Both captures are BARE refs, so each crosses
                            // VERBATIM (CR 608.2h): `$sacked` stays an object
                            // snapshot whose power/owner survive the zone
                            // change, `$sacPicks` stays a picks binding the
                            // graveyard filter below can read.
                            capture: {
                                $sacked: { ref: "$sacked" },
                                $sacPicks: { ref: "$sacPicks" },
                            },
                            // CR 603.3d — announced as the reflexive trigger
                            // goes on the stack, i.e. AFTER the sacrifice.
                            targetRequirement: { type: "any", count: 1 },
                            effects: [
                                {
                                    op: "dealDamage",
                                    amount: { ref: "$sacked.power" },
                                    to: { target: 0 },
                                },
                                {
                                    op: "if",
                                    predicate: {
                                        picksMatchFilter: { ref: "$sacPicks" },
                                        // CR 108.3 — a sacrificed permanent
                                        // goes to its OWNER's graveyard, which
                                        // is not necessarily the controller
                                        // who sacrificed it.
                                        player: { ref: "$sacked.owner" },
                                        filter: { subtype: "Hamster" },
                                    },
                                    then: [
                                        {
                                            op: "draw",
                                            player: "controller",
                                            count: { ref: "$sacked.power" },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};
