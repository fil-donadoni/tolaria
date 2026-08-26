import { useState } from "react";
import type { Player } from "~/types/game";
import type { PlayerInteraction } from "~/hooks/usePlayerInteraction";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from "~/components/ui/context-menu";
import {
    V4_EYEBROW,
    plaqueState,
    type PlaqueState,
} from "~/lib/board-chrome-v4";
import AnimatedLifeTotal from "./animated-life-total";
import PlayerSeatPlate from "./player-seat-plate";
import PlayerPoisonCounters from "./player-poison-counters";
import PlayerEnergyCounters from "./player-energy-counters";
import PlayerExperienceCounters from "./player-experience-counters";

type PlayerNameplateProps = {
    player: Player;
    interaction: PlayerInteraction;
    /** Extra classes appended by the layout (e.g. absolute positioning on the
     *  spatial board). */
    className?: string;
    /** Compact one-row variant (#1814 round-2 fixup, portrait; widened to
     *  landscape-compact by #2589) — see the dedicated doc block below
     *  `PlayerNameplate` for the full account. */
    compact?: boolean;
    /** True when `compact` is set BECAUSE of the landscape-compact rail
     *  (`LANDSCAPE_SIDE_GUTTER`), as opposed to the portrait seam — the two
     *  share the same one-row markup but not the same width budget: portrait's
     *  box is unconstrained (shrink-to-fit, no `max-w`), landscape's is capped
     *  at `calc(var(--landscape-side-gutter)-1rem)` (~48px, ~34px of content
     *  after padding+border). Round-2 review finding 1: at that width the name
     *  span already renders unreadable (~8px after `truncate`) the moment a
     *  poison OR energy badge is live, so landscape drops it outright rather
     *  than spend width on it. Portrait keeps the name — it has the room. */
    landscapeCompact?: boolean;
    /** CR 506.2 — attackers are declared and this seat is the defending
     *  player, so the plaque wears the `attacked` state (ADR 0103 §3: the
     *  signal hues are the only colour left on the chrome, and they carry
     *  meaning). Derived by the caller from the projected combat state
     *  (`isUnderAttack`, `~/lib/board-chrome-v4`) rather than read from a
     *  context here, so the presentational component stays renderable without
     *  a game provider — the classic `player-life.tsx` chrome simply omits it
     *  and gets the resting plaque. */
    underAttack?: boolean;
};

/** Box-shadow ring/glow for the nameplate, by interaction state, using only
 *  semantic tokens (ADR 0007 / 0103 §3 — no chromatic Tailwind). Precedence: an
 *  actionable targeting / damage-assignment state (accent-strong ivory, matching
 *  the target arrows) wins over every ambient plaque state, because it is the
 *  only one the player can act on; below it the three ambient states rank
 *  attacked → low life → active ({@link plaqueState}). */
function nameplateShadow(
    state: PlaqueState,
    isTargetable: boolean,
    isDamagePickable: boolean,
    isPlayerPicked: boolean
): string | undefined {
    const STRONG = "var(--color-accent-strong)";
    if (isTargetable) {
        return `0 0 0 2px ${STRONG}, 0 0 16px 1px color-mix(in oklab, ${STRONG} 45%, transparent)`;
    }
    if (isDamagePickable) {
        return isPlayerPicked
            ? `0 0 0 3px ${STRONG}, 0 0 20px 2px color-mix(in oklab, ${STRONG} 55%, transparent)`
            : `0 0 0 2px ${STRONG}, 0 0 16px 1px color-mix(in oklab, ${STRONG} 45%, transparent)`;
    }
    if (state === "attacked") {
        // The same hue the incoming attack arrows and the warm mid-board line
        // use, so "an attack is aimed at this seat" reads as one signal.
        const ring = "var(--color-signal-opponent)";
        return `0 0 0 2px ${ring}, 0 0 18px 1px color-mix(in oklab, ${ring} 45%, transparent)`;
    }
    if (state === "low") {
        const ring = "var(--color-danger)";
        return `0 0 0 2px ${ring}, 0 0 18px 1px color-mix(in oklab, ${ring} 40%, transparent)`;
    }
    if (state === "active") {
        // Teal for both seats — the gold priority ring read as too close to the
        // accent-strong life total to notice, and v4's ivory accent would be
        // indistinguishable from the targeting ring above.
        const ring = "var(--color-secondary-accent)";
        return `0 0 0 2px ${ring}, 0 0 18px 1px color-mix(in oklab, ${ring} 40%, transparent)`;
    }
    return undefined;
}

