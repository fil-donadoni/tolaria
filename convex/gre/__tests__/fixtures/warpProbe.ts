// Shared fixture: a test-only card declaring WARP (CR 702.185, issue #1268).
//
// Issue #1268 ships the KEYWORD and no card — Edge of Eternities is not in this
// pool — so the probe is what every warp suite drives. It lives in a fixture
// module rather than inline in one suite for the reason the two probes beside
// it do: the ENGINE guards and the BOT guards run in different vitest projects
// (`bot-suite-boundary.test.ts`), and both must drive the SAME definition or the
// two halves drift apart silently.
//
// The body is deliberately vanilla. Warp is entirely a cast-and-exile protocol
// (an alternative cost, a delayed exile, a recast window); an ETB effect on top
// would only make the assertions about the protocol harder to read.
import { registerTokenDefinition } from "../../../cards";
import type { CardDefinition } from "../../../cards/types";

export const WARP_PROBE_ID = "test:warp-probe";

/** CR 702.185a — "Warp {R}": a 4/4 for {4}{R} that can instead be cast for {R},
 *  is exiled at the beginning of the next end step, and is castable from exile
 *  for its printed {4}{R} from the following turn onward. The discount is wide
 *  on purpose: a suite can put ONE Mountain on the board and have exactly the
 *  warp cast be affordable, or five and have both be. */
export const warpProbe: CardDefinition = {
    id: WARP_PROBE_ID,
    rarity: "common",
    name: "Warp Probe",
    oracleText: "Warp {R}",
    types: ["Creature"],
    subtypes: ["Beast"],
    manaCost: { X: 4, R: 1 },
    power: 4,
    toughness: 4,
    staticAbilities: ["warp"],
    warp: { id: "warp", description: "Warp {R}", mana: { R: 1 } },
};
registerTokenDefinition(warpProbe);
