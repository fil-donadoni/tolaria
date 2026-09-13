// Regression guard for token image URL resolution.
//
// Background: tokens (CR 111, 707.1) have synthetic ids of the form
// `token:Name|...|<imagePrintId>` and live outside the Scryfall registry.
// Naively passing this id to `getImageUrl` produced URLs like
//   https://cards.scryfall.io/large/front/t/o/token:Wasp|...|ce98....jpg
// that 404'd in production. `resolveCardImageId` is the single chokepoint
// every image consumer must go through: it returns the def's printed
// `imagePrintId` for tokens that have one, and `null` for tokens that
// don't (so the caller skips the network and renders a placeholder).
//
// The bug class recurred once the engine minted a SECOND synthetic id shape
// (issue #3321): an inset spell's twin is `${printId}#${kind}` (ADR 0120), the
// resolver's guard was written against the `token:` prefix alone, and `#` is
// the URL FRAGMENT delimiter — so an Adventure on the stack did not merely
// request a wrong URL, it requested a TRUNCATED one, extension and all, and
// Scryfall answered 404. The catalogue-wide sweep at the bottom of this file is
// the assertion that generalises the guard: it asks the question of EVERY
// registered definition rather than of the id shapes someone remembered.

import { describe, it, expect } from "vitest";
import {
    getCardByName,
    registeredDefinitions,
    tokenDefinitionId,
} from "@convex/cards";
import type { TokenSpec } from "@convex/cards/types";
import {
    CARD_RENDITION_WIDTHS,
    CARD_SLOT_QUANTUM_PX,
    cardSlotFloor,
    getArtCropImageUrl,
    getArtImageUrl,
    getImageFallbackUrl,
    getImageSrcSet,
    getImageUrl,
    getPrintedCardImageUrl,
    resolveCardImageFace,
    resolveCardImageId,
} from "../images";

describe("resolveCardImageId", () => {
    it("printed cards (no `token:` prefix) resolve to their own id", () => {
        const printedId = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // grizzlyBears
        expect(resolveCardImageId(printedId)).toBe(printedId);
    });

    it("token with imagePrintId resolves to the printed token's Scryfall id", () => {
        // The Hive's Wasp encodes imagePrintId in the trailing segment; the
        // lazy synthesizer in `convex/cards/index.ts` decodes it.
        const id =
            "token:Wasp|Artifact,Creature|Insect||1|1||flying|09921372-126f-4c81-b6d8-ea50b1d0eb44";
        expect(resolveCardImageId(id)).toBe(
            "09921372-126f-4c81-b6d8-ea50b1d0eb44"
        );
    });

    it("token without imagePrintId returns null (placeholder path)", () => {
        const id = "token:Phantom|Creature|Spirit||2|2||";
        expect(resolveCardImageId(id)).toBeNull();
    });

    it("getImageUrl built from a resolved token id targets the printed token", () => {
        const id =
            "token:Wasp|Artifact,Creature|Insect||1|1||flying|09921372-126f-4c81-b6d8-ea50b1d0eb44";
        const resolved = resolveCardImageId(id)!;
        const url = getImageUrl(resolved);
        // The dangerous regression URL contained the literal `token:` prefix
        // and pipe characters; the resolved URL must not.
        expect(url).not.toContain("token:");
        expect(url).not.toContain("|");
        // Scryfall path layout: first two chars of the Scryfall id make the
        // shard directories. Primary rendition is the `grid` WebP (488×680).
        expect(url).toContain("/grid/front/0/9/");
        expect(url).toMatch(/\.webp$/);
        expect(url).toContain(resolved);
    });

    it("getImageFallbackUrl mirrors getImageUrl as the legacy `normal` jpg", () => {
        const id = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // grizzlyBears
        const url = getImageFallbackUrl(id);
        expect(url).toContain("/normal/front/c/e/");
        expect(url).toMatch(/\.jpg$/);
        expect(url).toContain(id);
    });

    it("getImageSrcSet describes the three WebP renditions by width", () => {
        const id = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // grizzlyBears
        const srcSet = getImageSrcSet(id);
        const entries = srcSet.split(", ");
        expect(entries).toHaveLength(3);
        expect(entries[0]).toMatch(/\/thumb\/front\/c\/e\/.*\.webp 146w$/);
        expect(entries[1]).toMatch(/\/grid\/front\/c\/e\/.*\.webp 488w$/);
        expect(entries[2]).toMatch(/\/display\/front\/c\/e\/.*\.webp 672w$/);
    });

    it("getImageSrcSet with includeThumb:false drops the 146w thumb rendition", () => {
        // Mid-slot strategy (hand/stack/battlefield): a 1× screen must resolve
        // `grid` 488w, never the softer `thumb`.
        const id = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // grizzlyBears
        const srcSet = getImageSrcSet(id, { includeThumb: false });
        const entries = srcSet.split(", ");
        expect(entries).toHaveLength(2);
        expect(entries[0]).toMatch(/\/grid\/front\/c\/e\/.*\.webp 488w$/);
        expect(entries[1]).toMatch(/\/display\/front\/c\/e\/.*\.webp 672w$/);
        expect(srcSet).not.toContain("/thumb/");
    });

    it("getArtImageUrl targets the `art` WebP rendition", () => {
        const id = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // grizzlyBears
        const url = getArtImageUrl(id);
        expect(url).toContain("/art/front/c/e/");
        expect(url).toMatch(/\.webp$/);
        expect(url).toContain(id);
    });

    it("getArtCropImageUrl built from a resolved token id targets the printed token", () => {
        const id =
            "token:Wasp|Artifact,Creature|Insect||1|1||flying|09921372-126f-4c81-b6d8-ea50b1d0eb44";
        const resolved = resolveCardImageId(id)!;
        const url = getArtCropImageUrl(resolved);
        expect(url).not.toContain("token:");
        expect(url).toContain("/art_crop/front/0/9/");
    });
});

