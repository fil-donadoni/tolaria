// Issue #1734 — the CLIENT's offered set must equal the SERVER's offered set,
// for every filter dimension of every target kind.
//
// #1697/#1732 established the shape for the PERMANENT kind: the client stopped
// re-implementing a narrow subset of the filter dimensions and started calling
// the same target-filter registry (`convex/gre/targetFilters.ts`, ADR 0068)
// that `getLegalTargets` (offered set) and `selectTarget` (accepted set) share.
// This file is the equivalent proof for the remaining three kinds — spell,
// player and graveyard-card.
//
// Every assertion here compares the client predicate's verdict against
// `getLegalTargets`' own output, and does so through the REAL wire projection
// (`projectPublicState`) — never a hand-built view. That gives both directions
// the issue asks for in a single comparison: a legal target must be OFFERED
// (the client must not over-filter — the inverse regression #1732 shipped when
// `emblems` went missing from the synthetic state) and an illegal one must NOT
// be (the original fail-open symptom). A set equality catches both; a one-sided
// `toBe(false)` catches only one.
//
// The dimensions exercised are the ones the audit in the PR description marks
// as newly enforced client-side. They are chosen from the audit table, not from
// the implementation: a test written by reading the new code inherits its
// assumptions and cannot falsify them.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { getLegalTargets, NO_TARGETING_SOURCE } from "@convex/gre/rules";
import { pendingTargetFiltersFromRequirement } from "@convex/gre/rules";
import type { GameState } from "@convex/gre/state";
import type { TargetRequirement, TargetSelection } from "@convex/cards/types";
import type { CardInstance, PendingTarget } from "~/types/game";
import {
    matchesPlayerTargetFilters,
    matchesSpellPendingTarget,
} from "~/lib/card-utils";
import { getEligibleGraveyards } from "~/lib/graveyard-targets";

import { prohibit } from "@convex/cards/sets/inv/blue";
import { gainsay } from "@convex/cards/sets/pls/blue";
import { fireAndBrimstone } from "@convex/cards/sets/drk/white";
import { forgottenLore } from "@convex/cards/sets/ice/green";
import {
    counterspell,
    disenchant,
    shivanDragon,
    grizzlyBears,
} from "@convex/cards/sets/lea";
import { thermokarst } from "@convex/cards/sets/ice/green";

const CHOOSER = "p1";

/** The `PendingTarget` the SERVER builds for `requirement` — the same
 *  `pendingTargetFiltersFromRequirement` lowering `announceCast` /
 *  `raiseTriggerTargetSelection` run, so the carried filter set under test is
 *  the real one and not a test author's guess at it. */
function pendingFor(
    requirement: TargetRequirement,
    /** CR 601.2c — slots already filled under THIS SAME requirement. */
    selected: TargetSelection[] = []
): PendingTarget {
    return {
        playerId: CHOOSER,
        cardInstanceId: "src",
        targetType: requirement.type,
        count: requirement.count,
        selected,
        ...pendingTargetFiltersFromRequirement(requirement, undefined),
    } as unknown as PendingTarget;
}

/** Ids of the stack items the CLIENT would ring as clickable, computed off the
 *  PROJECTED state — the only thing a browser ever sees. */
function clientSpellOffered(
    state: GameState,
    requirement: TargetRequirement,
    selected: TargetSelection[] = []
): string[] {
    const projected = projectPublicState(state, 1, CHOOSER);
    const pendingTarget = pendingFor(requirement, selected);
    const players = projected.players.map((p) => ({
        id: p.id,
        battlefield: p.battlefield as unknown as CardInstance[],
    }));
    return projected.stack
        .filter((item) =>
            matchesSpellPendingTarget(item, pendingTarget, {
                playerId: CHOOSER,
                activePlayerId: projected.activePlayerId,
                players,
            })
        )
        .map((item) => item.id);
}

