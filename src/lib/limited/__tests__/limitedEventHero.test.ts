// The event page hero's phase → CTA mapping (PRD #5383, issue #5389): every
// phase for every viewer role.
import { describe, it, expect } from "vitest";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import {
    LIMITED_EVENT_PHASES,
    limitedDraftPackProgress,
    limitedEventChips,
    limitedEventHero,
    limitedEventPhase,
    limitedViewerRole,
    type LimitedEventPhase,
} from "../limitedEventHero";

type HeroEvent = Parameters<typeof limitedEventHero>[0];

const PAIRING = {
    roundNumber: 1,
    seatIndex: 0,
    opponentSeatIndex: 1,
    opponentNickname: "Bea",
    opponentIsBot: false,
    isBye: false,
    result: null,
    gameWins: null,
    gameLosses: null,
    outcome: null,
    matchId: null,
    roundComplete: false,
} as const;

/** One event per stepper phase. */
const PHASE_EVENTS: Record<LimitedEventPhase, Partial<HeroEvent>> = {
    waiting: { status: "open" },
    draft: { status: "started", type: "draft" },
    deckbuilding: { status: "started", type: "sealed", completed: false },
    games: { status: "playing", completed: true, viewerPairing: PAIRING },
    done: { status: "finished", completed: true },
};

function event(phase: LimitedEventPhase, over: Partial<HeroEvent> = {}) {
    return {
        type: "sealed",
        seatCount: 4,
        seatsWithDeck: 1,
        completed: false,
        draftCompletedAt: undefined,
        viewerPairing: null,
        seats: [
            { seatIndex: 0, userId: "u1", isBot: false },
            { seatIndex: 1, userId: "u2", isBot: false },
        ],
        ...PHASE_EVENTS[phase],
        ...over,
    } as unknown as HeroEvent;
}

const SEATED = { hasDeck: false };
const VIEWERS = {
    creator: { isCreator: true, seat: SEATED },
    seated: { isCreator: false, seat: SEATED },
    visitor: { isCreator: false, seat: undefined },
} as const;

describe("limitedEventPhase", () => {
    it.each(LIMITED_EVENT_PHASES)("maps the %s event to its own step", (p) => {
        expect(limitedEventPhase(event(p))).toBe(p);
    });

    it("keeps an all-decks-in event on the Deckbuilding step", () => {
        expect(
            limitedEventPhase(event("deckbuilding", { completed: true }))
        ).toBe("deckbuilding");
    });
});

describe("limitedViewerRole", () => {
    it("ranks creator over seated over visitor", () => {
        expect(limitedViewerRole(true, true)).toBe("creator");
        expect(limitedViewerRole(true, false)).toBe("creator");
        expect(limitedViewerRole(false, true)).toBe("seated");
        expect(limitedViewerRole(false, false)).toBe("visitor");
    });
});

