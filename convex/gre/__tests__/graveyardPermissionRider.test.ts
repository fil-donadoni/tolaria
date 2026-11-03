// Graveyard play permission RIDER (issue #1239 — Serra Paragon): "Once during
// each of your turns, you may play a land from your graveyard or cast a
// permanent spell with mana value 3 or less from your graveyard. If you do, it
// gains 'When this permanent is put into a graveyard from the battlefield,
// exile it and you gain 2 life.'"
//
// The permission is a row on the one graveyard play permission record (ADR
// 0093, CR 305.1 for the land play / CR 601.3 for the cast); its
// `grantsOnUse` rider is stamped on the object actually played or cast with it
// and converted into an indefinite triggered-ability grant as the permanent
// enters. The granted ability is a self-scoped leave trigger (CR 603.10a
// looks back in time for it) acting on the card in the graveyard (CR 400.7e).
//
// Full path: the resolver (`gre/rules.ts`), the land-play dispatcher
// (`gre/playLand.ts`), the real cast seam (`locateCastSource`, `game.ts`) +
// the Cast Commit kernel (`gre/castCommit.ts`), resolution (`gre/state.ts`),
// and the client surface through `projectPublicState` + the frontend
// oracle-text lookup.
import { describe, it, expect } from "vitest";
import type { MayPayCost } from "../../cards/types";
import {
    getPlayer,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../state";
import { applyPlayLandFromAnyZone, finalizeLandEntry } from "../playLand";
import {
    canCastFromGraveyardByPermission,
    canPlayLandsFromGraveyard,
} from "../rules";
import { commitCast } from "../castCommit";
import { locateCastSource } from "../../game";
import { projectPublicState } from "../../gameProjections";
import { getDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { serraParagon } from "../../cards/sets/dmu/white.cards";
import { lurrus } from "../../cards/sets/iko/multicolor.cards";
import { wateryGrave } from "../../cards/sets/rav/colorless.cards";
import {
    counterspell,
    grayOgre,
    hillGiant,
    mountain,
    savannahLions,
    solRing,
} from "../../cards/sets/lea/index.cards";
import { getTriggeredAbilityOracleText } from "../../../src/lib/card-utils";

const RIDER_ID = "serra-paragon-granted-exile";
const RIDER_TEXT =
    "When this permanent is put into a graveyard from the battlefield, exile it and you gain 2 life.";

function onBattlefield(defId: string, id: string): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
}

function inGraveyard(defId: string, id: string): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "graveyard",
    });
}

/** p1's main phase, Serra Paragon (and any `extraSources`, in battlefield
 *  order BEFORE her) on the battlefield, `graveyard` in p1's graveyard. */
function board(
    graveyard: CardInstanceState[],
    opts: { extraSources?: CardInstanceState[]; activePlayerId?: string } = {}
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    ...(opts.extraSources ?? []),
                    onBattlefield(serraParagon().id, "serra"),
                ],
                graveyard,
            }),
            makePlayer("p2"),
        ],
        activePlayerId: opts.activePlayerId ?? "p1",
        priorityPlayerId: opts.activePlayerId ?? "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

/** Casts `cardId` from p1's graveyard through the real seam: `locateCastSource`
 *  selects the permission, the Cast Commit kernel spends it and builds the
 *  stack item. Mana leg waived — the kernel applies a plan, it never gates. */
function castFromGraveyard(state: GameState, cardId: string): StackItem {
    const p1 = getPlayer(state, "p1");
    const source = locateCastSource(state, p1, cardId);
    expect(source.zone).toBe("graveyard");
    const card = p1.graveyard.find((c) => c.id === cardId)!;
    const item = commitCast(state, {
        casterId: "p1",
        cardInstanceId: cardId,
        cardDef: getDefinition((card.card as { id: string }).id),
        manaCost: {},
        source: {
            zone: "graveyard",
            ...(source.graveyardPermission
                ? { graveyardPermission: source.graveyardPermission }
                : {}),
        },
        legs: {},
        record: {},
        mode: {},
        placement: { kind: "announce" },
    });
    expect(item).not.toBeNull();
    return item!;
}

function riderGrants(card: CardInstanceState | undefined) {
    return (card?.grantedTriggeredAbilities ?? []).filter(
        (g) => g.abilityId === RIDER_ID
    );
}

/** Moves the permanent off the battlefield and resolves the trigger(s) its
 *  departure put on the stack. */
function departAndResolve(
    state: GameState,
    cardId: string,
    toZone: "graveyard" | "exile" | "hand"
): void {
    removePermanentTo(state, cardId, toZone);
    processPendingActionTriggers(state);
    while (state.stack.length > 0) resolveTopOfStack(state);
}

