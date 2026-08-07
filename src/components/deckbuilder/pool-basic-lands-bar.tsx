import { Button } from "@/components/ui/button";
import { BASIC_LAND_SUBTYPES, type BasicLandSubtype } from "./basicLands";

interface PoolBasicLandsBarProps {
    /** cardId to add for each Basic subtype — the seat's own Pool printing
     *  when the Pool opened one, else the catalogue's canonical basic land
     *  (`resolveBasicLandCardIds`, issue #1576), or the catalogue's canonical
     *  printing unconditionally in Constructed (`resolveCanonicalBasicLandCardIds`,
     *  issue #1627). `null` only in the pathological case where the catalogue
     *  itself has no definition for that subtype's name; that button renders
     *  disabled rather than being omitted. */
    cardIdsBySubtype: Record<BasicLandSubtype, string | null>;
    /** Current Maindeck copy count per subtype (issue #1627,
     *  `countBasicLandCopies`) — drives the visible counter and the remove
     *  affordance's floor-at-zero disabled state. */
    counts: Record<BasicLandSubtype, number>;
    /** Adds `count` copies of the subtype's resolved cardId to the Maindeck —
     *  1 for a plain click, 5 for the `+5` step. */
    onAdd: (cardId: string, cardName: string, count: number) => void;
    /** Removes exactly one copy of the SUBTYPE — deliberately not of a cardId
     *  (PR #2320 review B1). `counts` is computed per subtype, so a remover
     *  keyed on one resolved printing disagrees with the number right next to
     *  the button: a Maindeck Mountain added under any other printing was
     *  counted, enabled the control, and was never removed. Passing the
     *  subtype makes the two halves share one classifier by construction.
     *  Never invoked for a subtype at zero copies — every gesture that reaches
     *  it is gated on `counts[subtype] > 0` in this component, so a caller
     *  never has to re-check the floor. */
    onRemove: (subtype: BasicLandSubtype) => void;
    disabled: boolean;
}

/** "Unlimited basic lands added freely" (PRD #1107 story 18, ADR 0054/0055):
 *  a one-click add per Basic subtype. Unlike every other card in either
 *  builder, a Basic isn't Pool-constrained in Limited — clicking appends a
 *  brand-new Maindeck copy rather than moving an existing one — and in
 *  Constructed it is an ordinary deck card added straight from the bar
 *  instead of the search grid (issue #1627, PRD #1617: "the basics bar ships
 *  in BOTH builders"). All five subtypes ALWAYS render (issue #1576) — a
 *  deck always needs basics regardless of what a drafted set's Pool happened
 *  to open (a Vintage Cube Pool has none) or that Constructed has no Pool at
 *  all — so this bar must never render `null`.
 *
 *  Each subtype is three controls (issue #1627):
 *   - a `−` button, disabled at zero copies — the visible, discoverable floor;
 *   - the pill itself: a plain click adds one, a shift-click or right-click
 *     removes one (the modifier gesture the acceptance criteria calls for,
 *     alongside the dedicated `−` button above);
 *   - a `+5` button for building a full mana base in a handful of clicks. */
export default function PoolBasicLandsBar({
    cardIdsBySubtype,
    counts,
    onAdd,
    onRemove,
    disabled,
}: PoolBasicLandsBarProps) {
    return (
        <div className="flex flex-wrap items-center gap-2 short-viewport:gap-1 border-b border-border-subtle/30 bg-surface/60 px-4 py-2 short-viewport:py-0.5 md:px-6">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Add Basic
            </span>
            {BASIC_LAND_SUBTYPES.map((subtype) => {
                const cardId = cardIdsBySubtype[subtype];
                const count = counts[subtype];
                const addDisabled = disabled || cardId === null;
                // Removing needs no resolved cardId: the copies are already in
                // the Maindeck and are identified by subtype (review B1). The
                // count IS the floor, and the only one.
                const removeDisabled = disabled || count === 0;

                const addOne = () => {
                    if (cardId !== null) onAdd(cardId, subtype, 1);
                };
                const addFive = () => {
                    if (cardId !== null) onAdd(cardId, subtype, 5);
                };
                const removeOne = () => {
                    if (count > 0) onRemove(subtype);
                };

                return (
                    <div
                        key={subtype}
                        className="flex items-center gap-1 short-viewport:gap-0.5"
                    >
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove one ${subtype}`}
                            title={`Remove one ${subtype}`}
                            disabled={removeDisabled}
                            onClick={removeOne}
                        >
                            −
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            // short-viewport (issue #2056 defect 3 amplification):
                            // `size="sm"` alone (px-3 py-1.5) measured this bar at
                            // ~35px; these overrides shrink the button chrome
                            // itself (not just the bar's own padding) toward the
                            // ~28px target.
                            className="short-viewport:px-1.5 short-viewport:py-0 short-viewport:text-[10px]"
                            disabled={addDisabled}
                            title={`Click to add one ${subtype}; shift-click or right-click to remove one`}
                            onClick={(e) => {
                                if (e.shiftKey) {
                                    removeOne();
                                    return;
                                }
                                addOne();
                            }}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                removeOne();
                            }}
                        >
                            + {subtype}
                        </Button>
                        <span
                            className="min-w-[1.5ch] text-center text-xs tabular-nums text-text-muted"
                            data-testid={`basic-count-${subtype}`}
                        >
                            {count}
                        </span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            aria-label={`Add five ${subtype}`}
                            title={`Add five ${subtype}`}
                            disabled={addDisabled}
                            onClick={addFive}
                        >
                            +5
                        </Button>
                    </div>
                );
            })}
        </div>
    );
}
