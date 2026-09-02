// Land-entry pay-choice (CR 614.12, ADR 0051) — the RAV/GPT/DIS "shock land"
// cycle. A played land carrying `entersTappedUnlessPay` suspends entry on a
// stackless `land-entry-tapped` PendingChoice: pay the cost to enter untapped,
// or decline and enter tapped. Paying removes only the land's own tapped
// clause — any other tapped source (Kismet) still applies (CR 616).

import { describe, it, expect } from "vitest";
import {
    steamVents,
    stompingGround,
    godlessShrine,
} from "../../cards/sets/gpt/colorless";
import {
    wateryGrave,
    sacredFoundry,
    templeGarden,
    overgrownTomb,
} from "../../cards/sets/rav/colorless";
import {
    breedingPool,
    hallowedFountain,
    bloodCrypt,
} from "../../cards/sets/dis/colorless";
import { kismet } from "../../cards/sets/leg/white";
import { seraph } from "../../cards/sets/ice/white";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    applyPlayLand,
    applyPlayLandFromExile,
    applyPlayLandFromGraveyard,
} from "../playLand";
import { applyLandEntrySubmit } from "../pendingChoiceSubmit";
import { getPlayer, resolveTopOfStack } from "../state";
import type { StackItem } from "../state";
import { legalActions } from "../legalActions";
import { projectPublicState } from "../../gameProjections";

const ALL_SHOCKS = [
    {
        def: steamVents,
        colors: [{ U: 1 }, { R: 1 }],
        subtypes: ["Island", "Mountain"],
    },
    {
        def: stompingGround,
        colors: [{ R: 1 }, { G: 1 }],
        subtypes: ["Mountain", "Forest"],
    },
    {
        def: godlessShrine,
        colors: [{ W: 1 }, { B: 1 }],
        subtypes: ["Plains", "Swamp"],
    },
    {
        def: wateryGrave,
        colors: [{ U: 1 }, { B: 1 }],
        subtypes: ["Island", "Swamp"],
    },
    {
        def: sacredFoundry,
        colors: [{ R: 1 }, { W: 1 }],
        subtypes: ["Mountain", "Plains"],
    },
    {
        def: templeGarden,
        colors: [{ G: 1 }, { W: 1 }],
        subtypes: ["Forest", "Plains"],
    },
    {
        def: overgrownTomb,
        colors: [{ B: 1 }, { G: 1 }],
        subtypes: ["Swamp", "Forest"],
    },
    {
        def: breedingPool,
        colors: [{ G: 1 }, { U: 1 }],
        subtypes: ["Forest", "Island"],
    },
    {
        def: hallowedFountain,
        colors: [{ W: 1 }, { U: 1 }],
        subtypes: ["Plains", "Island"],
    },
    {
        def: bloodCrypt,
        colors: [{ B: 1 }, { R: 1 }],
        subtypes: ["Swamp", "Mountain"],
    },
];

function playSteamVents(
    life = 20,
    p2Battlefield: ReturnType<typeof makeInstance>[] = []
) {
    const shock = makeInstance(steamVents.id, { id: "shock", zone: "hand" });
    const state = makeState({
        players: [
            makePlayer("p1", { life, hand: [shock] }),
            makePlayer("p2", { battlefield: p2Battlefield }),
        ],
    });
    return { state, player: getPlayer(state, "p1") };
}

/** A Steam Vents sitting in `zone` on p1 (issue #1980 — the two origins that
 *  used to skip the pay-choice entirely). `named` gives the instance a `.card`
 *  payload carrying a real `name`: production persists only the slim `{ id }`
 *  (see `makeInstance`), so the prompt today always falls back to "This land"
 *  and the redaction branch cannot be told apart without one. */