describe("Serra Paragon — graveyard play permission rider (issue #1239)", () => {
    describe("land branch (CR 305.1)", () => {
        it("a land played from the graveyard gains the rider; destroyed, it is exiled and its controller gains 2 life", () => {
            const state = board([inGraveyard(mountain().id, "gy-mountain")]);
            const p1 = getPlayer(state, "p1");
            const lifeBefore = p1.life;

            const land = applyPlayLandFromAnyZone(state, p1, "gy-mountain");
            expect(land?.zone).toBe("battlefield");
            expect(riderGrants(land!)).toEqual([
                expect.objectContaining({ sourceCardId: serraParagon().id }),
            ]);
            expect(land!.graveyardPermissionRider).toBeUndefined();

            departAndResolve(state, "gy-mountain", "graveyard");
            expect(p1.graveyard.some((c) => c.id === "gy-mountain")).toBe(
                false
            );
            expect(p1.exile.some((c) => c.id === "gy-mountain")).toBe(true);
            expect(p1.life).toBe(lifeBefore + 2);
        });

        it("a shock land parked on its CR 614.12 pay-choice still gains the rider when it enters", () => {
            const state = board([inGraveyard(wateryGrave().id, "gy-grave")]);
            const p1 = getPlayer(state, "p1");
            expect(applyPlayLandFromAnyZone(state, p1, "gy-grave")).toBeNull();
            const choice = state.pendingChoices?.find(
                (c) => c.kind === "land-entry-tapped"
            );
            expect(choice).toBeDefined();
            finalizeLandEntry(
                state,
                "p1",
                "gy-grave",
                choice!.cost as MayPayCost,
                false,
                "graveyard"
            );
            const land = p1.battlefield.find((c) => c.id === "gy-grave");
            expect(riderGrants(land)).toHaveLength(1);
        });

        it("the land play spends the one use: no permanent spell is castable by Serra that turn", () => {
            const state = board([
                inGraveyard(mountain().id, "gy-mountain"),
                inGraveyard(savannahLions().id, "gy-lions"),
            ]);
            const p1 = getPlayer(state, "p1");
            const lions = p1.graveyard.find((c) => c.id === "gy-lions")!;
            expect(canCastFromGraveyardByPermission(state, p1, lions)).toBe(
                true
            );
            applyPlayLandFromAnyZone(state, p1, "gy-mountain");
            expect(canCastFromGraveyardByPermission(state, p1, lions)).toBe(
                false
            );
        });
    });

    describe("cast branch (CR 601.3)", () => {
        it("a permanent spell cast from the graveyard gains the rider as it resolves; the cast closes the land play", () => {
            const state = board([
                inGraveyard(savannahLions().id, "gy-lions"),
                inGraveyard(mountain().id, "gy-mountain"),
            ]);
            const p1 = getPlayer(state, "p1");
            const item = castFromGraveyard(state, "gy-lions");
            expect(item.graveyardPermissionRider).toEqual({
                sourceCardId: serraParagon().id,
                abilityId: RIDER_ID,
            });
            expect(canPlayLandsFromGraveyard(state, p1)).toBe(false);

            resolveTopOfStack(state);
            const lions = p1.battlefield.find((c) => c.id === "gy-lions");
            expect(riderGrants(lions)).toHaveLength(1);
            expect(lions!.graveyardPermissionRider).toBeUndefined();
        });

        it("the rider survives Serra Paragon leaving the battlefield before the licensed spell resolves", () => {
            const state = board([inGraveyard(savannahLions().id, "gy-lions")]);
            const p1 = getPlayer(state, "p1");
            castFromGraveyard(state, "gy-lions");
            removePermanentTo(state, "serra", "graveyard");
            processPendingActionTriggers(state);
            expect(p1.battlefield.some((c) => c.id === "serra")).toBe(false);

            resolveTopOfStack(state);
            const lions = p1.battlefield.find((c) => c.id === "gy-lions");
            expect(riderGrants(lions)).toHaveLength(1);

            const lifeBefore = p1.life;
            departAndResolve(state, "gy-lions", "graveyard");
            expect(p1.exile.some((c) => c.id === "gy-lions")).toBe(true);
            expect(p1.life).toBe(lifeBefore + 2);
        });

        it("a NON-creature permanent cast this way and destroyed is exiled too — the granted trigger is not creature-only", () => {
            const state = board([inGraveyard(solRing().id, "gy-ring")]);
            const p1 = getPlayer(state, "p1");
            castFromGraveyard(state, "gy-ring");
            resolveTopOfStack(state);
            const lifeBefore = p1.life;
            departAndResolve(state, "gy-ring", "graveyard");
            expect(p1.exile.some((c) => c.id === "gy-ring")).toBe(true);
            expect(p1.life).toBe(lifeBefore + 2);
        });

        it("a countered licensed spell has spent the permission and carries no rider", () => {
            const state = board([
                inGraveyard(savannahLions().id, "gy-lions"),
                inGraveyard(mountain().id, "gy-mountain"),
            ]);
            const p1 = getPlayer(state, "p1");
            castFromGraveyard(state, "gy-lions");
            state.stack.push({
                ...makeInstance(counterspell().id, {
                    id: "counter",
                    controllerId: "p2",
                    ownerId: "p2",
                    zone: "stack",
                }),
                castById: "p2",
                targets: [{ type: "spell", id: "gy-lions" }],
            });
            resolveTopOfStack(state);
            const lions = p1.graveyard.find((c) => c.id === "gy-lions");
            expect(lions).toBeDefined();
            expect(lions!.graveyardPermissionRider).toBeUndefined();
            expect(riderGrants(lions)).toEqual([]);
            expect(canPlayLandsFromGraveyard(state, p1)).toBe(false);
        });
    });

    describe("the granted ability fires only on the battlefield → graveyard departure", () => {
        it.each(["exile", "hand"] as const)(
            "a permanent played this way that goes to %s does not trigger the rider",
            (toZone) => {
                const state = board([
                    inGraveyard(mountain().id, "gy-mountain"),
                ]);
                const p1 = getPlayer(state, "p1");
                applyPlayLandFromAnyZone(state, p1, "gy-mountain");
                const lifeBefore = p1.life;
                removePermanentTo(state, "gy-mountain", toZone);
                processPendingActionTriggers(state);
                expect(state.stack).toEqual([]);
                expect(p1.life).toBe(lifeBefore);
            }
        );
    });

    describe("permission gates (ADR 0093 record)", () => {
        it("caps the cast at mana value 3", () => {
            const state = board([
                inGraveyard(grayOgre().id, "gy-ogre"),
                inGraveyard(hillGiant().id, "gy-giant"),
            ]);
            const p1 = getPlayer(state, "p1");
            const ogre = p1.graveyard.find((c) => c.id === "gy-ogre")!;
            const giant = p1.graveyard.find((c) => c.id === "gy-giant")!;
            expect(canCastFromGraveyardByPermission(state, p1, ogre)).toBe(
                true
            );
            expect(canCastFromGraveyardByPermission(state, p1, giant)).toBe(
                false
            );
        });

        it("is absent on the opponent's turn", () => {
            const state = board([inGraveyard(savannahLions().id, "gy-lions")], {
                activePlayerId: "p2",
            });
            const p1 = getPlayer(state, "p1");
            const lions = p1.graveyard.find((c) => c.id === "gy-lions")!;
            expect(canCastFromGraveyardByPermission(state, p1, lions)).toBe(
                false
            );
            expect(canPlayLandsFromGraveyard(state, p1)).toBe(false);
        });

        it("the deterministic selection decides the rider: Lurrus scanned first spends her use, no rider; the next cast spends Serra's, rider", () => {
            const state = board(
                [
                    inGraveyard(savannahLions().id, "gy-lions-1"),
                    inGraveyard(savannahLions().id, "gy-lions-2"),
                ],
                { extraSources: [onBattlefield(lurrus().id, "lurrus")] }
            );
            const first = castFromGraveyard(state, "gy-lions-1");
            expect(first.graveyardPermissionRider).toBeUndefined();
            resolveTopOfStack(state);
            const second = castFromGraveyard(state, "gy-lions-2");
            expect(second.graveyardPermissionRider).toBeDefined();
            resolveTopOfStack(state);
            const p1 = getPlayer(state, "p1");
            expect(
                riderGrants(p1.battlefield.find((c) => c.id === "gy-lions-1"))
            ).toEqual([]);
            expect(
                riderGrants(p1.battlefield.find((c) => c.id === "gy-lions-2"))
            ).toHaveLength(1);
        });
    });

    describe("frontend wiring — through the real projection", () => {
        it("the viewer's own graveyard card carries Serra's cast affordance", () => {
            const state = board([inGraveyard(savannahLions().id, "gy-lions")]);
            const slim = projectPublicState(state, 1, "p1")
                .players.find((p) => p.id === "p1")!
                .graveyard.find((c) => c.id === "gy-lions")!;
            expect(slim.castKind).toBe("graveyard-permission");
            expect(slim.legalActions).toBeDefined();
        });

        it("the projected permanent carries the granted ability, and its trigger on the stack shows the rider's text", () => {
            const state = board([inGraveyard(mountain().id, "gy-mountain")]);
            const p1 = getPlayer(state, "p1");
            applyPlayLandFromAnyZone(state, p1, "gy-mountain");

            const projectedLand = projectPublicState(state, 1, "p1")
                .players.find((p) => p.id === "p1")!
                .battlefield.find((c) => c.id === "gy-mountain")!;
            expect(projectedLand.grantedTriggeredAbilities).toEqual([
                expect.objectContaining({
                    sourceCardId: serraParagon().id,
                    abilityId: RIDER_ID,
                }),
            ]);

            removePermanentTo(state, "gy-mountain", "graveyard");
            processPendingActionTriggers(state);
            const trigger = projectPublicState(state, 2, "p1").stack[0];
            expect(trigger).toBeDefined();
            expect(
                getTriggeredAbilityOracleText(
                    (trigger.card as { id: string }).id,
                    trigger.triggeredAbilityId!,
                    trigger.grantedTriggeredAbilities
                )
            ).toBe(RIDER_TEXT);
        });
    });
});
