import BasicLandTile from "./basic-land-tile";
import CompactChromeDisclosure from "./compact-chrome-disclosure";
import { useCompactChromeFold } from "./useCompactChromeFold";
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
    /** Adds `count` copies of the subtype's resolved cardId to the Maindeck. */
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
    /** The deck Format's allowed sets (issue #1629 AC3) — threaded straight
     *  to each subtype's printing picker, `null` offers every printing. */
    allowedSets: string[] | null;
    /** A printing was picked from a subtype's art grid (issue #1629) — the
     *  caller persists the preference AND rewrites the open deck's copies;
     *  this bar only forwards the gesture. */
    onPickArt: (subtype: BasicLandSubtype, printId: string) => void;
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
 *  Each subtype is a `BasicLandTile` (issue #5398): the printing in effect as
 *  art that opens the Format-filtered printing picker, its mana symbol, the
 *  Maindeck count, and `−` (disabled at zero copies) / `+`. */
export default function PoolBasicLandsBar({
    cardIdsBySubtype,
    counts,
    onAdd,
    onRemove,
    allowedSets,
    onPickArt,
    disabled,
}: PoolBasicLandsBarProps) {
    // Issue #2671 review M1: was `compact-chrome:hidden`, a CSS variant that
    // never widened to cover `useIsTabletPortrait()` — at 820x1180 the
    // disclosure below folds (its own predicate DOES include tablet-portrait)
    // while this static label stayed visible, rendering "Add Basic" beside
    // the disclosure's own "Add Basic ▾" toggle. Reading the disclosure's
    // exact fold predicate keeps the two from ever disagreeing again.
    const compactChrome = useCompactChromeFold();
    return (
        <div className="flex flex-wrap items-center gap-2 short-viewport:gap-1 border-b border-border-subtle/30 bg-surface/60 px-4 py-2 short-viewport:py-0.5 md:px-6">
            {!compactChrome && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Add Basic
                </span>
            )}
            {/* Issue #2511: five subtypes x four controls wraps to 199px at
                390px wide — the second-tallest chrome band on the screen, and
                one a player only touches while building a mana base. It folds
                behind its own toggle on a phone-shaped viewport;
                `CompactChromeDisclosure` renders the steppers verbatim on a
                desktop-shaped one, so the bar above `md` is unchanged. */}
            <CompactChromeDisclosure label="Add Basic">
                {BASIC_LAND_SUBTYPES.map((subtype) => (
                    <BasicLandTile
                        key={subtype}
                        subtype={subtype}
                        cardId={cardIdsBySubtype[subtype]}
                        count={counts[subtype]}
                        allowedSets={allowedSets}
                        onAdd={onAdd}
                        onRemove={onRemove}
                        onPickArt={onPickArt}
                        disabled={disabled}
                    />
                ))}
            </CompactChromeDisclosure>
        </div>
    );
}