/** Presentational life total + nameplate shared by the classic life chrome
 *  (`player-life.tsx`) and the spatial board (`board-player.tsx`), slice
 *  #280. Compact box framed by the shared corner filigree: a large
 *  accent-strong life total over an uppercase, muted name. The seat-coloured
 *  priority ring and the targeting / damage-choice ring are box-shadows from
 *  the flags computed by {@link usePlayerInteraction}; the click handler is
 *  wired by the caller via `interaction.handleClick`.
 *
 *  Carries `data-arrow-anchor-player` so a spell/ability that targets a player
 *  (e.g. Lightning Bolt to the face) can attach its arrow
 *  (`target-arrows-overlay.tsx` / `board-arrows.tsx`).
 *
 *  **`compact` (#1814 round-2 fixup).** Portrait's viewer nameplate grows
 *  UPWARD out of a band the battlefield's own inset must reserve for it
 *  (`PORTRAIT_NAMEPLATE_BAND_H`, `portrait-board-bands.ts`) — review round 1
 *  sized that reservation to the DESKTOP nameplate's worst case (~91px:
 *  life + name on separate lines, each counter its own row) and paid for it
 *  by shrinking the battlefield to unusably small (untappable, <44px wide)
 *  cards on a 667px phone. `compact` is the fix: ONE row — life, name, and
 *  BOTH counter badges inline, every piece with an explicit `leading-none`
 *  (or a fixed-height glyph) so the row's height is exactly the tallest
 *  child's font-size, never an inherited/ambiguous line-height. Collapsing
 *  three-to-five rows into one is what lets the reserved band shrink from
 *  ~91px to `PORTRAIT_NAMEPLATE_BAND_H` (~26px content + a small rendering
 *  safety margin, see that constant for the exact box math) while still
 *  showing every field the desktop nameplate shows. Desktop and the classic
 *  `player-life.tsx` never pass `compact` — their box is unchanged. Issue
 *  #2589 widened the second caller: landscape-compact now passes `compact`
 *  too (`board-player.tsx`), for the same reason portrait originally needed
 *  it — its own narrowed `LANDSCAPE_SIDE_GUTTER` left rail has no room for
 *  the multi-row box either. */
