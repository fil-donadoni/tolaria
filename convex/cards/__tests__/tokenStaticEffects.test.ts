// Guard for the token static-effect codec (CR 611 on a CR 111.1 object).
//
// A token has no printed card: its identity is the content-derived string
// `tokenDefinitionId` builds, and `maybeSynthesizeToken` decodes that string
// back into a `CardDefinition` on every registry MISS — a cold Convex isolate,
// a client-side engine run, any process that never executed the server-side
// `registerTokenDefinition`. `StaticEffect`s are closures and cannot ride the
// string, so the id carries KEYS and both sides rebuild through the one factory
// table in `cards/tokenStaticEffects.ts`.
//
// The regression this locks down: the decoder used to rebuild from a
// hand-written `kinds.includes("permanent-guard")` branch, so every effect
// shape but that single hand-mapped guard decoded as NO static effects at all.
// Urza's Saga's Construct lost its "+1/+1 for each artifact you control" CDA
// (CR 604.3) and died to the CR 704.5f zero-toughness SBA the moment the
// registry went cold.
//
// Every probe spec below uses a name that no card in the catalogue creates, so
// the ids under test are guaranteed to MISS the registry regardless of test
// ordering or worker isolation — decoding is the only thing that can satisfy
// them.

import { describe, it, expect } from "vitest";
import { tokenDefinitionId, tryGetDefinition } from "..";
import { TOKEN_STATIC_EFFECT_FACTORIES } from "../tokenStaticEffects";
import type { TokenSpec, TokenStaticEffectKey } from "../types";
import { makeInstance, makePlayer, makeState } from "./setup";
import { ornithopter } from "../sets/atq/colorless";
import { getEffectivePower, getEffectiveToughness } from "../../gre/layers";
import type { CardInstanceState } from "../../gre/state";

const KEYS = Object.keys(
    TOKEN_STATIC_EFFECT_FACTORIES
) as TokenStaticEffectKey[];

/** A token spec no card creates, carrying exactly `key`. */
function probeSpec(key: TokenStaticEffectKey): TokenSpec {
    return {
        name: `Codec Probe ${key}`,
        types: ["Artifact", "Creature"],
        power: 0,
        toughness: 0,
        staticEffectKeys: [key],
    };
}

describe("token static-effect codec (CR 611)", () => {
    it("every registered key survives the id round trip on a registry miss", () => {
        expect(KEYS.length).toBeGreaterThan(0);
        for (const key of KEYS) {
            const def = tryGetDefinition(tokenDefinitionId(probeSpec(key)));
            expect(def, `no definition decoded for ${key}`).not.toBeNull();
            expect(
                def!.staticEffects ?? [],
                `${key} decoded with no static effects`
            ).toHaveLength(1);
            expect(def!.staticEffects![0].kind).toBe(
                TOKEN_STATIC_EFFECT_FACTORIES[key]().kind
            );
        }
    });

    it("a token with no keys decodes with no static effects", () => {
        const def = tryGetDefinition(
            tokenDefinitionId({
                name: "Codec Probe bare",
                types: ["Creature"],
                power: 1,
                toughness: 1,
            })
        );
        expect(def!.staticEffects ?? []).toHaveLength(0);
    });

    it("a legacy id that encoded the effect KIND still decodes its guard", () => {
        // Ids already written into live games predate the keys and hold
        // `permanent-guard` in the same segment (Tetravite). Losing it silently
        // would un-protect a token mid-game.
        const parts = tokenDefinitionId({
            name: "Codec Probe legacy",
            types: ["Artifact", "Creature"],
            power: 1,
            toughness: 1,
        }).split("|");
        // Segment index 9 is the static-effect segment; a legacy id holds the
        // effect KIND there. (`parts[0]` still carries the `token:` prefix.)
        parts[9] = "permanent-guard";
        const legacy = parts.join("|");
        const def = tryGetDefinition(legacy);
        expect(def!.staticEffects ?? []).toHaveLength(1);
        expect(def!.staticEffects![0].kind).toBe("permanent-guard");
    });

    it("a decoded CDA really computes — the Construct's P/T off the id alone", () => {
        // The behavioural half: decoding must yield a WORKING effect, not just
        // a non-empty array. Built with `card.id` only — exactly what a cold
        // isolate reads back off the wire.
        const id = tokenDefinitionId(probeSpec("pt-cda-artifacts-you-control"));
        const token: CardInstanceState = {
            id: "probe-token",
            card: { id },
            isToken: true,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            types: ["Artifact", "Creature"],
            subtypes: [],
            staticAbilities: [],
            power: 0,
            toughness: 0,
            isTapped: false,
            isSummoningSick: true,
        };
        const thopter = makeInstance(ornithopter.id, {
            id: "thopter-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [token, thopter] }),
                makePlayer("p2"),
            ],
        });
        // Ornithopter + the token itself.
        expect(getEffectivePower(state, token)).toBe(2);
        expect(getEffectiveToughness(state, token)).toBe(2);
    });
});
