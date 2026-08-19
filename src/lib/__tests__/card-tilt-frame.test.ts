// Issue #2551 — the hover tilt/glare mapping expressed in the CARD's own
// frame rather than the slot's.
//
// A tapped permanent rotates its visual layer 90° clockwise INSIDE an
// unrotated slot box (#1994). The tilt element itself is deliberately NOT
// rotated — it is an ancestor of the rotated, `pointer-events: none` layer —
// so everything this mapping produces has to be re-expressed:
//
//   * the pointer offset must be read in the card's own axes (a portrait card
//     laid on its side has its SHORT axis running vertically down the slot),
//   * the resulting 3D rotation, which is applied about the SLOT's axes, must
//     be the card-frame rotation conjugated back into slot axes.
//
// The strongest statement of "correct" here is COVARIANCE: the tilt and glare
// a given point of the card face produces must be the untapped result rigidly
// rotated with the art. These tests assert exactly that, plus the two edge
// behaviours (which edge recedes, where the bright spot lands) the issue's
// acceptance criteria name.
import { describe, it, expect } from "vitest";
import { cardTiltFrame } from "../card-tilt-frame";

/** A representative portrait slot box (matches the component test's stub). */
const W = 200;
const H = 280;
const ASPECT = W / H;
const MAX = 14;

/** Slot-frame normalised pointer offsets (px, py — the raw
 *  `(clientX - left) / width - 0.5` pair the component computes) for a point
 *  given in the CARD's OWN normalised frame, under a clockwise visual
 *  rotation of `deg`. This is the forward map; `cardTiltFrame` inverts it. */
function slotOffsets(cx: number, cy: number, deg: number) {
    const rad = (deg * Math.PI) / 180;
    const u = cx * W;
    const v = cy * H;
    return {
        px: (u * Math.cos(rad) - v * Math.sin(rad)) / W,
        py: (u * Math.sin(rad) + v * Math.cos(rad)) / H,
    };
}

function frameAt(cx: number, cy: number, rotationDeg: number) {
    const { px, py } = slotOffsets(cx, cy, rotationDeg);
    return cardTiltFrame({
        px,
        py,
        aspect: ASPECT,
        rotationDeg,
        maxTiltDeg: MAX,
    });
}

describe("cardTiltFrame — rotated-frame tilt + glare mapping (#2551)", () => {
    it("is the untapped mapping verbatim at 0° (hand, pile and untapped board callers)", () => {
        // The legacy formula: rotateX(-py * max), rotateY(px * max), glare at
        // ((px + 0.5) * 100)% ((py + 0.5) * 100)%.
        const f = cardTiltFrame({
            px: 0.25,
            py: 0.25,
            aspect: ASPECT,
            rotationDeg: 0,
            maxTiltDeg: MAX,
        });
        expect(f.tiltXDeg).toBeCloseTo(-3.5, 10);
        expect(f.tiltYDeg).toBeCloseTo(3.5, 10);
        expect(f.glareXPct).toBeCloseTo(75, 10);
        expect(f.glareYPct).toBeCloseTo(75, 10);
    });

    it("rotates the tilt with the art — the same point of the card face tilts the same way tapped or not", () => {
        // An off-axis point of the card face: right of centre, above centre in
        // the CARD's own frame. Off-axis matters — a point on a card axis
        // cannot distinguish a correct mapping from one that merely swapped
        // the two components.
        const cx = 0.2;
        const cy = -0.3;
        const flat = frameAt(cx, cy, 0);
        const tapped = frameAt(cx, cy, 90);

        // Conjugating a small rotation (wx, wy) by a 90° clockwise screen
        // rotation sends it to (-wy, wx): the card's own horizontal axis IS
        // the slot's vertical axis once the card lies on its side.
        expect(tapped.tiltXDeg).toBeCloseTo(-flat.tiltYDeg, 10);
        expect(tapped.tiltYDeg).toBeCloseTo(flat.tiltXDeg, 10);

        // The glare is drawn in the card's own (pre-rotation) box, so its
        // gradient centre is frame-invariant: identical percentages.
        expect(tapped.glareXPct).toBeCloseTo(flat.glareXPct, 10);
        expect(tapped.glareYPct).toBeCloseTo(flat.glareYPct, 10);

        // Sanity on the flat side so the covariance above is anchored to real
        // numbers rather than two equal wrong values.
        expect(flat.tiltXDeg).toBeCloseTo(4.2, 10);
        expect(flat.tiltYDeg).toBeCloseTo(2.8, 10);
        expect(flat.glareXPct).toBeCloseTo(70, 10);
        expect(flat.glareYPct).toBeCloseTo(20, 10);
    });

    it("tilts the card's VISIBLE top edge away when the cursor is pushed toward it (tapped)", () => {
        // `rotate(90deg)` is clockwise on screen, so the card's own "up"
        // direction (0, -1) maps to slot +x: on a tapped permanent the card's
        // top edge is the RIGHT side of the slot. Pushing the cursor there
        // must send that edge away from the viewer, which in CSS is a POSITIVE
        // rotateY (the +x edge goes to -z), about the card's own horizontal
        // axis — i.e. no rotateX component at all.
        const tapped = frameAt(0, -0.3, 90);
        expect(tapped.tiltYDeg).toBeGreaterThan(0);
        expect(tapped.tiltXDeg).toBe(0);
        // Same magnitude as the untapped card at the same point of its face.
        expect(tapped.tiltYDeg).toBeCloseTo(frameAt(0, -0.3, 0).tiltXDeg, 10);
    });

    it("puts the glare's bright spot under the cursor in the card's own frame (tapped)", () => {
        // The visible top-left quadrant of the ROTATED card face.
        const tapped = frameAt(-0.25, -0.25, 90);
        expect(tapped.glareXPct).toBeCloseTo(25, 10);
        expect(tapped.glareYPct).toBeCloseTo(25, 10);
    });

    it("never exceeds the tuned tilt magnitude, even where the slot box reaches past the rotated face", () => {
        // A tapped card's SHORT axis runs down the slot, so the slot's top and
        // bottom strips sit OFF the card face: read naively they would drive
        // the card-frame offset past ±0.5 and overshoot `maxTiltDeg / 2`.
        const corner = cardTiltFrame({
            px: 0.5,
            py: -0.5,
            aspect: ASPECT,
            rotationDeg: 90,
            maxTiltDeg: MAX,
        });
        expect(Math.abs(corner.tiltXDeg)).toBeLessThanOrEqual(MAX / 2 + 1e-9);
        expect(Math.abs(corner.tiltYDeg)).toBeLessThanOrEqual(MAX / 2 + 1e-9);
        // The GLARE is not clamped — off the card face the bright spot
        // honestly leaves the card rather than sticking to its edge.
        expect(corner.glareXPct).toBeLessThan(0);
    });

    it("writes exact zeros at 90° rather than floating-point trig dust", () => {
        // Math.cos(Math.PI / 2) is 6.1e-17, and a `-0` reaches the DOM as
        // "rotateX(-0.00deg)". Both are snapped.
        const f = frameAt(0, -0.3, 90);
        expect(Object.is(f.tiltXDeg, 0)).toBe(true);
    });
});
