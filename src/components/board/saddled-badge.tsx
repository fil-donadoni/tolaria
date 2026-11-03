import type { CardInstance } from "~/types/game";

/** CR 702.171b — "this permanent is SADDLED" marker.
 *
 *  Saddled is "a designation that has no rules meaning other than to act as a
 *  marker that spells and abilities can identify" — a Mount's own abilities
 *  read it ("if this creature isn't saddled"), so both players need to see,
 *  before combat, which Mounts already hold it. It lasts until end of turn and
 *  is never a counter, so `CounterBadges` cannot show it.
 *
 *  Reads the projected `saddled` flag, never the definition: an unsaddled
 *  Mount shows nothing.
 *
 *  Sits bottom-left, the `ClassLevelBadge` / `NotedManaBadge` corner. They
 *  cannot collide: only permanents can be saddled through a creature Mount's
 *  ability, and neither a Class nor a mana-battery artifact is one.
 *
 *  Purely presentational — pointer-events are off so it never intercepts the
 *  card's tap/target/ability gestures. */
export default function SaddledBadge({ card }: { card: CardInstance }) {
    if (card.saddled !== true) return null;

    return (
        <div
            data-saddled="true"
            className="pointer-events-none absolute bottom-1 left-1 z-20 rounded-full bg-black/70 px-1.5 py-0.5 drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]"
            title="Saddled until end of turn"
            aria-label="Saddled"
        >
            <span className="text-[0.625rem] leading-none font-bold text-white">
                Saddled
            </span>
        </div>
    );
}
