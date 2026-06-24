import { useMemo } from "react";
import type { CardInstance, Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useBattlefieldInteraction } from "~/hooks/useBattlefieldInteraction";
import { useIsPortrait } from "~/hooks/useIsPortrait";
import { isCreature, isLand } from "~/lib/card-utils";
import { bandedRowsLayout, RIGHT_GUTTER } from "~/lib/board-layout";
import { groupBattlefield } from "~/lib/battlefield-stacks";
import SpatialZone, { type SpatialItem } from "./spatial-zone";
import BoardBattlefieldCard from "./board-battlefield-card";
import BattlefieldStack from "./battlefield-stack";
import CombatPanels from "./combat-panels";

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
    // Single high seam (#335): on portrait the right control column collapses
    // (pod → bottom bar) so the battlefield reclaims the reserved gutter and
    // uses the full screen width. Same hook the controller reads — the gutter
    // and the pod can never disagree about which layout is live.
    const isPortrait = useIsPortrait();
    const {
        getVisualState,
        handleClickWithEvent,
        getActivatable,
        handleActivateAbility,
        overlays,
    } = useBattlefieldInteraction(player);

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

    /** Render a single host permanent with its attached auras pinned up-and-left
     *  (CR 303.4) — unchanged from the per-card path. A host is always "altered"
     *  per `groupBattlefield`, so it only ever appears as a singleton group. */
    function renderHostWithAuras(card: CardInstance): React.ReactNode {
        const auras = attachedAurasByHost.get(card.id);
        if (!auras?.length) return renderCard(card);
        // Host slot carries its auras as overlays pinned up-and-left, so they
        // track the host through the spring/tilt motion. The host paints last
        // (on top); each extra aura fans further out.
        return (
            <div className="relative w-full h-full">
                {auras.map((aura, i) => (
                    <div
                        key={aura.id}
                        className="absolute w-full h-full"
                        style={{
                            top: `-${22 * (i + 1)}%`,
                            left: `-${22 * (i + 1)}%`,
                        }}
                    >
                        {renderCard(aura)}
                    </div>
                ))}
                {renderCard(card)}
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
            return {
                key: group.key,
                node: renderHostWithAuras(group.members[0]),
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
    const { orderedItems, creatureCount, landCount, otherCount } =
        useMemo(() => {
            const creatures: CardInstance[] = [];
            const lands: CardInstance[] = [];
            const others: CardInstance[] = [];
            for (const card of player.battlefield) {
                if (
                    card.attachedTo &&
                    hostExistsAnywhere.has(card.attachedTo)
                ) {
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
            // slot, so the row math is unchanged — only the slot COUNT shrinks.
            const creatureGroups = groupBattlefield(
                creatures,
                attachedAurasByHost
            );
            const landGroups = groupBattlefield(lands, attachedAurasByHost);
            const otherGroups = groupBattlefield(others, attachedAurasByHost);
            // Order: creatures, then back row = lands (left block) then others (right).
            const ordered: SpatialItem[] = [
                ...creatureGroups,
                ...landGroups,
                ...otherGroups,
            ].map(groupToItem);
            return {
                orderedItems: ordered,
                creatureCount: creatureGroups.length,
                landCount: landGroups.length,
                otherCount: otherGroups.length,
            };
            // `groupToItem`/`renderCard` close over the per-render interaction
            // handlers; they are intentionally recomputed each render (cheap) —
            // the heavy grouping deps are the battlefield and host set.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [player.battlefield, hostExistsAnywhere, attachedAurasByHost]);

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
                },
                {
                    split: { left: landCount, right: otherCount },
                    centerYFrac: BACK_CENTER_Y_FRAC,
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
