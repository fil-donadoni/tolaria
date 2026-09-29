// Antiquities (ATQ) — the game's first artifact-centric expansion, split by
// colour per ADR 0043. Every entry is a new CardDefinition (ATQ has no
// reprints of already-implemented cards, so there are no CardPrint stubs).
// Modern Scryfall oracle text is authoritative (ADR 0004); the canonical
// card list, mana costs, and types are sourced from MTGJSON `ATQ.json`.
// Generic mana is encoded as `X: n` (e.g. {3} → { X: 3 }); {0} is an empty
// mana cost `{}`. Cards are classified by the colour identity of their mana
// cost (CR 202.2); lands and artifacts (no coloured cost) live in
// colorless.ts.

import type { CardDefinition, SpellContext } from "../../types";

// Detonate — {X}{R} Sorcery. "Destroy target artifact with mana value X. It
// can't be regenerated. Detonate deals X damage to that artifact's
// controller." `mvFilter: { equals: "X" }` resolves X at announcement against
// the chosen value and restricts legal targets to artifacts whose mana value
// equals X (CR 107.3 / 202.3). Snapshot the controller before the destroy so
// the X damage still lands on the right player via last-known information
// (CR 608.2c).
export const detonate: CardDefinition = {
    id: "ffd7eb90-ae95-49df-898a-9510187bce1c",
    rarity: "uncommon",
    name: "Detonate",
    oracleText:
        "Destroy target artifact with mana value X. It can't be regenerated. Detonate deals X damage to that artifact's controller.",
    manaCost: { X: "X", R: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Artifact",
        count: 1,
        mvFilter: { equals: "X" },
    },
    // NOT DSL-migratable (ADR 0045, #852): the `destroy` Op has no
    // `cantBeRegenerated` option ("It can't be regenerated"), so the destroy
    // half is not expressible even though the X-damage half is. Classifier
    // over-count (folds destroy + getX, blind to the destroy rider). Blocked
    // on a `cantBeRegenerated` field for the destroy Op, not on X.
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        const controllerId = ctx.getController(target);
        const x = ctx.getX();
        ctx.destroy(target, { cantBeRegenerated: true });
        ctx.dealDamage({ type: "player", id: controllerId }, x);
    },
};

// Shatterstorm — {2}{R}{R} Sorcery. "Destroy all artifacts. They can't be
// regenerated." Mass destroy via `forEach` over the "Artifact" battlefield
// filter + `destroy { ref: "$each", cantBeRegenerated: true }` (CR 701.8,
// 701.19c) — the Day of Judgment shape (`m11/white.ts`) with the `destroy`
// Op's `cantBeRegenerated` passthrough (ADR 0053); indestructible artifacts
// are still spared.
export const shatterstorm: CardDefinition = {
    id: "0987461a-45c0-4956-8627-cd27a7e038d0",
    rarity: "rare",
    name: "Shatterstorm",
    oracleText: "Destroy all artifacts. They can't be regenerated.",
    manaCost: { X: 2, R: 2 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Artifact" },
            },
            effects: [
                {
                    op: "destroy",
                    target: { ref: "$each" },
                    cantBeRegenerated: true,
                },
            ],
        },
    ],
};

// Artifact Blast — {R} Instant. "Counter target artifact spell." Targets a
// spell on the stack restricted to the Artifact card type via
// `spellTypeFilter` (CR 114.1), then counters it (CR 701.6a). No-op if the
// target has left the stack (CR 608.2b, handled by `counter`).
export const artifactBlast: CardDefinition = {
    id: "1506d99d-7b2e-4101-84a5-c950dadb263a",
    rarity: "common",
    name: "Artifact Blast",
    oracleText: "Counter target artifact spell.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: "Artifact",
    },
    effects: [{ op: "counter", target: { target: 0 } }],
};

// Goblin Artisans — {R} Creature — Goblin Artificer, 1/1. "{T}: Flip a coin.
// If you win the flip, draw a card. If you lose the flip, counter target
// artifact spell you control..." (CR 705.1 coin flip; CR 121.1 draw; CR
// 701.5a counter.) The target is declared at activation (the ability always
// targets an artifact spell you control); on a coin-flip WIN the counter is
// simply not performed and you draw instead.
//
// DSL (issue #1281): uses `coinFlip` — the SUSPENDING flip that raises the CR
// 705.2 / ADR 0023 `random-reveal` Pending Choice, i.e. the one every other
// coin-flip card in the catalogue uses (Chaos Orb, Goblin Bomb, Ice Cauldron,
// Rejuvenate) and the one the client animates (`random-reveal-overlay.tsx`).
// It was briefly migrated onto the synchronous sibling `coinFlipSync`, which
// skips that reveal — the flip resolved invisibly and the animation was gone.
// `coinFlipSync` draws from the SAME seeded PRNG, so the only difference is
// whether the player gets to see the flip; for a card whose whole text is
// "Flip a coin", that is the card.
//
// DIVERGENCE (flagged, tracked #974): the printed "that isn't the target of an
// ability from another creature named Goblin Artisans" multi-copy clause is
// simplified (not enforced) — it only matters with two Goblin Artisans
// targeting the same spell, an edge the current pool/UI doesn't exercise.
export const goblinArtisans: CardDefinition = {
    id: "6669d96e-9a7b-4427-a477-f4e76831f593",
    rarity: "uncommon",
    name: "Goblin Artisans",
    oracleText:
        "{T}: Flip a coin. If you win the flip, draw a card. If you lose the flip, counter target artifact spell you control that isn't the target of an ability from another creature named Goblin Artisans.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Artificer"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "goblin-artisans-flip",
            oracleText:
                "{T}: Flip a coin. If you win the flip, draw a card. If you lose the flip, counter target artifact spell you control.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "spell",
                count: 1,
                spellTypeFilter: "Artifact",
                controller: "you",
            },
            effects: [
                {
                    op: "coinFlip",
                    win: {
                        consequence: "Draw a card.",
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                        ],
                    },
                    loss: {
                        consequence:
                            "Counter target artifact spell you control.",
                        effects: [{ op: "counter", target: { target: 0 } }],
                    },
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster A — sacrifice-as-activation-cost on a filtered, non-self permanent
// (CR 602.1 / 118.5). The activated-ability cost gains `sacrificeFilter`: the
// player chooses which matching permanent to sacrifice while paying the cost,
// and the activation is illegal if no matching permanent is on their
// battlefield. The chosen permanent's pre-sacrifice mana value is snapshotted
// onto the stack item so `getAdditionalSacrificeMv()` reads it at resolve
// (Priest of Yawgmoth). See PRD #269 cluster A, issue #282.
//
// NOTE (out of scope) (CR 605.1a deviation): Priest of Yawgmoth is
// technically a mana ability (no target, can add mana) but is modeled here as a
// `useStack: true` activated ability. Its output is the sacrificed artifact's
// mana value, read at resolve from the stack item's sacrifice snapshot, and the
// non-stack commit (`commitNonStackActivation`) resolves a descriptor-less mana
// ability through a transient stack item that carries no such snapshot — so the
// flip would add no mana. Ashnod's Altar and Phyrexian Altar, whose output IS a
// descriptor (`manaProduced` / `manaChoices`), were flipped by issue #3047.
// Practical cost for Priest: its mana isn't available mid-cast.
// tracked-by: #3989
// ─────────────────────────────────────────────────────────────────────────────
