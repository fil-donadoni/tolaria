// Identity swaps keep the permanent's own continuous effects (issue #1705).
//
// `applyCopy` / `revertCopy` (`gre/copy.ts`), `turnFaceDown` / `turnFaceUp`
// (`gre/faceDown.ts`) and both legs of `transformPermanent` (`gre/transform.ts`)
// replace a permanent's COPIABLE VALUES — layer 1, CR 613.1a. None of them is a
// zone change, so none of them makes a new object (CR 400.7) and none of them
// ends a continuous effect already applying to the permanent (CR 708.2, 707.2,
// 701.27b). Every site therefore rebuilds layer 1 and replays the permanent's
// OWN live overlays on top, in CR 613.7 timestamp order.
//
// Three failure shapes, one describe block each:
//   (a) a live grant is DROPPED by the rebuild;
//   (b) a live REMOVAL is undone by it — the printed keyword comes back while
//       the stripper's hold record survives, dangling;
//   (c) a restore ANCHOR captured from the previous identity is written back
//       onto the NEW face when the effect later expires — corruption, not loss.
//
// Every assertion that is board-visible is re-run through `projectPublicState`:
// the client never sees `GameState`, and a fat-state-only assertion cannot see
// a field the wire drops.

import { describe, it, expect } from "vitest";
import { applyCopy, revertCopy } from "../copy";
import { turnFaceDown, turnFaceUp } from "../faceDown";
import { transformPermanent } from "../transform";
import { syncLayer6 } from "../layer6";
import { syncLayers2to5 } from "../layers2to5";
import {
    applySourceStaticEffects,
    buildSpellContext,
    unapplySourceStaticEffects,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../state";
import { finalizeCleanup } from "../phases";
import { grantOutrankedByAbilityLoss } from "../activatedAbilities";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { registerTokenDefinition } from "../../cards";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { airElemental, flight, mahamotiDjinn } from "../../cards/sets/lea/blue";
import { gravitySphere } from "../../cards/sets/leg/red";

const UNTIL_EOT = { phase: "end-of-turn" } as const;

// ───────────────────────────────────────────────────────────────────────────
// Fixtures. No shipped `CardDefinition` carries a `backFace` yet (the only
// double-faced object in the catalogue is the Incubator TOKEN spec), so the
// transform legs need registered definitions — the same shape
// `transform.test.ts` uses. They still travel the real `transformPermanent`.
// ───────────────────────────────────────────────────────────────────────────

/** Front: a 1/1 flier. Back: a 3/3 with trample AND flying — chosen so shape
 *  (b) has something to resurrect on the new face (flying) and shape (a) has a
 *  printed keyword to keep separate from a granted one (trample). */
const SWAP_FRONT_ID = "test-identity-swap-front";
registerTokenDefinition({
    id: SWAP_FRONT_ID,
    name: "Test Fledgling",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    backFace: {
        name: "Test Roc",
        types: ["Creature"],
        subtypes: ["Bird", "Beast"],
        power: 3,
        toughness: 3,
        staticAbilities: ["flying", "trample"],
    },
});

/** A NONCREATURE artifact front with an artifact-creature back — the shape an
 *  animation (CR 208.2) actually meets: the front is not a creature, so the
 *  animation adds the Creature type; the back already is one, so after the
 *  swap the animation must add nothing and remove nothing on expiry. */
const ANIM_FRONT_ID = "test-identity-swap-anim-front";
registerTokenDefinition({
    id: ANIM_FRONT_ID,
    name: "Test Contraption",
    rarity: "common",
    manaCost: {},
    types: ["Artifact"],
    backFace: {
        name: "Test Golem",
        types: ["Artifact", "Creature"],
        subtypes: ["Golem"],
        power: 3,
        toughness: 3,
    },
});

/** A blanket "loses all abilities" source (CR 613.1f, the Humility /
 *  Titania's Song shape) with no `applies` narrowing, so the test can point it
 *  at any permanent. The catalogue's two shipped ability-loss cards both bind
 *  to a card type (nonbasic land / noncreature artifact) that an identity swap
 *  itself changes, which would confound the assertion under test. */
const NULLIFIER_ID = "test-identity-swap-nullifier";
registerTokenDefinition({
    id: NULLIFIER_ID,
    name: "Test Nullifier",
    rarity: "common",
    manaCost: {},
    types: ["Enchantment"],
    staticEffects: [{ kind: "ability-loss", applies: () => true }],
});

/** A blanket layer-4 `type-add` source (the Animate Artifact / Titania's Song
 *  shape), likewise unnarrowed. */
const TYPE_ADDER_ID = "test-identity-swap-type-adder";
registerTokenDefinition({
    id: TYPE_ADDER_ID,
    name: "Test Type Adder",
    rarity: "common",
    manaCost: {},
    types: ["Enchantment"],
    staticEffects: [
        { kind: "type-add", applies: () => true, types: ["Artifact"] },
    ],
});

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function makeBoard(...cards: CardInstanceState[]): GameState {
    return makeState({
        players: [makePlayer("p1", { battlefield: cards }), makePlayer("p2")],
    });
}

function ctxFor(state: GameState) {
    const item: StackItem = pushSpell(state, grizzlyBears.id, "p1");
    return buildSpellContext(state, item);
}

/** Occurrences of `keyword` — the only quantity the multiset model cares
 *  about (CR 113.1, #1706). */
/** CR 400.7 / 613.1f — a source STOPS applying by leaving the battlefield, not
 *  by having `unapplySourceStaticEffects` called on it: layer 6 is derived from
 *  the live board (PRD #2064 S3), so a permanent left in the battlefield array
 *  keeps applying however many times its teardown ran. Production splices it
 *  out immediately after (`removePermanentTo`); these tests do the same. */
function leaveBattlefield(state: GameState, card: CardInstanceState): void {
    unapplySourceStaticEffects(state, card);
    for (const player of state.players) {
        player.battlefield = player.battlefield.filter((c) => c.id !== card.id);
    }
    syncLayer6(state);
}

function count(card: CardInstanceState, keyword: string): number {
    return card.staticAbilities.filter((a) => a === keyword).length;
}

/** Drives the real CR 514.2 cleanup purge (not a hand-rolled tick). */
function runCleanup(state: GameState): void {
    state.phase = "CLEANUP";
    finalizeCleanup(state);
}

/** The same permanent as the CLIENT sees it — through the real projection,
 *  never a hand-built view. */
function projected(state: GameState, id: string) {
    const view = projectPublicState(state, 1, "p1");
    return view.players[0].battlefield.find((c) => c.id === id)!;
}

/** The six rebuild sites, each driven through its real entry point. `source`
 *  is a Mahamoti Djinn on the board for the copy legs to copy. */
const SWAP_SITES: {
    name: string;
    run: (card: CardInstanceState, source: CardInstanceState) => void;
}[] = [
    { name: "applyCopy", run: (card, source) => applyCopy(card, source) },
    {
        name: "revertCopy",
        run: (card, source) => {
            applyCopy(card, source);
            revertCopy(card);
        },
    },
    { name: "turnFaceDown", run: (card) => turnFaceDown(card, "morph") },
    {
        name: "turnFaceUp",
        run: (card) => {
            turnFaceDown(card, "morph");
            turnFaceUp(card);
        },
    },
    {
        name: "transformPermanent (front → back)",
        run: (card) => transformPermanent(card),
    },
    {
        name: "transformPermanent (back → front)",
        run: (card) => {
            transformPermanent(card);
            transformPermanent(card);
        },
    },
];

// ───────────────────────────────────────────────────────────────────────────
// (a) live grants survive
// ───────────────────────────────────────────────────────────────────────────

describe("shape (a) — a live keyword grant survives every identity swap (CR 400.7 / 613.1f)", () => {
    for (const site of SWAP_SITES) {
        it(`${site.name} keeps an until-EOT grant`, () => {
            const card = makeInstance(SWAP_FRONT_ID, { id: "swap-1" });
            const source = makeInstance(mahamotiDjinn.id, { id: "src-1" });
            const state = makeBoard(card, source);
            const ctx = ctxFor(state);
            ctx.grantStaticAbility(
                { type: "permanent", id: "swap-1" },
                "haste",
                UNTIL_EOT
            );
            expect(count(card, "haste")).toBe(1);

            site.run(card, source);

            expect(count(card, "haste")).toBe(1);
            // The provenance record is untouched, so the CLEANUP purge can
            // still find and release exactly its own occurrence.
            expect(card.grantedStaticAbilities).toEqual([
                {
                    ability: "haste",
                    duration: { phase: "end-of-turn" },
                    // CR 613.7 (PRD #2064 S3) — a resolving ability's
                    // continuous effect carries its own layer timestamp now,
                    // so a grant that lands after a strip survives it.
                    seq: expect.any(Number),
                },
            ]);
            // Board-visible: the grant must survive the wire too.
            expect(projected(state, "swap-1").staticAbilities).toContain(
                "haste"
            );
        });
    }

    it("a keyword-counter grant survives a transform and still releases on counter removal (CR 122.1c)", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "swap-c" });
        const state = makeBoard(card);
        const ctx = ctxFor(state);
        ctx.addCounter({ type: "permanent", id: "swap-c" }, "flying", 1);
        // Printed flying + the counter's own occurrence.
        expect(count(card, "flying")).toBe(2);

        transformPermanent(card);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);

        // The back face also prints flying, so the counter's occurrence sits
        // on top of the NEW printed one — still exactly two.
        expect(count(card, "flying")).toBe(2);
        ctx.removeCounter({ type: "permanent", id: "swap-c" }, "flying", 1);
        expect(count(card, "flying")).toBe(1);
        expect(projected(state, "swap-c").staticAbilities).toContain("flying");
    });

    it("an indefinite grant survives a face-down / face-up round trip (CR 708.2)", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "swap-i" });
        const state = makeBoard(card);
        const ctx = ctxFor(state);
        ctx.grantStaticAbilityPermanent(
            { type: "permanent", id: "swap-i" },
            "vigilance"
        );

        turnFaceDown(card, "morph");
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);
        // CR 708.2 — face down it is a 2/2 vanilla, but the layer-6 grant is
        // not a copiable value and applies over layer 1.
        expect(card.power).toBe(2);
        expect(count(card, "flying")).toBe(0);
        expect(count(card, "vigilance")).toBe(1);

        turnFaceUp(card);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);
        expect(count(card, "flying")).toBe(1);
        expect(count(card, "vigilance")).toBe(1);
        expect(projected(state, "swap-i").staticAbilities).toContain(
            "vigilance"
        );
    });

    it("turnFaceUp never aliases the shared printed CardDefinition array", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "swap-alias" });
        turnFaceDown(card, "morph");
        turnFaceUp(card);
        card.staticAbilities.push("mutated");
        // A second permanent of the same printing must be unaffected.
        const other = makeInstance(SWAP_FRONT_ID, { id: "swap-alias-2" });
        turnFaceDown(other, "morph");
        turnFaceUp(other);
        expect(other.staticAbilities).toEqual(["flying"]);
    });

    it("the CLEANUP purge after a swap releases exactly the granted occurrence (#1706)", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "swap-cl" });
        const state = makeBoard(card);
        const ctx = ctxFor(state);
        ctx.grantStaticAbility(
            { type: "permanent", id: "swap-cl" },
            "flying",
            UNTIL_EOT
        );
        transformPermanent(card);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);
        // Back face prints flying + trample; the grant adds a second flying.
        expect(count(card, "flying")).toBe(2);
        expect(count(card, "trample")).toBe(1);

        runCleanup(state);

        // Exactly the grant's occurrence went — the NEW face's printed flying
        // stays, and trample is untouched.
        expect(count(card, "flying")).toBe(1);
        expect(count(card, "trample")).toBe(1);
        expect(card.grantedStaticAbilities).toBeUndefined();
    });
});

