/// <reference types="node" />
// Reduced-motion gating guard (issue #598, PRD #589).
//
// Every micro-motion animation MUST live behind
// `@media (prefers-reduced-motion: no-preference)` so that when the OS requests
// reduced motion, NOTHING animates (acceptance criterion #2). This is the one
// load-bearing accessibility invariant of the slice, and it lives in plain CSS
// (`src/index.css`) — jsdom can't evaluate media queries, so we assert it by
// reading the stylesheet text (via Node fs, the test runtime) and checking that
// each animation `@keyframes` is only ever *applied* inside the gated block.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

/** Extract the body of the (single) `@media (prefers-reduced-motion:
 *  no-preference)` block, brace-matched so nested rules are included. */
function reducedMotionBlock(source: string): string {
    const marker = "@media (prefers-reduced-motion: no-preference)";
    const start = source.indexOf(marker);
    expect(start, "reduced-motion media query is present").toBeGreaterThan(-1);
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
            depth--;
            if (depth === 0) return source.slice(open + 1, i);
        }
    }
    throw new Error("unterminated reduced-motion media block");
}

describe("micro-motion is reduced-motion gated (issue #598)", () => {
    const gated = reducedMotionBlock(css);

    // The keyframe names that power the #598 micro-motion. Every `animation:`
    // that applies one of these must sit inside the gated block — never at the
    // top level where it would run regardless of the user's preference.
    const motionAnimations = [
        "runicSpin", // slow-rotating runic title ring
        "ambientBreath", // breathing warm/cool glows
        "kenBurns", // slow ken-burns on the background art
        "selectedPulse", // pulse on the selected Deck
        "arrivalGlow", // zone-arrival emphasis on a just-moved card
    ];

    it.each(motionAnimations)(
        "applies the %s animation only inside the reduced-motion gate",
        (name) => {
            // It is defined as a keyframe and applied somewhere.
            expect(css).toContain(`@keyframes ${name}`);
            const appliedAnywhere = new RegExp(
                `animation:[^;]*\\b${name}\\b`
            ).test(css);
            expect(appliedAnywhere, `${name} is applied`).toBe(true);
            // ...and the application lives inside the gate.
            const appliedInGate = new RegExp(
                `animation:[^;]*\\b${name}\\b`
            ).test(gated);
            expect(
                appliedInGate,
                `${name} must be applied inside the reduced-motion gate`
            ).toBe(true);
        }
    );

    it("applies each motion animation ONLY inside the gate (none leak to top level)", () => {
        // Strip the gated block out, then assert no `animation:` referencing a
        // motion keyframe survives at the top level.
        const outsideGate = css.replace(gated, "");
        for (const name of motionAnimations) {
            const leaked = new RegExp(`animation:[^;]*\\b${name}\\b`).test(
                outsideGate
            );
            expect(
                leaked,
                `${name} must NOT be applied outside the reduced-motion gate`
            ).toBe(false);
        }
    });

    it("gates the deck-row hover-lift transform behind reduced-motion", () => {
        // The hover-lift translate is the only transform-on-hover for rows; it
        // must live in the gate so reduced-motion users get no lift.
        expect(gated).toContain(".deck-row-liftable:hover");
        expect(gated).toMatch(/\.deck-row-liftable:hover\s*\{[^}]*translateY/);
    });
});
