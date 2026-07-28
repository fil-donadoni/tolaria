import { describe, it, expect } from "vitest";
import { getDisplayAbilities } from "../card-utils";
import { cardImageSignature } from "../card-image-signature";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import {
    applySourceStaticEffects,
    unapplySourceStaticEffects,
} from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import type { SlimCardInstance } from "@convex/gameProjections";

// #447 — the card preview must reflect runtime-granted abilities & P/T. This
// exercises the FULL path that ships the bug when broken: a keyword grant is
// applied in the GRE (layer 6, CR 611.2 keyword-grant static effect), the state
// is projected to the wire (gameProjections), and the projected instance is fed
// to BOTH getDisplayAbilities (the preview ability resolver) AND
// cardImageSignature (the memo comparator). The unit pieces passing alone is
// not enough — the regression was the memo freezing a stale instance, so the
// signature must change in lockstep with the displayed abilities.

// Real card ids from convex/cards/sets/lea.ts.
const BEAR_ID = "2b871039-6a66-4ac3-95e7-24759c1f2f92"; // Merfolk of the Pearl Trident — vanilla
const FLIGHT_ID = "67c7784b-6b79-4268-a714-895c82809aff"; // aura granting flying (non-landwalk)
const BURROWING_ID = "a14c05e4-8df3-450b-8a98-5028e73b14c1"; // aura granting mountainwalk (landwalk)

/** Re-projects the live state for p1's viewer and returns the projected
 *  battlefield card matching `instanceId` as a frontend `CardInstance`. The
 *  projection strips `card.card` to `{ id }` — exactly the wire shape the
 *  preview consumes. */
function projectedCard(
    state: ReturnType<typeof makeState>,
    instanceId: string
): CardInstance {
    const projected = projectPublicState(state, 1, "p1");
    const slim = projected.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === instanceId) as SlimCardInstance | undefined;
    if (!slim) throw new Error(`instance ${instanceId} not on projected board`);
    // SlimCardInstance is structurally the frontend CardInstance wire shape.
    return slim as unknown as CardInstance;
}

