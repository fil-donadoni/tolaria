import { FACE_DOWN_CARD_ID } from "@convex/cards";
import type { FaceDownProducer } from "@convex/gre/faceDown";
import type { CardInstance } from "~/types/game";

/** A live `CardInstance` or a bare `{ id }` placeholder — the two shapes every
 *  card renderer is handed. Mirrors `card-image-signature.ts`'s `CardLike`. */
type CardLike = CardInstance | { id: string };

function isCardInstance(card: CardLike): card is CardInstance {
    return "controllerId" in card;
}

/** The generic face-down face: the app's own card back, used by every producer
 *  that has no printed helper card of its own. Not a Scryfall id — it is a
 *  local asset, so it renders with no network round-trip and no 404 fallback
 *  dance (`public/img/card-back.webp`). */
export const GENERIC_CARD_BACK_SRC = "/img/card-back.webp";

/** What to PAINT for a face-down object (issue #2904).
 *
 *  `back` is a ready URL (the app asset above); `print` is a Scryfall printing
 *  id, resolved through the ordinary `~/lib/images` renditions exactly like any
 *  other card — the shape a producer with real printed helper art (a Morph
 *  card, a Manifest card) takes when one is censused for it. */
export type FaceDownFace =
    | { kind: "back"; src: string }
    | { kind: "print"; imagePrintId: string };

const GENERIC_BACK: FaceDownFace = { kind: "back", src: GENERIC_CARD_BACK_SRC };

/**
 * ONE ROW PER MECHANIC — the whole point of the {@link FaceDownProducer}
 * census (issue #2904). A total `Record`, deliberately: adding a producer to
 * the union in `convex/gre/faceDown.ts` fails the type-check here until it
 * declares its face, so a new face-down mechanic can never ship rendering
 * whatever the previous branch happened to return.
 *
 * Every shipped producer currently resolves to the generic back, and each row
 * records why rather than collapsing into a default:
 *
 *  - `morph` — Wizards prints no in-game helper card whose art the CDN serves
 *    under a printing id we could census here; the physical game uses the
 *    literal card back. Swapping this row to `{ kind: "print", … }` is the
 *    entire change if one is ever added.
 *  - `cast-face-down` — an effect-granted face-down cast (CR 708.4, ADR 0013)
 *    is not a keyword and has never had helper art.
 *  - `face-down-exile` — a CR 406.3 face-down exiled card is a card lying face
 *    down in the exile pile; the back IS its printed appearance.
 */
const FACE_BY_PRODUCER: Record<FaceDownProducer, FaceDownFace> = {
    morph: GENERIC_BACK,
    "cast-face-down": GENERIC_BACK,
    "face-down-exile": GENERIC_BACK,
    // Only ever painted for a viewer NOT entitled to look: the impulse idiom's
    // own controller sees the real card (`isHiddenFromKnower`), because in
    // paper it lies face up in front of them.
    "impulse-exile": GENERIC_BACK,
};

/** The face to paint for an object hidden by `producer`. An ABSENT producer —
 *  state persisted before #2904, or a bare `{ id: FACE_DOWN_CARD_ID }`
 *  placeholder that never had one — falls back to the generic back, which is
 *  what every censused producer resolves to anyway. */
export function resolveFaceDownFace(
    producer: FaceDownProducer | undefined
): FaceDownFace {
    return producer ? FACE_BY_PRODUCER[producer] : GENERIC_BACK;
}

/**
 * Is this object FACE DOWN, for rendering purposes? The single client-side
 * predicate (issue #2904) — never re-derive it from an id or an absence.
 *
 * Two projected shapes are both face down, and they differ on purpose:
 *  - `faceDown` set — a face-down permanent or stack item for any viewer
 *    (CR 708.2), and a CR 406.3 face-down exile card for BOTH viewers, the
 *    entitled one included (`projectExileCard` stamps it on the wire).
 *  - `card.id` is the sentinel with no flag — a bare `{ id }` placeholder, and
 *    any pre-#2904 projection shape.
 */
export function isFaceDownCard(card: CardLike): boolean {
    if (!isCardInstance(card)) return card.id === FACE_DOWN_CARD_ID;
    if (card.card.id === FACE_DOWN_CARD_ID) return true;
    // `faceDown` ALONE is not enough. The Manual Board (ADR 0080) has its own
    // face-down path with its own sentinel (`MANUAL_FACE_DOWN_CARD_ID`,
    // `convex/manual.ts`) and sets this same flag — and it is explicitly out of
    // scope for issue #2904. Requiring the GRE's own producer marker keeps a
    // manual card on its existing path (and stops `faceDownRealCardId` from
    // handing the preview a second face built from `"__faceDown"`).
    return card.faceDown === true && card.faceDownBy !== undefined;
}

/**
 * The REAL definition id behind a face-down object, for a viewer entitled to
 * look at it (CR 708.5 on the battlefield/stack, CR 406.3 in exile) — and
 * `undefined` for everyone else, because the wire simply does not carry it to
 * them. Feeds the preview's SECOND face and nothing else.
 *
 * The two entitled shapes, again deliberately different:
 *  - battlefield / stack: `card.card.id` is the CR 708.2a sentinel for EVERY
 *    viewer (issue #1735 — every id-derived rules read must see the vanilla
 *    2/2), so the real id rides the display-only `knownCardId`.
 *  - exile: the entitled viewer keeps the REAL `card.card.id`, because
 *    CR 406.3a lets them PLAY the card and the client needs its real cost;
 *    `faceDown` is what marks it hidden. A non-entitled viewer's copy has the
 *    sentinel there instead, which this returns `undefined` for.
 *
 * NEVER read this for a rules computation — it is the identification
 * affordance only, exactly like `displayCardId`.
 */
export function faceDownRealCardId(card: CardLike): string | undefined {
    if (!isCardInstance(card)) return undefined;
    if (!isFaceDownCard(card)) return undefined;
    if (card.knownCardId) return card.knownCardId;
    // The exile leg's real id is only trustworthy when the GRE stamped the
    // producer: without that guard any face-down object from another subsystem
    // (the Manual Board's `"__faceDown"`) would be read as its own real id and
    // rendered as a second "Actual card" face naming a definition-less string.
    if (card.faceDownBy === undefined) return undefined;
    return card.card.id === FACE_DOWN_CARD_ID ? undefined : card.card.id;
}

/** The producer marker, for either card shape. A bare placeholder has none. */
export function faceDownProducer(card: CardLike): FaceDownProducer | undefined {
    return isCardInstance(card) ? card.faceDownBy : undefined;
}
