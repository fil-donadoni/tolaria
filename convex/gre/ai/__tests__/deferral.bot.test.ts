// The deferral perimeter (issue #4764): one predicate the Verdict lowering and
// the root rule of issue #4757 share. One block per clause — instant timing
// (CR 117.1a / 117.1b), own side only, not a response, no attack declared —
// plus the last-window reading (CR 513.1) and the both-direction timing
// classifier the lowering routes pairs through.
//
// The cards are FIXTURES, never special cases: nothing under test reads a card
// name. Impulse is an untargeted instant, Grizzly Bears a sorcery-speed body,
// Lightning Bolt a targeted instant, Snapcaster Mage a flash body whose entering
// trigger targets its own graveyard, Polluted Delta an untargeted stack
// activation, Mishra's Factory a mana ability (it never uses the stack,
// CR 605.3b), Zuran Orb a conversion (sacrifice a land: gain 2 life), and a
// flash Flametongue Kavu (a temporary definition) a flash body whose entering
// trigger can target an opposing creature. Unnatural Speed is an instant
// whose whole script is a haste grant until end of turn, Giant Growth one
// whose whole script is a pump until end of turn.
import { describe, expect, it } from "vitest";
import { getCardByName, withTemporaryDefinition } from "../../../cards";
import {
    isDeferrableAction,
    isLastDeferralWindow,
    isPreAttackGrant,
} from "../deferral";
import { timingPairClassifier } from "../verdicts/evalPairs";
import type { Move } from "../../moves";
import type { CardInstanceState, GameState } from "../../state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup";

const IMPULSE = getCardByName("Impulse").id;
const BEARS = getCardByName("Grizzly Bears").id;
const BOLT = getCardByName("Lightning Bolt").id;
const SNAPCASTER = getCardByName("Snapcaster Mage").id;
const DELTA = getCardByName("Polluted Delta").id;
const KAVU = getCardByName("Flametongue Kavu");
const SPEED = getCardByName("Unnatural Speed").id;
const GROWTH = getCardByName("Giant Growth").id;

const FACTORY = getCardByName("Mishra's Factory").id;
const ORB = getCardByName("Zuran Orb").id;
const ISLAND = getCardByName("Island").id;

const DELTA_FETCH = "polluted-delta-fetch";
const FACTORY_MANA = "mishras-factory-mana";
const ORB_GAIN = "zuran-orb-ability";

function card(cardId: string, id: string, owner = "p1"): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        isSummoningSick: false,
    });
}

function cast(
    cardInstanceId: string,
    targets: Extract<Move, { kind: "cast-spell" }>["targets"] = []
): Move {
    return {
        kind: "cast-spell",
        cardInstanceId,
        targets,
        confirmTargets: false,
        tapPlan: [],
    };
}

function activate(cardInstanceId: string, abilityId: string): Move {
    return {
        kind: "activate-ability",
        cardInstanceId,
        abilityId,
        targets: [],
        confirmTargets: false,
        tapPlan: [],
    };
}

/** p1's own main phase, p1 holding `hand` over `battlefield`, p2 holding
 *  `oppBattlefield`. */
function board(
    opts: {
        hand?: CardInstanceState[];
        battlefield?: CardInstanceState[];
        graveyard?: CardInstanceState[];
        oppBattlefield?: CardInstanceState[];
    } & Partial<GameState> = {}
): GameState {
    const { hand, battlefield, graveyard, oppBattlefield, ...rest } = opts;
    return makeState({
        players: [
            makePlayer("p1", {
                hand: hand ?? [],
                battlefield: battlefield ?? [],
                graveyard: graveyard ?? [],
            }),
            makePlayer("p2", { battlefield: oppBattlefield ?? [] }),
        ],
        ...rest,
    });
}

describe("instant timing (CR 117.1a / 117.1b)", () => {
    it("admits an instant cast and refuses a sorcery-speed cast", () => {
        const state = board({
            hand: [card(IMPULSE, "impulse"), card(BEARS, "bears")],
        });
        expect(isDeferrableAction(state, "p1", cast("impulse"))).toBe(true);
        expect(isDeferrableAction(state, "p1", cast("bears"))).toBe(false);
    });

    it("admits a stack activation with no timing restriction, refuses a mana ability", () => {
        const state = board({
            battlefield: [card(DELTA, "delta"), card(FACTORY, "factory")],
        });
        expect(
            isDeferrableAction(state, "p1", activate("delta", DELTA_FETCH))
        ).toBe(true);
        expect(
            isDeferrableAction(state, "p1", activate("factory", FACTORY_MANA))
        ).toBe(false);
    });

    it("refuses pass and a move kind it cannot read", () => {
        const state = board({ hand: [card(IMPULSE, "impulse")] });
        expect(isDeferrableAction(state, "p1", { kind: "pass" })).toBe(false);
        expect(
            isDeferrableAction(state, "p1", {
                kind: "play-land",
                cardInstanceId: "impulse",
            } as Move)
        ).toBe(false);
    });
});

