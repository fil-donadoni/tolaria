import type { EmblemInstance } from "@convex/cards/types";
import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { stackFanOffset, STACK_COUNT_BADGE_MIN } from "~/lib/board-layout";
import BoardEmblem from "./board-emblem";

/** Command-zone emblem slot for one player (CR 114, issue #1221) — sits beside
 *  the library/graveyard/exile piles and the companion (`board-piles.tsx`).
 *  Emblems are owner-scoped: `GameState.emblems` is a single flat list on the
 *  wire, so this filters it to the emblems this player owns. Renders nothing
 *  when the player controls no emblem — the common case, so it adds no chrome
 *  until a planeswalker ultimate actually creates one. Reads the list from
 *  {@link useGameContext} rather than prop-drilling GameState (frontend rule).
 *  CR 114.4 — emblems never leave, so this slot only ever grows during a game.
 *
 *  Identical emblems (same `emblemId` — a planeswalker ultimated twice) are
 *  fanned into one overlapping slot, mirroring the identical-permanent stacks
 *  on the battlefield (PRD #621, {@link stackFanOffset}). Emblems carry no
 *  tap/counter/attachment state (CR 114.4), so the identity key is just
 *  `emblemId` with none of the battlefield's "altered permanent ejects from the
 *  stack" exceptions, and — since an emblem never changes zone — no FLIP
 *  shared-layout identity is needed. */
export default function PlayerEmblems({ player }: { player: Player }) {
    const { emblems } = useGameContext();
    const owned = (emblems ?? []).filter((e) => e.ownerId === player.id);
    if (owned.length === 0) return null;

    const groups = groupByEmblemId(owned);

    return (
        <div
            data-testid={`emblems-${player.id}`}
            className="flex flex-row-reverse gap-2"
        >
            {groups.map((group) => (
                <EmblemStack key={group[0].emblemId} members={group} />
            ))}
        </div>
    );
}

/** One fanned slot of identical emblems (or a lone emblem). Fixed-footprint:
 *  the slot reserves exactly `card-w-sm + (n-1)·offset` so a wide fan never
 *  reflows its neighbours (PRD #621 fixed-footprint rule). A `×N` count badge
 *  appears once the fan is dense enough that not every member reads at a glance
 *  ({@link STACK_COUNT_BADGE_MIN}). */
function EmblemStack({ members }: { members: EmblemInstance[] }) {
    const n = members.length;

    if (n === 1) {
        return (
            <div className="relative w-(--card-w-sm) aspect-5/7">
                <BoardEmblem emblem={members[0]} />
            </div>
        );
    }

    const offset = stackFanOffset(n);
    return (
        <div
            data-emblem-stack={members[0].emblemId}
            data-stack-size={n}
            className="relative"
            // A fan is WIDER than one card but exactly ONE CARD TALL: its
            // members are absolutely positioned card-sized tiles. Deriving the
            // wrapper's height from its full fan width (`aspect-5/7`) made the
            // slot taller than the cards inside it and, in a stretch-aligned
            // pile row, re-shaped every neighbouring tile with it.
            style={{
                width: `calc(var(--card-w-sm) + ${(n - 1) * offset}px)`,
                height: "calc(var(--card-w-sm) * 7 / 5)",
            }}
        >
            {members.map((emblem, i) => (
                <div
                    key={emblem.id}
                    className="absolute top-0 w-(--card-w-sm) aspect-5/7 transition-transform"
                    style={{ left: `${i * offset}px`, zIndex: 10 + i }}
                >
                    <BoardEmblem emblem={emblem} />
                </div>
            ))}
            {n >= STACK_COUNT_BADGE_MIN && (
                <div
                    data-emblem-count
                    className="absolute top-1.5 -right-1.5 z-modal-top pointer-events-none rounded-full bg-black/85 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white ring-1 ring-white/30 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                >
                    ×{n}
                </div>
            )}
        </div>
    );
}

/** Bucket emblems into runs of identical `emblemId`, preserving first-seen
 *  order so the command zone is stable across renders (emblems only ever
 *  append, CR 114.4). */
function groupByEmblemId(emblems: EmblemInstance[]): EmblemInstance[][] {
    const order: string[] = [];
    const byId = new Map<string, EmblemInstance[]>();
    for (const emblem of emblems) {
        const bucket = byId.get(emblem.emblemId);
        if (bucket) {
            bucket.push(emblem);
        } else {
            byId.set(emblem.emblemId, [emblem]);
            order.push(emblem.emblemId);
        }
    }
    return order.map((id) => byId.get(id)!);
}