/** Ids of the players the CLIENT would ring as clickable, off the projection. */
function clientPlayerOffered(
    state: GameState,
    requirement: TargetRequirement,
    selected: TargetSelection[] = []
): string[] {
    const projected = projectPublicState(state, 1, CHOOSER);
    const pendingTarget = pendingFor(requirement, selected);
    return projected.players
        .filter((p) =>
            matchesPlayerTargetFilters(
                {
                    id: p.id,
                    battlefield: p.battlefield as unknown as CardInstance[],
                },
                pendingTarget,
                projected.activePlayerId
            )
        )
        .map((p) => p.id);
}

const serverOffered = (
    state: GameState,
    requirement: TargetRequirement,
    selected: TargetSelection[] = []
) =>
    getLegalTargets(
        state,
        requirement,
        NO_TARGETING_SOURCE,
        CHOOSER,
        undefined,
        selected
    ).map((t) => t.id);

// ─── spell kind (CR 114.1) ──────────────────────────────────────────────────

describe("spell-target client parity (issue #1734)", () => {
    /** Two spells on the stack, one of each relevant characteristic. */
    function stackWith(...cardIds: string[]): GameState {
        const state = makeState();
        for (const id of cardIds) pushSpell(state, id, "p2");
        return state;
    }

    it("mvFilter (Prohibit, CR 202.3) — offered set matches the server", () => {
        // Counterspell is mana value 2 (legal under `{ max: 2 }`), Shivan
        // Dragon is 6 (illegal). Before #1734 `mvFilter` was classified
        // "server-only" client-side: BOTH rows were offered.
        const state = stackWith(counterspell.id, shivanDragon.id);
        const req = prohibit.targetRequirement!;
        const server = serverOffered(state, req);
        expect(server).toHaveLength(1);
        expect(clientSpellOffered(state, req)).toEqual(server);
    });

    it("colorFilter (Gainsay, CR 202.2) — offered set matches the server", () => {
        // `getEffectiveColors` reads `colorOverride`/`grantedColors` off the
        // instance (both survive `slimCard`) and falls back to the bundled card
        // registry for the printed cost — the fat `card` definition the
        // projection strips to `{ id }` is never needed. This assertion is what
        // proves that: it runs entirely on projected stack items.
        const state = stackWith(counterspell.id, disenchant.id);
        const req = gainsay.targetRequirement!;
        const server = serverOffered(state, req);
        expect(server).toHaveLength(1);
        expect(clientSpellOffered(state, req)).toEqual(server);
    });

    it("delayed triggers are not spells (CR 603.7a) — offered set matches the server", () => {
        // The deleted mirrors tested `abilityId || triggeredAbilityId` and
        // omitted `delayedTriggerId`, so a delayed trigger on the stack read as
        // a legal "target instant or sorcery spell" — fail-OPEN.
        const state = stackWith(counterspell.id, shivanDragon.id);
        const delayed = state.stack[1];
        delayed.delayedTriggerId = "some-delayed-trigger";
        const req: TargetRequirement = {
            type: "spell",
            count: 1,
            spellTypeFilter: ["Instant", "Creature"],
        };
        const server = serverOffered(state, req);
        expect(server).toEqual([state.stack[0].id]);
        expect(clientSpellOffered(state, req)).toEqual(server);
    });

    it("spellWouldDestroyLandYouControl via an Effect Script destroy Op (CR 701.8) — offered set matches the server", () => {
        // The deleted mirror recognised only `def.effect === "destroy-target"`
        // and missed the `effects: [{ op: "destroy" }]` authoring mode (ADR
        // 0045) the registry handles — so a DSL land-destruction spell was
        // silently UNCLICKABLE under Equinox's granted counter ability. That is
        // the over-filter direction, invisible without a parity assertion.
        const myLand = makeInstance(grizzlyBears.id, {
            id: "my-land",
            controllerId: CHOOSER,
            ownerId: CHOOSER,
            zone: "battlefield",
        });
        myLand.types = ["Land"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [myLand] }),
                makePlayer("p2"),
            ],
        });
        // Thermokarst's land destruction is an Effect Script (`effects:
        // [{ op: "destroy" }]`), NOT the `effect: "destroy-target"` shorthand
        // the deleted mirror recognised — that is precisely the branch it
        // missed.
        pushSpell(state, thermokarst.id, "p2", [
            { type: "permanent", id: "my-land" },
        ]);
        pushSpell(state, counterspell.id, "p2");
        const req: TargetRequirement = {
            type: "spell",
            count: 1,
            spellWouldDestroyLandYouControl: true,
        };
        const server = serverOffered(state, req);
        expect(server).toEqual([state.stack[0].id]);
        expect(clientSpellOffered(state, req)).toEqual(server);
    });

    it("unfiltered spell requirement still offers every spell (no over-filtering)", () => {
        // The inverse-regression guard in its plainest form: routing through
        // the registry must not narrow anything on its own.
        const state = stackWith(counterspell.id, disenchant.id);
        const req: TargetRequirement = { type: "spell", count: 1 };
        const server = serverOffered(state, req);
        expect(server).toHaveLength(2);
        expect(clientSpellOffered(state, req)).toEqual(server);
    });
});

