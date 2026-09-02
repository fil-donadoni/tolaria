// Graveyard reach — the gate and the leaf term (issue #3042, map #1892).
//
// The subject is `convex/gre/ai/graveyardReach.ts` (the predicate) and
// `evaluate.ts`'s `graveyardReach` term (the pricing). The contract under test
// is the one the ticket makes load-bearing: a graveyard is a DEAD ZONE by
// default and must score exactly as it did before the term existed; it earns
// credit only where its owner can actually reach it; and the credit must never
// approach a permanent's in-play worth, or trading and chump-blocking become
// free.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { evaluate, evaluateBreakdown } from "../evaluate";
import {
    hasGraveyardRecursionAccess,
    isSelfReachableInGraveyard,
} from "../ai/graveyardReach";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const BEARS = getCardByName("Grizzly Bears").id; // 2/2 vanilla
const GIANT = getCardByName("Hill Giant").id; // 3/3 vanilla
const SPRITES = getCardByName("Scryb Sprites").id; // 1/1 flier
const REANIMATE = getCardByName("Reanimate").id; // graveyard -> battlefield
const REGROWTH = getCardByName("Regrowth").id; // graveyard -> hand
const UNSUMMON = getCardByName("Unsummon").id; // battlefield -> hand (bounce)
const EPHEMERATE = getCardByName("Ephemerate").id; // exile -> battlefield (blink)
const FIREBOLT = getCardByName("Firebolt").id; // CR 702.34 flashback
const ASHEN_GHOUL = getCardByName("Ashen Ghoul").id; // activateFromGraveyard
const BREACH = getCardByName("Underworld Breach").id; // CR 702.138 grant
const BOLT = getCardByName("Lightning Bolt").id; // ordinary escape fodder
const CARETAKER = getCardByName("Hell's Caretaker").id; // recurs OTHER cards
const CRUCIBLE = getCardByName("Crucible of Worlds").id; // CR 305.9 land play
const FOREST = getCardByName("Forest").id;
const DEATH_OR_GLORY = getCardByName("Death or Glory").id; // nested construct
const SQUEE = getCardByName("Squee, Goblin Nabob").id; // graveyard-zone trigger
const DARIGAAZ = getCardByName("Darigaaz's Charm").id; // per-MODE target zone
const CORPSE_DANCE = getCardByName("Corpse Dance").id; // reanimate, exile LATER

function seat(
    id: string,
    over: Parameters<typeof makePlayer>[1] = {}
): ReturnType<typeof makePlayer> {
    return makePlayer(id, over);
}

/** Two seats, `p1` first (the evaluating seat throughout this file). */
function stateWith(
    p1: ReturnType<typeof makePlayer>,
    p2: ReturnType<typeof makePlayer> = seat("p2")
) {
    return makeState({ players: [p1, p2] });
}

