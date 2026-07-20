import { useMemo } from "react";
import type { CardInstance, Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useBattlefieldInteraction } from "~/hooks/useBattlefieldInteraction";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useIsPortrait } from "~/hooks/useIsPortrait";
import { isCreature, isLand } from "~/lib/card-utils";
import { tryGetDefinition } from "@convex/cards";
import {
    bandedRowsLayout,
    stackFootprintWidth,
    RIGHT_GUTTER,
} from "~/lib/board-layout";
import { groupBattlefield } from "~/lib/battlefield-stacks";
import SpatialZone, { type SpatialItem } from "./spatial-zone";
import BoardBattlefieldCard from "./board-battlefield-card";
import type { CardVisualState } from "./battlefield-card";
import BattlefieldStack from "./battlefield-stack";
import CombatPanels from "./combat-panels";
import AttachedCardsCluster from "./attached-cards-cluster";
import CardImage from "../cards/card-image";

/** Two battlefield rows: creatures hold the combat line in FRONT (toward the
 *  midline), and everything noncreature — lands plus other permanents (artifacts
 *  / enchantments / planeswalkers) — sits in the BACK row as two blocks: lands
 *  flush-left, other noncreatures flush-right. Both rows live in ONE full-height
 *  zone (no `overflow-hidden` sub-bands that would clip tall cards): {@link
 *  bandedRowsLayout} caps each row's scale to its height slice. `centerYFrac` is
 *  the VIEWER orientation (creatures nearest the top/midline); `SpatialZone`'s
 *  `mirror` flips it for the opponent so both players' creatures sit nearest the
 *  midline. */
const CREATURES_CENTER_Y_FRAC = 0.28;
const BACK_CENTER_Y_FRAC = 0.74;
type BandKey = "creatures" | "back";

/** Neutral visual state for a phased-out permanent (CR 702.26): no combat ring,
 *  no tap-target highlight, not interactive — `BoardBattlefieldCard` reads
 *  `phased` for its dim/inert treatment. */
const INERT_VISUAL: CardVisualState = {
    interactive: false,
    enabled: true,
    dimmed: false,
    combatOffset: "",
    ringClass: "",
    badge: null,
};

type BoardBattlefieldProps = {
    player: Player;
    /** Mirror the opponent's side to the top half. */
    mirror?: boolean;
    "data-testid"?: string;
};

/** Classify a permanent into its battlefield band. Creature-lands (e.g. Dryad
 *  Arbor, animated lands) sit with the creatures, matching the classic board;
 *  everything else (lands + other noncreature permanents) goes to the back row. */
function bandOf(card: CardInstance): BandKey {
    return isCreature(card) ? "creatures" : "back";
}

/** Order within the back row: lands first, then other noncreature permanents,
 *  so "terre + noncreature" read left-to-right consistently. */
function backRowRank(card: CardInstance): number {
    return isLand(card) ? 0 : 1;
}

/** One player's battlefield on the spatial board (PRD #249, slice #256).
 *
 *  Owns the per-player board-coupled visual-state AND interaction computation:
 *  it calls the shared {@link useBattlefieldInteraction} hook ONCE (which itself
 *  composes {@link useBattlefieldVisualState}, #256) and hands each permanent
 *  its {@link CardVisualState} (combat rings, tap, marked damage, legal-target
 *  highlight) plus its click handler to {@link BoardBattlefieldCard}. The
 *  click handler dispatches the SAME mutations as the classic board for tap /
 *  in-payment tap / mana-choice pick (#272); the hook's `overlays` node (the
 *  mana-choice picker + validation toast) is mounted here so the spatial board
 *  surfaces them. Isolating the hook in this component (rather than inside
 *  `board.tsx`'s item builder) keeps the rules-of-hooks contract clean —
 *  the hook runs unconditionally per mounted battlefield.
 *
 *  Cards are split into the {@link BANDS} rows (creatures / others / lands) and
 *  each band is positioned by the shared layout math via its own
 *  {@link SpatialZone}; all bands live in the same `LayoutGroup` so a permanent
 *  that changes band (an animated land, a creature that loses its types) still
 *  FLIP-animates by `slotId` rather than teleporting. */
