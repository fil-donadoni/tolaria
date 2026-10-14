import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import LoadingScreen from "~/components/ui/loading-screen";
import CatalogueLoadError from "~/components/ui/catalogue-load-error";
import { useResilientQuery } from "~/hooks/useResilientQuery";
import { hydrateCatalogue } from "~/lib/catalogueArtifact";
import { installSets } from "~/lib/catalogue/definitionShards";
import { manifestSetCodes } from "~/lib/catalogue/manifestSetCodes";

/**
 * The game route's catalogue gate (issue #5615, PRD #5602, ADR 0113
 * Amendment V): the board renders once the Sets of the game's Definition
 * Manifest are resident — both maindecks, both companions, the viewer's own
 * sideboard — instead of the whole catalogue.
 *
 * ONE ROW PER SEAT THE VIEWER OWNS. `gameReads.getDefinitionManifest` is
 * gated on seat ownership: a 2-player client gets its own row and `null` for
 * the opponent's; a solo client, which follows whoever owes input, owns both
 * seats (`-p1`, `-p2`) and needs both rows (each seat's own sideboard); in a
 * game against the Bot the human owns both handles too. So every seat's row
 * is asked for, and the union of what comes back is installed.
 *
 * `null` MEANS SEVERAL THINGS, and only one of them is "wait": the row is
 * written at `chooseFirstPlayer`, so a `pregame` Game has none (the route
 * does not mount this gate before `playing`). A `playing` Game whose OWN row
 * is `null` was built before manifests existed (a game in flight at deploy):
 * that is the WHOLE-CATALOGUE fallback, never a gate that waits forever.
 *
 * The Manifest widens only on a debug load; a definition outside it reaches
 * the board through `useDefinitionsResident`, which holds the board on its
 * own — so this gate never has to be right about everything, only about the
 * common case: a game's Sets, before its first frame.
 */
export default function DefinitionManifestGate({
    gameId,
    playerId,
    seatIds,
    children,
}: {
    gameId: Id<"games">;
    /** The viewer's seat: whose row decides between "its Sets" and the
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
        seatIds[0] !== undefined
            ? { gameId, playerId: seatIds[0] }
            : "skip"
    );
    const second = useResilientQuery(
        api.gameReads.getDefinitionManifest,
        seatIds[1] !== undefined
            ? { gameId, playerId: seatIds[1] }
            : "skip"
    );
    const firstRow = first.data;
    const secondRow = second.data;
    const own = seatIds.indexOf(playerId) === 1 ? secondRow : firstRow;
    // `null`: a Game that predates manifests — fall back to the whole
    // catalogue.
    const fallback = own === null;
    const codes = useMemo(
        () => manifestSetCodes([firstRow, secondRow]),
        [firstRow, secondRow]
    );
    const codesKey = codes.join(" ");

    const [resident, setResident] = useState<string | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [attempt, setAttempt] = useState(0);

    // `undefined`: still loading.
    const loading = own === undefined;
    useEffect(() => {
        if (loading) return;
        let cancelled = false;
        const load = fallback
            ? hydrateCatalogue().then(() => undefined)
            : installSets(codesKey === "" ? [] : codesKey.split(" "));
        load.then(
            () => {
                if (!cancelled) setResident(fallback ? "*" : codesKey);
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
    }, [loading, fallback, codesKey, attempt]);

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
    // Ready once the current Manifest's Sets (or, on fallback, everything)
    // have been installed; a widened Manifest holds the board again until
    // its new Sets are in.
    const ready = resident !== null && (resident === "*" || resident === codesKey);
    if (!ready) return <LoadingScreen message="Loading cards..." />;
    return <>{children}</>;
}