describe("graveyard reach — recursion access (issue #3042)", () => {
    it("sees a reanimation spell in hand", () => {
        const player = seat("p1", {
            hand: [makeInstance(REANIMATE, { zone: "hand" })],
        });
        expect(hasGraveyardRecursionAccess(player)).toBe(true);
    });

    it("sees a regrowth effect (graveyard -> HAND) too", () => {
        const player = seat("p1", {
            hand: [makeInstance(REGROWTH, { zone: "hand" })],
        });
        expect(hasGraveyardRecursionAccess(player)).toBe(true);
    });

    it("sees a recursion permanent already on the battlefield", () => {
        // Hell's Caretaker returns ANOTHER creature card from the graveyard,
        // so it is access to the pile at large.
        const player = seat("p1", { battlefield: [makeInstance(CARETAKER)] });
        expect(hasGraveyardRecursionAccess(player)).toBe(true);
    });

    it("a SELF-recovery card is not access to the pile — wherever it sits", () => {
        // Ashen Ghoul returns ITSELF from the graveyard (CR 113.6). Read as
        // access it would credit the top of the whole graveyard off a card in
        // hand or on the battlefield, where it reaches nothing at all — the
        // "credit a dead graveyard" failure the gate exists to prevent, and a
        // whole class (Bloodghast, Gravecrawler, Reassembling Skeleton).
        for (const zone of ["hand", "battlefield"] as const) {
            const card = makeInstance(ASHEN_GHOUL, { zone });
            const player = seat("p1", {
                [zone]: [card],
            } as Parameters<typeof makePlayer>[1]);
            expect(hasGraveyardRecursionAccess(player)).toBe(false);
        }
        // A fat graveyard plus that card on the battlefield stays a dead zone.
        const state = stateWith(
            seat("p1", {
                graveyard: [makeInstance(GIANT, { zone: "graveyard" })],
                battlefield: [makeInstance(ASHEN_GHOUL)],
            })
        );
        expect(evaluateBreakdown(state, "p1").self.graveyardReach).toBe(0);
    });

    it("reads a MODE's own target zone, not the card's (Darigaaz's Charm)", () => {
        // The regrowth mode declares `zone: "graveyard"`; the card level does
        // not. Pairing every mode with the card-level requirement missed it.
        const player = seat("p1", {
            hand: [makeInstance(DARIGAAZ, { zone: "hand" })],
        });
        expect(hasGraveyardRecursionAccess(player)).toBe(true);
    });

    it("a LATER exile is not a blink (Corpse Dance reanimates, then exiles)", () => {
        // The blink discriminator must not count an exile that fires in a
        // delayed trigger: it happens after the return, so it cannot be what
        // was returned. Counting it read two genuine reanimation spells as
        // blinks.
        const player = seat("p1", {
            hand: [makeInstance(CORPSE_DANCE, { zone: "hand" })],
        });
        expect(hasGraveyardRecursionAccess(player)).toBe(true);
    });

    it("descends the non-structural nesting Ops too (Death or Glory)", () => {
        // Its reanimation sits inside a `divideIntoPiles` branch, which the
        // first walk fell through on `default:`.
        const player = seat("p1", {
            hand: [makeInstance(DEATH_OR_GLORY, { zone: "hand" })],
        });
        expect(hasGraveyardRecursionAccess(player)).toBe(true);
    });

    it("is false for a plain BOUNCE — it reaches no graveyard", () => {
        const player = seat("p1", {
            hand: [makeInstance(UNSUMMON, { zone: "hand" })],
        });
        expect(hasGraveyardRecursionAccess(player)).toBe(false);
    });

    it("is false for a BLINK — the card comes back from exile, not a grave", () => {
        const player = seat("p1", {
            hand: [makeInstance(EPHEMERATE, { zone: "hand" })],
        });
        expect(hasGraveyardRecursionAccess(player)).toBe(false);
    });

    it("is false for a seat holding nothing that reads a graveyard", () => {
        const player = seat("p1", {
            hand: [makeInstance(BEARS, { zone: "hand" })],
            battlefield: [makeInstance(GIANT)],
        });
        expect(hasGraveyardRecursionAccess(player)).toBe(false);
    });
});