export default function BoardBattlefield({
    player,
    mirror,
    "data-testid": testId,
}: BoardBattlefieldProps) {
    // Scan every battlefield for cross-controlled auras (CR 303.4). Falls back
    // to this player alone when the context has no roster (minimal test
    // contexts) so own-battlefield auras still resolve and nothing crashes.
    const ctx = useGameContext();
    const allPlayers = useMemo(
        () => (ctx.allPlayers?.length ? ctx.allPlayers : [player]),
        [ctx.allPlayers, player]
    );
    // CR 601.2d — un-stack identical permanents while a divide-as-you-choose
    // selection is in progress, so each instance is individually dialable.
    const divideActive = ctx.pendingTarget?.divideTotal !== undefined;
    // CR 702.26 — permanents this player controls that are phased out. They stay
    // on the board rendered dimmed/inert (never grouped, never interactive)
    // instead of vanishing while set aside.
    const myPhasedCards = useMemo(
        () =>
            (ctx.phasedOutCards ?? []).filter(
                (c) => c.controllerId === player.id
            ),
        [ctx.phasedOutCards, player.id]
    );
    // Single high seam (#335): on portrait the right control column collapses
    // (pod → bottom bar) so the battlefield reclaims the reserved gutter and
    // uses the full screen width. Same hook the controller reads — the gutter
    // and the pod can never disagree about which layout is live.
    const isPortrait = useIsPortrait();
    const {
        getVisualState,
        handleClick,
        handleClickWithEvent,
        getActivatable,
        handleActivateAbility,
        isSelectingOnThisBoard,
        overlays,
    } = useBattlefieldInteraction(player);
    // Un-stack identical permanents while a per-instance battlefield SELECTION
    // is active on this board (a `choose-permanents` pick like Frantic Search's
    // untap, or a sacrifice/exile/tap-other cost pick), so each candidate leaves
    // the fan into its own slot and its selection ring is visible — mirrors the
    // divide-as-you-choose un-stack above.
    const unstackForSelection = divideActive || isSelectingOnThisBoard;
    // Zone-arrival deferral (flight animation): a permanent that just arrived
    // on this battlefield renders as its OWN singleton for the arrival window
    // even when identical stackable neighbours exist — joining the fan now
    // would unmount its shared-layout element (the group's layoutId is the old
    // lead's id) and cut the cross-zone flight short. After the window the
    // arrivals set empties and it merges into the fan normally.
    const recentArrivals = ctx.recentArrivals;
    const arrivalDeferIds = useMemo(() => {
        if (!recentArrivals || recentArrivals.size === 0) return undefined;
        const onBattlefield = new Set<string>();
        for (const c of player.battlefield) {
            if (recentArrivals.has(c.id)) onBattlefield.add(c.id);
        }
        return onBattlefield.size > 0 ? onBattlefield : undefined;
    }, [recentArrivals, player.battlefield]);
    // The client-side choice buffer (a `choose-permanents` selection) is local
    // React state — it does NOT mutate `player.battlefield`, unlike combat /
    // targeting which change server state and thus the card references. So a
    // buffer toggle alone would not invalidate the `orderedItems` memo below,
    // and the cached card nodes (with their baked-in `getVisualState` result)
    // would keep the stale pre-selection ring. Depend on the buffer so a pick
    // recomputes the nodes and the emerald selection ring appears.
    const { buffer: choiceBuffer } = usePendingChoiceBuffer();

    // Attached auras (CR 303.4) are NOT placed as their own slot in the row —
    // they ride ON their host, overlapping up-and-left, exactly as the classic
    // board renders them. The aura's controller may differ from the host's, so
    // scan every battlefield for auras whose host sits on this side (matches
    // `player-battlefield.tsx`'s `attachedAurasByHost`).
    const attachedAurasByHost = useMemo(() => {
        const map = new Map<string, CardInstance[]>();
        const hostsOnThisSide = new Set(player.battlefield.map((c) => c.id));
        for (const p of allPlayers) {
            for (const c of p.battlefield) {
                if (!c.attachedTo) continue;
                if (!hostsOnThisSide.has(c.attachedTo)) continue;
                const bucket = map.get(c.attachedTo);
                if (bucket) bucket.push(c);
                else map.set(c.attachedTo, [c]);
            }
        }
        return map;
    }, [player.battlefield, allPlayers]);

    // Hosts on this side that hold one or more cards in exile (Parallax Wave /
    // Banishing Light — projected `exiledByPermanentId`). Those cards render as
    // a corner peek-stack on the host (`board-battlefield-card.tsx`), so the
    // host — like an aura host — must be lifted above its neighbours.
    const hostsHoldingExile = useMemo(() => {
        const ids = new Set<string>();
        const hostsOnThisSide = new Set(player.battlefield.map((c) => c.id));
        for (const p of allPlayers) {
            for (const c of p.exile) {
                if (
                    c.exiledByPermanentId &&
                    hostsOnThisSide.has(c.exiledByPermanentId)
                )
                    ids.add(c.exiledByPermanentId);
            }
        }
        return ids;
    }, [player.battlefield, allPlayers]);

    // A host carrying attached satellites (auras or exile-held cards) has an
    // overhanging peek-stack + ×N badge that must paint OVER neighbouring cards,
    // so its slot rides at a raised resting z (below the drag lift's 50).
    const hostHasAttachments = (cardId: string) =>
        attachedAurasByHost.has(cardId) || hostsHoldingExile.has(cardId);

    // Auras whose host exists on the board fold into that host's slot (above);
    // ungrouped leftovers (host gone / attachedTo unset) still get their own slot
    // so they never vanish.
    const hostExistsAnywhere = useMemo(() => {
        const ids = new Set<string>();
        for (const p of allPlayers)
            for (const c of p.battlefield) ids.add(c.id);
        return ids;
    }, [allPlayers]);

    function renderCard(card: CardInstance) {
        return (
            <BoardBattlefieldCard
                card={card}
                vs={getVisualState(card)}
                onClick={(e) => handleClickWithEvent(card, e)}
                activatableAbilities={getActivatable(card)}
                onActivateAbility={(abilityId, keepPriority) =>
                    handleActivateAbility(card.id, abilityId, keepPriority)
                }
            />
        );
    }

    // CR 702.26 — a phased-out permanent renders dimmed and fully inert (no
    // interaction state, no click, no ability menu). It uses a neutral visual
    // state so `BoardBattlefieldCard` skips every combat/target overlay.
    function renderPhasedCard(card: CardInstance): SpatialItem {
        return {
            key: `phased:${card.id}`,
            node: <BoardBattlefieldCard card={card} vs={INERT_VISUAL} phased />,
        };
    }

    /** Render a single host permanent with its attached auras (CR 303.4) as a
     *  corner peek-stack BEHIND the host ({@link AttachedCardsCluster}): the
     *  front aura sits in the top-left overhang and each further one peeks a
     *  sliver behind it, with a ×N badge and a click-to-open pile dialog showing
     *  every aura. Replaces the old cascade that hid all but the last aura. A
     *  host is always "altered" per `groupBattlefield`, so it only ever appears
     *  as a singleton group.
     *
     *  The peek slivers open the pile dialog on click (they render aura ART, not
     *  the interactive board card, so a tap anywhere on the fan opens the
     *  reveal); the dialog then routes a card click to `handleClick` so a
     *  specific aura buried in the stack can still be targeted (Disenchant). The
     *  host itself stays fully interactive (rendered via `renderCard` at z-10). */
    function renderHostWithAuras(card: CardInstance): React.ReactNode {
        const auras = attachedAurasByHost.get(card.id);
        if (!auras?.length) return renderCard(card);
        const hostName = tryGetDefinition(card.card.id)?.name ?? "permanent";
        return (
            <div className="relative w-full h-full">
                <AttachedCardsCluster
                    cards={auras}
                    renderMember={(aura) => <CardImage card={aura} />}
                    interactiveMembers={false}
                    pileTitle={`Attached to ${hostName}`}
                    onPileCardClick={handleClick}
                />
                {/* Host paints above the peek-stack (which is z-0). */}
                <div className="relative z-10 w-full h-full">
                    {renderCard(card)}
                </div>
            </div>
        );
    }

    /** Turn one grouped band entry — a singleton or a fanned permanent stack
     *  (PRD #621, #623) — into a single laid-out {@link SpatialItem}. A singleton
     *  renders exactly as before (host+auras path included); a stack occupies the
     *  SAME one-card footprint slot and renders its members as a fan via
     *  {@link BattlefieldStack}. */
    function groupToItem(group: {
        key: string;
        isStack: boolean;
        members: CardInstance[];
    }): SpatialItem {
        if (!group.isStack) {
            const host = group.members[0];
            return {
                key: group.key,
                node: renderHostWithAuras(host),
                // Lift a host with attached satellites over its neighbours so its
                // corner peek-stack / ×N badge is not hidden behind them.
                zIndex: hostHasAttachments(host.id) ? 30 : undefined,
                arrivalGlow: arrivalDeferIds?.has(group.key) === true,
            };
        }
        return {
            key: group.key,
            node: (
                <BattlefieldStack
                    members={group.members}
                    renderMember={renderCard}
                />
            ),
        };
    }

    // Hosts that get their own slot (auras fold into their host above), grouped
    // into the creature row and the back row, concatenated front-to-back so the
    // layout closure below can place each row. The back row is ordered lands
    // first, then other noncreature permanents — lands cluster left, others
    // right (a two-block split row).
    const {
        orderedItems,
        creatureCount,
        landCount,
        otherCount,
        creatureWidths,
        landWidths,
        otherWidths,
    } = useMemo(() => {
        const creatures: CardInstance[] = [];
        const lands: CardInstance[] = [];
        const others: CardInstance[] = [];
        for (const card of player.battlefield) {
            if (card.attachedTo && hostExistsAnywhere.has(card.attachedTo)) {
                continue;
            }
            if (bandOf(card) === "creatures") creatures.push(card);
            else if (backRowRank(card) === 0) lands.push(card);
            else others.push(card);
        }
        // Collapse identical, interchangeable permanents into fanned
        // permanent stacks BEFORE layout (PRD #621, #623). Group each band
        // independently so a stack never spans the creature/back-row split;
        // each resulting group (singleton OR stack) takes exactly one layout
        // slot. CR 601.2d — while a divide-as-you-choose selection is active
        // (Pyrokinesis), un-stack so every identical instance gets its own slot
        // and its own on-card damage stepper.
        const creatureGroups = groupBattlefield(
            creatures,
            attachedAurasByHost,
            unstackForSelection,
            arrivalDeferIds
        );
        const landGroups = groupBattlefield(
            lands,
            attachedAurasByHost,
            unstackForSelection,
            arrivalDeferIds
        );
        const otherGroups = groupBattlefield(
            others,
            attachedAurasByHost,
            unstackForSelection,
            arrivalDeferIds
        );
        // A fanned stack is wider than one card, so each group reserves its own
        // footprint width in the row (issue #977) — otherwise a 6-card fan
        // overflows its slot and covers the next permanent's click target.
        const widthsOf = (groups: { members: CardInstance[] }[]) =>
            groups.map((g) => stackFootprintWidth(g.members.length));
        // CR 702.26 — phased-out permanents join their band as inert singletons
        // (never grouped/stacked), appended AFTER the live groups so they sit at
        // the tail of the row. Each reserves one card's footprint width.
        const phasedCreatures: CardInstance[] = [];
        const phasedLands: CardInstance[] = [];
        const phasedOthers: CardInstance[] = [];
        for (const card of myPhasedCards) {
            if (bandOf(card) === "creatures") phasedCreatures.push(card);
            else if (backRowRank(card) === 0) phasedLands.push(card);
            else phasedOthers.push(card);
        }
        const singleWidths = (cards: CardInstance[]) =>
            cards.map(() => stackFootprintWidth(1));
        const creatureItems = [
            ...creatureGroups.map(groupToItem),
            ...phasedCreatures.map(renderPhasedCard),
        ];
        const landItems = [
            ...landGroups.map(groupToItem),
            ...phasedLands.map(renderPhasedCard),
        ];
        const otherItems = [
            ...otherGroups.map(groupToItem),
            ...phasedOthers.map(renderPhasedCard),
        ];
        // Order: creatures, then back row = lands (left block) then others (right).
        const ordered: SpatialItem[] = [
            ...creatureItems,
            ...landItems,
            ...otherItems,
        ];
        return {
            orderedItems: ordered,
            creatureCount: creatureItems.length,
            landCount: landItems.length,
            otherCount: otherItems.length,
            creatureWidths: [
                ...widthsOf(creatureGroups),
                ...singleWidths(phasedCreatures),
            ],
            landWidths: [...widthsOf(landGroups), ...singleWidths(phasedLands)],
            otherWidths: [
                ...widthsOf(otherGroups),
                ...singleWidths(phasedOthers),
            ],
        };
        // `groupToItem`/`renderCard` close over the per-render interaction
        // handlers; they are intentionally recomputed each render (cheap) —
        // the heavy grouping deps are the battlefield and host set.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        player.battlefield,
        hostExistsAnywhere,
        attachedAurasByHost,
        unstackForSelection,
        choiceBuffer,
        myPhasedCards,
        arrivalDeferIds,
    ]);

    // One full-height zone; the layout stacks the creature row (centered) over
    // the back row (lands flush-left, other noncreatures flush-right) so nothing
    // is clipped vertically (see BANDS doc). Both seats reserve a matching
    // `RIGHT_GUTTER` (#334) so the flush-right back-row block ends before the
    // right control column (opponent piles · stack · pod · viewer piles) and no
    // permanent is hidden under the controller pod. The opponent reserves it for
    // symmetry even though only the viewer side hosts the pod.
    function layout(_count: number, width: number, height: number) {
        return bandedRowsLayout({
            bands: [
                {
                    count: creatureCount,
                    centerYFrac: CREATURES_CENTER_Y_FRAC,
                    widths: creatureWidths,
                },
                {
                    split: { left: landCount, right: otherCount },
                    centerYFrac: BACK_CENTER_Y_FRAC,
                    leftWidths: landWidths,
                    rightWidths: otherWidths,
                },
            ],
            width,
            height,
            // Portrait drops the gutter to 0 so both rows span the full width;
            // landscape/desktop keeps the reserved control-column gutter.
            rightGutter: isPortrait ? 0 : RIGHT_GUTTER,
        });
    }

    return (
        <>
            <SpatialZone
                items={orderedItems}
                layout={layout}
                mirror={mirror}
                anchorKind="permanent"
                // Attacking creatures lift toward the midline (`-translate-y-8`
                // / `translate-y-8`); without this the card top is clipped by
                // the zone's `overflow-hidden` box. Let lifted cards paint
                // outside the band instead (same fix the hand zone uses, #271).
                overflowVisible
                data-testid={testId}
                className="mx-3"
            />
            {/* Combat declaration / damage modals (#281). The per-card combat
            clicks (toggleAttacker / selectBlocker / assignBlockerTarget) live
            in the hook's handler above; these are the separate, non-click-driven
            band-formation and damage-assignment panels, gated to the right
            combat sub-step — the SAME panels the classic board mounts. */}
            <CombatPanels player={player} />
            {overlays}
        </>
    );
}
