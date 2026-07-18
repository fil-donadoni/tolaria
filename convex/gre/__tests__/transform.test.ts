// Transform / double-faced permanents (CR 712, CR 701.27, ADR 0067, issue
// #1210) — the pure `transformPermanent` primitive, exercised directly
// (mirrors `faceDown.test.ts`'s coverage shape for the sibling face-swap
// mechanic: fat-state characteristics, wire-format identical-both-viewers,
// no-op guards). Op-level / activated-ability-driven coverage lives in
// `convex/gre/effects/__tests__/interpreter.test.ts`.

import { describe, it, expect } from "vitest";
import { transformPermanent } from "../transform";
import { registerTokenDefinition, tryGetDefinition } from "../../cards";
import { getCardColors } from "../../cards/colors";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const FRONT_ID = "test-transform-front";
registerTokenDefinition({
    id: FRONT_ID,
    name: "Test Incubator",
    rarity: "common",
    manaCost: {},
    types: ["Artifact"],
    backFace: {
        name: "Test Construct",
        types: ["Artifact", "Creature"],
        subtypes: ["Construct"],
        power: 0,
        toughness: 0,
        staticAbilities: [],
    },
});

const NO_BACK_FACE_ID = "test-transform-no-backface";
registerTokenDefinition({
    id: NO_BACK_FACE_ID,
    name: "Plain Artifact",
    rarity: "common",
    manaCost: {},
    types: ["Artifact"],
});

// A front face whose back face is COLORED (CR 712.2 — a back face's color is
// fixed by its own printed characteristics). Regression coverage for the
// color-drop bug: `registerBackFaceDefinition` used to hardcode `manaCost:
// {}` on the synthesized back-face definition, so a colored back face
// registered as colorless server-side (`getCardColors` derives color from
// `manaCost`) even though the client's `maybeSynthesizeToken` rebuilds color
// from the encoded token id — a server/client divergence.
const COLORED_BACK_FRONT_ID = "test-transform-colored-back-front";
registerTokenDefinition({
    id: COLORED_BACK_FRONT_ID,
    name: "Test Werewolf",
    rarity: "common",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Human"],
    backFace: {
        name: "Test Werewolf Back",
        types: ["Creature"],
        subtypes: ["Werewolf"],
        power: 3,
        toughness: 3,
        colors: ["B"],
        staticAbilities: [],
    },
});

