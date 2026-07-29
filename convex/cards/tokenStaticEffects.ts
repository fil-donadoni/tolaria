// Named factories for the continuous static effects a TOKEN can carry
// (CR 611 on a CR 111.1 object).
//
// Why this registry exists — the bug it closes. A token has no printed card:
// its whole identity is the content-derived string `tokenDefinitionId` builds,
// and `maybeSynthesizeToken` (`cards/index.ts`) decodes that string back into a
// `CardDefinition` on every registry MISS — a cold Convex isolate, a client-side
// engine run (the vs-AI Brain, the Draft Lab), any process that never executed
// the server-side `registerTokenDefinition` call. A `StaticEffect` is a pair of
// CLOSURES (`applies`, `compute`) and cannot ride a string. The id therefore
// used to encode only the effect KINDS, and the decoder rebuilt them from a
// hand-maintained `if (kinds.includes("permanent-guard"))` — so a token whose
// effect was any OTHER kind silently decoded with NO static effects at all.
// That is how Urza's Saga's Construct died the moment the registry went cold:
// its "+1/+1 for each artifact you control" characteristic-defining ability
// (CR 604.3) vanished, leaving the printed 0/0 to the CR 704.5f SBA.
//
// The fix is to give each token static effect a stable KEY and encode the keys
// (not the kinds) in the id, so ENCODE and DECODE share one table. The
// exhaustiveness is structural, not conventional: `TokenStaticEffectKey`
// (`cards/types.ts`) is the union of legal keys and this record is typed
// `Record<TokenStaticEffectKey, …>`, so a key with no factory and a factory
// with no key are both compile errors. There is no list left to forget to
// update.
//
// A token static effect must be REFERENTIALLY TRANSPARENT — its factory takes
// no arguments and its closures may read only the state passed to them. Both
// the server's registration and any decoder's rebuild call the same factory and
// must produce identical behaviour (a per-instance parameter would have to ride
// the id, and the id keys a SHARED definition — see `tokenDefinitionId`).

import {
    cantBeEnchantedSelfGuard,
    EFFECT_AFFECTS_SELF,
    type StaticEffect,
    type TokenStaticEffectKey,
} from "./types";
import type { StaticPTCDA } from "./types";

/** CR 604.3 — "This token gets +1/+1 for each artifact you control", the
 *  characteristic-defining ability on Urza's Saga's Construct (CR 714, mh2).
 *  A `pt-cda` returning the DELTA over the printed base P/T (the catalogue
 *  convention, Wayfaring Giant `sets/inv/white.ts`). The token IS an artifact,
 *  so it counts ITSELF: a lone Construct is 1/1 and never dies to the CR 704.5f
 *  zero-toughness SBA. */
function ptCdaArtifactsYouControl(): StaticPTCDA {
    return {
        kind: "pt-cda",
        applies: EFFECT_AFFECTS_SELF,
        compute: (source, state) => {
            let artifacts = 0;
            for (const player of state.players) {
                for (const permanent of player.battlefield) {
                    if (permanent.controllerId !== source.controllerId)
                        continue;
                    if (permanent.types.includes("Artifact")) artifacts++;
                }
            }
            return { power: artifacts, toughness: artifacts };
        },
    };
}

/** The single ENCODE/DECODE table. Exhaustive by construction — see the module
 *  header. Add a key to {@link TokenStaticEffectKey} and the compiler demands
 *  the factory here (and vice versa). */
export const TOKEN_STATIC_EFFECT_FACTORIES: Record<
    TokenStaticEffectKey,
    () => StaticEffect
> = {
    // CR 303.4 — "This token can't be enchanted." (Tetravite, `sets/atq`.)
    "cant-be-enchanted-self": cantBeEnchantedSelfGuard,
    "pt-cda-artifacts-you-control": ptCdaArtifactsYouControl,
};

/** Legacy ids written before the keys existed encoded effect KINDS in the same
 *  segment. Exactly one token shape ever shipped that way (Tetravite's
 *  `permanent-guard`), so a game in flight keeps its guard instead of silently
 *  losing it on the first decode after this change. Never extend: a new token
 *  static effect gets a key, not an alias. */
const LEGACY_KIND_ALIASES: Record<string, TokenStaticEffectKey> = {
    "permanent-guard": "cant-be-enchanted-self",
};

function isTokenStaticEffectKey(value: string): value is TokenStaticEffectKey {
    return value in TOKEN_STATIC_EFFECT_FACTORIES;
}

/** Rebuilds the static effects for a token from its declared keys. Shared by
 *  the server's `registerTokenDefinition` path (`gre/state.ts`) and the
 *  decoder's rebuild (`maybeSynthesizeToken`), so both always agree. Unknown
 *  segments are dropped (a token id written by a newer build than this one). */
export function resolveTokenStaticEffects(
    keys: readonly string[] | undefined
): StaticEffect[] {
    if (!keys?.length) return [];
    const effects: StaticEffect[] = [];
    for (const raw of keys) {
        const key = isTokenStaticEffectKey(raw)
            ? raw
            : LEGACY_KIND_ALIASES[raw];
        if (!key) continue;
        effects.push(TOKEN_STATIC_EFFECT_FACTORIES[key]());
    }
    return effects;
}