// ───────────────────────────────────────────────────────────────────────────
// (b) live removals are not undone
// ───────────────────────────────────────────────────────────────────────────

describe("shape (b) — a live layer-6 removal is not undone by an identity swap (CR 613.1f)", () => {
    it("Gravity Sphere: a permanent that becomes a copy of a printed flier still does not fly", () => {
        const elemental = makeInstance(airElemental.id, { id: "elem-1" });
        const djinn = makeInstance(mahamotiDjinn.id, { id: "djinn-1" });
        const sphere = makeInstance(gravitySphere.id, { id: "sphere-1" });
        const state = makeBoard(elemental, djinn, sphere);

        applySourceStaticEffects(state, sphere);
        expect(count(elemental, "flying")).toBe(0);

        applyCopy(elemental, djinn);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);

        // Mahamoti Djinn prints flying; the Sphere's hold is still live.
        expect(count(elemental, "flying")).toBe(0);
        expect(projected(state, "elem-1").staticAbilities).not.toContain(
            "flying"
        );
        // …and the Sphere leaving restores exactly one occurrence, on the new
        // identity, not two.
        unapplySourceStaticEffects(state, sphere);
        expect(count(elemental, "flying")).toBe(1);
    });

    it("Gravity Sphere: transforming into a flying back face still does not fly", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "swap-b1" });
        const sphere = makeInstance(gravitySphere.id, { id: "sphere-2" });
        const state = makeBoard(card, sphere);

        applySourceStaticEffects(state, sphere);
        expect(count(card, "flying")).toBe(0);

        transformPermanent(card);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);

        expect(count(card, "flying")).toBe(0);
        expect(count(card, "trample")).toBe(1);
        expect(projected(state, "swap-b1").staticAbilities).toEqual([
            "trample",
        ]);
    });

    it("a stale hold is dropped: a keyword the new face does not print is not restored later", () => {
        const elemental = makeInstance(airElemental.id, { id: "elem-2" });
        const bear = makeInstance(grizzlyBears.id, { id: "bear-src" });
        const sphere = makeInstance(gravitySphere.id, { id: "sphere-3" });
        const state = makeBoard(elemental, bear, sphere);

        applySourceStaticEffects(state, sphere);
        expect(count(elemental, "flying")).toBe(0);

        // Becomes a Grizzly Bear — which prints no flying at all.
        applyCopy(elemental, bear);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);
        expect(count(elemental, "flying")).toBe(0);

        // The Sphere's hold had nothing to take on the new face, so its
        // restore must not conjure an occurrence out of nothing.
        unapplySourceStaticEffects(state, sphere);
        expect(count(elemental, "flying")).toBe(0);
    });

    it("ability-loss: the NEW face's printed keywords stay stripped across a transform", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "swap-b2" });
        const nullifier = makeInstance(NULLIFIER_ID, { id: "null-1" });
        const state = makeBoard(card, nullifier);

        applySourceStaticEffects(state, nullifier);
        expect(card.staticAbilities).toEqual([]);

        transformPermanent(card);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);

        // The back face prints flying AND trample — a blanket layer-6 removal
        // applies over layer 1 whatever layer 1 now says (CR 613.1a/613.1f).
        expect(card.staticAbilities).toEqual([]);
        expect(projected(state, "swap-b2").staticAbilities).toEqual([]);
    });

    it("ability-loss: unapplying the stripper restores the NEW face's keywords, not the old face's", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "swap-b3" });
        const nullifier = makeInstance(NULLIFIER_ID, { id: "null-2" });
        const state = makeBoard(card, nullifier);

        applySourceStaticEffects(state, nullifier);
        transformPermanent(card);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);
        unapplySourceStaticEffects(state, nullifier);

        // Back face's line, not the front's ["flying"].
        expect([...card.staticAbilities].sort()).toEqual(["flying", "trample"]);
        expect(card.removedKeywords).toBeUndefined();
    });

    it("CR 613.7 — a grant with a LATER timestamp than the stripper survives the swap (Humility, then Fire Whip)", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "swap-b4" });
        const nullifier = makeInstance(NULLIFIER_ID, { id: "null-3" });
        const aura = makeInstance(flight.id, {
            id: "flight-1",
            attachedTo: "swap-b4",
        });
        const state = makeBoard(card, nullifier, aura);

        applySourceStaticEffects(state, nullifier); // earlier timestamp
        applySourceStaticEffects(state, aura); // later — wins
        expect(count(card, "flying")).toBe(1);

        transformPermanent(card);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);

        // The later grant still wins, and the back face's printed keywords are
        // still eaten by the stripper.
        expect(card.staticAbilities).toEqual(["flying"]);
        expect(projected(state, "swap-b4").staticAbilities).toEqual(["flying"]);
    });

    it("CR 613.7 — a grant with an EARLIER timestamp than the stripper stays eaten across the swap", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "swap-b6" });
        const aura = makeInstance(flight.id, {
            id: "flight-3",
            attachedTo: "swap-b6",
        });
        const nullifier = makeInstance(NULLIFIER_ID, { id: "null-5" });
        const state = makeBoard(card, aura, nullifier);

        applySourceStaticEffects(state, aura); // earlier — loses
        applySourceStaticEffects(state, nullifier); // later — strips it
        expect(card.staticAbilities).toEqual([]);

        transformPermanent(card);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);

        // The complement of the Humility-then-Fire-Whip case above: a grant
        // that PREDATES the stripper is still eaten on the new face, exactly
        // as the printed keywords are.
        expect(card.staticAbilities).toEqual([]);
        expect(projected(state, "swap-b6").staticAbilities).toEqual([]);

        // …and the stripper is still holding that grant's occurrence, so its
        // release hands back three: the back face's flying + trample, plus the
        // aura's flying.
        unapplySourceStaticEffects(state, nullifier);
        expect(count(card, "flying")).toBe(2);
        expect(count(card, "trample")).toBe(1);
    });

    it("CR 613.7 — a targeted removal that PREDATES a blanket stripper keeps its own hold across the swap", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "swap-b7" });
        const sphere = makeInstance(gravitySphere.id, { id: "sphere-5" });
        const nullifier = makeInstance(NULLIFIER_ID, { id: "null-6" });
        const state = makeBoard(card, sphere, nullifier);

        applySourceStaticEffects(state, sphere); // earlier — takes flying
        applySourceStaticEffects(state, nullifier); // later — takes the rest
        expect(card.staticAbilities).toEqual([]);

        transformPermanent(card);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);

        expect(card.staticAbilities).toEqual([]);
        // The blanket source only ever took what was live at ITS timestamp:
        // the Sphere's own hold on flying must survive the rebuild, keyed to
        // the Sphere, or the next unapply resurrects a keyword that is still
        // being held down.
        // CR 613.7 (issue #1750) — the fresh board's first two materializing
        // sources mint consecutive timestamps (`allocStaticTimestamp` starts
        // at 1): pin the VALUE, not just presence, so a future regression that
        // drops or garbles `seq` at this write site is caught here rather than
        // only by an equally-broken `?? 0` reader downstream.
        expect(card.removedKeywords).toEqual([
            expect.objectContaining({
                keyword: "flying",
                sourceId: "sphere-5",
                seq: 1,
            }),
            expect.objectContaining({
                keyword: "trample",
                sourceId: "null-6",
                seq: 2,
            }),
        ]);

        leaveBattlefield(state, nullifier);
        expect(count(card, "flying")).toBe(0); // the Sphere is still live
        expect(count(card, "trample")).toBe(1);
        expect(projected(state, "swap-b7").staticAbilities).toEqual([
            "trample",
        ]);

        leaveBattlefield(state, sphere);
        expect(count(card, "flying")).toBe(1);
    });

    it("CR 613.7 — an eaten grant is held by the EARLIEST stripper that outranks it, not by the first one on the board", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "swap-b8" });
        const first = makeInstance(NULLIFIER_ID, { id: "null-7" });
        const aura = makeInstance(flight.id, {
            id: "flight-4",
            attachedTo: "swap-b8",
        });
        const second = makeInstance(NULLIFIER_ID, { id: "null-8" });
        const state = makeBoard(card, first, aura, second);

        applySourceStaticEffects(state, first); // seq 1 — eats printed flying
        applySourceStaticEffects(state, aura); // seq 2 — grants flying back
        applySourceStaticEffects(state, second); // seq 3 — eats the grant
        expect(card.staticAbilities).toEqual([]);

        transformPermanent(card);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);

        expect(card.staticAbilities).toEqual([]);
        // Releasing the LATER stripper hands back only what it took — the
        // aura's occurrence. The back face's printed flying + trample are held
        // by the earlier one and stay gone.
        leaveBattlefield(state, second);
        expect(count(card, "flying")).toBe(1);
        expect(count(card, "trample")).toBe(0);
        expect(projected(state, "swap-b8").staticAbilities).toEqual(["flying"]);

        leaveBattlefield(state, first);
        expect(count(card, "flying")).toBe(2);
        expect(count(card, "trample")).toBe(1);
    });

    it("CR 613.7 — a grant sharing the stripper's timestamp survives, matching grantOutrankedByAbilityLoss", () => {
        // Two sources cannot mint the same `staticSeq` through the real apply
        // path, so the tie is built directly on the instance — the swap still
        // travels the real `transformPermanent`. The reader's rule is
        // strictly-less (`grantOutrankedByAbilityLoss(5, 5) === false`), and
        // the replay must not disagree with it.
        expect(grantOutrankedByAbilityLoss(5, 5)).toBe(false);
        const card = makeInstance(SWAP_FRONT_ID, { id: "swap-b9" });
        // An INDEFINITE grant from a resolving ability (CR 611.2c) — the
        // residue channel, so it is the permanent's own record rather than a
        // source's, which is what lets it be stamped by hand at all.
        card.grantedStaticAbilities = [{ ability: "haste", seq: 5 }];
        card.baseStaticAbilities = [];
        card.staticAbilities = ["haste"];
        // PRD #2064 S3 — the resolving arm's LEDGER; `abilitiesSuppressedBy`
        // is the derived output the swap recomputes.
        card.abilityLossHolds = [{ sourceId: "null-tie", seq: 5 }];

        transformPermanent(card);

        expect(card.staticAbilities).toEqual(["haste"]);
        // The back face's printed flying + trample are both eaten by the
        // equal-timestamp stripper (it applies first at a tie), and the grant
        // that shares its timestamp is applied after it and survives.
        expect(card.removedKeywords).toEqual([
            { keyword: "flying", sourceId: "null-tie", seq: 5 },
            { keyword: "trample", sourceId: "null-tie", seq: 5 },
        ]);
    });

    it("CR 613.7 — Gravity Sphere then Flight still flies with a swap in the middle (#1715)", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "swap-b5" });
        const sphere = makeInstance(gravitySphere.id, { id: "sphere-4" });
        const aura = makeInstance(flight.id, {
            id: "flight-2",
            attachedTo: "swap-b5",
        });
        const state = makeBoard(card, sphere, aura);

        applySourceStaticEffects(state, sphere); // strips the printed flying
        applySourceStaticEffects(state, aura); // later grant wins
        expect(count(card, "flying")).toBe(1);

        transformPermanent(card);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);

        // Back face prints flying too: the Sphere's hold takes one occurrence,
        // the later grant keeps the other.
        expect(count(card, "flying")).toBe(1);
        expect(count(card, "trample")).toBe(1);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// (c) restore anchors re-captured from the new base
