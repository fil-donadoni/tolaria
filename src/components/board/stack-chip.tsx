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
    return (
        <PileChip
            label={open ? "STACK ▾" : "STACK"}
            count={count}
            onClick={onToggle}
            data-testid="chip-stack"
        />
    );
}