function shockIn(
    zone: "exile" | "graveyard",
    opts: { life?: number; knownTo?: string[]; named?: boolean } = {}
) {
    const shock = makeInstance(steamVents.id, {
        id: "shock",
        zone,
        ...(opts.named
            ? { card: { id: steamVents.id, name: steamVents.name } }
            : {}),
        ...(opts.knownTo ? { knownTo: opts.knownTo } : {}),
    });
    const state = makeState({
        players: [
            makePlayer("p1", { life: opts.life ?? 20, [zone]: [shock] }),
            makePlayer("p2"),
        ],
    });
    return { state, player: getPlayer(state, "p1") };
}

describe("shock land entry: definition shape (CR 614.12)", () => {
    it.each(ALL_SHOCKS)(
        "$def.name declares entersTappedUnlessPay, subtypes, and the two-colour mana choice",
        ({ def, colors, subtypes }) => {
            expect(def.entersTappedUnlessPay).toEqual({ life: 2 });
            expect(def.subtypes).toEqual(subtypes);
            expect(def.entersTapped).toBeUndefined();
            expect(def.entersTappedUnless).toBeUndefined();
            expect(def.activatedAbilities![0].manaChoices).toEqual(colors);
        }
    );
});

describe("shock land entry: suspend (CR 614.12, ADR 0051)", () => {
    it("suspends entry on a land-entry-tapped choice — the land stays in hand", () => {
        const { state, player } = playSteamVents();
        const result = applyPlayLand(state, player, "shock");

        expect(result).toBeNull(); // no on-battlefield instance yet
        expect(player.hand.find((c) => c.id === "shock")).toBeDefined();
        expect(
            player.battlefield.find((c) => c.id === "shock")
        ).toBeUndefined();

        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("land-entry-tapped");
        expect(head?.playerId).toBe("p1");
        expect(head?.landInstanceId).toBe("shock");
        expect(head?.landSourceZone).toBe("hand");
        expect(head?.cost).toEqual({ life: 2 });
        expect(state.priorityPlayerId).toBe("p1");
    });
});

