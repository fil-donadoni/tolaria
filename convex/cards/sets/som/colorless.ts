// som (Scars of Mirrodin) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";
import { hasMetalcraft } from "../../types";
import { makeDualLand } from "../../abilities";

// The SOM "fast land" cycle — see `makeDualLand`'s `fastLand` flag in
// `convex/cards/abilities/index.ts` for the shared conditional-tapped shape.
// Vintage Cube free tranche (issue #675, ADR 0041).
export const copperlineGorge: CardDefinition = makeDualLand({
    id: "28f1d784-f286-418d-a712-bc07ad10d4a2",
    name: "Copperline Gorge",
    rarity: "rare",
    colors: ["R", "G"],
    fastLand: true,
});

export const razorvergeThicket: CardDefinition = makeDualLand({
    id: "345e053a-3178-485c-8602-1624bbf2f064",
    name: "Razorverge Thicket",
    rarity: "rare",
    colors: ["G", "W"],
    fastLand: true,
});

export const blackcleaveCliffs: CardDefinition = makeDualLand({
    id: "3d71be5f-0fd7-4a88-8041-f4d6bc4cc9ac",
    name: "Blackcleave Cliffs",
    rarity: "rare",
    colors: ["B", "R"],
    fastLand: true,
});

export const seachromeCoast: CardDefinition = makeDualLand({
    id: "99939b90-e88c-4c2f-ba78-56d455611703",
    name: "Seachrome Coast",
    rarity: "rare",
    colors: ["W", "U"],
    fastLand: true,
});

export const darkslickShores: CardDefinition = makeDualLand({
    id: "e530388b-eb19-4211-abd8-8a4c3c38c3af",
    name: "Darkslick Shores",
    rarity: "rare",
    colors: ["U", "B"],
    fastLand: true,
});

const MOX_OPAL_COLORS = ["W", "U", "B", "R", "G"] as const;

// Mox Opal — Legendary Artifact, {0} (Vintage Cube FREE wave 3, issue #1530,
// parent PRD #1525). "Metalcraft — {T}: Add one mana of any color. Activate
// only if you control three or more artifacts." UNBLOCKED: the som/#675-era
// stub comment (superseded) called this out as needing both a Metalcraft
// registry row AND a `canActivate` gate on the tap-mana fast path — but issue
// #947 (Chrome Mox's un-imprinted-mox fix) already wired `canActivate` into
// EVERY real consumer of a tap-based mana ability
// (`getManaTapOptionsDetailed` / `hasManaAbility` / `getActivatedManaAbility`,
// `convex/gre/constants.ts`), not merely the stack-based `activateAbility`
// mutation this stub's comment worried about — a stale blocker exactly like
// PRD #1525 warns about (Surveil, Pyrogoyf, Tishana's Tidebinder). Metalcraft
// itself is a CR 702-preamble ABILITY WORD (no independent rules meaning,
// like Domain/Flurry — never declared in `staticAbilities[]`), backed by the
// shared `hasMetalcraft` board-scan helper (`cards/types.ts`, registered in
// `mechanicsRegistry.ts`'s `ABILITY_WORDS`). Shape mirrors Chrome Mox
// (`mrd/colorless.ts`) exactly: `canActivate` is the availability gate,
// `manaChoices` is the static 5-colour option list every `getManaTapOptions`
// consumer reads once gated true, and `effect` is the required-but-unreached
// DSL fallback (no board-conditional colour narrowing needed here — unlike
// Chrome Mox's imprint set, Mox Opal always offers all five colours once
// active, so no `getManaChoices` override is needed).
export const moxOpal: CardDefinition = {
    id: "6be9b1d5-9ab8-4adb-ba54-2c0117e842fa",
    name: "Mox Opal",
    rarity: "mythic",
    oracleText:
        "Metalcraft — {T}: Add one mana of any color. Activate only if you control three or more artifacts.",
    manaCost: {},
    types: ["Artifact"],
    supertypes: ["Legendary"],
    activatedAbilities: [
        {
            id: "mox-opal-mana",
            oracleText:
                "Metalcraft — {T}: Add one mana of any color. Activate only if you control three or more artifacts.",
            cost: { tap: true },
            useStack: false,
            canActivate: (source, state) =>
                hasMetalcraft(state, source.controllerId),
            // Required-but-unreached fallback (mirrors Chrome Mox / Fellwar
            // Stone / Birds of Paradise) — the real per-activation colour
            // choice is resolved by the `manaChoices` list below.
            effect: (ctx) => ctx.addMana({ W: 1 }),
            manaChoices: MOX_OPAL_COLORS.map((c) => ({ [c]: 1 })),
        },
    ],
};