describe("own side only", () => {
    it("refuses a target on the opponent's side, admits one on the mover's", () => {
        const state = board({
            hand: [card(BOLT, "bolt")],
            battlefield: [card(BEARS, "mine")],
            oppBattlefield: [card(BEARS, "theirs", "p2")],
        });
        expect(
            isDeferrableAction(
                state,
                "p1",
                cast("bolt", [{ type: "player", id: "p2" }])
            )
        ).toBe(false);
        expect(
            isDeferrableAction(
                state,
                "p1",
                cast("bolt", [{ type: "permanent", id: "theirs" }])
            )
        ).toBe(false);
        expect(
            isDeferrableAction(
                state,
                "p1",
                cast("bolt", [{ type: "permanent", id: "mine" }])
            )
        ).toBe(true);
    });

    it("asks an entering trigger's targets of the board (CR 603.3d)", () => {
        // Snapcaster's trigger can only point at its controller's graveyard.
        const snap = board({
            hand: [card(SNAPCASTER, "snap")],
            graveyard: [
                { ...card(BOLT, "gy-bolt"), zone: "graveyard" as const },
            ],
            oppBattlefield: [card(BEARS, "theirs", "p2")],
        });
        expect(isDeferrableAction(snap, "p1", cast("snap"))).toBe(true);

        // A flash body whose trigger can point at an opposing creature is
        // removal in disguise: out, and back in once no opposing creature is
        // a legal target.
        const flashKavu = {
            ...KAVU,
            staticAbilities: [...(KAVU.staticAbilities ?? []), "flash"],
        };
        withTemporaryDefinition(flashKavu, () => {
            const facing = board({
                hand: [card(KAVU.id, "kavu")],
                oppBattlefield: [card(BEARS, "theirs", "p2")],
            });
            expect(isDeferrableAction(facing, "p1", cast("kavu"))).toBe(false);
            const alone = board({
                hand: [card(KAVU.id, "kavu")],
                battlefield: [card(BEARS, "mine")],
            });
            expect(isDeferrableAction(alone, "p1", cast("kavu"))).toBe(true);
        });

        // The same trigger as a MODAL one (CR 700.2b): the requirement sits
        // on the mode, not on the trigger, and still takes the cast out.
        const modalKavu = {
            ...flashKavu,
            triggeredAbilities: (KAVU.triggeredAbilities ?? []).map((t) => ({
                ...t,
                targetRequirement: undefined,
                modes: [
                    {
                        id: "burn",
                        label: "burn",
                        oracleText: t.oracleText,
                        targetRequirement: t.targetRequirement,
                        effects: t.effects,
                    },
                ],
            })),
        };
        withTemporaryDefinition(modalKavu, () => {
            const facing = board({
                hand: [card(KAVU.id, "kavu")],
                oppBattlefield: [card(BEARS, "theirs", "p2")],
            });
            expect(isDeferrableAction(facing, "p1", cast("kavu"))).toBe(false);
        });
    });
});

describe("a conversion of another permanent stays the evaluation's (issue #2939)", () => {
    it("refuses an activation whose cost sacrifices another permanent, admits a self-sacrifice", () => {
        const state = board({
            battlefield: [
                card(ORB, "orb"),
                card(DELTA, "delta"),
                card(ISLAND, "island"),
            ],
        });
        expect(isDeferrableAction(state, "p1", activate("orb", ORB_GAIN))).toBe(
            false
        );
        expect(
            isDeferrableAction(state, "p1", activate("delta", DELTA_FETCH))
        ).toBe(true);
    });
});

describe("not a response", () => {
    it("refuses with anything on the stack", () => {
        const state = board({ hand: [card(IMPULSE, "impulse")] });
        expect(isDeferrableAction(state, "p1", cast("impulse"))).toBe(true);
        pushSpell(state, BOLT, "p2", [{ type: "player", id: "p1" }]);
        expect(isDeferrableAction(state, "p1", cast("impulse"))).toBe(false);
    });
});

