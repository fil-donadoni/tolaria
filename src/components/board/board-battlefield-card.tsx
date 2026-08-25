import type { CardInstance } from "~/types/game";
import type { CardVisualState, ActivatableAbility } from "./battlefield-card";
import { useGameContext } from "~/hooks/useGameContext";
import { useArrowHighlight } from "~/hooks/arrowHighlightContext";
import { effectivePower, effectiveToughness } from "~/lib/effective-stats";
import { isCreature } from "~/lib/card-utils";
import { getEffectiveColorDisplay } from "~/lib/color-override";
import CardImage from "../cards/card-image";
import CardTilt3D from "./card-tilt-3d";
import {
    landscapeAttackerLiftPx,
    landscapeCombatLiftDirection,
} from "~/lib/landscape-board-bands";
import CounterBadges from "./counter-badges";
import PlaneswalkerLoyaltyBadge from "./planeswalker-loyalty-badge";
import NotedManaBadge from "./noted-mana-badge";
import ManualNoteBadge from "./manual-note-badge";
import SummoningSicknessBadge from "./summoning-sickness-badge";
import AttachedCardsCluster from "./attached-cards-cluster";
import ExileCastButton from "./exile-cast-button";
import ActivatableAbilityMenu from "./activatable-ability-menu";
import { useAbilityCardClick } from "~/hooks/useAbilityCardClick";

/** Clockwise screen rotation a tapped permanent's presentational layer carries
 *  (#1994). Single source for BOTH consumers — the layer's own `transform` and
 *  the tilt frame that has to compensate for it (#2551): a rotation the tilt
 *  did not hear about is exactly the bug, so the two must never be typed
 *  independently. */
const TAP_ROTATION_DEG = 90;

type BoardBattlefieldCardProps = {
    card: CardInstance;
    /** Board-coupled visual state computed by `useBattlefieldVisualState`
     *  (combat rings, tap, legal-target highlight, dim, badge). The SAME
     *  computation the classic board uses — reused as-is (#256). */
    vs: CardVisualState;
    /** Per-card click handler from the shared `useBattlefieldInteraction` hook
     *  (#272). The battlefield is click-only on the spatial board (no drag):
     *  clicking a mana source taps/untaps it (or routes cast/activation
     *  payment), and the event carries the pointer coords the mana-choice
     *  picker anchors to. Wired by `BoardBattlefield`; omitted means inert
     *  (e.g. opponent's permanents the viewer can't act on). The ability menu /
     *  targeting / combat branches live in the same handler and ship in the
     *  follow-up slices (#278/#279/#281). */
    onClick?: (e: React.MouseEvent) => void;
    /** Activated abilities the viewer may fire on this permanent, from the
     *  shared `useBattlefieldInteraction` hook's `getActivatable` (#278). When
     *  non-empty, the card gains the same left-click context menu / touch
     *  action-sheet affordance as the classic board via the shared
     *  {@link ActivatableAbilityMenu}.
     *
     *  During combat sub-steps (DECLARE_ATTACKERS / DECLARE_BLOCKERS) this same
     *  click handler dispatches the combat declaration mutations
     *  (toggleAttacker / selectBlocker / assignBlockerTarget) via the hook's
     *  `handleClickWithEvent`, which routes combat clicks straight to the
     *  declaration branch instead of opening a multi-color source's mana picker
     *  (#281). */
    activatableAbilities?: ActivatableAbility[];
    /** Dispatches the selected ability — wired to the hook's
     *  `handleActivateAbility` (X prompt, keep-priority, mana entry). */
    onActivateAbility?: (abilityId: string, keepPriority: boolean) => void;
    /** Click policy for a permanent that ALSO has activatable abilities (issue
     *  #2169). Omitted / false ⇒ today's rule: the ability gesture owns the
     *  click and `onClick` is not bound, so a permanent with both a tap and an
     *  ability is never tapped by a stray click. `true` (the Manual Board,
     *  whose every permanent carries the manual verb list and whose primary
     *  gesture IS the tap) additionally fires `onClick` on a desktop click,
     *  while still letting the event reach the menu trigger. Touch is
     *  identical on both branches — the tap opens the action sheet. */
    clickActsWithAbilities?: boolean;
    /** CR 702.26 — this permanent is phased out (set aside). It stays visible on
     *  its controller's battlefield but rendered dimmed and fully inert: no
     *  click, no ability menu, a "Phased" tag instead of interaction. */
    phased?: boolean;
    /** Landscape-compact's shared card height (#1768), for scaling the combat
     *  lift (#1770 follow-up from #1802). `vs.combatOffset`'s fixed
     *  `translate-y-8` (32px, tuned for the 168px desktop card) overshoots the
     *  midline at the much smaller compact card scale; when set, the lift is
     *  re-derived proportionally via {@link landscapeAttackerLiftPx} instead
     *  of applying the desktop Tailwind class. Omitted ⇒ desktop/portrait,
     *  unchanged. */
    compactCardHeight?: number;
};