// ───────────────────────────────────────────────────────────────────────────

describe("shape (c) — a restore anchor is re-captured from the NEW base (CR 613.1a)", () => {
    it("an animated permanent that transforms restores to the NEW face's P/T on expiry", () => {
        const card = makeInstance(ANIM_FRONT_ID, { id: "anim-1" });
        const state = makeBoard(card);
        const ctx = ctxFor(state);
        ctx.animateAsCreature(
            { type: "permanent", id: "anim-1" },
            {
                power: 2,
                toughness: 2,
                subtype: "Assembly-Worker",
                additionalTypes: ["Artifact"],
                duration: UNTIL_EOT,
            }
        );
        expect(card.types).toContain("Creature");
        expect(card.power).toBe(2);
        expect(card.animation?.addedCreatureType).toBe(true);

        transformPermanent(card);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);

        // The layer-7b set survives the swap …
        expect(card.power).toBe(2);
        expect(card.toughness).toBe(2);
        expect(getEffectivePower(state, card)).toBe(2);
        // … and its anchor now names the BACK face's printed 3/3, not the
        // front's undefined P/T.
        expect(card.animation?.savedPower).toBe(3);
        expect(card.animation?.savedToughness).toBe(3);
        // The back face is printed a creature, so the animation adds nothing
        // and must not strip the type on expiry.
        expect(card.animation?.addedCreatureType).toBe(false);

        runCleanup(state);

        expect(card.power).toBe(3);
        expect(card.toughness).toBe(3);
        expect(card.types).toContain("Creature");
        expect(card.subtypes).toEqual(["Golem"]);
        const slim = projected(state, "anim-1");
        expect(getEffectivePower(state, slim)).toBe(3);
        expect(getEffectiveToughness(state, slim)).toBe(3);
    });

    it("an animated permanent that is copied restores to the COPIED identity's P/T", () => {
        const card = makeInstance(ANIM_FRONT_ID, { id: "anim-2" });
        const bear = makeInstance(grizzlyBears.id, { id: "bear-2" });
        const state = makeBoard(card, bear);
        const ctx = ctxFor(state);
        ctx.animateAsCreature(
            { type: "permanent", id: "anim-2" },
            { power: 5, toughness: 5, duration: UNTIL_EOT }
        );
        expect(card.power).toBe(5);

        applyCopy(card, bear);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);

        expect(card.power).toBe(5);
        expect(card.animation?.savedPower).toBe(2);
        expect(card.animation?.savedToughness).toBe(2);

        runCleanup(state);
        expect(card.power).toBe(2);
        expect(card.toughness).toBe(2);
    });

    it("a timed subtype change restores the NEW face's printed subtype line (CR 305.7)", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "sub-1" });
        const state = makeBoard(card);
        const ctx = ctxFor(state);
        ctx.setSubtypesUntil(
            { type: "permanent", id: "sub-1" },
            ["Zombie"],
            UNTIL_EOT
        );
        expect(card.subtypes).toEqual(["Zombie"]);
        expect(card.temporarySubtypeChange?.restoreSubtypes).toEqual(["Bird"]);

        transformPermanent(card);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);

        // The layer-4 set survives; its anchor is now the BACK face's line.
        expect(card.subtypes).toEqual(["Zombie"]);
        expect(card.temporarySubtypeChange?.restoreSubtypes).toEqual([
            "Bird",
            "Beast",
        ]);

        runCleanup(state);
        expect(card.subtypes).toEqual(["Bird", "Beast"]);
        expect(projected(state, "sub-1").subtypes).toEqual(["Bird", "Beast"]);
    });

    it("an indefinite subtype set survives a transform and re-anchors on the new face (CR 611.2b)", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "sub-2" });
        const state = makeBoard(card);
        const ctx = ctxFor(state);
        ctx.setSubtypes({ type: "permanent", id: "sub-2" }, ["Spirit"]);
        expect(card.subtypes).toEqual(["Spirit"]);

        transformPermanent(card);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);

        expect(card.subtypes).toEqual(["Spirit"]);
        expect(card.indefiniteSubtypeSet?.restoreSubtypes).toEqual([
            "Bird",
            "Beast",
        ]);
        expect(projected(state, "sub-2").subtypes).toEqual(["Spirit"]);
    });

    it("a layer-4 type-add survives a transform and is not double-applied", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "type-1" });
        const adder = makeInstance(TYPE_ADDER_ID, { id: "adder-1" });
        const state = makeBoard(card, adder);

        applySourceStaticEffects(state, adder);
        expect(card.types).toEqual(["Creature", "Artifact"]);

        transformPermanent(card);
        // CR 613.1d/f (PRD #2064 S3/S4) — every layer is DERIVED, so an
        // identity swap recomposes only what the INSTANCE bears; the board's
        // own continuous effects come back at the engine's recompute tick,
        // which every production path reaches (`refreshCounterGatedStatics`,
        // run at the top of every SBA pass and before every write).
        syncLayers2to5(state);
        syncLayer6(state);

        expect(card.types.filter((t) => t === "Artifact")).toHaveLength(1);
        expect(card.types).toContain("Creature");
        expect(projected(state, "type-1").types).toContain("Artifact");

        // The source leaving still removes exactly what it added — the type
        // was not printed on either face. Under a derivation "leaving" means
        // actually leaving the battlefield array, which is what production does
        // immediately after `unapplySourceStaticEffects` announces the stop.
        unapplySourceStaticEffects(state, adder);
        for (const player of state.players) {
            player.battlefield = player.battlefield.filter(
                (c) => c.id !== adder.id
            );
        }
        syncLayers2to5(state);
        expect(card.types).not.toContain("Artifact");
    });

    it("read-time layer-7 records (temporaryPTSet) are neither dropped nor double-applied by a swap", () => {
        const card = makeInstance(SWAP_FRONT_ID, { id: "pt-1" });
        const state = makeBoard(card);
        const ctx = ctxFor(state);
        ctx.setBasePT({ type: "permanent", id: "pt-1" }, 7, 7, UNTIL_EOT);
        expect(getEffectivePower(state, card)).toBe(7);

        transformPermanent(card);
        // CR 613.1f (PRD #2064 S3) — layer 6 is DERIVED, so an identity swap
        // recomposes only what the INSTANCE bears; the board's own continuous
        // effects come back at the engine's recompute tick, which every
        // production path reaches (`refreshCounterGatedStatics`, run at the top
        // of every SBA pass and before every write).
        syncLayer6(state);

        // A layer-7b SET beats the new face's printed 3/3 (CR 613.4b), and the
        // base P/T underneath it is the back face's.
        expect(getEffectivePower(state, card)).toBe(7);
        expect(card.power).toBe(3);
        const slim = projected(state, "pt-1");
        expect(getEffectivePower(state, slim)).toBe(7);

        runCleanup(state);
        expect(getEffectivePower(state, card)).toBe(3);
    });
});