describe("transformPermanent (CR 712, ADR 0067)", () => {
    it("swaps to the back face in place — types/subtypes/P-T/abilities and card.card.id", () => {
        const card = makeInstance(FRONT_ID, {
            id: "t1",
            controllerId: "p1",
            ownerId: "p1",
        });
        transformPermanent(card);

        expect(card.transformed).toBe(true);
        expect(card.transformedFrom).toBe(FRONT_ID);
        expect((card.card as { id: string }).id).not.toBe(FRONT_ID);
        expect(card.types).toEqual(["Artifact", "Creature"]);
        expect(card.subtypes).toEqual(["Construct"]);
        expect(card.power).toBe(0);
        expect(card.toughness).toBe(0);
        expect(card.staticAbilities).toEqual([]);

        // The synthesized back-face definition is registered and reads back
        // its own printed characteristics (name, types) independently.
        const backDef = tryGetDefinition((card.card as { id: string }).id);
        expect(backDef).not.toBeNull();
        expect(backDef!.name).toBe("Test Construct");
    });

    it("flips back to front on a second call (CR 712.8a — the same primitive toggles either direction)", () => {
        const card = makeInstance(FRONT_ID, {
            id: "t2",
            controllerId: "p1",
            ownerId: "p1",
        });
        transformPermanent(card);
        transformPermanent(card);

        expect(card.transformed).toBeUndefined();
        expect(card.transformedFrom).toBeUndefined();
        expect((card.card as { id: string }).id).toBe(FRONT_ID);
        expect(card.types).toEqual(["Artifact"]);
        expect(card.subtypes).toEqual([]);
    });

    it("is a no-op when the current face declares no backFace", () => {
        const card = makeInstance(NO_BACK_FACE_ID, {
            id: "t3",
            controllerId: "p1",
            ownerId: "p1",
        });
        transformPermanent(card);
        expect(card.transformed).toBeUndefined();
        expect((card.card as { id: string }).id).toBe(NO_BACK_FACE_ID);
    });

    it("counters placed before transforming carry over across the flip (CR 122 — transform doesn't remove them)", () => {
        const card = makeInstance(FRONT_ID, {
            id: "t4",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [card] }),
                makePlayer("p2"),
            ],
        });
        transformPermanent(card);
        expect(card.counters).toEqual({ "+1/+1": 2 });
        // The base 0/0 Construct + 2 +1/+1 counters reads as 2/2 (layer 7c).
        expect(getEffectivePower(state, card)).toBe(2);
        expect(getEffectiveToughness(state, card)).toBe(2);
    });

    // CR 712 (issue #1210) — the back-face definition is registered through
    // the SAME `token:...` codec (`tokenDefinitionId`) a front-face token
    // uses, so a client that never saw the server-side registration call
    // (`maybeSynthesizeToken`, tested directly in
    // `cards/__tests__/tokenRegistry.test.ts`) can still decode a transformed
    // permanent's new face from its id alone. A bespoke id format here would
    // leave the client unable to render name/art the moment a permanent
    // transforms.
    it("the synthesized back-face id is `token:`-prefixed (the shared codec, not a bespoke format)", () => {
        const card = makeInstance(FRONT_ID, {
            id: "t7",
            controllerId: "p1",
            ownerId: "p1",
        });
        transformPermanent(card);
        const backId = (card.card as { id: string }).id;
        // A `token:`-prefixed id is exactly what `maybeSynthesizeToken`
        // decodes on a client that never saw this session's
        // `registerTokenDefinition` call — see
        // `cards/__tests__/tokenRegistry.test.ts` for the decode-path proof
        // (this test only pins the ENCODE side: the id shape transform.ts
        // actually produces, not a bespoke `backface:...` format).
        expect(backId).toMatch(/^token:/);
        const decoded = tryGetDefinition(backId);
        expect(decoded).not.toBeNull();
        expect(decoded!.name).toBe("Test Construct");
    });

    it("two permanents transforming from the SAME front id share one synthesized back-face definition", () => {
        const a = makeInstance(FRONT_ID, {
            id: "t5a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(FRONT_ID, {
            id: "t5b",
            controllerId: "p1",
            ownerId: "p1",
        });
        transformPermanent(a);
        transformPermanent(b);
        expect((a.card as { id: string }).id).toBe(
            (b.card as { id: string }).id
        );
    });

    it("a COLORED back face registers with the correct server-side color (CR 712.2, color-drop regression)", () => {
        const card = makeInstance(COLORED_BACK_FRONT_ID, {
            id: "t8",
            controllerId: "p1",
            ownerId: "p1",
        });
        transformPermanent(card);
        const backId = (card.card as { id: string }).id;
        const backDef = tryGetDefinition(backId);
        expect(backDef).not.toBeNull();
        // Server derives color from `manaCost` via `getCardColors` — the
        // exact path the engine uses (layers, `hasColor`, etc.). A hardcoded
        // `manaCost: {}` on the synthesized definition would make this
        // return `[]` instead of `["B"]`.
        expect(getCardColors(backDef!)).toEqual(["B"]);
    });
});

describe("transform is always PUBLIC information (CR 712.1a) — no per-viewer hiding", () => {
    it("the transformed face projects identically for the controller and the opponent", () => {
        const card = makeInstance(FRONT_ID, {
            id: "t6",
            controllerId: "p1",
            ownerId: "p1",
        });
        transformPermanent(card);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [card] }),
                makePlayer("p2"),
            ],
        });

        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "t6"
            )!;
            expect(slim.transformed).toBe(true);
            expect(slim.types).toEqual(["Artifact", "Creature"]);
            expect(slim.subtypes).toEqual(["Construct"]);
            expect(slim.power).toBe(0);
            expect(slim.toughness).toBe(0);
            expect(slim.card.id).toBe((card.card as { id: string }).id);
        }
    });
});
