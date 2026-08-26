/** Seat plate (ADR 0103 §1/§4, issue #2727) — the 44px square at the head of
 *  the full player plaque, carrying the seat's initial in the display face.
 *
 *  The v4 prototype's plaque showed a 44px AVATAR crop. `Player`
 *  (`src/types/game.ts`) carries no avatar / picture / image field of any kind
 *  — the board has literally nothing to render there — so this plate shows a
 *  monogram rather than a broken image, on the same 44px module ADR 0101 §2
 *  sets as the coarse-pointer rung. Swapping the glyph for a real crop, if the
 *  player record ever grows one, is a change to this file and nowhere else.
 *
 *  Rendered only on the FULL plaque. The compact (portrait / landscape-compact)
 *  plaque's whole box is 24px tall BY CONTRACT — `PORTRAIT_NAMEPLATE_MAX_H` in
 *  `portrait-board-bands.ts` mirrors its border + padding + row arithmetic, and
 *  every portrait band is tiled against the reservation derived from it — so a
 *  44px plate cannot go there without re-deriving the whole band budget. The
 *  bands are the contract; the skin fits inside them.
 *
 *  `aria-hidden`: the initial is a decorative restatement of the name span the
 *  plaque already renders beside it, so a screen reader would otherwise read
 *  the seat out twice ("J, Jace"). */
export default function PlayerSeatPlate({ name }: { name: string }) {
    const initial = (name.trim()[0] ?? "?").toUpperCase();
    return (
        <span
            aria-hidden
            data-seat-plate
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--panel-radius)] border border-[var(--hairline-strong)] bg-surface-elevated font-display text-lg tracking-[-0.025em] text-text-muted"
        >
            {initial}
        </span>
    );
}