export default function PlayerNameplate({
    player,
    interaction,
    className = "",
    compact = false,
    landscapeCompact = false,
    underAttack = false,
}: PlayerNameplateProps) {
    const { hasPriority, isTargetable, isDamageTargetPickable } = interaction;

    // Manual Board life editing (PRD #2162 / issue #2169). Both affordances
    // are OPT-IN through fields the GRE `usePlayerInteraction` never sets, so
    // on the real board `lifeEditable` is false, `onLifeWheel` is undefined,
    // and every branch below collapses to exactly the markup shipped before:
    // no wheel listener, no wrapper element, no input.
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const onLifeCommit = interaction.onLifeCommit;
    const lifeEditable = interaction.lifeEditable === true && !!onLifeCommit;
    const onLifeWheel = interaction.onLifeWheel;
    const onLifeStep = interaction.onLifeStep;
    const menuActions = interaction.menuActions ?? [];

    function commitLife() {
        setEditing(false);
        const next = Number.parseInt(draft, 10);
        if (!Number.isNaN(next) && next !== player.life) onLifeCommit?.(next);
    }

    /** The life total, wrapped in its click-to-edit affordance when the
     *  injected interaction offers one. Not a component — a render helper, so
     *  the two nameplate variants (compact / full) share one definition
     *  without duplicating the editing branch. */
    function lifeTotal(isCompact: boolean) {
        const total = (
            <AnimatedLifeTotal
                key={player.id}
                life={player.life}
                compact={isCompact}
            />
        );
        if (!lifeEditable) return total;
        if (editing) {
            return (
                <input
                    autoFocus
                    aria-label="Life total"
                    data-life-input={player.id}
                    className={`bg-surface-strong text-center font-bold text-text ${
                        isCompact ? "w-10 text-sm" : "w-16 text-2xl"
                    }`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={commitLife}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") commitLife();
                        if (e.key === "Escape") setEditing(false);
                    }}
                />
            );
        }
        return (
            <span
                className="cursor-pointer"
                data-life-editable={player.id}
                onClick={(e) => {
                    e.stopPropagation();
                    setDraft(String(player.life));
                    setEditing(true);
                }}
            >
                {total}
            </span>
        );
    }

    /** One life-step button (manual-mode QA round 3, item 4). Deliberately
     *  tiny and `leading-none`: on the compact (portrait) nameplate the whole
     *  row's height IS its tallest child, and that height is mirrored as a
     *  constant in `portrait-board-bands.ts` — a button taller than the life
     *  glyph would silently grow the reserved band and shrink the
     *  battlefield (#1814). */
    function lifeStepButton(delta: number, isCompact: boolean) {
        if (!onLifeStep) return null;
        return (
            <button
                type="button"
                aria-label={delta > 0 ? "Gain 1 life" : "Lose 1 life"}
                data-life-step={`${player.id}:${delta > 0 ? "+" : "-"}`}
                onClick={(e) => {
                    e.stopPropagation();
                    onLifeStep(delta);
                }}
                className={`shrink-0 rounded-sm px-1 leading-none text-text-muted transition-colors hover:bg-surface-strong hover:text-text ${
                    isCompact ? "text-[11px]" : "text-base"
                }`}
            >
                {delta > 0 ? "+" : "−"}
            </button>
        );
    }

    /** The life total with its − / + flanking buttons, when the injected
     *  interaction offers stepping. Without `onLifeStep` this is exactly the
     *  bare life total the GRE board has always rendered. */
    function lifeRow(isCompact: boolean) {
        if (!onLifeStep) return lifeTotal(isCompact);
        return (
            <span className="inline-flex items-center justify-center gap-1">
                {lifeStepButton(-1, isCompact)}
                {lifeTotal(isCompact)}
                {lifeStepButton(1, isCompact)}
            </span>
        );
    }

    const interactive =
        (isTargetable && !interaction.isDivideTarget) || isDamageTargetPickable;
    // The three ambient plaque states of ADR 0103 / issue #2727, ranked once in
    // a pure helper so the precedence is unit-testable away from React.
    const state = plaqueState({
        hasPriority,
        underAttack,
        life: player.life,
    });
    const boxShadow = nameplateShadow(
        state,
        isTargetable,
        isDamageTargetPickable,
        interaction.isPlayerPicked
    );

    const box = (
        <div
            data-arrow-anchor-player={player.id}
            data-plaque-state={state ?? undefined}
            onClick={interaction.handleClick}
            onWheel={onLifeWheel ? (e) => onLifeWheel(e.deltaY) : undefined}
            style={{ boxShadow }}
            // Class-constant linkage (#1814 round-3 fixup): `border` (1px ×
            // 2 edges, unconditional on this box) is
            // `PORTRAIT_NAMEPLATE_BORDER_PX` in `portrait-board-bands.ts`;
            // the compact variant's `py-0.5` (0.125rem × 2 edges × 16px) is
            // `PORTRAIT_NAMEPLATE_PADDING_PX` there. Those constants build
            // `PORTRAIT_NAMEPLATE_MAX_H` — the reserved band's real worst
            // case — by mirroring these two literals, not by re-measuring
            // the DOM, so a class edited here without a matching edit there
            // silently reopens the #1814 overlap. `board-player.test.tsx`
            // ("compact nameplate variant follows the portrait seam") pins
            // both class strings verbatim — that test is the mechanical
            // guard: a rename here fails it immediately instead of drifting.
            // Only `py-0.5` is pinned there — the HORIZONTAL `px-*` is free
            // to change without touching that guard.
            //
            // `px-1.5` (was `px-3`, round-2 review finding 7): landscape-
            // compact's seat rail (`LANDSCAPE_SIDE_GUTTER`, `4rem`) gives
            // this box a ~48px max-width, of which `px-3` (24px) + the
            // border (2px) left only ~22px for life + name + poison/energy
            // — the name collapsed to nothing and the badges had nowhere to
            // go but past the box's own edge, into the battlefield band
            // (contradicting the rail's "chrome can never overlap a card"
            // invariant). `px-1.5` (12px) buys 12px of that back at ZERO
            // width-budget cost (it only changes how the EXISTING gutter is
            // spent, not the gutter itself) — portrait's compact box, which
            // isn't width-constrained the same way, is unaffected by the
            // extra 12px it also picks up here (same class, both variants).
            //
            // `overflow-hidden` (round-2 review finding 7): the arithmetic
            // above still doesn't guarantee content fits — a player WITH
            // either poison or energy counters live is a real, reachable
            // case (poison: mbs/colorless, c13/black, onc/multicolor;
            // energy: onc/multicolor, mh3, m3c) that can still exceed even
            // the freed-up width. `overflow-hidden` is what makes "chrome
            // can never overlap a card" true BY CONSTRUCTION regardless of
            // content, matching the rest of this module's own philosophy
            // (`landscape-board-bands.ts`'s "make the overlap arithmetically
            // impossible" framing) instead of resting on a budget
            // calculation that a future badge could invalidate again.
            //
            // Round-2 REGRESSED by this same `overflow-hidden`: the compact
            // row below used `justify-center`, which overflows UNSAFELY at
            // BOTH ends when content exceeds the box — so the badge case
            // this comment describes clipped off the LEADING edge instead of
            // the trailing one, eating the life total itself (a life of 20
            // rendered as `0`). Round-3 review finding 1: `justify-start`
            // below is what makes the life total — always the FIRST child —
            // safe from `overflow-hidden` by construction; only content
            // AFTER it can ever be clipped.
            //
            // v4 skin (ADR 0103 §5, issue #2727): the frame is a HAIRLINE —
            // 1px `--hairline` (ivory/12) on the panel corner, over a
            // translucent graphite fill — and the corner filigree that used to
            // overlay this box is gone, per §5 ("no corner brackets"). The box
            // arithmetic the portrait band budget mirrors is UNTOUCHED by that
            // swap: the border is still 1px on two edges
            // (`PORTRAIT_NAMEPLATE_BORDER_PX`), the compact padding is still
            // `py-0.5` (`PORTRAIT_NAMEPLATE_PADDING_PX`), and the filigree was
            // an `absolute` overlay that never contributed height in the first
            // place.
            className={`relative shrink-0 overflow-hidden rounded-[var(--panel-radius)] border border-[var(--hairline)] bg-surface/85 text-center backdrop-blur-md transition-shadow duration-200 ${
                compact ? "px-1.5 py-0.5" : "px-3 py-2"
            } ${interactive ? "cursor-pointer" : ""} ${className}`}
        >
            {/* key by player.id so a solo-mode viewer swap (different player
             *  rendered at the same seat position) remounts the animator with a
             *  fresh baseline instead of animating a phantom life delta — the
             *  swap is only a change of view, not a real life change. */}
            {compact ? (
                // PORTRAIT: a single row — see the `compact` doc above.
                // `flex-nowrap` so a long name never wraps the row onto a
                // second line (which would blow `PORTRAIT_NAMEPLATE_BAND_H`'s
                // exact height budget); a name that doesn't fit truncates
                // instead via `truncate` + a max width, not by growing taller.
                //
                // LANDSCAPE-COMPACT: `flex-wrap` instead (issue #1969 review
                // round 1, finding 4 — MEASURED, not reasoned: at 844x390 the
                // one-row form overflowed its 48px box by 86px, leaving the
                // poison badge 55% visible and the energy and experience
                // badges at visibleFrac 0 — invisible, and invisible in a way
                // no test in the repo could see, since `check:ui` lists
                // `game-board` as `unwalked` and happy-dom has no layout).
                // Wrapping is the fix the two variants' budgets allow to
                // differ on: landscape's box is width-capped at
                // `calc(var(--landscape-side-gutter)-1rem)` but has NO height
                // reservation to blow — the seat anchors are absolutely
                // positioned inside the 4rem left rail
                // (`LANDSCAPE_OPPONENT_SEAT_ANCHOR` /
                // `LANDSCAPE_VIEWER_SEAT_ANCHOR`), and every band is already
                // inset by that rail, so growing DOWNWARD (viewer) or UPWARD
                // (opponent, `-translate-y-full`) still cannot overlap a card.
                // Portrait is the exact mirror — unconstrained width, a fixed
                // reserved height — so it keeps `flex-nowrap`.
                //
                // `justify-start` (round-3 review finding 1, was
                // `justify-center`): with `overflow-hidden` on the parent box,
                // centering overflows unsafely at BOTH ends, so a badge
                // pushing the row past the box's content width used to clip
                // the LEADING edge — the life total, always the row's first
                // child. `justify-start` pins content flush left, so the life
                // total sits at x=0 and only what comes AFTER it can ever be
                // clipped.
                <div
                    className={`flex items-center justify-start gap-1.5 ${
                        landscapeCompact ? "flex-wrap" : "flex-nowrap"
                    }`}
                >
                    {lifeRow(true)}
                    {!landscapeCompact && (
                        // Landscape-only drop (round-3 review finding 1): the
                        // ~34px content box (48px anchor − 12px `px-1.5` −
                        // 2px border) has no room for life + name + a live
                        // badge — the name already renders unreadable
                        // (~8px after `truncate`) whenever one is live, so
                        // landscape spends the width on the badge instead.
                        // Portrait's box is unconstrained (no `max-w`), so it
                        // keeps the name — dropping it there would cost
                        // nothing back.
                        <span className="max-w-16 truncate text-[9px] leading-none uppercase tracking-[0.15em] text-text-muted">
                            {player.name}
                        </span>
                    )}
                    <PlayerPoisonCounters
                        count={player.poisonCounters}
                        compact
                    />
                    <PlayerEnergyCounters
                        count={player.energyCounters}
                        compact
                    />
                    <PlayerExperienceCounters
                        count={player.experienceCounters}
                        compact
                    />
                </div>
            ) : (
                // FULL plaque (desktop / classic chrome), v4 shape (ADR 0103
                // §1/§4): a 44px seat plate, then an eyebrow NAME over the
                // display-face life total — name small and quiet above, number
                // large and bright below, which is the read order a player
                // actually wants (they scan for the number and only then check
                // whose it is). Counters sit under the life total rather than
                // stacking their own full-width rows, so the plaque stays one
                // compact block whatever is live on it.
                //
                // No band reads this variant's height: portrait and
                // landscape-compact both render the `compact` branch above,
                // and desktop's chrome is corner-anchored with no reservation
                // to blow.
                <div className="flex items-center gap-3">
                    <PlayerSeatPlate name={player.name} />
                    <div className="flex min-w-0 flex-col items-start gap-1">
                        <span
                            className={`max-w-32 truncate ${V4_EYEBROW}`}
                            data-plaque-name
                        >
                            {player.name}
                        </span>
                        {lifeRow(false)}
                        <span className="flex flex-wrap items-center gap-1">
                            <PlayerPoisonCounters
                                count={player.poisonCounters}
                            />
                            <PlayerEnergyCounters
                                count={player.energyCounters}
                            />
                            <PlayerExperienceCounters
                                count={player.experienceCounters}
                            />
                        </span>
                    </div>
                </div>
            )}
            {/* The Monarch designation moved off the nameplate to a marker-card
             *  tile beside the piles (`player-monarch-tile.tsx`, #1305). */}
            {/* CR 601.2d — a divide-target player keeps its candidate ring (via
             *  `isTargetable`) but the [−] N [+] stepper now lives inside the
             *  divide dialog (`divide-target-list.tsx`), not on the nameplate. */}
        </div>
    );

    // No injected menu actions ⇒ no menu chrome at all, so the GRE nameplate
    // renders the exact element tree it always has. With actions (Manual
    // Board), the box becomes a left-click menu trigger, the same gesture the
    // battlefield cards and pile tiles already use for their verbs — a genuine
    // right-click stays with the card preview (`ui/context-menu.tsx`). The
    // life total's own click handler calls `stopPropagation`, so clicking the
    // NUMBER still opens the inline editor rather than the menu.
    if (menuActions.length === 0) return box;
    return (
        <ContextMenu>
            <ContextMenuTrigger render={<span className="contents" />}>
                {box}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                {menuActions.map((action) => (
                    <ContextMenuItem key={action.key} onClick={action.onSelect}>
                        {action.label}
                    </ContextMenuItem>
                ))}
            </ContextMenuContent>
        </ContextMenu>
    );
}