describe("graveyard reach — self-reachable cards (issue #3042)", () => {
    it("counts a flashback card (CR 702.34) in the graveyard", () => {
        const card = makeInstance(FIREBOLT, { zone: "graveyard" });
        const player = seat("p1", { graveyard: [card] });
        const state = stateWith(player);
        expect(isSelfReachableInGraveyard(state, player, card)).toBe(true);
    });

    it("counts a card whose ability activates from the graveyard (CR 113.6)", () => {
        const card = makeInstance(ASHEN_GHOUL, { zone: "graveyard" });
        const player = seat("p1", { graveyard: [card] });
        const state = stateWith(player);
        expect(isSelfReachableInGraveyard(state, player, card)).toBe(true);
    });

    it("counts a card whose GRAVEYARD-ZONE TRIGGER returns it (Squee)", () => {
        // The other spelling of CR 113.6: a triggered ability scoped to the
        // graveyard whose script moves `$source` out of it. This is where the
        // self-recovery refused by the access predicate belongs — it applies
        // to the one card it can actually return.
        const card = makeInstance(SQUEE, { zone: "graveyard" });
        const player = seat("p1", { graveyard: [card] });
        expect(
            isSelfReachableInGraveyard(stateWith(player), player, card)
        ).toBe(true);
    });

    it("counts a LAND under a play-from-graveyard permission (CR 305.9)", () => {
        // A land is PLAYED, never cast, so `graveyardCastMechanism` is silent
        // on it; Crucible of Worlds' reach lives in `canPlayLandsFromGraveyard`.
        const land = makeInstance(FOREST, { zone: "graveyard" });
        const without = seat("p1", { graveyard: [land] });
        expect(
            isSelfReachableInGraveyard(stateWith(without), without, land)
        ).toBe(false);
        const withCrucible = seat("p1", {
            graveyard: [land],
            battlefield: [makeInstance(CRUCIBLE)],
        });
        expect(
            isSelfReachableInGraveyard(
                stateWith(withCrucible),
                withCrucible,
                land
            )
        ).toBe(true);
    });

    it("does NOT count a BATTLEFIELD-GRANTED escape — that pile is `graveyardEngineTerm`'s", () => {
        // CR 702.138 — Underworld Breach grants escape to the whole graveyard,
        // so `graveyardCastMechanism` answers "escape" for every nonland card
        // in it. `graveyardEngineTerm` already prices that pile as throughput;
        // crediting it here too values every Breach board twice.
        // Breach's `exileOtherCount` is 3, so a cast consumes FOUR cards —
        // the graveyard has to be that big for the engine term to fire at all,
        // which is what makes the "unaffected" half of this assertion real.
        const cards = Array.from({ length: 4 }, () =>
            makeInstance(BOLT, { zone: "graveyard" })
        );
        const player = seat("p1", {
            graveyard: cards,
            battlefield: [makeInstance(BREACH)],
        });
        const state = stateWith(player);
        for (const card of cards) {
            expect(isSelfReachableInGraveyard(state, player, card)).toBe(false);
        }
        const terms = evaluateBreakdown(state, "p1").self;
        expect(terms.graveyardReach).toBe(0);
        // ...while the engine term itself is unaffected and still fires.
        expect(terms.graveyard).toBeGreaterThan(0);
    });

    it("does NOT count an ordinary creature card", () => {
        const card = makeInstance(GIANT, { zone: "graveyard" });
        const player = seat("p1", { graveyard: [card] });
        const state = stateWith(player);
        expect(isSelfReachableInGraveyard(state, player, card)).toBe(false);
    });
});