describe("shock land entry: resolve (CR 614.12)", () => {
    it("pay 2 life → enters UNTAPPED, controller loses 2 life", () => {
        const { state, player } = playSteamVents(20);
        applyPlayLand(state, player, "shock");
        applyLandEntrySubmit(state, { playerId: "p1", accept: true });

        const land = player.battlefield.find((c) => c.id === "shock");
        expect(land).toBeDefined();
        expect(land!.isTapped).toBe(false);
        expect(getPlayer(state, "p1").life).toBe(18);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("decline → enters TAPPED, life unchanged", () => {
        const { state, player } = playSteamVents(20);
        applyPlayLand(state, player, "shock");
        applyLandEntrySubmit(state, { playerId: "p1", accept: false });

        const land = player.battlefield.find((c) => c.id === "shock");
        expect(land!.isTapped).toBe(true);
        expect(getPlayer(state, "p1").life).toBe(20);
    });

    it("records the land drop exactly once (CR 305.2)", () => {
        const { state, player } = playSteamVents(20);
        applyPlayLand(state, player, "shock");
        applyLandEntrySubmit(state, { playerId: "p1", accept: true });
        expect(getPlayer(state, "p1").landsPlayedThisTurn).toBe(1);
    });
});

describe("shock land entry: independence from other tapped sources (CR 616)", () => {
    it("Kismet forces tapped AND you may still pay 2 life (Arena parity)", () => {
        const kismetInst = makeInstance(kismet.id, {
            id: "kismet",
            controllerId: "p2",
        });
        const { state, player } = playSteamVents(20, [kismetInst]);
        applyPlayLand(state, player, "shock");

        // Paying is still offered even though the land will enter tapped anyway.
        applyLandEntrySubmit(state, { playerId: "p1", accept: true });

        const land = player.battlefield.find((c) => c.id === "shock");
        // Kismet's independent replacement keeps it tapped despite the payment.
        expect(land!.isTapped).toBe(true);
        // The payment still happened (each replacement is independent).
        expect(getPlayer(state, "p1").life).toBe(18);
    });
});

describe("shock land entry: affordability gate (CR 119.4)", () => {
    it("at 1 life only 'decline' is legal, and accepting throws", () => {
        const { state, player } = playSteamVents(1);
        applyPlayLand(state, player, "shock");

        const actions = legalActions(state);
        const kinds = actions.map((a) =>
            a.action.kind === "submit-land-entry"
                ? `land-entry:${a.action.accept}`
                : a.action.kind
        );
        expect(kinds).toContain("land-entry:false");
        expect(kinds).not.toContain("land-entry:true");

        expect(() =>
            applyLandEntrySubmit(state, { playerId: "p1", accept: true })
        ).toThrow(/Cannot pay/);
    });
});

// CR 614.12 (issue #1980) — the pay-choice belongs to the LAND, not to the
// zone it is played from. `applyPlayLandFromExile` (a hideaway / impulse-draw
// play permission) and `applyPlayLandFromGraveyard` (Icetill Explorer) both
// used to skip it outright: they read `shouldEnterTapped` and moved the card,
// so a shock land played from either zone entered UNTAPPED FOR FREE with no
// prompt and no life paid. Both now suspend before the zone move exactly as
// the hand and library-top origins do.
describe.each([
    { origin: "exile", zone: "exile" as const },
    { origin: "graveyard", zone: "graveyard" as const },
])("shock land entry: $origin origin (CR 614.12, #1980)", ({ zone }) => {
    const play =
        zone === "exile" ? applyPlayLandFromExile : applyPlayLandFromGraveyard;

    it(`suspends entry on a land-entry-tapped choice — the land stays in the ${zone}`, () => {
        const { state, player } = shockIn(zone);
        const result = play(state, player, "shock");

        expect(result).toBeNull(); // no on-battlefield instance yet
        expect(player[zone].find((c) => c.id === "shock")).toBeDefined();
        expect(
            player.battlefield.find((c) => c.id === "shock")
        ).toBeUndefined();

        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("land-entry-tapped");
        expect(head?.playerId).toBe("p1");
        expect(head?.landInstanceId).toBe("shock");
        expect(head?.landSourceZone).toBe(zone);
        expect(head?.cost).toEqual({ life: 2 });
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("pay 2 life → enters UNTAPPED, controller loses 2 life", () => {
        const { state, player } = shockIn(zone);
        play(state, player, "shock");
        applyLandEntrySubmit(state, { playerId: "p1", accept: true });

        const land = player.battlefield.find((c) => c.id === "shock");
        expect(land).toBeDefined();
        expect(land!.isTapped).toBe(false);
        expect(getPlayer(state, "p1").life).toBe(18);
        expect(player[zone].find((c) => c.id === "shock")).toBeUndefined();
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("decline → enters TAPPED, life unchanged", () => {
        const { state, player } = shockIn(zone);
        play(state, player, "shock");
        applyLandEntrySubmit(state, { playerId: "p1", accept: false });

        const land = player.battlefield.find((c) => c.id === "shock");
        expect(land!.isTapped).toBe(true);
        expect(getPlayer(state, "p1").life).toBe(20);
    });

    // CR 305.2 — a PLAYED land spends the drop, exactly once, at the
    // settlement and not at the suspend.
    it("records the land drop exactly once, and only once settled", () => {
        const { state, player } = shockIn(zone);
        play(state, player, "shock");
        expect(getPlayer(state, "p1").landsPlayedThisTurn ?? 0).toBe(0);
        applyLandEntrySubmit(state, { playerId: "p1", accept: true });
        expect(getPlayer(state, "p1").landsPlayedThisTurn).toBe(1);
    });

    // CR 616 / 614.1c — paying removes only the land's OWN clause; a
    // battlefield-scanned replacement still taps it, on every origin.
    it("Kismet still forces tapped even when the 2 life is paid", () => {
        const { state, player } = shockIn(zone);
        getPlayer(state, "p2").battlefield.push(
            makeInstance(kismet.id, {
                id: "kismet",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        play(state, player, "shock");
        applyLandEntrySubmit(state, { playerId: "p1", accept: true });

        const land = player.battlefield.find((c) => c.id === "shock");
        expect(land!.isTapped).toBe(true);
        expect(getPlayer(state, "p1").life).toBe(18);
    });
});

// CR 305.1-analog / 400.7 — the exile origin carries two concerns the graveyard one
// does not: a per-card play permission that must be consumed when the card
// leaves exile, and an exile zone that may belong to a DIFFERENT player
// (issue #1156). Both have to survive the detour through the pay-choice.
describe("shock land entry: exile origin specifics (CR 305.1-analog, #1980)", () => {
    it("consumes the exile play grant when the DELAYED entry settles, not at the suspend", () => {
        const shock = makeInstance(steamVents.id, {
            id: "shock",
            zone: "exile",
            castableFromExileBy: "p1",
            castableFromExileIncludesLand: true,
            castableFromExileUntilTurn: 3,
            castFromExileWithoutPayingManaCost: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, exile: [shock] }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        applyPlayLandFromExile(state, player, "shock");

        // Still suspended: the grant survives the choice window (priority is
        // frozen on the chooser, so nothing else can consume it).
        expect(
            player.exile.find((c) => c.id === "shock")?.castableFromExileBy
        ).toBe("p1");

        applyLandEntrySubmit(state, { playerId: "p1", accept: false });
        const land = player.battlefield.find((c) => c.id === "shock")!;
        expect(land.castableFromExileBy).toBeUndefined();
        expect(land.castableFromExileIncludesLand).toBeUndefined();
        expect(land.castableFromExileUntilTurn).toBeUndefined();
        expect(land.castFromExileWithoutPayingManaCost).toBeUndefined();
    });

    it("a cross-player grant settles onto the CASTER's battlefield, not the exile owner's", () => {
        const shock = makeInstance(steamVents.id, {
            id: "shock",
            zone: "exile",
            controllerId: "p2",
            ownerId: "p2",
            castableFromExileBy: "p1",
            castableFromExileIncludesLand: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { exile: [shock] }),
            ],
        });
        const p1 = getPlayer(state, "p1");
        expect(applyPlayLandFromExile(state, p1, "shock")).toBeNull();
        expect(state.pendingChoices?.[0]?.landSourceZone).toBe("exile");

        applyLandEntrySubmit(state, { playerId: "p1", accept: true });
        expect(getPlayer(state, "p2").exile).toHaveLength(0);
        expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
        const land = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "shock"
        );
        expect(land).toBeDefined();
        expect(land!.isTapped).toBe(false);
        expect(getPlayer(state, "p1").life).toBe(18);
        expect(getPlayer(state, "p1").landsPlayedThisTurn).toBe(1);
    });

    // CR 406.3 — a hideaway-exiled card is FACE DOWN, examinable only by the
    // players its `knownTo` names, while `pendingChoices` cross
    // `projectPublicState` unredacted to BOTH viewers. The prompt must not be
    // the thing that discloses the hidden card's identity.
    it("never names a still-face-down exiled land in the prompt", () => {
        const { state, player } = shockIn("exile", {
            named: true,
            knownTo: ["p1"],
        });
        applyPlayLandFromExile(state, player, "shock");

        const prompt = state.pendingChoices?.[0]?.prompt;
        expect(prompt).not.toContain("Steam Vents");
        expect(prompt).toContain("This land");
    });

    it("DOES name an ordinary face-up exiled land (CR 406.3's default)", () => {
        const { state, player } = shockIn("exile", { named: true });
        applyPlayLandFromExile(state, player, "shock");

        expect(state.pendingChoices?.[0]?.prompt).toContain("Steam Vents");
    });
});

// CR 614.12 — the "as it enters" pay-choice applies at EVERY ETB, not only when
// the land is PLAYED from hand. A shock land put onto the battlefield by an
// effect (library tutor / reanimation / put-onto-battlefield) funnels through
// `putReanimatedOnBattlefield`; it MUST offer the same pay-choice, never enter
// untapped for free. Driven here via Seraph's `seraph-reanimate` delayed
// trigger (`returnToBattlefield` — the identical funnel a fetch land uses).
describe("shock land entry via effect — non-play ETB (CR 614.12)", () => {
    function reanimateShock(life = 20) {
        const shock = makeInstance(steamVents.id, {
            id: "shock",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const seraphInst = makeInstance(seraph.id, {
            id: "seraph",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life,
                    battlefield: [seraphInst],
                    graveyard: [shock],
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...seraphInst,
            zone: "stack",
            castById: "p1",
            delayedTriggerId: "seraph-reanimate",
            delayedPayload: { deadId: "shock", controllerId: "p1" },
        } as unknown as StackItem);
        resolveTopOfStack(state);
        return state;
    }

    it("enqueues the land-entry-tapped pay-choice — does NOT enter untapped for free", () => {
        const state = reanimateShock(20);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("land-entry-tapped");
        expect(head?.playerId).toBe("p1");
        expect(head?.landInstanceId).toBe("shock");
        expect(head?.cost).toEqual({ life: 2 });
        // The must-NOT row of the source-zone census (issue #1980): this land
        // came from the graveyard but was PUT onto the battlefield, not
        // played. It must record `"battlefield"`, so `finalizeLandEntry` takes
        // the already-in-play completion and never re-moves it out of a
        // graveyard it no longer occupies (and never spends a land drop).
        expect(head?.landSourceZone).toBe("battlefield");
        // Provisional: the land is on the battlefield but not settled untapped.
        const land = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "shock"
        );
        expect(land).toBeDefined();
        expect(land!.isTapped).toBe(true);
        expect(getPlayer(state, "p1").life).toBe(20); // not paid yet
    });

    it("pay 2 life → enters UNTAPPED, controller loses 2 life", () => {
        const state = reanimateShock(20);
        applyLandEntrySubmit(state, { playerId: "p1", accept: true });
        const land = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "shock"
        );
        expect(land!.isTapped).toBe(false);
        expect(getPlayer(state, "p1").life).toBe(18);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("decline → enters TAPPED, life unchanged", () => {
        const state = reanimateShock(20);
        applyLandEntrySubmit(state, { playerId: "p1", accept: false });
        const land = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "shock"
        );
        expect(land!.isTapped).toBe(true);
        expect(getPlayer(state, "p1").life).toBe(20);
    });

    it("does NOT count as a land drop (CR 305.2 — only PLAYING a land does)", () => {
        const state = reanimateShock(20);
        applyLandEntrySubmit(state, { playerId: "p1", accept: false });
        expect(getPlayer(state, "p1").landsPlayedThisTurn ?? 0).toBe(0);
    });
});

describe("shock land entry: wire format (ADR 0051)", () => {
    it("the pending choice and the tapped land survive projectPublicState", () => {
        const { state, player } = playSteamVents(20);
        applyPlayLand(state, player, "shock");

        // The suspended choice projects to the chooser.
        const projectedSuspended = projectPublicState(state, 1, "p1");
        const head = projectedSuspended.pendingChoices?.[0];
        expect(head?.kind).toBe("land-entry-tapped");
        expect(head?.cost).toEqual({ life: 2 });

        applyLandEntrySubmit(state, { playerId: "p1", accept: false });

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "shock");
        expect(slim!.isTapped).toBe(true);
        void player;
    });

    // issue #1980 — the exile-origin choice reaches the client through the
    // same reducer, discriminator and all: without `landSourceZone` surviving
    // projection the prompt renders but nothing tells the finalizer where the
    // land is.
    it("the exile-origin choice keeps its source zone across projectPublicState", () => {
        const { state, player } = shockIn("exile");
        applyPlayLandFromExile(state, player, "shock");

        const head = projectPublicState(state, 1, "p1").pendingChoices?.[0];
        expect(head?.kind).toBe("land-entry-tapped");
        expect(head?.landSourceZone).toBe("exile");
        expect(head?.cost).toEqual({ life: 2 });

        applyLandEntrySubmit(state, { playerId: "p1", accept: false });
        const slim = projectPublicState(state, 1, "p1")
            .players.find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "shock");
        expect(slim!.isTapped).toBe(true);
    });
});
