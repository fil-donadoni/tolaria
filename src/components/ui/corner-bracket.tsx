// One Panel v3 corner bracket (ADR 0101 §2, issue #2581).
//
// A 10px L at 1px / opacity .5, inset 4px from the panel border. Every number
// is a CSS token read by `.panel-bracket` (src/index.css) — nothing is
// hard-coded here, so the clearance guard in `design-tokens.test.ts` reads the
// same values the browser paints.
//
// Replaces `CornerFiligree` as the DEFAULT Panel frame. The 40px filigree
// survives only where a Panel explicitly opts back in (`ornament`), which the
// ADR limits to the lobby hero, Game Over and Match Result — the three waiting
// states where the ornament costs no working space.
import type { Corner } from "./corner-filigree";

export default function CornerBracket({ corner }: { corner: Corner }) {
    return (
        <span
            data-slot="corner-bracket"
            data-corner={corner}
            className="panel-bracket"
            aria-hidden
        />
    );
}