describe("graveyardReach term (issue #3042)", () => {
    it("a graveyard with NO reachable payoff is a dead zone — the position scores exactly as with an empty graveyard", () => {
        const withFatty = stateWith(
            seat("p1", {
                graveyard: [makeInstance(GIANT, { zone: "graveyard" })],
            })
        );
        const withEmpty = stateWith(seat("p1"));
        expect(evaluateBreakdown(withFatty, "p1").self.graveyardReach).toBe(0);
        expect(evaluate(withFatty, "p1")).toBe(evaluate(withEmpty, "p1"));
    });

    it("credits the graveyard once recursion is in hand", () => {
        const noAccess = stateWith(
            seat("p1", {
                graveyard: [makeInstance(GIANT, { zone: "graveyard" })],
                hand: [makeInstance(BEARS, { zone: "hand" })],
            })
        );
        const access = stateWith(
            seat("p1", {
                graveyard: [makeInstance(GIANT, { zone: "graveyard" })],
                hand: [makeInstance(REANIMATE, { zone: "hand" })],
            })
        );
        expect(evaluateBreakdown(noAccess, "p1").self.graveyardReach).toBe(0);
        expect(
            evaluateBreakdown(access, "p1").self.graveyardReach
        ).toBeGreaterThan(0);
    });

    it("credits a self-reachable card with no recursion anywhere", () => {
        const state = stateWith(
            seat("p1", {
                graveyard: [makeInstance(FIREBOLT, { zone: "graveyard" })],
            })
        );
        expect(
            evaluateBreakdown(state, "p1").self.graveyardReach
        ).toBeGreaterThan(0);
    });

    it("is SYMMETRIC and gated per player: my recursion does not credit the opponent's graveyard", () => {
        const state = stateWith(
            seat("p1", { hand: [makeInstance(REANIMATE, { zone: "hand" })] }),
            seat("p2", {
                graveyard: [makeInstance(GIANT, { zone: "graveyard" })],
            })
        );
        const terms = evaluateBreakdown(state, "p1");
        expect(terms.opp.graveyardReach).toBe(0);
        // ...and the same graveyard DOES credit them once THEY hold recursion.
        const theirs = stateWith(
            seat("p1"),
            seat("p2", {
                graveyard: [makeInstance(GIANT, { zone: "graveyard" })],
                hand: [makeInstance(REANIMATE, { zone: "hand" })],
            })
        );
        expect(
            evaluateBreakdown(theirs, "p1").opp.graveyardReach
        ).toBeGreaterThan(0);
    });

    it("caps how many reachable cards are credited, best-first", () => {
        const many = stateWith(
            seat("p1", {
                // The two small creatures come FIRST, so a first-found cap
                // would credit them and this could not tell the two apart.
                graveyard: [
                    makeInstance(SPRITES, { zone: "graveyard" }),
                    makeInstance(SPRITES, { zone: "graveyard" }),
                    makeInstance(GIANT, { zone: "graveyard" }),
                    makeInstance(GIANT, { zone: "graveyard" }),
                ],
                hand: [makeInstance(REANIMATE, { zone: "hand" })],
            })
        );
        const twoGiants = stateWith(
            seat("p1", {
                graveyard: [
                    makeInstance(GIANT, { zone: "graveyard" }),
                    makeInstance(GIANT, { zone: "graveyard" }),
                ],
                hand: [makeInstance(REANIMATE, { zone: "hand" })],
            })
        );
        // `graveyardReachCap` is 2, so the two extra 1/1s add nothing and the
        // two 3/3s are the ones credited (best-first, not first-found).
        expect(evaluateBreakdown(many, "p1").self.graveyardReach).toBe(
            evaluateBreakdown(twoGiants, "p1").self.graveyardReach
        );
        expect(DEFAULT_EVAL_WEIGHTS.graveyardReachCap).toBe(2);
    });

    it("does NOT make a creature trade a wash: dying is still a decisive loss WITH the payoff reachable", () => {
        const reanimate = () => makeInstance(REANIMATE, { zone: "hand" });
        const alive = stateWith(
            seat("p1", {
                battlefield: [makeInstance(GIANT)],
                hand: [reanimate()],
            })
        );
        const dead = stateWith(
            seat("p1", {
                graveyard: [makeInstance(GIANT, { zone: "graveyard" })],
                hand: [reanimate()],
            })
        );
        const before = evaluate(alive, "p1");
        const after = evaluate(dead, "p1");
        expect(after).toBeLessThan(before);
        // The credit returned must sit WELL BELOW the worth the creature had
        // in play — the contrast the ticket demands. It comes back at
        // `graveyardReachFraction` (0.15) of latent worth, so the position
        // keeps the overwhelming majority of the loss.
        const lost = before - after;
        const credited = evaluateBreakdown(dead, "p1").self.graveyardReach;
        expect(credited).toBeGreaterThan(0);
        expect(credited).toBeLessThan(lost / 3);
    });
});
