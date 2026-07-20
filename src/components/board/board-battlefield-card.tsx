import type { CardInstance } from "~/types/game";
import type { CardVisualState, ActivatableAbility } from "./battlefield-card";
import { useGameContext } from "~/hooks/useGameContext";
import { useArrowHighlight } from "~/hooks/arrowHighlightContext";
import { effectivePower, effectiveToughness } from "~/lib/effective-stats";
import { isCreature } from "~/lib/card-utils";
import { getColorOverrideDisplay } from "~/lib/color-override";
import CardImage from "../cards/card-image";
import CardTilt3D from "./card-tilt-3d";
import CounterBadges from "./counter-badges";
import PlaneswalkerLoyaltyBadge from "./planeswalker-loyalty-badge";
import NotedManaBadge from "./noted-mana-badge";
import AttachedCardsCluster from "./attached-cards-cluster";
import ExileCastButton from "./exile-cast-button";
import ActivatableAbilityMenu from "./activatable-ability-menu";
import { useAbilityCardClick } from "~/hooks/useAbilityCardClick";

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
    /** CR 702.26 — this permanent is phased out (set aside). It stays visible on
     *  its controller's battlefield but rendered dimmed and fully inert: no
     *  click, no ability menu, a "Phased" tag instead of interaction. */
    phased?: boolean;
};

/** Battlefield card for the new spatial board (PRD #249, slice #256).
 *
 *  Carries every board-coupled visual signal a permanent needs to read at a
 *  glance, sourced from the shared pure {@link CardVisualState} computation
 *  (`useBattlefieldVisualState`) so the classic and spatial boards never
 *  diverge:
 *  - combat grouping ring (`vs.ringClass`) + combat-group badge (`vs.badge`),
 *  - tapped rotation (90° visual rotate, layout box unchanged),
 *  - marked damage (CR 120.3) + effective P/T (CR 613, layer 7c) on creatures,
 *  - legal-target / legal-choice highlight rides on `vs.ringClass` during
 *    targeting/choice; a dim overlay marks ineligible/dimmed permanents.
 *
 *  Emits `data-arrow-anchor-permanent` so target arrows
 *  (`target-arrows-overlay.tsx`) attach to this card. Hover tilt + zoom preview
 *  ride along via {@link CardTilt3D} / {@link CardImage} (#253).
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
    phased = false,
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
                className="absolute inset-0 rounded-sm pointer-events-none z-30"
                style={{
                    boxShadow:
                        "0 0 0 2px var(--color-accent-strong), 0 0 16px 2px color-mix(in oklab, var(--color-accent) 55%, transparent)",
                }}
            />
        ) : null;

    // Legal target of the spell/ability on the stack currently choosing targets
    // (CR 601.2c). Same accent-strong ring + glow the player nameplate uses when
    // it is a legal target (player-nameplate.tsx) so a targetable permanent and
    // a targetable player read identically. It MUST be the card wrapper's OWN
    // box-shadow, not a child overlay: the wrapper is `overflow-hidden`, which
    // clips a descendant's outward box-shadow (the glow) but never its own — the
    // same reason the pre-existing `ringClass` rings live on the wrapper itself.
    const TARGET_GLOW =
        "0 0 0 2px var(--color-accent-strong)," +
        " 0 0 16px 1px color-mix(in oklab, var(--color-accent-strong) 45%, transparent)";
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
                <div className="bg-red-600 px-1 py-0.5 rounded-xs text-[10px] font-bold text-white leading-none drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]">
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
            <div className="absolute inset-0 bg-black/40 rounded-sm pointer-events-none z-10" />
        ) : null;

    const colorDisplay = card.colorOverride?.length
        ? getColorOverrideDisplay(card.colorOverride)
        : null;

    const colorOverrideOverlay = colorDisplay ? (
        <div
            className="absolute inset-0 pointer-events-none rounded-[7%] z-[5]"
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

    // Tapped state rotates the visual only; the slot placement (#251/#252) sizes
    // the layout box, so rotation here never reflows neighbors.
    const tapTransform = card.isTapped ? "rotate(90deg)" : undefined;

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

    const phasedBadge = phased ? (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none z-20">
            <span className="bg-black/75 px-1.5 py-0.5 rounded-xs text-[9px] font-bold uppercase tracking-wide text-white leading-none">
                Phased
            </span>
        </div>
    ) : null;

    const inner = (
        <CardTilt3D>
            <div
                className={`relative w-full h-full rounded-sm overflow-hidden ${
                    vs.targetGlow
                        ? ""
                        : "ring-1 ring-black/40 shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
                } ${vs.ringClass}`}
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
                <NotedManaBadge card={card} />
                {ptDamageStack}
                <PlaneswalkerLoyaltyBadge card={card} />
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
          ? { onClick: ability.onClick, onTouchStart: ability.onTouchStart }
          : { onClick };

    const cardContent = (
        <div
            data-arrow-anchor-permanent={card.id}
            data-tapped={card.isTapped ? "true" : undefined}
            data-phased={phased ? "true" : undefined}
            className={`relative w-full h-full ${vs.combatOffset} ${
                phased ? "cursor-default pointer-events-none" : cursorClass
            } transition duration-250`}
            style={{
                transform: tapTransform,
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
                each dialog card. */}
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
            {/* Host paints above the peek-stack (which is z-0). */}
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
