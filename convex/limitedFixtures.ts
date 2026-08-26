// Seeded Limited fixtures for the `check:ui` lane (issue #2822).
//
// WHY THIS EXISTS. `bun run check:ui`'s Limited/Draft walks used to pick
// their subject by LIST POSITION — "the first three rows of whatever
// `TOLARIA_UI_EMAIL` can see" — and `listOpenLimitedEvents`
// (`convex/limitedEvents.ts`) returns every open event on the deployment to
// everyone. So the row count on `/limited`, and which SEAT the Draft Room
// walks measured, were both functions of a month of hand-made events rather
// than of the code under test: `budgets.json` ceilings rotted with no `src/`
// change (the same eight FAILs were recorded twice, days apart, with
// byte-identical numbers — `docs/findings/2671-limited-list-budgets-drifted.md`).
//
// The fix is a fixture the lane CONTROLS: two events addressed by `label`,
// with a hand-pinned pack and pool, so every Limited/Draft reading is a
// function of this file plus the components. Nothing here touches the
// deployment's real events — the lane navigates to a `?label=` filtered view
// (`src/router.tsx`) whose row set is exactly these two.
//
// SHAPE, deliberately mirroring `debugScenarios:seedScenarioDirect`:
//   - an `internalMutation`, so it is reachable only with deploy access
//     (`bunx convex run` / dashboard / MCP) and never from a client — there
//     is no caller identity to gate on, the access control is "can you run
//     internal mutations against this deployment at all";
//   - UPSERT BY LABEL: re-running replaces the labelled rows rather than
//     accumulating duplicates;
//   - the written rows are DEPLOYMENT-LOCAL by design — not in git, so they
//     do not reproduce on a fresh clone. That is why a missing fixture makes
//     the lane print UNWALKED with this seeding command, never fall back to
//     walking some other event.
//
// Run it with:
//
//     bunx convex run limitedFixtures:seedUiGateFixtures '{"email":"<TOLARIA_UI_EMAIL>"}'
//
// The cards are PINNED BY NAME rather than dealt by `startDraft`: a seeded
// deal is only as stable as the set's implemented card list, which grows every
// time a card ships — exactly the "the number moved and nobody can attribute
// it" failure this issue is about. A name that stops resolving throws here,
// loudly, at seed time.
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { tryGetCardByName } from "./cards";
import { resolveCardMeta } from "./limitedCardMeta";
import { deleteSeats, saveSeats } from "./limitedSeatStore";
import {
    assignFreeSeat,
    buildEmptySeats,
    fillBotSeats,
} from "./limited/eventLogic";
import type {
    DraftPackCard,
    LimitedEventSeat,
    LimitedPoolCard,
} from "./limited/eventTypes";
import { SCORER_VERSION } from "./limited/scorerVersion";
// The three labels live in a dependency-free leaf module, not here: this file
// is a registered Convex function module, so a `scripts/`-side importer of
// these constants would drag gitignored `convex/_generated` into `bun run
// land`. See that file's header (issue #2822 review round 2).
import {
    UI_GATE_DRAFT_LABEL,
    UI_GATE_OPEN_LABEL,
} from "./limited/uiGateFixtureLabels";

/** Alpha — a checked-in Booster Config (`convex/limited/registry.ts`) and the
 *  set every pinned card below is printed in. Only ever DISPLAYED here (the
 *  packs are hand-built, not generated), but a real code keeps the event's
 *  name and Pack Source row honest. */
const FIXTURE_SET = "lea";
const FIXTURE_SEAT_COUNT = 8;

/** A constant, so a re-seed reproduces the same event rather than a fresh
 *  shuffle. Nothing in the fixture is dealt from it — it exists because
 *  `submitPick` refuses an event with no seed, and a fixture that would break
 *  if someone clicked Pick in it is a trap. */
const FIXTURE_SEED = 20260822;

/** The 15-card booster in front of seat 0. */
const FIXTURE_PACK_NAMES = [
    "Air Elemental",
    "Bad Moon",
    "Black Knight",
    "Bog Wraith",
    "Braingeyser",
    "Counterspell",
    "Craw Wurm",
    "Dark Ritual",
    "Disenchant",
    "Dragon Whelp",
    "Drudge Skeletons",
    "Earth Elemental",
    "Elvish Archers",
    "Fire Elemental",
    "Fireball",
] as const;

/** Seat 0's already-picked pool. Sized like a real mid-draft pool: enough
 *  cards that the pool pane actually scrolls at every viewport (a two-card
 *  pool would make `draft-pool-stop`'s occlusion reading vacuous), few enough
 *  that the seeded document stays small. */
const FIXTURE_POOL_NAMES = [
    "Animate Wall",
    "Ankh of Mishra",
    "Armageddon",
    "Aspect of Wolf",
    "Basalt Monolith",
    "Benalish Hero",
    "Berserk",
    "Birds of Paradise",
    "Black Vise",
    "Blessing",
    "Blue Elemental Blast",
    "Burrowing",
    "Castle",
    "Celestial Prism",
    "Clockwork Beast",
    "Clone",
    "Cockatrice",
    "Conservator",
    "Copper Tablet",
    "Crusade",
    "Crystal Rod",
    "Death Ward",
    "Deathgrip",
    "Demonic Tutor",
] as const;

/** One pinned card as a Pool entry. Resolved through the SAME `resolveCardMeta`
 *  the pure draft engine is injected with (`convex/limitedCardMeta.ts`), so a
 *  fixture entry is byte-identical to a dealt one — including what
 *  `limitedSeatStore`'s intern/expand round-trip rebuilds it into. */
