/**
 * Face-down permanents (CR 708, ADR 0013).
 *
 * A face-down creature is a 2/2 colourless nameless vanilla creature with no
 * abilities (CR 708.2), regardless of the real card underneath. Rather than
 * gate every def-derived reader on a `faceDown` flag, we swap the instance's
 * `card.id` to the face-down sentinel definition (a registered 2/2 vanilla
 * creature) and set the stored characteristic fields to the vanilla values —
 * so colours, triggered/activated abilities, static effects and P/T all read
 * as the 2/2 automatically. The real id is retained in `faceDownOf` for the
 * turn-up (#124) and for the controller's own projected view.
 */

import { FACE_DOWN_CARD_ID, tryGetDefinition } from "../cards";
import { rebuildCopiableValuesAndReplayOverlays } from "./identitySwap";
import type { CardInstanceState } from "./state";
import type { LayerStateView } from "./layers";

/**
 * WHICH MECHANIC put an object face down — the census the DISPLAY layer keys
 * its face-down FACE on (`src/lib/face-down.ts`), issue #2904.
 *
 * A face-down object's rules identity is uniformly the CR 708.2a sentinel, but
 * the FACE a player sees is not: printed Magic gives some producers their own
 * helper-card art (a Morph card, a Manifest card) and gives others nothing at
 * all. That is a property of the MECHANIC, never of the hidden card, so it is
 * stamped here at the moment the object goes face down and rides the wire on
 * `CardInstanceState.faceDownBy` — the client must never re-derive it, because
 * the only honest source (the hidden card, or the effect that hid it) is
 * exactly what the wire withholds.
 *
 * One row per mechanic, never a branch: `FACE_BY_PRODUCER`
 * (`src/lib/face-down.ts`) is a total `Record` over this union, so adding a
 * producer here fails the type-check until it also declares its face. Three
 * further mechanics are registry rows with status `planned` and ship nothing,
 * each earning its member when its own mechanic ships, not before:
 *   - CR 701.40 manifest
 *   - CR 701.62 manifest dread
 *   - megamorph, the second half of CR 702.37 morph (its subrule 702.37b)
 */
export type FaceDownProducer =
    /** CR 702.37a/c — the morph alternative cost: cast as a face-down 2/2. */
    | "morph"
    /** CR 708.4 / ADR 0013 — an EFFECT that lets a card be cast face down
     *  (Illusionary Mask). Not a keyword and not card-specific: any future
     *  effect granting a face-down cast joins this row rather than adding one,
     *  because none of them has printed helper art either. */
    | "cast-face-down"
    /** CR 406.3 — exiled FACE DOWN because the card's own oracle text says so
     *  (Memory Jar, Necropotence, Headliner Scarlett, CR 702.75a hideaway).
     *  The object is a CARD in exile, not a permanent, and it is face down for
     *  its knower too — CR 406.3 lets them LOOK, which is the preview's second
     *  face, not the pile tile. */
    | "face-down-exile";

/** The runtime census of {@link FaceDownProducer} — a TOTAL `Record`, so a new
 *  member fails the type-check here until it is listed, exactly like the
 *  client's face table.
 *
 *  It exists because a producer can be RETIRED (issue #3001 retired
 *  `"impulse-exile"`), and a retired member does not disappear from state that
 *  was already persisted: `gameStates` holds ONE row per game, patched in
 *  place, so a game in flight when the change lands still carries the old
 *  string. The type assertion at the deserialize seam believes whatever it
 *  reads, so without this the stale value flows to the client and indexes a
 *  `Record` that no longer has the row. */
const FACE_DOWN_PRODUCER_CENSUS: Record<FaceDownProducer, true> = {
    morph: true,
    "cast-face-down": true,
    "face-down-exile": true,
};

/** Is `value` a producer this build still knows? `false` for a RETIRED one
 *  read back out of persisted state (issue #3001) — see the census above. */
export function isFaceDownProducer(value: unknown): value is FaceDownProducer {
    return typeof value === "string" && value in FACE_DOWN_PRODUCER_CENSUS;
}

