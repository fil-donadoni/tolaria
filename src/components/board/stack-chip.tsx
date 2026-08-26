import PileChip from "./pile-chip";

/** Portrait stack chip (#336). On a phone the always-on floating stack panel is
 *  hidden behind this chip; tapping it toggles the EXISTING {@link GameStack}
 *  overlay (reused unchanged) so spells/abilities waiting to resolve stay one
 *  thumb-tap away without permanently eating board space. The chip only renders
 *  while the stack is non-empty. View layer only. */
export default function StackChip({
    count,
    open,
    onToggle,
}: {
    count: number;
    open: boolean;
    onToggle: () => void;
}) {
    if (count === 0) return null;
    // Deliberately the SAME `PileChip` primitive the zone chips use, not a
    // second chip that merely looks like one: on the phone bar the stack sits
    // beside GY / LIB / EXL and any drift between them reads as a bug. The v4
    // pass re-skins the primitive once (hairline edge, eyebrow label, ivory
    // count badge) and this affordance follows — it is a re-skin of a shipped
    // control, not a new one.
    return (
        <PileChip
            label={open ? "STACK ▾" : "STACK"}
            count={count}
            onClick={onToggle}
            data-testid="chip-stack"
        />
    );
}