// Face-aware image URL selection for transformed permanents/tokens (CR 712,
// issue #1595). A permanent showing its back face has `card.card.id` swapped
// to a synthesized token id whose CONTENT encodes `imagePrintFace: "back"`
// (`tokenDefinitionId`, `convex/cards/index.ts`) — `resolveCardImageFace` is
// the single chokepoint that reads it back, and every URL builder accepts
// the resolved face as an explicit param.
describe("resolveCardImageFace / face-aware URL selection (issue #1595)", () => {
    const PRINT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    // Builds the id via the SAME `tokenDefinitionId` codec
    // `registerBackFaceDefinition` (`gre/transform.ts`) uses — and,
    // deliberately, NEVER registers it. On a real client, `transformPermanent`
    // runs server-side only; the browser bundle never sees that
    // `registerTokenDefinition` call and must decode the wire `card.card.id`
    // string cold, through `maybeSynthesizeToken`'s lazy-synthesis path
    // (`convex/cards/index.ts`). Pre-registering the def here would bypass
    // that decode path entirely and mask a codec bug (issue #1595 review) —
    // this id is resolved the same way a fresh, cold client would.
    const backFaceSpec: TokenSpec = {
        name: "Test Construct",
        types: ["Artifact", "Creature"],
        subtypes: ["Construct"],
        power: 0,
        toughness: 0,
        imagePrintId: PRINT_ID,
        imagePrintFace: "back",
    };
    const BACK_FACE_ID = tokenDefinitionId(backFaceSpec);

    // A plain token with its OWN imagePrintId but no back-face marker — the
    // overwhelming majority shape (e.g. The Hive's Wasp) — must still default
    // to "front".
    const PLAIN_TOKEN_ID =
        "token:Wasp|Artifact,Creature|Insect||1|1||flying|09921372-126f-4c81-b6d8-ea50b1d0eb44";

    it("a printed card (no `token:` prefix) resolves to front", () => {
        const printedId = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // grizzlyBears
        expect(resolveCardImageFace(printedId)).toBe("front");
    });

    it("a plain token with no back-face marker resolves to front", () => {
        expect(resolveCardImageFace(PLAIN_TOKEN_ID)).toBe("front");
    });

    it("a cold-decoded (never registered) back-face token id resolves to back", () => {
        expect(resolveCardImageFace(BACK_FACE_ID)).toBe("back");
    });

    it("scryfallUrl-backed builders default to the `front/` segment when no face is passed", () => {
        const id = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // grizzlyBears
        expect(getImageUrl(id)).toContain("/grid/front/c/e/");
        expect(getPrintedCardImageUrl(id)).toContain("/grid/front/c/e/");
        expect(getImageFallbackUrl(id)).toContain("/normal/front/c/e/");
        expect(getArtImageUrl(id)).toContain("/art/front/c/e/");
        expect(getArtCropImageUrl(id)).toContain("/art_crop/front/c/e/");
        for (const entry of getImageSrcSet(id).split(", ")) {
            expect(entry).toContain("/front/");
        }
    });

    it("every scryfallUrl-backed builder renders the `back/` segment when face is 'back'", () => {
        expect(getImageUrl(PRINT_ID, "back")).toContain("/grid/back/a/a/");
        expect(getPrintedCardImageUrl(PRINT_ID, "back")).toContain(
            "/grid/back/a/a/"
        );
        expect(getImageFallbackUrl(PRINT_ID, "back")).toContain(
            "/normal/back/a/a/"
        );
        expect(getArtImageUrl(PRINT_ID, "back")).toContain("/art/back/a/a/");
        expect(getArtCropImageUrl(PRINT_ID, "back")).toContain(
            "/art_crop/back/a/a/"
        );
        for (const entry of getImageSrcSet(PRINT_ID, { face: "back" }).split(
            ", "
        )) {
            expect(entry).toContain("/back/");
            expect(entry).not.toContain("/front/");
        }
    });

    it("end-to-end: resolveCardImageId + resolveCardImageFace on the same back-face id builds a `back/` URL", () => {
        const resolvedId = resolveCardImageId(BACK_FACE_ID)!;
        const face = resolveCardImageFace(BACK_FACE_ID);
        expect(resolvedId).toBe(PRINT_ID);
        expect(face).toBe("back");
        expect(getImageUrl(resolvedId, face)).toContain("/grid/back/a/a/");
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("no registered definition can produce an un-fetchable image URL (issue #3321)", () => {
    // The guard that was missing. Both earlier incidents were the same shape —
    // an id this engine SYNTHESIZES reaching a Scryfall path — and both were
    // found in production rather than here, because every test asserted the id
    // shapes its author already knew about. This one enumerates the registry,
    // so the next synthetic id is covered on the day it is minted.
    //
    // `registeredDefinitions()` is the right population precisely because it is
    // WIDER than the catalogue: it yields the face-down sentinel, runtime
    // tokens and inset-spell twins — the objects that have no printing of their
    // own and are therefore the only ones that can break this.
    // Swept INSIDE the tests, never at collection time. The `dom` project runs
    // `isolate: false` (one worker, shared module registry), and several
    // sibling suites assert through `waitFor` with its 1s default — a
    // ~2,000-definition synchronous sweep evaluated while the file is merely
    // being COLLECTED is work those timers pay for. Memoised so the two
    // assertions below sweep once between them.
    let swept: { offenders: string[]; urls: string[] } | null = null;
    const sweep = (): { offenders: string[]; urls: string[] } => {
        if (swept) return swept;
        const offenders: string[] = [];
        const urls: string[] = [];
        for (const def of registeredDefinitions()) {
            const resolved = resolveCardImageId(def.id);
            if (resolved === null) continue; // renders the in-app placeholder
            if (resolved.includes("#") || resolved.startsWith("token:")) {
                offenders.push(`${def.name} (${def.id}) -> ${resolved}`);
            }
            urls.push(getArtCropImageUrl(resolved));
        }
        swept = { offenders, urls };
        return swept;
    };

    it("resolves every definition to a printing id or to nothing", () => {
        const { offenders } = sweep();
        expect(
            offenders,
            "a synthetic id reached the image resolver's output. It is not a " +
                "Scryfall id, so the request either 404s or — for an id " +
                "containing `#` — is truncated at the fragment delimiter and " +
                "loses its file extension. Return null instead and let the " +
                "caller render the placeholder."
        ).toEqual([]);
    });

    it("builds no URL carrying a fragment delimiter", () => {
        const { urls } = sweep();
        // The assertion stated at the OUTPUT rather than at the id, because
        // this is the property that actually broke: a `#` anywhere in the path
        // makes the browser send less than the string says.
        expect(urls.filter((u) => u.includes("#"))).toEqual([]);
        // Vacuity floor: a resolver that answered null for everything would
        // pass both assertions above.
        expect(urls.length).toBeGreaterThan(100);
    });
});

describe("an Adventure's art is the adventurer card's printing (CR 715.2c, issue #3321)", () => {
    // One card is one card, and one card is one PRINTING: the inset half has no
    // illustration of its own, so a Petty Theft on the stack shows Brazen
    // Borrower's art rather than a placeholder.
    const twinId = `${getCardByName("Brazen Borrower").id}#adventure`;

    it("resolves the twin to the parent's print id", () => {
        expect(resolveCardImageId(twinId)).toBe(
            getCardByName("Brazen Borrower").id
        );
    });

    it("produces the same art URL the parent produces", () => {
        expect(getArtCropImageUrl(resolveCardImageId(twinId)!)).toBe(
            getArtCropImageUrl(getCardByName("Brazen Borrower").id)
        );
    });
});

/**
 * The image-quality floor (issue #3553).
 *
 * The defect this replaces was a hand-written `sizes` constant per call site,
 * with ~18 call sites declaring nothing and inheriting the board's 140px into
 * a 180-260px slot. The floor is a FUNCTION of the measured slot, so the
 * property under test is the one a constant can never hold: for any slot and
 * any dpr, the candidate the declared hint resolves is at least as wide as the
 * slot's device-pixel width.
 */
describe("cardSlotFloor (issue #3553)", () => {
    /** What a browser resolves from a width-described srcset given a `sizes`
     *  hint: the narrowest candidate at or above `sizes × dpr`, and the widest
     *  available when none reaches it. Deliberately re-implemented here rather
     *  than imported — the assertion is about what the BROWSER will do with
     *  what `cardSlotFloor` declares, so the selection rule has to be stated
     *  independently of the code under test. */
    function resolved(
        floor: { sizes: string; includeThumb: boolean },
        dpr: number
    ) {
        const candidates = [
            ...(floor.includeThumb ? [CARD_RENDITION_WIDTHS.thumb] : []),
            CARD_RENDITION_WIDTHS.grid,
            CARD_RENDITION_WIDTHS.display,
        ];
        const need = parseInt(floor.sizes, 10) * dpr;
        return candidates.find((w) => w >= need) ?? candidates.at(-1)!;
    }

    // Every slot this app actually paints, from the smallest chip to the
    // widest dialog tile, against every dpr the five-viewport matrix uses.
    const SLOTS = [
        40, 60, 64, 78, 84, 96, 100, 112, 120, 140, 160, 180, 208, 260,
    ];
    const DPRS = [1, 2, 3];

    it("resolves a candidate at least as wide as the slot's device width", () => {
        for (const slot of SLOTS) {
            for (const dpr of DPRS) {
                // Above the ladder's own top there is nothing to resolve —
                // see the ceiling test below.
                if (slot * dpr > CARD_RENDITION_WIDTHS.display) continue;
                const floor = cardSlotFloor(slot, dpr);
                expect({
                    slot,
                    dpr,
                    got: resolved(floor, dpr) >= slot * dpr,
                }).toEqual({ slot, dpr, got: true });
            }
        }
    });

    it("has a real ceiling at `display` 672w, and does not pretend otherwise", () => {
        // A slot needing more than 672 device px (260 CSS px at 3×) cannot be
        // covered by any rendition this srcset offers, and no `sizes` hint
        // changes that — the fix would be a WIDER CDN rendition, which issue
        // #3553 puts out of scope. The floor still declares the true slot
        // width, so the browser takes the widest candidate there is and the
        // gate's `cardsSoft` counts the shortfall instead of hiding it. This
        // test exists so the ceiling is a recorded fact rather than a
        // surprise the next reader debugs from a red run.
        const floor = cardSlotFloor(260, 3);
        expect(parseInt(floor.sizes, 10)).toBe(272);
        expect(resolved(floor, 3)).toBe(CARD_RENDITION_WIDTHS.display);
        expect(CARD_RENDITION_WIDTHS.display).toBeLessThan(260 * 3);
    });

    it("never resolves thumb for a slot wider than thumb's own pixel width", () => {
        for (const slot of SLOTS) {
            for (const dpr of DPRS) {
                const floor = cardSlotFloor(slot, dpr);
                if (resolved(floor, dpr) !== CARD_RENDITION_WIDTHS.thumb)
                    continue;
                expect({
                    slot,
                    dpr,
                    fits: slot * dpr <= CARD_RENDITION_WIDTHS.thumb,
                }).toEqual({ slot, dpr, fits: true });
            }
        }
    });

    it("keeps small slots on the cheap rendition — a floor, not an upgrade", () => {
        // The counter-property to the one above: if the floor simply dropped
        // `thumb` everywhere it would pass both assertions above while
        // doubling the bytes of every chip and collapsed pile on the board.
        expect(cardSlotFloor(64, 1).includeThumb).toBe(true);
        expect(cardSlotFloor(40, 3).includeThumb).toBe(true);
        // …and drops it exactly where 146 real pixels stop covering the slot.
        expect(cardSlotFloor(180, 2).includeThumb).toBe(false);
        expect(cardSlotFloor(120, 3).includeThumb).toBe(false);
    });

    it("rounds the declared hint UP to the quantum, never down", () => {
        // Down would re-create the defect one quantum at a time. Up costs at
        // most one rendition step and usually nothing at all.
        const floor = cardSlotFloor(181, 2);
        expect(parseInt(floor.sizes, 10)).toBe(192);
        expect(parseInt(floor.sizes, 10) % CARD_SLOT_QUANTUM_PX).toBe(0);
        expect(parseInt(cardSlotFloor(192, 2).sizes, 10)).toBe(192);
    });

    it("clamps a sub-1 devicePixelRatio so the floor never drops below CSS width", () => {
        // Browser zoom-out reports dpr < 1. The floor is a floor.
        expect(cardSlotFloor(208, 0.5).includeThumb).toBe(false);
    });
});
