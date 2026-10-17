import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import LoadingScreen from "~/components/ui/loading-screen";
import CatalogueLoadError from "~/components/ui/catalogue-load-error";
import { useResilientQuery } from "~/hooks/useResilientQuery";
import { hydrateCatalogue } from "~/lib/catalogueArtifact";
import { installShards } from "~/lib/catalogue/definitionShards";
import { manifestShardKeys } from "~/lib/catalogue/manifestShardKeys";

/**
 * The game route's catalogue gate (issue #5615, PRD #5602, ADR 0113
 * Amendments V–VI): the board renders once the shards of the game's
 * Definition Manifest are resident — the hand-written Sets and the compiled
 * shards (issue #5616) of both maindecks, both companions, the viewer's own
 * sideboard — instead of the whole catalogue.
 *
 * ONE ROW PER SEAT THE VIEWER OWNS. `gameReads.getDefinitionManifest` is
 * gated on seat ownership: a 2-player client gets its own row and `null` for
 * the opponent's; a solo client, which follows whoever owes input, owns both
 * seats (`-p1`, `-p2`) and needs both rows (each seat's own sideboard); in a
 * game against the Bot the human owns both handles too. So every seat's row
 * is asked for, and the union of what comes back is installed — once every
 * row has settled, so the board mounts exactly once.
 *
 * `null` MEANS SEVERAL THINGS, and none of them is "wait": the row is
 * written at `chooseFirstPlayer`, so a `pregame` Game has none (the route
 * does not mount this gate before `playing`); a seat the viewer does not own
 * (ignored); a Game built before manifests existed, a finished Game whose
 * rows were deleted, a transient auth gap. A `playing` Game whose OWN row is
 * `null` takes the WHOLE-CATALOGUE fallback, never a gate that waits forever
 * — at worst a download the game did not need.
 *
 * HOLD ONCE. The board is held only until the FIRST Manifest's shards are
 * resident. A later widening (a debug load, which widens every seat's row)
 * installs its shards in the background: unmounting the board on every widen
 * would drop its in-memory state (Yields, the driver's dedupe refs, an open
 * dialog) — and anything the widened state actually names is held by the
 * board itself (`useDefinitionsResident`), card by card. So this gate never
 * has to be right about everything, only about the common case: a game's
 * shards, before its first frame.
 */
export default function DefinitionManifestGate({
    gameId,
    playerId,
    seatIds,
    children,
}: {
    gameId: Id<"games">;
    /** The viewer's seat: whose row decides between "its shards" and the
     *  whole-catalogue fallback. */
    playerId: string;
    /** Every seat of the Game (`games.players[].id`). */
    seatIds: readonly string[];
    children: ReactNode;
}) {
    // Two seats is the shape of every Game; a hook per seat keeps the call
    // order fixed whatever the array holds.
    const first = useResilientQuery(
        api.gameReads.getDefinitionManifest,
        seatIds[0] !== undefined ? { gameId, playerId: seatIds[0] } : "skip"
    );
    const second = useResilientQuery(
        api.gameReads.getDefinitionManifest,
        seatIds[1] !== undefined ? { gameId, playerId: seatIds[1] } : "skip"
    );
    const firstRow = first.data;
    const secondRow = seatIds[1] === undefined ? null : second.data;
    const own = seatIds.indexOf(playerId) === 1 ? secondRow : firstRow;
    // `undefined`: a row is still loading — every row must have settled
    // before the first install, or the board mounts twice.
    const loading = firstRow === undefined || secondRow === undefined;
    const fallback = own === null;
    const keys = useMemo(
        () => manifestShardKeys([firstRow, secondRow]),
        [firstRow, secondRow]
    );
    const keysKey = keys.join(" ");
    const queryError = first.error ?? second.error;

    const [resident, setResident] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (loading || queryError !== null) return;
        let cancelled = false;
        const load = fallback
            ? hydrateCatalogue().then(() => undefined)
            : installShards(keysKey === "" ? [] : keysKey.split(" "));
        load.then(
            () => {
                if (!cancelled) setResident(true);
            },
            (cause: unknown) => {
                if (!cancelled)
                    setError(
                        cause instanceof Error
                            ? cause
                            : new Error(String(cause))
                    );
            }
        );
        return () => {
            cancelled = true;
        };
    }, [loading, queryError, fallback, keysKey, attempt]);

    if (queryError) {
        return (
            <CatalogueLoadError
                error={queryError}
                onRetry={() => {
                    first.retry();
                    second.retry();
                }}
            />
        );
    }
    if (error) {
        return (
            <CatalogueLoadError
                error={error}
                onRetry={() => {
                    setError(null);
                    setAttempt((n) => n + 1);
                }}
            />
        );
    }
    if (!resident) return <LoadingScreen message="Loading cards..." />;
    return <>{children}</>;
}