describe("limitedEventHero — CTA per phase and role", () => {
    const EXPECTED: Record<
        LimitedEventPhase,
        Record<keyof typeof VIEWERS, [string, string]>
    > = {
        waiting: {
            creator: ["start", "Start now · 2 bots fill in"], // seated creator
            seated: ["waiting", "Waiting for the host to start"],
            visitor: ["join", "Join this event"],
        },
        draft: {
            creator: ["draft", "Enter the Draft Room"],
            seated: ["draft", "Enter the Draft Room"],
            visitor: ["waiting", "Draft in progress"],
        },
        deckbuilding: {
            creator: ["build", "Build your deck"],
            seated: ["build", "Build your deck"],
            visitor: ["waiting", "Players are building their decks"],
        },
        games: {
            creator: ["play", "Play match vs Bea"],
            seated: ["play", "Play match vs Bea"],
            visitor: ["waiting", "Rounds in progress"],
        },
        done: {
            creator: ["back", "Back to Limited events"],
            seated: ["back", "Back to Limited events"],
            visitor: ["back", "Back to Limited events"],
        },
    };

    for (const phase of LIMITED_EVENT_PHASES) {
        for (const role of Object.keys(VIEWERS) as (keyof typeof VIEWERS)[]) {
            it(`${phase} · ${role}`, () => {
                const hero = limitedEventHero(event(phase), VIEWERS[role]);
                expect(hero.phase).toBe(phase);
                expect(hero.role).toBe(role);
                expect([hero.cta.kind, hero.cta.label]).toEqual(
                    EXPECTED[phase][role]
                );
            });
        }
    }

    it("leads an unseated creator with Join, Start as the quieter second action (issue #5665)", () => {
        const hero = limitedEventHero(event("waiting"), {
            isCreator: true,
            seat: undefined,
        });
        expect(hero.role).toBe("creator");
        expect(hero.cta.kind).toBe("join");
        expect(hero.secondary?.kind).toBe("start");
    });

    it("keeps Start primary, with no second action, for a seated creator", () => {
        const hero = limitedEventHero(event("waiting"), VIEWERS.creator);
        expect(hero.cta.kind).toBe("start");
        expect(hero.secondary).toBeNull();
    });

    it("drops the bots from the Start label once the table is full", () => {
        const full = event("waiting", {
            seats: [0, 1, 2, 3].map((i) => ({
                seatIndex: i,
                userId: `u${i}`,
                isBot: false,
            })) as unknown as HeroEvent["seats"],
        });
        expect(limitedEventHero(full, VIEWERS.creator).cta.label).toBe(
            "Start now"
        );
    });

    it("waits (disabled shape) once the viewer's deck is in", () => {
        const hero = limitedEventHero(event("deckbuilding"), {
            isCreator: false,
            seat: { hasDeck: true },
        });
        expect(hero.cta).toEqual({
            kind: "waiting",
            label: "Waiting — 1/4 decks",
        });
    });

    it("says the rounds are starting once every deck is in", () => {
        const hero = limitedEventHero(
            event("deckbuilding", { seatsWithDeck: 4 }),
            { isCreator: false, seat: { hasDeck: true } }
        );
        expect(hero.cta.label).toBe("All decks are in — rounds are starting");
    });

    it("never offers a Match for a bye or a decided pairing", () => {
        const bye = event("games", {
            viewerPairing: { ...PAIRING, isBye: true },
        });
        const decided = event("games", {
            viewerPairing: { ...PAIRING, outcome: "win" },
        });
        expect(limitedEventHero(bye, VIEWERS.seated).cta.kind).toBe("waiting");
        expect(limitedEventHero(decided, VIEWERS.seated).cta.kind).toBe(
            "waiting"
        );
    });

    it("always yields exactly one CTA, with no second action outside the unseated creator's Start", () => {
        for (const phase of LIMITED_EVENT_PHASES) {
            for (const viewer of Object.values(VIEWERS)) {
                const hero = limitedEventHero(event(phase), viewer);
                expect(hero.cta).toBeDefined();
                expect(hero.secondary).toBeNull();
            }
        }
    });
});

describe("limitedEventChips", () => {
    const base = {
        type: "draft",
        seatCount: 8,
        gamesFormat: "bo3",
        timerEnabled: true,
    } as Pick<
        LimitedEventView,
        "type" | "seatCount" | "gamesFormat" | "timerEnabled"
    >;

    it("lists type · Pack Source, Games Format, seats and the timer", () => {
        expect(limitedEventChips(base, "Vintage Cube")).toEqual([
            "Draft · Vintage Cube",
            "Best of 3",
            "8 seats",
            "Pick timer on",
        ]);
    });

    it("omits the timer for Sealed and the source for an unnamed one", () => {
        expect(
            limitedEventChips(
                { ...base, type: "sealed", gamesFormat: "bo1" },
                undefined
            )
        ).toEqual(["Sealed", "Best of 1", "8 seats"]);
    });
});

describe("limitedDraftPackProgress", () => {
    const packs = { packSlots: ["a", "a", "a"] };

    it("marks packs behind, in play and ahead of the 0-indexed round", () => {
        expect(
            limitedDraftPackProgress({
                ...packs,
                draftRound: 1,
                draftCompletedAt: undefined,
            }).map((p) => p.state)
        ).toEqual(["done", "current", "upcoming"]);
    });

    it("has every pack behind it once the draft completed", () => {
        expect(
            limitedDraftPackProgress({
                ...packs,
                draftRound: 2,
                draftCompletedAt: 5,
            }).map((p) => p.state)
        ).toEqual(["done", "done", "done"]);
    });
});