/** Battlefield card for the new spatial board (PRD #249, slice #256).
 *
 *  Carries every board-coupled visual signal a permanent needs to read at a
 *  glance, sourced from the shared pure {@link CardVisualState} computation
 *  (`useBattlefieldVisualState`) so the classic and spatial boards never
 *  diverge:
 *  - combat grouping ring (`vs.ringClass`) + combat-group badge (`vs.badge`),
 *  - tapped rotation (90° visual rotate at FULL card size, issue #1994) — the
 *    rotation lives on an inert presentational layer INSIDE this card's own
 *    unrotated slot box, never on the interactive box itself, so tapping a
 *    permanent never changes its own hit-testable footprint and never widens
 *    what the row layout reserves for it (see the `tapTransform` comment
 *    below for the full rationale),
 *  - marked damage (CR 120.3) + effective P/T (CR 613, layer 7c) on creatures,
 *  - legal-target / legal-choice highlight rides on `vs.ringClass` during
 *    targeting/choice; a dim overlay marks ineligible/dimmed permanents.
 *
 *  Emits `data-arrow-anchor-permanent` so target arrows
 *  (`target-arrows-overlay.tsx`) attach to this card. Hover tilt + zoom
 *  preview ride along via {@link CardTilt3D} / {@link CardImage} (#253) and
 *  stay live tapped or not: {@link CardTilt3D} wraps the rotated presentational
 *  layer rather than living inside it, so its own pointer listeners (and
 *  `card-preview.tsx`'s) sit outside the `pointer-events: none` region a
 *  tapped permanent's overhang uses to stay non-hit-testable (see
 *  `tapTransform`). Because that leaves the tilt element unrotated under a
 *  rotated face, this card passes {@link TAP_ROTATION_DEG} down as
 *  `visualRotationDeg` so the tilt axes and glare box are expressed in the
 *  CARD's frame rather than the slot's (#2551).
 *
 *  Reads ONLY projected (`PublicGameState` / `FullGameState`) fields — no GRE
 *  import — consistent with the CLAUDE.md wire-format rule. The battlefield is
 *  click-only on the spatial board (no drag): the click handler is wired by the
 *  parent in a later slice; this slice renders state only. */
