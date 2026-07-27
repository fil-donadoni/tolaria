// The Incubator token (CR 701.53 Incubate) — shared spec for `incubateOp`.
// "Incubate N" creates a colorless Artifact token named Incubator with N
// +1/+1 counters and "{2}: Transform this artifact.", which transforms it
// into a 0/0 colorless Phyrexian artifact creature token (the back face).
//
// This is exactly a `createToken` Op (CR 111 / 701.7) whose `EffectTokenSpec`
// carries a token-scoped activated ability (issue #1191 — the gap that
// blocked Investigate's Clue / Magda's Treasures / Sunfall alike) PLUS a
// dynamic `entersWith.counters` count and a `backFace` (issue #1210 — the
// dynamic-counter-count and permanent-transform machinery Incubate itself
// needed). No dedicated `incubate` Op exists or is needed: "Incubate N" IS
// `{ op: "createToken", token: makeIncubatorTokenSpec(N), controller }`,
// matching the "generalize, don't add" primitive-reuse mandate (issue #924).
//
// Art: the real MOM "Incubator // Phyrexian" double-faced token print
// (Scryfall id 2c5ed737-657b-43bf-b222-941da7579a4a, shared by every printed
// Incubate source per Scryfall's `all_parts`) is pinned explicitly on both
// faces rather than relying on `tokenPrintIdFor` auto-resolution — the
// lockfile's entry name is the concatenated DFC name "Incubator //
// Phyrexian", not this spec's own front-face name "Incubator"
// (`tokenPrintIdFor` name-matches exactly, so the auto-resolve path would
// miss). Once transformed, the back face renders the correct BACK-face art:
// `registerBackFaceDefinition` (`gre/transform.ts`) stamps the synthesized
// Phyrexian definition `imagePrintFace: "back"`, and `src/lib/images.ts`
// routes every render call site through it (issue #1595, closed).
import type {
    EffectOp,
    EffectPlayerRef,
    EffectTokenSpec,
    EffectValue,
} from "../../types";

const INCUBATOR_PHYREXIAN_PRINT_ID = "2c5ed737-657b-43bf-b222-941da7579a4a";

/** Builds the Incubator token's `EffectTokenSpec` for a given N (CR 701.53
 *  — "create an Incubator token ... with N +1/+1 counters on it", N possibly
 *  dynamic, e.g. Sunfall's "X, where X is the number of creatures exiled
 *  this way"). Every Incubate source shares this ONE spec shape, so their
 *  Incubators share one synthesized token definition (`tokenDefinitionId` is
 *  content-derived) and one client-side rehydration path. */
export function makeIncubatorTokenSpec(count: EffectValue): EffectTokenSpec {
    return {
        name: "Incubator",
        types: ["Artifact"],
        subtypes: ["Incubator"],
        imagePrintId: INCUBATOR_PHYREXIAN_PRINT_ID,
        activatedAbilities: [
            {
                id: "incubator-transform",
                oracleText: "{2}: Transform this artifact.",
                cost: { mana: { generic: 2 } },
                useStack: true,
                effects: [{ op: "transform", target: { ref: "$source" } }],
            },
        ],
        entersWith: { counters: [{ type: "+1/+1", count }] },
        backFace: {
            name: "Phyrexian",
            types: ["Artifact", "Creature"],
            subtypes: ["Phyrexian"],
            power: 0,
            toughness: 0,
            imagePrintId: INCUBATOR_PHYREXIAN_PRINT_ID,
        },
    };
}

/** Sugar for "Incubate N" (CR 701.53 keyword action) as an Effect Script Op:
 *  create one Incubator token (`makeIncubatorTokenSpec(count)`) for
 *  `controller` (default the resolving controller, CR 111.2). */
export function incubateOp(
    count: EffectValue,
    controller: EffectPlayerRef = "controller"
): EffectOp {
    return {
        op: "createToken",
        token: makeIncubatorTokenSpec(count),
        controller,
    };
}