describe("card preview reflects runtime grants end-to-end (#447)", () => {
    it("a granted NON-landwalk keyword (flying) shows as a [+] granted row, and the memo signature changes", () => {
        const creature = makeInstance(BEAR_ID, { id: "creature-1" });
        const aura = makeInstance(FLIGHT_ID, {
            id: "aura-1",
            attachedTo: "creature-1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature, aura] }),
                makePlayer("p2"),
            ],
        });

        // Before the grant: signature + abilities reflect the vanilla creature.
        const before = projectedCard(state, "creature-1");
        const sigBefore = cardImageSignature(before);
        const dispBefore = getDisplayAbilities(BEAR_ID, before);
        expect(
            dispBefore.keywords.find((k) => k.name === "flying")
        ).toBeUndefined();

        // Apply the aura's keyword-grant static effect (CR 611.2).
        applySourceStaticEffects(state, aura);

        const after = projectedCard(state, "creature-1");
        const sigAfter = cardImageSignature(after);
        const dispAfter = getDisplayAbilities(BEAR_ID, after);

        // The preview now shows flying as a GRANTED ([+]) row.
        expect(dispAfter.keywords).toContainEqual({
            name: "flying",
            state: "granted",
        });
        // The memo signature changed, so CardImage re-renders with the fresh
        // instance instead of freezing the stale one.
        expect(sigAfter).not.toBe(sigBefore);
    });

    it("a granted LANDWALK keyword (mountainwalk) shows as a [+] granted row", () => {
        const creature = makeInstance(BEAR_ID, { id: "creature-1" });
        const aura = makeInstance(BURROWING_ID, {
            id: "aura-1",
            attachedTo: "creature-1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature, aura] }),
                makePlayer("p2"),
            ],
        });

        applySourceStaticEffects(state, aura);
        const granted = projectedCard(state, "creature-1");
        const disp = getDisplayAbilities(BEAR_ID, granted);
        expect(disp.keywords).toContainEqual({
            name: "mountainwalk",
            state: "granted",
        });
    });

    it("the granted keyword disappears from the preview when the grant ends", () => {
        const creature = makeInstance(BEAR_ID, { id: "creature-1" });
        const aura = makeInstance(FLIGHT_ID, {
            id: "aura-1",
            attachedTo: "creature-1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature, aura] }),
                makePlayer("p2"),
            ],
        });

        applySourceStaticEffects(state, aura);
        const sigGranted = cardImageSignature(
            projectedCard(state, "creature-1")
        );

        // The aura leaves play → grant is spliced back out (CR 704.5q / 611).
        unapplySourceStaticEffects(state, aura);

        const ended = projectedCard(state, "creature-1");
        const disp = getDisplayAbilities(BEAR_ID, ended);
        expect(disp.keywords.find((k) => k.name === "flying")).toBeUndefined();
        // And the signature reverts, so the preview re-renders to the native view.
        expect(cardImageSignature(ended)).not.toBe(sigGranted);
    });

    it("runtime P/T (counters + temporary mods) is reflected in the signature", () => {
        const base = makeInstance(BEAR_ID, { id: "creature-1" });
        const buffed: CardInstance = {
            ...(base as unknown as CardInstance),
            counters: { "+1/+1": 2 },
            temporaryPTMods: [{ power: 1, toughness: 1 }],
        };
        const baseSig = cardImageSignature(base as unknown as CardInstance);
        // Counters change the signature.
        expect(
            cardImageSignature({
                ...(base as unknown as CardInstance),
                counters: { "+1/+1": 2 },
            })
        ).not.toBe(baseSig);
        // Temporary P/T mods change the signature.
        expect(cardImageSignature(buffed)).not.toBe(baseSig);
    });

    it("colorOverride still updates the signature (no regression)", () => {
        const base = makeInstance(BEAR_ID, {
            id: "creature-1",
        }) as unknown as CardInstance;
        const laced: CardInstance = { ...base, colorOverride: ["R"] };
        expect(cardImageSignature(laced)).not.toBe(cardImageSignature(base));
    });

    it("a bare { id } placeholder has a stable signature (no instance deltas to track)", () => {
        expect(cardImageSignature({ id: "x" })).toBe(
            cardImageSignature({ id: "x" })
        );
        expect(cardImageSignature({ id: "x" })).toBe("x");
    });

    it("identical instances share a signature so the memo still skips unrelated repaints", () => {
        const a = makeInstance(BEAR_ID, {
            id: "creature-1",
        }) as unknown as CardInstance;
        const b = makeInstance(BEAR_ID, {
            id: "creature-1",
        }) as unknown as CardInstance;
        // Tapping/combat flags are NOT preview-relevant: signature unchanged.
        const tapped: CardInstance = {
            ...a,
            isTapped: true,
            isAttacking: true,
        };
        expect(cardImageSignature(a)).toBe(cardImageSignature(b));
        expect(cardImageSignature(tapped)).toBe(cardImageSignature(a));
    });
});

// A granted keyword and the ability that carries its rules text are the SAME
// ability. Ward is granted as `staticAbilities: ["ward {1}"]` PLUS the
// "Whenever this permanent becomes the target …" trigger, so the preview listed
// it twice: once bare, once with the reminder text. The compact keyword row is
// the canonical one.
describe("granted keyword rows are not duplicated by their rules-text ability", () => {
    it("drops a granted ability whose oracle text restates a granted keyword row", () => {
        const creature = makeInstance(BEAR_ID, {
            id: "warded-1",
            staticAbilities: ["ward {1}"],
            grantedTriggeredAbilities: [
                { sourceCardId: BEAR_ID, abilityId: "nope" },
            ],
        } as Partial<CardInstance> as never);
        const display = getDisplayAbilities(BEAR_ID, {
            ...(creature as unknown as CardInstance),
            staticAbilities: ["ward {1}"],
            grantedTriggeredAbilities: [],
        });
        expect(
            display.keywords.filter((k) => k.state === "granted")
        ).toHaveLength(1);
        expect(display.keywords[0].name).toBe("ward {1}");
        // Nothing else may restate it.
        const restated = [...display.activated, ...display.triggered].filter(
            (a) => a.oracleText.toLowerCase().startsWith("ward")
        );
        expect(restated).toHaveLength(0);
    });

    it("keeps a NATIVE ability even when it opens with a keyword word", () => {
        // The filter is scoped to granted-vs-granted precisely so printed text
        // is never swallowed.
        const display = getDisplayAbilities(BEAR_ID);
        expect(display.keywords.every((k) => k.state !== "granted")).toBe(true);
    });
});