// ─── player kind (CR 115.4) ─────────────────────────────────────────────────

describe("player-target client parity (issue #1734)", () => {
    it("controller: opponent (Forgotten Lore, CR 109.3) — offered set matches the server", () => {
        // `controller` was NOT checked client-side at all before #1734: both
        // nameplates lit up and the server rejected whichever the player
        // clicked.
        const state = makeState();
        const req = forgottenLore.targetRequirement!;
        const server = serverOffered(state, req);
        expect(server).toEqual(["p2"]);
        expect(clientPlayerOffered(state, req)).toEqual(server);
    });

    it("playerAttackedThisTurn (Fire and Brimstone, CR 506.2) — offered set matches the server", () => {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        attacker.hasAttackedThisTurn = true;
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        const req = fireAndBrimstone.targetRequirement!;
        const server = serverOffered(state, req);
        expect(server).toEqual(["p2"]);
        expect(clientPlayerOffered(state, req)).toEqual(server);
    });

    it("no player attacked — both sides offer nobody", () => {
        const state = makeState();
        const req = fireAndBrimstone.targetRequirement!;
        expect(serverOffered(state, req)).toEqual([]);
        expect(clientPlayerOffered(state, req)).toEqual([]);
    });

    it("an unfiltered player requirement still offers both players (no over-filtering)", () => {
        const state = makeState();
        const req: TargetRequirement = { type: "player", count: 1 };
        const server = serverOffered(state, req);
        expect(server).toEqual(["p1", "p2"]);
        expect(clientPlayerOffered(state, req)).toEqual(server);
    });

    it("controller distinguishes the CHOOSER from the ACTIVE player (CR 109.3)", () => {
        // Every other player-kind fixture in this file runs on `makeState()`'s
        // default `activePlayerId: "p1"`, which is ALSO the chooser — so a
        // `controller` implementation that threaded the active player in as
        // the chooser (or vice versa) would agree with the server on all of
        // them. This fixture is the only one that can tell the two apart:
        // p1 chooses while p2 is the active player, and the three relationship
        // values then pick three DIFFERENT sets.
        const state = makeState({
            activePlayerId: "p2",
            priorityPlayerId: "p2",
        });
        const you: TargetRequirement = {
            type: "player",
            count: 1,
            controller: "you",
        };
        const opponent: TargetRequirement = {
            type: "player",
            count: 1,
            controller: "opponent",
        };
        const active: TargetRequirement = {
            type: "player",
            count: 1,
            controller: "active",
        };
        // The chooser's own seat is NOT the active player here, so "you" and
        // "active" must disagree — the property the symmetric fixtures cannot
        // express.
        expect(serverOffered(state, you)).toEqual(["p1"]);
        expect(clientPlayerOffered(state, you)).toEqual(["p1"]);
        expect(serverOffered(state, opponent)).toEqual(["p2"]);
        expect(clientPlayerOffered(state, opponent)).toEqual(["p2"]);
        expect(serverOffered(state, active)).toEqual(["p2"]);
        expect(clientPlayerOffered(state, active)).toEqual(["p2"]);
    });

    it("a colour-filtered requirement admits no player (CR 105.2)", () => {
        // Players have no colour. `getLegalTargets` skips its whole player loop
        // when a colour filter is set and `selectTarget` throws "Players have
        // no color" — a kind-level exclusion, not a registry filter, so the
        // client reproduces it explicitly.
        const state = makeState();
        const req: TargetRequirement = {
            type: "any",
            count: 1,
            colorFilter: "U",
        };
        expect(
            serverOffered(state, req).filter((id) => id === "p1" || id === "p2")
        ).toEqual([]);
        expect(clientPlayerOffered(state, req)).toEqual([]);
    });
});

