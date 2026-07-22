// NEM — white cards, split by colour per ADR 0043. The registry's
// `import * as nem from "./sets/nem"` resolves through nem/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { holdsExileBundle } from "../../abilities/exileBundle";

// Parallax Wave — "Fading 5 (…) Remove a fade counter from this enchantment:
// Exile target creature. When this enchantment leaves the battlefield, each
// player returns to the battlefield all cards they own exiled with it."
// (CR 702.32 Fading; CR 701.18 exile; CR 603.7a leaves-the-battlefield.)
//
// Fading 5 is expanded implicitly at the getDefinition seam (ADR 0054): the
// "fading 5" string injects `entersWith` five fade counters + the upkeep
// remove-or-sacrifice trigger. The repeatable exile mode spends those same fade
// counters as an activation cost (`cost.removeCounter`), racing the fading
// clock — every exile brings the sacrifice one upkeep closer.
//
// DSL-first (ADR 0045): the exile-and-return bundle (ADR 0028) is now the
// `exileWithAttachments` / `returnExiledForSource` Op pair — the activated exile
// arms a bundle keyed to `$source` (host-only, the O-Ring default), and the
// leaves trigger returns every card exiled with this enchantment to its owner's
// control (`returnExiledForSource` iterates every bundle keyed to this source).
const PARALLAX_WAVE_ID = "cef789e8-e4cc-4f61-bc15-debc2487777f"; // NEM 17
export const parallaxWave: CardDefinition = {
    id: PARALLAX_WAVE_ID,
    name: "Parallax Wave",
    rarity: "rare",
    oracleText:
        "Fading 5 (This enchantment enters with five fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it.)\nRemove a fade counter from this enchantment: Exile target creature.\nWhen this enchantment leaves the battlefield, each player returns to the battlefield all cards they own exiled with it.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    staticAbilities: ["fading 5"],
    activatedAbilities: [
        {
            id: "parallax-wave-exile",
            oracleText:
                "Remove a fade counter from this enchantment: Exile target creature.",
            cost: { removeCounter: { type: "fade", count: 1 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // CR 701.18 host-only exile (auras die, equipment detaches); ADR
            // 0028 arms the return keyed to `$source`. Op defaults
            // includeAttachments/returnTapped false — the host-only shape.
            effects: [{ op: "exileWithAttachments", target: { target: 0 } }],
        },
    ],
    triggeredAbilities: [
        leftTrigger({
            // CR 603.7a — every card exiled with this returns to its owner's
            // battlefield when it leaves. `returnExiledForSource` returns every
            // bundle under this sourceId, each to its own owner's control.
            id: "parallax-wave-return",
            oracleText:
                "When this enchantment leaves the battlefield, each player returns to the battlefield all cards they own exiled with it.",
            scope: "self",
            condition: holdsExileBundle,
            effects: [{ op: "returnExiledForSource" }],
        }),
    ],
};

// Seal of Cleansing — {1}{W} Enchantment. "Sacrifice this enchantment:
// Destroy target artifact or enchantment." CR 605 activated ability with a
// self-sacrifice cost (no mana), mirroring Haywire Mite's sacrifice-cost +
// artifact-or-enchantment target shape (bro/colorless.ts) but destroying
// (DSL `destroy` Op, CR 701.8) rather than exiling. The Op is already
// interpreter-exercised — no hand-written test required (per-Op regime,
// ADR 0046).
export const sealOfCleansing: CardDefinition = {
    id: "af6c921e-1b82-412c-9979-adfdf83440f7",
    name: "Seal of Cleansing",
    rarity: "common",
    oracleText:
        "Sacrifice this enchantment: Destroy target artifact or enchantment.",
    manaCost: { X: 1, W: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "seal-of-cleansing-sac",
            oracleText:
                "Sacrifice this enchantment: Destroy target artifact or enchantment.",
            cost: { sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                count: 1,
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};
