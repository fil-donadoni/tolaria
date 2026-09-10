import { Sparkles } from "lucide-react";
import type { CardInstance } from "~/types/game";

/** CR 111.1 / 111.7 — persistent "this permanent is a TOKEN" marker.
 *
 *  A token is a marker representing a permanent that isn't represented by a
 *  card (CR 111.1), and one that leaves the battlefield ceases to exist as a
 *  state-based action (CR 111.7). That makes token-ness gameplay-relevant, not
 *  cosmetic: a bounce or a flicker ANNIHILATES a token where it would only
 *  inconvenience the real permanent, so a player must be able to see it before
 *  choosing a target.
 *
 *  Reads the projected `isToken` flag, never the name or the art — a token
 *  created as a COPY of another permanent (CR 707.2) takes that card's name,
 *  art and characteristics and is otherwise indistinguishable from it, which is
 *  exactly the case this badge exists for.
 *
 *  Sits bottom-left: top-left is the summoning-sickness badge (a token creature
 *  is very often BOTH), top-centre the manual note, top-right the combat/target
 *  index, centre the counters and bottom-right the P/T + damage stack. The one
 *  other bottom-left tenant is `NotedManaBadge`, which a token CAN also earn as
 *  a copy of Ice Cauldron — this badge steps above it when both are live.
 *
 *  Purely presentational — pointer-events are off so it never intercepts the
 *  card's tap/target/ability gestures. */
export default function TokenBadge({ card }: { card: CardInstance }) {
    if (card.isToken !== true) return null;

    // `NotedManaBadge` holds the same corner, and a token is not immune to it:
    // a token that's a COPY of Ice Cauldron / Jeweled Amulet (CR 707.2) can
    // bank mana like the original. Step above it when both are live — the same
    // predicate `NotedManaBadge` renders on, so the two can never disagree —
    // rather than painting over it. Nothing else moves.
    const noted = card.notedMana?.mana;
    const stacked = !!noted && Object.values(noted).some((n) => n > 0);

    return (
        <div
            data-token="true"
            className={`absolute ${stacked ? "bottom-8" : "bottom-1"} left-1 z-20 pointer-events-none rounded-full bg-black/70 p-1 ring-1 ring-white/30 drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]`}
            title="Token — ceases to exist if it leaves the battlefield"
            aria-label="Token"
        >
            <Sparkles className="w-3 h-3 text-secondary-accent-strong" />
        </div>
    );
}
