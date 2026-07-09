// usg (Urza's Saga) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type {
    ActivatedAbilityContext,
    CardDefinition,
    PermanentView,
} from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Gaea's Cradle — "{T}: Add {G} for each creature you control." (CR 605.1a
// mana ability, `useStack: false`.) Board-conditional output via the
// `manaAmount` hook — the same primitive the Urza land trio uses
// (`convex/cards/sets/atq/colorless.ts`), generalized here to a COUNT rather
// than a binary on/off. `manaProduced` is the representative fallback (one
// creature) for best-effort callers without a board snapshot. Vintage Cube
// free tranche (issue #675, ADR 0041).
export const gaeasCradle: CardDefinition = {
    id: "25b0b816-0583-44aa-9dc5-f3ff48993a51",
    rarity: "rare",
    name: "Gaea's Cradle",
    oracleText: "{T}: Add {G} for each creature you control.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "gaeas-cradle-mana",
            oracleText: "{T}: Add {G} for each creature you control.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ G: 1 });
            },
            manaProduced: { G: 1 },
            manaAmount: (_source, battlefield) => ({
                G: battlefield.filter((p: PermanentView) =>
                    p.types.includes("Creature")
                ).length,
            }),
        },
    ],
};

// Tolarian Academy — "{T}: Add {U} for each artifact you control." (CR
// 605.1a mana ability, `useStack: false`.) Same `manaAmount` shape as
// Gaea's Cradle, counting artifacts instead of creatures. Vintage Cube free
// tranche (issue #675, ADR 0041).
export const tolarianAcademy: CardDefinition = {
    id: "ad7ac9a5-340f-4509-826c-7b9416d47887",
    rarity: "rare",
    name: "Tolarian Academy",
    oracleText: "{T}: Add {U} for each artifact you control.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "tolarian-academy-mana",
            oracleText: "{T}: Add {U} for each artifact you control.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ U: 1 });
            },
            manaProduced: { U: 1 },
            manaAmount: (_source, battlefield) => ({
                U: battlefield.filter((p: PermanentView) =>
                    p.types.includes("Artifact")
                ).length,
            }),
        },
    ],
};

// Powder Keg — "At the beginning of your upkeep, you may put a fuse counter on
// this artifact.\n{T}, Sacrifice this artifact: Destroy each artifact and
// creature with mana value equal to the number of fuse counters on this
// artifact." (Premodern SB, PRD #979 / issue #997.) DSL-first (ADR 0045): both
// halves are Effect Scripts — no `resolve()`.
//
// NOTE ON SET (issue #997): the issue targets `usg` (Urza's Saga), but Powder
// Keg's only real Scryfall printing is Urza's DESTINY (uds, id below). `uds`
// is not a built/Premodern-legal set, so the card lives in the usg module —
// the home-set directory drives Premodern legality (`definitionSetCode` →
// "usg", which IS in PREMODERN_LEGAL_SETS) while `id` stays the real print id.
//
// COUNTER-READ-AFTER-SACRIFICE (CR 608.2g last-known information): sacrificing
// Powder Keg is a COST, paid at activation, so by the time the ability resolves
// the source has left the battlefield. `{ counters: { of: { ref: "$source" } } }`
// reads the count as LAST-KNOWN information — the resolving stack item snapshots
// the source's counters and the interpreter's `resolveValue` counters branch
// falls back to `getCounterCount` via `ctx.sourceInstanceId` for an
// off-battlefield `$source` (see convex/gre/effects/interpreter.ts).
export const powderKeg: CardDefinition = {
    id: "4d9715c2-9036-4ae2-a5b4-1b190d50c963",
    rarity: "rare",
    name: "Powder Keg",
    oracleText:
        "At the beginning of your upkeep, you may put a fuse counter on this artifact.\n{T}, Sacrifice this artifact: Destroy each artifact and creature with mana value equal to the number of fuse counters on this artifact.",
    manaCost: { generic: 2 },
    types: ["Artifact"],
    triggeredAbilities: [
        phaseTrigger({
            id: "powder-keg-fuse",
            oracleText:
                "At the beginning of your upkeep, you may put a fuse counter on this artifact.",
            phase: "UPKEEP",
            scope: "your",
            // CR 603.5 optional trigger + CR 122.1 — a cost-free "you may"
            // decision (mayPay with no cost, issue #680); on accept, put one
            // fuse counter on the source. A genuine tactical yes/no, so the
            // prompt is kept (not auto-resolved).
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Put a fuse counter on Powder Keg?",
                    bind: "$fuse",
                },
                {
                    op: "if",
                    predicate: { binding: "$fuse" },
                    then: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "fuse",
                            target: { ref: "$source" },
                            count: 1,
                        },
                    ],
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "powder-keg-detonate",
            oracleText:
                "{T}, Sacrifice this artifact: Destroy each artifact and creature with mana value equal to the number of fuse counters on this artifact.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            // CR 608.2g / 701.16 — sweep every artifact and creature (all
            // players' battlefields, so no `controller`) whose mana value
            // equals the source's fuse-counter count. The count is read as
            // last-known information: the source was sacrificed as a cost, so
            // `{ counters: { of: { ref: "$source" }, type: "fuse" } }` resolves
            // through the interpreter's off-battlefield `$source` fallback.
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: ["Artifact", "Creature"] },
                    },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: { ref: "$each.manaValue" },
                                op: "eq",
                                right: {
                                    counters: {
                                        of: { ref: "$source" },
                                        type: "fuse",
                                    },
                                },
                            },
                            then: [
                                {
                                    op: "destroy",
                                    target: { ref: "$each" },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};