// ─── CR 601.2c already-chosen exclusion, spell + player kinds ───────────────

describe("CR 601.2c already-chosen exclusion — client parity (issue #1734)", () => {
    // Both new client predicates open with an `isAlreadySelectedTarget` guard
    // mirroring the server's own exclusion — the "another target" half of a
    // multi-count requirement (Magma Burst's kicked second target, Dust to
    // Dust's two artifacts). Neither guard had a test: replacing the whole
    // `if` with `if (false)` left the frontend suites entirely green, so the
    // exclusion was new behaviour nothing could distinguish from a no-op.
    //
    // Both kinds are driven from ONE requirement shape — `count: 2` with NO
    // other filter — so every candidate passes every other gate and the
    // already-chosen dimension is the only thing that can decide the verdict.

    it("a spell already chosen under this SAME requirement is no longer offered", () => {
        const state = makeState();
        const first = pushSpell(state, counterspell.id, "p2");
        const second = pushSpell(state, disenchant.id, "p2");
        const req: TargetRequirement = { type: "spell", count: 2 };

        // Control: with nothing chosen yet BOTH stack items are legal, so
        // neither is excluded for any other reason.
        expect(clientSpellOffered(state, req).sort()).toEqual(
            serverOffered(state, req).sort()
        );
        expect(clientSpellOffered(state, req)).toContain(first.id);

        const selected: TargetSelection[] = [{ type: "spell", id: first.id }];
        const server = serverOffered(state, req, selected);
        expect(server).toEqual([second.id]);
        expect(clientSpellOffered(state, req, selected)).toEqual(server);
    });

    it("a player already chosen under this SAME requirement is no longer offered", () => {
        const state = makeState();
        const req: TargetRequirement = { type: "player", count: 2 };

        // Control: unfiltered, both seats are legal first picks.
        expect(clientPlayerOffered(state, req)).toEqual(["p1", "p2"]);

        const selected: TargetSelection[] = [{ type: "player", id: "p1" }];
        const server = serverOffered(state, req, selected);
        expect(server).toEqual(["p2"]);
        expect(clientPlayerOffered(state, req, selected)).toEqual(server);
    });
});

// ─── graveyard-card kind (CR 109.2 / 400.7) ─────────────────────────────────

describe("graveyard-card client parity (issue #1734)", () => {
    it("subtypeFilter — eligible graveyard cards match the server's offered set", () => {
        // The card kind was already routed through `checkCardTargetFilters`
        // (issue #1950); this pins the parity through the REAL projection so a
        // regression in either the projection or the forward set is caught.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: CHOOSER,
            ownerId: CHOOSER,
            zone: "graveyard",
        });
        // The decoy must be a CREATURE card too, otherwise the requirement's
        // STRUCTURAL `type: "Creature"` gate excludes it on its own and
        // `subtypeFilter` — the dimension under test — never does any work.
        // (Proof-of-failure caught exactly that: with an Instant decoy this
        // test stayed green after the pre-#1950 narrow mirror was restored.)
        const dragon = makeInstance(shivanDragon.id, {
            id: "dragon",
            controllerId: CHOOSER,
            ownerId: CHOOSER,
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [bear, dragon] }),
                makePlayer("p2"),
            ],
        });
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            zone: "graveyard",
            controller: "you",
            subtypeFilter: ["Bear"],
        };
        const server = serverOffered(state, req);
        expect(server).toEqual(["bear"]);

        const projected = projectPublicState(state, 1, CHOOSER);
        const client = getEligibleGraveyards(
            pendingFor(req),
            projected.players as never,
            CHOOSER,
            projected.activePlayerId
        ).flatMap((g) => g.cards.map((c) => c.id));
        expect(client).toEqual(server);
    });
});
