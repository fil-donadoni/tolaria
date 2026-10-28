// Shared fixture: test-only MODAL double-faced cards whose back face is CAST
// (CR 712.11b, issue #7200).
//
// Issue #7200 ships the cast path and no card — Jennifer Walters and the rest
// of the nonland-backed class are hand-written in their own Hand Tail issues,
// blocked by it — so these probes are what every back-face-cast suite drives.
// A fixture module rather than inline for the reason `warpProbe.fixture.ts`
// gives: the ENGINE guards and the BOT guards run in different vitest
// projects, and both must drive the SAME definitions.
//
// Two probes, one per way a cast back face leaves the stack:
//   * a CREATURE back face resolves onto the battlefield and stays back face
//     up (CR 712.8f);
//   * an INSTANT back face resolves into the graveyard, where it has only its
//     front face's characteristics again (CR 712.8a).
// Each back face costs something the front does not, so a suite can tell from
// the mana alone which face was paid for.
import { registerTokenDefinition } from "../../../cards";
import { modalBackTwinDefinition } from "../../../cards/modalDfc";
import type { CardDefinition } from "../../../cards/types";

export const MODAL_CREATURE_BACK_PROBE_ID = "test:modal-creature-back-probe";
export const MODAL_INSTANT_BACK_PROBE_ID = "test:modal-instant-back-probe";

/** {W} 1/1 Human // {2}{G} 4/4 Beast with trample. */
export const modalCreatureBackProbe: CardDefinition = {
    id: MODAL_CREATURE_BACK_PROBE_ID,
    rarity: "common",
    name: "Modal Probe Squire",
    oracleText: "",
    types: ["Creature"],
    subtypes: ["Human"],
    manaCost: { W: 1 },
    power: 1,
    toughness: 1,
    backFace: {
        kind: "modal",
        name: "Modal Probe Behemoth",
        manaCost: { X: 2, G: 1 },
        types: ["Creature"],
        subtypes: ["Beast"],
        power: 4,
        toughness: 4,
        staticAbilities: ["trample"],
        oracleText: "Trample",
    },
};

/** {1}{W} 2/2 Soldier // {R} Instant — "deals 3 damage to any target". */
export const modalInstantBackProbe: CardDefinition = {
    id: MODAL_INSTANT_BACK_PROBE_ID,
    rarity: "common",
    name: "Modal Probe Sentry",
    oracleText: "",
    types: ["Creature"],
    subtypes: ["Soldier"],
    manaCost: { X: 1, W: 1 },
    power: 2,
    toughness: 2,
    backFace: {
        kind: "modal",
        name: "Modal Probe Flare",
        manaCost: { R: 1 },
        types: ["Instant"],
        targetRequirement: { type: "any", count: 1 },
        effects: [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
        oracleText: "Modal Probe Flare deals 3 damage to any target.",
    },
};

for (const probe of [modalCreatureBackProbe, modalInstantBackProbe]) {
    registerTokenDefinition(probe);
    // The twin `preloadDefinitions` registers for every catalogue card; a
    // probe outside the catalogue registers its own.
    registerTokenDefinition(modalBackTwinDefinition(probe)!);
}
