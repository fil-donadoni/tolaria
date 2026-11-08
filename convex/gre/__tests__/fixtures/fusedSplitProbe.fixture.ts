// Shared fixture: a test-only SPLIT card with FUSE (CR 702.102).
//
// A fixture module rather than inline for the reason `warpProbe.fixture.ts`
// gives: the ENGINE guards and the BOT guards run in different vitest
// projects, and both must drive the SAME definition.
//
// Both halves are red and both target a creature, so one land type pays every
// cast and the fused spell's two target groups are distinguishable by what
// each half does to its own target: the left half deals 1 damage, the right
// half 2. Fused onto ONE 3-toughness creature, it dies only if BOTH halves
// resolved against their own slots (CR 702.102d).
import { registerTokenDefinition } from "../../../cards";
import {
    defineSplitCard,
    SPLIT_HALF_SIDES,
    splitHalfTwinDefinition,
} from "../../../cards/splitCard";
import { fusedSplitTwinDefinition } from "../../../cards/fusedSplit";
import type { CardDefinition } from "../../../cards/types";

export const FUSED_SPLIT_PROBE_ID = "test:fused-split-probe";

const FUSE_LINE =
    "Fuse (You may cast one or both halves of this card from your hand.)";

/** {R} "1 damage to target creature" // {1}{R} "2 damage to target creature",
 *  with fuse. */
export const fusedSplitProbe: CardDefinition = defineSplitCard({
    id: FUSED_SPLIT_PROBE_ID,
    rarity: "common",
    oracleText: "",
    staticAbilities: ["fuse"],
    halves: [
        {
            name: "Probe Spark",
            manaCost: { R: 1 },
            types: ["Instant"],
            oracleText: `Probe Spark deals 1 damage to target creature.\n${FUSE_LINE}`,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
        {
            name: "Probe Blaze",
            manaCost: { X: 1, R: 1 },
            types: ["Instant"],
            oracleText: `Probe Blaze deals 2 damage to target creature.\n${FUSE_LINE}`,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
});

registerTokenDefinition(fusedSplitProbe);
// The twins `preloadDefinitions` registers for every catalogue card; a probe
// outside the catalogue registers its own.
for (const side of SPLIT_HALF_SIDES) {
    registerTokenDefinition(splitHalfTwinDefinition(fusedSplitProbe, side)!);
}
registerTokenDefinition(fusedSplitTwinDefinition(fusedSplitProbe)!);