function fixturePoolCard(name: string): LimitedPoolCard {
    const def = tryGetCardByName(name);
    if (!def) {
        throw new Error(
            `ui-gate fixture card "${name}" no longer resolves in the card catalogue — ` +
                `pick a replacement in convex/limitedFixtures.ts and re-record the ` +
                `limited-*/draft-* rows of scripts/ui-gate/budgets.json`
        );
    }
    const meta = resolveCardMeta(def.id);
    return {
        scryfallId: def.id,
        cardId: meta?.cardId ?? def.id,
        cardName: meta?.cardName ?? def.name,
    };
}

/** `pickId`s follow `draftEngine.ts`'s own `r<round>-p<seat>-c<idx>` shape so
 *  a stale `selectedPickId` from a previous run can never collide with a
 *  later round's card — the invariant `LimitedEventSeat.selectedPickId`
 *  documents. */
function fixturePackCard(name: string, index: number): DraftPackCard {
    return { ...fixturePoolCard(name), pickId: `r0-p0-c${index}` };
}

/** Seat 0 is the `TOLARIA_UI_EMAIL` account, at a FIXED index — the seat the
 *  Draft Room walks measure. `assignFreeSeat` takes the first free index, so
 *  seating the viewer into freshly-built empty seats always yields 0; the
 *  randomisation `startLimitedEvent` performs (seat order IS pass order) is
 *  deliberately not reproduced, because a fixture that shuffles is not a
 *  fixture. */
function seatViewer(userId: Id<"users">, nickname: string): LimitedEventSeat[] {
    return assignFreeSeat(
        buildEmptySeats(FIXTURE_SEAT_COUNT),
        userId,
        nickname
    );
}

/** Drops the rows a previous seeding of this label left behind — the event,
 *  its `limitedSeats` payload and its `limitedSelections`. Only ever touches
 *  rows carrying this exact fixture label; the deployment's real events have
 *  no label at all and are never read here. */
async function dropFixture(ctx: MutationCtx, label: string): Promise<number> {
    const existing = await ctx.db
        .query("limitedEvents")
        .withIndex("by_label", (q) => q.eq("label", label))
        .collect();
    for (const event of existing) {
        await deleteSeats(ctx, event._id);
        await ctx.db.delete(event._id);
    }
    return existing.length;
}

async function insertFixtureEvent(
    ctx: MutationCtx,
    label: string,
    createdBy: Id<"users">,
    type: "draft" | "sealed",
    now: number
): Promise<Id<"limitedEvents">> {
    return await ctx.db.insert("limitedEvents", {
        label,
        createdBy,
        type,
        // Every fixture is inserted OPEN and moved to its final status by the
        // `saveSeats` patch below — that helper is the single writer of the
        // event's `seats` array and its seat child rows, and routing the
        // status through it keeps the two in step by construction.
        status: "open",
        seatCount: FIXTURE_SEAT_COUNT,
        packSlots: [FIXTURE_SET, FIXTURE_SET, FIXTURE_SET],
        matchFormat: "bo3",
        // Timer OFF: a timer-on fixture would schedule real Auto-Pick
        // mutations that mutate the seat between two lane runs, which is the
        // exact class of drift this fixture exists to remove.
        timerEnabled: false,
        seats: [],
        createdAt: now,
        updatedAt: now,
    });
}

export const seedUiGateFixtures = internalMutation({
    args: {
        /** The `check:ui` account (`TOLARIA_UI_EMAIL` in `.env.local`) — the
         *  user seated at seat 0 of both fixtures. Passed rather than derived
         *  because an internal mutation has no caller identity. */
        email: v.string(),
    },
    returns: v.object({
        openEventId: v.id("limitedEvents"),
        draftEventId: v.id("limitedEvents"),
        replaced: v.number(),
        packSize: v.number(),
        poolSize: v.number(),
    }),
    handler: async (ctx, args) => {
        const user = await ctx.db
            .query("users")
            .withIndex("email", (q) => q.eq("email", args.email))
            .unique();
        if (!user) {
            throw new Error(
                `No user with email "${args.email}" on this deployment — sign in once with the check:ui account first.`
            );
        }

        const now = Date.now();
        const replaced =
            (await dropFixture(ctx, UI_GATE_OPEN_LABEL)) +
            (await dropFixture(ctx, UI_GATE_DRAFT_LABEL));

        // ── Fixture 1: seating still open ────────────────────────────────
        const openEventId = await insertFixtureEvent(
            ctx,
            UI_GATE_OPEN_LABEL,
            user._id,
            "draft",
            now
        );
        await saveSeats(ctx, openEventId, seatViewer(user._id, user.nickname), {
            updatedAt: now,
        });

        // ── Fixture 2: mid-draft, live pack + non-empty pool ─────────────
        const pack = FIXTURE_PACK_NAMES.map(fixturePackCard);
        const pool = FIXTURE_POOL_NAMES.map(fixturePoolCard);
        const draftEventId = await insertFixtureEvent(
            ctx,
            UI_GATE_DRAFT_LABEL,
            user._id,
            "draft",
            now
        );
        const draftSeats = fillBotSeats(seatViewer(user._id, user.nickname));
        draftSeats[0] = { ...draftSeats[0], currentPack: pack, pool };
        await saveSeats(ctx, draftEventId, draftSeats, {
            status: "started",
            seed: FIXTURE_SEED,
            scorerVersion: SCORER_VERSION,
            // Round 0 with one pack per seat still in circulation — the state
            // `startDraft` leaves behind (`draftPacksRemaining: seats.length`),
            // so a Pick submitted in this fixture advances the draft normally
            // instead of hitting an impossible count.
            draftRound: 0,
            draftPacksRemaining: FIXTURE_SEAT_COUNT,
            updatedAt: now,
        });

        return {
            openEventId,
            draftEventId,
            replaced,
            packSize: pack.length,
            poolSize: pool.length,
        };
    },
});