export default function BoardBattlefieldCard({
    card,
    vs,
    onClick,
    activatableAbilities,
    onActivateAbility,
    clickActsWithAbilities = false,
    phased = false,
    compactCardHeight,
}: BoardBattlefieldCardProps) {
    const { allPlayers, emblems, playerId } = useGameContext();
    const creature = isCreature(card);

    // CR 601.2d — divide-as-you-choose: a legal target of an active divide spell
    // (Pyrokinesis) keeps its candidate ring (`vs.ringClass`) so the player can
    // read which board permanents are eligible, but the per-target [−] N [+]
    // steppers now live inside the divide dialog (`divide-target-list.tsx`), not
    // on the card — overlaying them here occluded them behind neighbours.

    // Cards exiled-and-associated with THIS permanent (mechanism-agnostic via the
    // projected `exiledByPermanentId`): Banishing Light's held permanent, Ice
    // Cauldron's noted card, etc. Pin each to this host (Arena treatment); they
    // are de-duplicated from the Exile pile in `player-exile.tsx`.
    const associatedExiled = allPlayers
        .flatMap((p) => p.exile)
        .filter((c) => c.exiledByPermanentId === card.id);

    // Arrow hover-highlight (combat-read): when an arrow relationship is hovered
    // this card lights if it is a node of that relationship, dims if a highlight
    // is active and it is not. `null` = nothing hovered → neutral.
    const highlight = useArrowHighlight();
    const litState = highlight?.nodes
        ? highlight.nodes.has(card.id)
            ? "lit"
            : "unlit"
        : null;
    // Hovering the card seeds the shared channel with this permanent's id; the
    // arrow layer resolves it into the relationship to light (its own combat
    // cluster / target arrows). Additive — the tilt + card-preview hover on the
    // inner elements are untouched. A card with no arrows resolves to no
    // highlight, so unrelated permanents only preview/tilt as before.
    const setSeed = highlight?.setSeed;
    const onPointerEnter = setSeed
        ? () => setSeed({ nodeId: card.id })
        : undefined;
    const onPointerLeave = setSeed ? () => setSeed(null) : undefined;

    const highlightRing =
        litState === "lit" ? (
            <div
                className="absolute inset-0 card-corner pointer-events-none z-30"
                style={{
                    boxShadow:
                        "0 0 0 2px var(--color-accent-strong), 0 0 16px 2px color-mix(in oklab, var(--color-accent) 55%, transparent)",
                }}
            />
        ) : null;

    // Legal target of the spell/ability on the stack currently choosing targets
    // (CR 601.2c). The soft OUTER glow ADR 0103 §8 still allows for a candidate,
    // in the `signal-target` the inset candidate ring uses, so a targetable
    // permanent and a targetable player nameplate still read identically
    // (player-nameplate.tsx). It MUST be the card wrapper's OWN box-shadow, not
    // a child overlay: the wrapper is `overflow-hidden`, which clips a
    // descendant's outward box-shadow but never its own. Since #2724 the state
    // ring beside it is an inset pseudo-element, so the two no longer compete —
    // the glow is purely outward and the ring purely inward.
    const TARGET_GLOW =
        "0 0 16px 1px color-mix(in oklab, var(--color-signal-target) 55%, transparent)";
    // Base chrome (black hairline + drop shadow) the wrapper normally gets from
    // Tailwind; inlined here so the glow composes with it instead of the inline
    // `boxShadow` wiping the Tailwind shadow out.
    const BASE_SHADOW =
        "0 0 0 1px rgba(0,0,0,0.4), 0 6px 16px rgba(0,0,0,0.55)";

    // Phased-out permanents are set aside (CR 702.26) — no abilities, no clicks.
    const abilities = phased ? [] : (activatableAbilities ?? []);
    const hasAbilities = abilities.length > 0;
    const activate = (abilityId: string, keepPriority: boolean) =>
        onActivateAbility?.(abilityId, keepPriority);
    const ability = useAbilityCardClick(abilities, activate);

    const damage = card.damageMarked ?? 0;

    const ptDamageStack = creature ? (
        <div className="absolute bottom-1.5 right-1.5 flex flex-col items-end gap-0.5 pointer-events-none z-20">
            {damage > 0 && (
                <div className="bg-danger px-1 py-0.5 rounded-xs text-[10px] font-bold text-white leading-none drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]">
                    {damage}
                </div>
            )}
            <div className="bg-black p-0.5 rounded-xs text-[10px] font-bold text-white leading-none drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]">
                {effectivePower(allPlayers, card, emblems)}/
                {effectiveToughness(allPlayers, card, emblems)}
            </div>
        </div>
    ) : null;

    // The combat-group numeric badge (`vs.badge`) is intentionally NOT rendered
    // on the spatial board: the blocker → attacker arrows now convey combat
    // grouping, so the numeric indicator is redundant here (it stays on the
    // classic board).

    const darkenOverlay =
        (vs.interactive && !vs.enabled) || vs.dimmed ? (
            <div className="absolute inset-0 bg-black/40 card-corner pointer-events-none z-10" />
        ) : null;

    const colorDisplay = getEffectiveColorDisplay(card);

    const colorOverrideOverlay = colorDisplay ? (
        <div
            className="absolute inset-0 pointer-events-none card-corner z-[5]"
            style={{
                boxShadow: `inset 0 0 0 4px ${colorDisplay.inner}`,
                background: [
                    `linear-gradient(180deg, ${colorDisplay.inner} 0%, transparent 22%)`,
                    `linear-gradient(0deg, ${colorDisplay.inner} 0%, transparent 22%)`,
                    `linear-gradient(90deg, ${colorDisplay.inner} 0%, transparent 18%)`,
                    `linear-gradient(270deg, ${colorDisplay.inner} 0%, transparent 18%)`,
                ].join(", "),
            }}
        />
    ) : null;

    // Tapped state rotates the visual only — a bare rotate(90deg) on a 5:7
    // portrait box swaps its bounding box to 7:5 landscape, wider than the
    // card's own unrotated slot. Three mechanisms were tried and rejected
    // before this one (issue #1994, PR #2279 review rounds 1-3):
    //
    //   1. Scale the rotated box back down by the card's own aspect ratio
    //      (5/7) to fit the unrotated slot. Restored the footprint, but
    //      rendered EVERY tapped permanent 29% smaller linear (51% area) on
    //      EVERY viewport — desktop included, where the occlusion this issue
    //      fixes never occurs — and every attacking creature in combat
    //      (attackers are tapped). Undisclosed global visual regression.
    //   2. Reserve the wider rotated footprint in the ROW LAYOUT instead
    //      (`tappedFootprintWidth`, since removed from `board-layout.ts`).
    //      Measured (round-2 review) to make the REPORTED bug strictly
    //      WORSE: slots paint in DOM order with `z-index: auto`, so a tapped
    //      card's overhang can only ever cover its LEFT neighbour (the right
    //      overhang is painted over by the next slot and never stole
    //      anything) — the reservation protected the harmless right side and
    //      left the harmful left side untouched. Worse, `widths[]` doesn't
    //      create row width, it SPENDS it: inflating one item's reservation
    //      shrinks the row's one shared inter-item gap for every card in it,
    //      so on a phone battlefield already in the overlap/MIN_SCALE regime,
    //      reserving 48px per tapped land compressed the whole row — the
    //      untapped fetchland the issue reports went from 408 clickable px²
    //      on `main` to 0 on that branch.
    //   3. `pointer-events: none` on `[data-tap-visual]` with {@link
    //      CardTilt3D} still WRAPPING it (round 3). Fixed the reported bug —
    //      measured, every card in the row lands on hit-test geometry
    //      identical to the all-untapped control — but `pointer-events` is
    //      inherited DOWNWARD: CardTilt3D's own root (`[data-card-tilt-
    //      root]`) lived INSIDE `[data-tap-visual]`, so it and everything
    //      nested under it (CardImage, CardPreview) inherited `none` too.
    //      That silently killed hover-tilt, hover-dwell preview, right-click
    //      pinned preview and mobile long-press preview on EVERY tapped
    //      permanent on EVERY viewport (including desktop, where the
    //      occlusion this issue fixes never occurs), and un-disclosed a
    //      second regression: both `contextmenu` `preventDefault()` sites
    //      (CardTilt3D's own, and `card-preview.tsx`'s) were inside the now-
    //      inert subtree, so Chrome's NATIVE context menu started popping on
    //      right-click of any tapped permanent (`ui/context-menu.tsx`
    //      deliberately leaves a genuine right-click un-prevented, expecting
    //      the preview's own listener to own it). Same shape as round 1: a
    //      global desktop-visible cost paid to fix a phone-only bug.
    //
    // This version keeps round 3's win (spends no row width, fixes both
    // overhang sides, `cardContent` never rotates and is IDENTICAL tapped or
    // not) and closes its regression by re-ordering the nesting: {@link
    // CardTilt3D} now WRAPS `[data-tap-visual]` instead of living inside it.
    // `[data-card-tilt-root]` therefore sits OUTSIDE the inert layer — its
    // own computed `pointer-events` no longer inherits `none` from a
    // rotated descendant, so its `onPointerMove`/`onPointerLeave`/
    // `onContextMenu` (and `card-preview.tsx`'s listeners, bound via
    // `closest("[data-card-tilt-root]")` onto that same element) keep
    // firing. `[data-tap-visual]` still rotates and still goes
    // `pointer-events: none` while tapped — a `pointer-events: none` element
    // can never itself be hit-tested, so a click/hover anywhere in the
    // overhang still falls straight through it to whatever is genuinely
    // painted underneath (typically a neighbour's own unrotated box) instead
    // of this card stealing it; a point in the rotated overhang still
    // resolves to the NEIGHBOUR, because the neighbour's own tilt root sits
    // there, unaffected by this card's inert layer.
    //
    // Accepted, disclosed cost: mobile long-press preview is bound as React
    // `onTouch*` props directly on `CardPreview`'s own container (inside
    // `card-preview.tsx`), which — unlike the pointer/contextmenu listeners
    // — still lives INSIDE `[data-tap-visual]` (the art has to rotate with
    // the card). `card-preview.tsx` re-binds those handlers imperatively on
    // the same `[data-card-tilt-root]` ancestor the other listeners use, so
    // long-press is restored too — see that file's own comment.
    const tapRotationDeg = card.isTapped ? TAP_ROTATION_DEG : 0;
    const tapTransform = card.isTapped
        ? `rotate(${TAP_ROTATION_DEG}deg)`
        : undefined;

    // Combat lift (#1770 follow-up from #1802): landscape-compact re-derives
    // the desktop `translate-y-8` class as a proportional inline `translate`
    // instead of applying it, so a declared attacker's lift stays a constant
    // fraction of the card it is lifting rather than overshooting a small
    // card's midline. `combatOffset` itself still comes from the SHARED
    // `useBattlefieldVisualState` (desktop/portrait/landscape all compute
    // combat involvement identically) — only its rendering forks here.
    const liftDirection = compactCardHeight
        ? landscapeCombatLiftDirection(vs.combatOffset)
        : 0;
    const compactLiftTranslate =
        liftDirection !== 0 && compactCardHeight
            ? `0 ${liftDirection * landscapeAttackerLiftPx(compactCardHeight)}px`
            : undefined;
    const combatOffsetClassName = compactCardHeight ? "" : vs.combatOffset;

    // Cursor affordance mirrors the classic battlefield card: a pointer when
    // the permanent is interactive and enabled, not-allowed when interactive
    // but blocked, default otherwise (#272).
    const cursorClass = onClick
        ? vs.interactive
            ? vs.enabled
                ? "cursor-pointer"
                : "cursor-not-allowed"
            : "cursor-pointer"
        : "";

    // Base card chrome: a black hairline ring + drop shadow, ALWAYS present.
    //
    // It used to be dropped whenever a state ring was present, because the
    // hairline and the state ring were the same CSS property (`--tw-ring-color`)
    // and Tailwind's class-name ordering decided the winner: `ring-accent/40`
    // sorts BEFORE `ring-black/40` (verified in the built CSS: byte 73433 vs
    // 73695), so every accent-coloured candidate ring on this board was painted
    // BLACK — invisible — while `ring-danger`/`ring-signal-self` sorted after
    // black and showed. Issue #2724 moved state rings onto an inset
    // pseudo-element (`.card-ring`, ADR 0103 §8), which is a different property
    // on a different box: nothing contends any more, so the card keeps its
    // outline in every state and the hairline no longer has to be sacrificed to
    // show a ring. The `targetGlow` branch only ADDS its outward glow to the
    // same shadow stack.
    const baseChrome =
        "ring-1 ring-black/40 shadow-[0_6px_16px_rgba(0,0,0,0.55)]";

    const phasedBadge = phased ? (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none z-20">
            <span className="bg-black/75 px-1.5 py-0.5 rounded-xs text-[9px] font-bold uppercase tracking-wide text-white leading-none">
                Phased
            </span>
        </div>
    ) : null;

    // `CardTilt3D` wraps `[data-tap-visual]` (not the other way around, see
    // the `tapTransform` comment above): its own root (`[data-card-tilt-
    // root]`) must sit OUTSIDE the inert rotated layer so its pointer
    // listeners — and `card-preview.tsx`'s, bound onto the same element —
    // keep receiving events on a tapped permanent.
    //
    // The cost of that arrangement is that the tilt element is NOT rotated
    // while the face beneath it is, so the hover effect would be computed in
    // the slot's frame while the art sits in the card's (#2551). It is a frame
    // problem, not a DOM one: `visualRotationDeg` hands the tilt the rotation
    // applied below it — the same `TAP_ROTATION_DEG` `[data-tap-visual]` uses,
    // never a second literal — and it re-expresses both the tilt axes and the
    // glare box in the card's own frame without moving anywhere.
    const inner = (
        <CardTilt3D visualRotationDeg={tapRotationDeg}>
            <div
                data-tap-visual
                className="relative w-full h-full transition duration-250"
                style={{
                    transform: tapTransform,
                    pointerEvents: card.isTapped ? "none" : undefined,
                }}
            >
                <div
                    className={`relative w-full h-full card-corner overflow-hidden ${baseChrome} ${vs.ringClass}`}
                    style={
                        vs.targetGlow
                            ? { boxShadow: `${TARGET_GLOW}, ${BASE_SHADOW}` }
                            : undefined
                    }
                >
                    <CardImage card={card} sizes="120px" includeThumb={false} />
                    {colorOverrideOverlay}
                    {darkenOverlay}
                    {highlightRing}
                    {phasedBadge}
                    <CounterBadges card={card} />
                    {!phased && <SummoningSicknessBadge card={card} />}
                    <NotedManaBadge card={card} />
                    <ManualNoteBadge card={card} />
                    {ptDamageStack}
                    <PlaneswalkerLoyaltyBadge card={card} />
                </div>
            </div>
        </CardTilt3D>
    );

    // The clickable element binds tap/pay `onClick` normally; when the permanent
    // has activatable abilities it instead binds the ability gesture handlers
    // (touch → affordance, desktop → left-click menu) and the shared
    // `ActivatableAbilityMenu` wraps it — identical affordance to the classic
    // board (#278).
    const clickHandlers = phased
        ? {}
        : hasAbilities
          ? {
                onClick: (e: React.MouseEvent) => {
                    // Touch first: `ability.onClick` recognises the tap it was
                    // armed for by `onTouchStart`, opens the action sheet (or
                    // fires a lone ability) and marks the event handled. That
                    // branch is IDENTICAL on both policies.
                    ability.onClick(e);
                    if (!clickActsWithAbilities || e.defaultPrevented) return;
                    // Desktop, Manual Board only (#2169): `ability.onClick`
                    // returned without preventing, so this click still reaches
                    // `ContextMenuTrigger` and opens the verb menu — and the
                    // permanent's own primary action (tap / untap) fires too,
                    // which is exactly what the hand-written manual board did.
                    onClick?.(e);
                },
                onTouchStart: ability.onTouchStart,
            }
          : { onClick };

    const cardContent = (
        <div
            data-arrow-anchor-permanent={card.id}
            data-tapped={card.isTapped ? "true" : undefined}
            data-phased={phased ? "true" : undefined}
            className={`relative w-full h-full ${combatOffsetClassName} ${
                phased ? "cursor-default pointer-events-none" : cursorClass
            } transition duration-250`}
            style={{
                // NEVER rotated — this is the interactive box (click/pointer
                // handlers below), and its box must be identical tapped or
                // not (see the `tapTransform` comment above). The visual
                // rotation lives one layer deeper, on `data-tap-visual`.
                translate: compactLiftTranslate,
                opacity: phased ? 0.4 : litState === "unlit" ? 0.4 : 1,
                filter: phased ? "grayscale(0.85)" : undefined,
            }}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            {...clickHandlers}
        >
            {/* Cards held in exile by this permanent (Parallax Wave / Banishing
                Light) render as a corner peek-stack BEHIND the host, with a pile
                dialog on click; cast-from-exile (Ice Cauldron / Dauthi) rides on
                each dialog card. Deliberately OUTSIDE `data-tap-visual` below —
                it stays upright and clickable regardless of the host's tap
                state. NOT the same treatment as the counter/summoning-sickness
                badges: those render INSIDE `inner` (i.e. inside
                `data-tap-visual`) and DO rotate with a tapped host on this
                board — this peek-stack is a deliberate exception, chosen so
                the held-card pile stays legible and clickable while tapped,
                at the cost of visually detaching from the rotated art on a
                tapped Ice Cauldron / Banishing Light. See
                `board-battlefield-card.test.tsx`'s
                "peek-stack placement" describe block for the regression
                guard. */}
            {associatedExiled.length > 0 && (
                <AttachedCardsCluster
                    cards={associatedExiled}
                    renderMember={(exiled) => <CardImage card={exiled} />}
                    interactiveMembers={false}
                    pileTitle="Held in exile"
                    renderPileAction={(exiled, onClose) =>
                        exiled.castableFromExileBy === playerId ? (
                            <ExileCastButton
                                card={exiled}
                                onCommitted={onClose}
                            />
                        ) : null
                    }
                />
            )}
            {/* Host paints above the peek-stack (which is z-0) — a plain
                stacking wrapper, NOT the rotation layer itself (issue #1994
                round 4): `[data-tap-visual]` now lives one level deeper,
                INSIDE `inner`'s `CardTilt3D`, so `[data-card-tilt-root]` sits
                outside the inert layer and keeps receiving pointer events on
                a tapped permanent — see the `tapTransform` comment above for
                the full rationale. */}
            <div className="relative z-10 w-full h-full">{inner}</div>
        </div>
    );

    return (
        <ActivatableAbilityMenu
            abilities={abilities}
            onActivate={activate}
            sheetOpen={ability.sheetOpen}
            onSheetClose={ability.onSheetClose}
        >
            {cardContent}
        </ActivatableAbilityMenu>
    );
}