describe("no attack declared (CR 508.1)", () => {
    it("refuses once an attacker is declared", () => {
        const quiet = board({ hand: [card(IMPULSE, "impulse")] });
        expect(isDeferrableAction(quiet, "p1", cast("impulse"))).toBe(true);
        const attacked = board({
            hand: [card(IMPULSE, "impulse")],
            oppBattlefield: [card(BEARS, "attacker", "p2")],
            activePlayerId: "p2",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["attacker"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        expect(isDeferrableAction(attacked, "p1", cast("impulse"))).toBe(false);
    });
});

describe("a this-turn effect has no end-step window (CR 514.2, issue #4768)", () => {
    it("refuses a cast whose whole script ends at this turn's cleanup", () => {
        const state = board({
            hand: [card(SPEED, "speed"), card(BOLT, "bolt")],
            battlefield: [card(BEARS, "mine")],
        });
        const onMine = [{ type: "permanent" as const, id: "mine" }];
        // Same board, same own-side target, same instant timing: only the
        // script's duration separates them.
        expect(isDeferrableAction(state, "p1", cast("bolt", onMine))).toBe(
            true
        );
        expect(isDeferrableAction(state, "p1", cast("speed", onMine))).toBe(
            false
        );
    });
});

describe("a pre-attack grant (CR 508.1a / 302.6, issue #4768)", () => {
    const sick = (id: string) =>
        makeInstance(BEARS, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: true,
        });
    const onto = (id: string) => cast("speed", [{ type: "permanent", id }]);

    it("is a haste grant on the mover's own sick body before attackers", () => {
        for (const phase of [
            "PRECOMBAT_MAIN",
            "BEGINNING_OF_COMBAT",
        ] as const) {
            const state = board({
                hand: [card(SPEED, "speed")],
                battlefield: [sick("sick")],
                phase,
                activePlayerId: "p1",
            });
            expect(isPreAttackGrant(state, "p1", onto("sick"))).toBe(true);
        }
    });

    it("refuses a body that could already attack, or cannot attack at all", () => {
        const tapped = { ...sick("tapped"), isTapped: true };
        const state = board({
            hand: [card(SPEED, "speed")],
            battlefield: [card(BEARS, "ready"), tapped],
            oppBattlefield: [
                makeInstance(BEARS, {
                    id: "theirs",
                    controllerId: "p2",
                    ownerId: "p2",
                    isSummoningSick: true,
                }),
            ],
        });
        expect(isPreAttackGrant(state, "p1", onto("ready"))).toBe(false);
        expect(isPreAttackGrant(state, "p1", onto("tapped"))).toBe(false);
        expect(isPreAttackGrant(state, "p1", onto("theirs"))).toBe(false);
    });

    it("refuses every window past the declaration, and the opponent's turn", () => {
        const at = (phase: GameState["phase"], active: string) =>
            isPreAttackGrant(
                board({
                    hand: [card(SPEED, "speed")],
                    battlefield: [sick("sick")],
                    phase,
                    activePlayerId: active,
                }),
                "p1",
                onto("sick")
            );
        expect(at("DECLARE_ATTACKERS", "p1")).toBe(false);
        expect(at("POSTCOMBAT_MAIN", "p1")).toBe(false);
        expect(at("PRECOMBAT_MAIN", "p2")).toBe(false);
    });

    it("refuses a this-turn script that grants no haste", () => {
        // A pump expires this turn too; it enables no attack.
        const state = board({
            hand: [card(GROWTH, "growth")],
            battlefield: [sick("sick")],
        });
        expect(
            isPreAttackGrant(
                state,
                "p1",
                cast("growth", [{ type: "permanent", id: "sick" }])
            )
        ).toBe(false);
    });
});

describe("the last deferral window (CR 513.1)", () => {
    it("is the opponent's end step and nothing else", () => {
        const at = (phase: GameState["phase"], active: string) =>
            isLastDeferralWindow(
                makeState({ phase, activePlayerId: active }),
                "p1"
            );
        expect(at("END_STEP", "p2")).toBe(true);
        expect(at("END_STEP", "p1")).toBe(false);
        expect(at("PRECOMBAT_MAIN", "p1")).toBe(false);
        expect(at("UPKEEP", "p2")).toBe(false);
    });
});

describe("timing pairs, both directions (issue #4764)", () => {
    const moves: Move[] = [{ kind: "pass" }, cast("impulse"), cast("bears")];
    const PASS = 0;
    const IMPULSE_CAST = 1;
    const BEARS_CAST = 2;

    it("in an earlier window: pass over a deferrable action is timing", () => {
        const state = board({
            hand: [card(IMPULSE, "impulse"), card(BEARS, "bears")],
        });
        const isTiming = timingPairClassifier(state, "p1", moves);
        expect(isTiming({ rightIndex: PASS, otherIndex: IMPULSE_CAST })).toBe(
            true
        );
        // The other direction is a WHAT judgement there, and so is pass over
        // an action outside the perimeter.
        expect(isTiming({ rightIndex: IMPULSE_CAST, otherIndex: PASS })).toBe(
            false
        );
        expect(isTiming({ rightIndex: PASS, otherIndex: BEARS_CAST })).toBe(
            false
        );
    });

    it("in the last window: a deferrable action over pass is timing", () => {
        const state = board({
            hand: [card(IMPULSE, "impulse")],
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            phase: "END_STEP",
        });
        const isTiming = timingPairClassifier(state, "p1", moves);
        expect(isTiming({ rightIndex: IMPULSE_CAST, otherIndex: PASS })).toBe(
            true
        );
        expect(isTiming({ rightIndex: PASS, otherIndex: IMPULSE_CAST })).toBe(
            false
        );
    });
});