/** CR 406.3 / ADR 0026 — is this EXILED card face down: does anyone NOT know
 *  what it is?
 *
 *  The gate is the per-viewer `knownTo` grant and nothing else. Exile is an
 *  open zone (CR 406.1), so a card there is public to everyone UNLESS an
 *  exiling effect scoped its identity to specific viewers — which is exactly
 *  what `exileFaceDownCard` stamps for the cards whose ORACLE TEXT says "face
 *  down" (Memory Jar, Necropotence, Headliner Scarlett, CR 702.75a hideaway),
 *  and exactly what `projectExileCard` re-derives on the wire. The impulse
 *  idiom is NOT one of them (issue #3001): "exile the top card of your
 *  library; you may play it this turn" names no face-down exile, so CR 406.3's
 *  first sentence leaves the card face up and examinable by any player — it
 *  reaches exile through the ordinary zone-mover, which stamps nothing.
 *
 *  Deliberately NOT `faceDownBy` (issue #3413): `moveCard` keeps that marker
 *  alive across a move INTO exile while it deletes `knownTo`, so a card that
 *  was a face-down PERMANENT and is now a perfectly public exiled card still
 *  carries it. Reading it here would refuse disclosure for cards everyone can
 *  see. `faceDown` is likewise not it — an exile instance never carries that
 *  flag in raw state; `projectExileCard` adds it ON THE WIRE.
 *
 *  Extracted at the third copy (issue #3413): the wire gate
 *  (`projectExileCard`), the re-exile knowledge decision (`moveCardTo`) and
 *  the disclosure gate (`getPublicCardIdentity`) all ask this question, and
 *  the ONE way the face-down leak reopens is those three drifting apart. */
export function isFaceDownExile(card: {
    knownTo?: readonly string[];
}): boolean {
    return (card.knownTo?.length ?? 0) > 0;
}

/** Turns a permanent face down in place (CR 708.2). No-op if already face
 *  down. The real definition id is preserved in `faceDownOf`, and `producer`
 *  — the mechanic responsible, {@link FaceDownProducer} — in `faceDownBy`.
 *  `producer` is REQUIRED so a new face-down site cannot silently inherit the
 *  generic face; the FIELD stays optional, since state deserialized from
 *  before issue #2904 legitimately has none. */
export function turnFaceDown(
    state: LayerStateView,
    card: CardInstanceState,
    producer: FaceDownProducer
): void {
    if (card.faceDown) return;
    card.faceDownOf = (card.card as { id?: string }).id;
    card.faceDownBy = producer;
    card.card = { id: FACE_DOWN_CARD_ID };
    card.faceDown = true;
    // CR 708.2a — the 2/2 vanilla values are the permanent's new COPIABLE
    // VALUES (layer 1). Turning face down is not a zone change (CR 400.7), so
    // the permanent's own layers 2–7 are replayed on top (issue #1705).
    rebuildCopiableValuesAndReplayOverlays(state, card, {
        types: ["Creature"],
        subtypes: [],
        power: 2,
        toughness: 2,
        staticAbilities: [],
    });
}

/** Turns a face-down permanent face up in place (CR 708.9, ADR 0013) — the
 *  inverse of {@link turnFaceDown}. Restores the real card id from `faceDownOf`
 *  and re-reads the real characteristics from the registry, then clears the
 *  face-down markers so the permanent reads (and projects) as its true self to
 *  both players. No-op if the card isn't face down or its real id is missing
 *  from the registry. */
export function turnFaceUp(
    state: LayerStateView,
    card: CardInstanceState
): void {
    if (!card.faceDown || !card.faceDownOf) return;
    const def = tryGetDefinition(card.faceDownOf);
    if (!def) return;
    card.card = { id: def.id };
    // Every array is COPIED, never aliased: `def.staticAbilities` is the
    // shared printed `CardDefinition` array, and handing it to the instance
    // would let any later in-place writer corrupt the catalogue globally.
    rebuildCopiableValuesAndReplayOverlays(state, card, {
        types: [...def.types],
        subtypes: [...(def.subtypes ?? [])],
        power: def.power,
        toughness: def.toughness,
        staticAbilities: [...(def.staticAbilities ?? [])],
    });
    delete card.faceDown;
    delete card.faceDownOf;
    // The producer marker is meaningless once the object is face up, and a
    // stale one would pick a face-down face for a face-up permanent if any
    // future reader forgot to check `faceDown` first (issue #2904).
    delete card.faceDownBy;
}
