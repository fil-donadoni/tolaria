// uds (Urza's Destiny) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Colourless artifacts (no
// coloured cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Powder Keg — "At the beginning of your upkeep, you may put a fuse counter on
// this artifact.\n{T}, Sacrifice this artifact: Destroy each artifact and
// creature with mana value equal to the number of fuse counters on this
// artifact." (Premodern SB, PRD #979 / issue #997.) DSL-first (ADR 0045): both
// halves are Effect Scripts — no `resolve()`.
//
// HOME SET (issue #1027): Powder Keg's only real Scryfall printing is Urza's
// Destiny (uds, `id` below), which IS Premodern-legal. It is homed in this
// `uds` module — `definitionSetCode` derives to "uds", now in
// PREMODERN_LEGAL_SETS (`convex/formats.ts`). PR #1026 originally parked it in
// the `usg` module as a workaround before `uds` was a built/Premodern-legal
// set; #1027 corrects the attribution.
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
            // CR 608.2g / 701.21 — sweep every artifact and creature (all
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
