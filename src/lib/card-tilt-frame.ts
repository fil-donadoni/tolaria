/**
 * Pointer → hover-tilt/glare mapping, expressed in the CARD's own frame
 * (issue #2551).
 *
 * ## Why this is not just `rotateX/rotateY` on a normalised pointer offset
 *
 * A tapped permanent on the spatial board rotates a presentational layer 90°
 * clockwise INSIDE its own unrotated slot box (#1994), and {@link
 * CardTilt3D} deliberately WRAPS that layer from the outside — putting the
 * tilt inside the rotation killed hover, tilt, preview and the context-menu
 * suppression on every tapped card (#1994 round 3 → round 4). So the tilt
 * element itself is never rotated, and everything it computes is otherwise
 * expressed in the SLOT's frame:
 *
 * - the pointer offset is normalised by the SLOT's width/height, so a
 *   portrait card lying on its side gets its long axis' gain applied to its
 *   short one (and the tilt AXIS is skewed off the true perpendicular
 *   anywhere off the slot's own axes);
 * - the glare is `absolute inset-0`, i.e. the portrait slot rect: wrong
 *   aspect, rounded on the wrong corners, missing the rotated face's
 *   long-side overhang and bleeding past its short sides;
 * - the gradient centre is a percentage of that same portrait box, so the
 *   bright spot is mirrored/transposed away from the cursor.
 *
 * This module does the one derivation both outputs share. At `rotationDeg: 0`
 * every formula collapses to the legacy one exactly, so hand cards, pile
 * cards and untapped permanents are byte-identical.
 *
 * ## The derivation
 *
 * Screen axes are CSS's: **x right, y down, z toward the viewer**, and
 * `rotate(θ)` is clockwise on screen. Writing `X = px·W`, `Y = py·H` for the
 * pointer's pixel offset from the card centre, the same point in the card's
 * OWN (pre-rotation) axes is the inverse rotation
 *
 *     u =  X·cosθ + Y·sinθ        v = −X·sinθ + Y·cosθ
 *
 * which normalises against the CARD's own width/height — `cx = u/W`,
 * `cy = v/H` — because the card keeps its portrait dimensions no matter how
 * it is laid out. (`aspect = W/H` is all that survives, since `px`/`py` are
 * already ratios.)
 *
 * In that frame the tilt is the untapped rule verbatim: the edge under the
 * cursor recedes, i.e. `rotateX(−cy·max)` / `rotateY(cx·max)` — a positive
 * `rotateY` sends the +x edge to −z, and a positive `rotateX` sends the +y
 * (bottom) edge toward the viewer.
 *
 * That rotation is applied about the SLOT's axes though, so it has to be
 * conjugated back: for small angles a rotation reads as a vector
 * `(ω_x, ω_y)`, and `Rz(θ)` carries it to
 *
 *     ω_slot_x = ω_x·cosθ − ω_y·sinθ    ω_slot_y = ω_x·sinθ + ω_y·cosθ
 *
 * At θ = 90° that is `(−ω_y, ω_x)`: the card's own horizontal axis IS the
 * slot's vertical axis once the card lies on its side. Composition order
 * (`rotateX` then `rotateY`) is left as the component writes it — at ≤14° the
 * non-commutativity is far below a pixel.
 *
 * The glare, by contrast, is drawn in the card's own box (the component gives
 * the overlay the same `rotate(θ)` the visual layer carries, so the two
 * coincide exactly), which makes its gradient centre simply `(cx, cy)` — no
 * conjugation, and frame-invariant: the same point of the card face lights up
 * at the same percentage tapped or not.
 */

/** Floating-point trig dust (`Math.cos(π/2)` is 6.1e-17) and negative zero
 *  both reach the DOM as `rotateX(-0.00deg)`. Snap them to a true 0. */
function snap(value: number): number {
    return Math.abs(value) < 1e-9 ? 0 : value;
}

/** The card face never extends past ±0.5 of its own box; the slot box does
 *  (a tapped card's short axis runs down a taller slot), and reading those
 *  strips naively would overshoot the tuned tilt magnitude. */
function clampHalf(value: number): number {
    return Math.min(0.5, Math.max(-0.5, value));
}

export type CardTiltFrameInput = {
    /** Pointer offset from the slot centre, as a fraction of slot WIDTH. */
    px: number;
    /** Pointer offset from the slot centre, as a fraction of slot HEIGHT. */
    py: number;
    /** Slot box aspect ratio (width / height). Must be non-zero. */
    aspect: number;
    /** Clockwise visual rotation applied to the card face below the tilt
     *  element, in degrees. `0` for hand, pile and untapped permanents. */
    rotationDeg: number;
    /** Tilt magnitude at the card's own edge, in degrees ({@link CARD_TILT}). */
    maxTiltDeg: number;
};

export type CardTiltFrame = {
    /** `rotateX` degrees to write on the (unrotated) tilt element. */
    tiltXDeg: number;
    /** `rotateY` degrees to write on the (unrotated) tilt element. */
    tiltYDeg: number;
    /** Glare gradient centre, as a percentage of the CARD's own box. */
    glareXPct: number;
    /** Glare gradient centre, as a percentage of the CARD's own box. */
    glareYPct: number;
};

export function cardTiltFrame({
    px,
    py,
    aspect,
    rotationDeg,
    maxTiltDeg,
}: CardTiltFrameInput): CardTiltFrame {
    const rad = (rotationDeg * Math.PI) / 180;
    const cos = snap(Math.cos(rad));
    const sin = snap(Math.sin(rad));

    // Pointer offset in the card's own normalised frame.
    const cx = px * cos + (py / aspect) * sin;
    const cy = -px * aspect * sin + py * cos;

    // The untapped rule, applied about the card's own axes.
    const cardTiltX = -clampHalf(cy) * maxTiltDeg;
    const cardTiltY = clampHalf(cx) * maxTiltDeg;

    return {
        // …conjugated back into the slot axes the tilt element actually uses.
        tiltXDeg: snap(cardTiltX * cos - cardTiltY * sin),
        tiltYDeg: snap(cardTiltX * sin + cardTiltY * cos),
        // …and the glare, which is drawn in the card's own rotated box.
        glareXPct: snap((cx + 0.5) * 100),
        glareYPct: snap((cy + 0.5) * 100),
    };
}
