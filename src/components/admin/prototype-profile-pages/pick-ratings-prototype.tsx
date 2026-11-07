// PROTOTYPE — throwaway. Pick Ratings page, second session (2026-11-07):
// rail + table are DECIDED (Card Profiles variant D's form); the open question
// is the DIALOG. `?variant=ladder-pack|ladder|pack|lines|shelf` swaps only the dialog, on
// the same open card, so the variants compare on one card (← → cycle them).
// The first session's ratings variants A/B/C stay in this folder, unmounted.
// Real rows through the real hooks; every write is a local stub.
import { useMemo, useState } from "react";
import { useDraftableSets } from "~/hooks/useLimitedEvent";
import { useScopeCardRatings } from "~/hooks/useCardRatings";
import { useScopeCardProfiles } from "~/hooks/useCardProfiles";
import PrototypeSwitcher from "./prototype-switcher";
import { writeVariant } from "./proto-variants";
import { toProtoRatingCard, type ProtoRatingCard } from "./proto-data";
import RatingsVariantDDialog from "./ratings-variant-d-dialog";
import RatingsDialogLadder from "./ratings-dialog-ladder";
import RatingsDialogPack from "./ratings-dialog-pack";
import RatingsDialogLadderPack from "./ratings-dialog-ladder-pack";
import RatingsDialogLines from "./ratings-dialog-lines";
import RatingsFocusDialog from "./ratings-focus-dialog";
import type { RatingDialogProps } from "./ratings-dialog-shared";

export interface RatingsProtoApi {
    scopes: { setCode: string; label: string }[];
    scope: string | undefined;
    setScope: (s: string) => void;
    cards: ProtoRatingCard[] | undefined;
    setRating: (cardId: string, rating: number | null) => void;
    log: string[];
}

const DIALOGS: {
    key: string;
    name: string;
    component: (p: RatingDialogProps) => React.ReactNode;
}[] = [
    {
        key: "ladder-pack",
        name: "CHOSEN — ladder, pack test as a tab",
        component: RatingsDialogLadderPack,
    },
    {
        key: "ladder",
        name: "Ladder — the scale, with the cards on each rung",
        component: RatingsDialogLadder,
    },
    {
        key: "pack",
        name: "Pack test — where it lands in a real pack",
        component: RatingsDialogPack,
    },
    {
        key: "lines",
        name: "Lines — rank per group, compact rows",
        component: RatingsDialogLines,
    },
    {
        key: "shelf",
        name: "Shelf — baseline, ±0.5 neighbours",
        component: RatingsFocusDialog,
    },
];

function readDialogKey(): string {
    const v = new URLSearchParams(window.location.search).get("variant");
    return DIALOGS.find((d) => d.key === v)?.key ?? DIALOGS[0].key;
}

export default function PickRatingsPrototype() {
    const [dialogKey, setDialogKey] = useState(readDialogKey);
    const draftableSets = useDraftableSets();
    const scopes = useMemo(
        () =>
            (draftableSets ?? [])
                .filter((s) => s.draftable)
                .map((s) => ({
                    setCode: s.setCode,
                    label: s.isCube ? "Vintage Cube" : s.setCode.toUpperCase(),
                }))
                .sort(
                    (a, b) =>
                        Number(b.label === "Vintage Cube") -
                        Number(a.label === "Vintage Cube")
                ),
        [draftableSets]
    );
    const [scope, setScope] = useState<string | undefined>(undefined);
    const resolvedScope = scope ?? scopes[0]?.setCode;
    const wire = useScopeCardRatings(resolvedScope);
    const profiles = useScopeCardProfiles(resolvedScope);
    const [overrides, setOverrides] = useState<Map<string, number | null>>(
        () => new Map()
    );
    const [log, setLog] = useState<string[]>([]);

    const cards = useMemo(() => {
        if (!wire) return undefined;
        const archetypesOf = new Map(
            (profiles ?? []).map((p) => [
                p.cardId,
                (p.dbProfile ?? p.seedProfile)?.archetypes ?? [],
            ])
        );
        return wire.map((w) => {
            const base = {
                ...toProtoRatingCard(w),
                archetypes: archetypesOf.get(w.cardId) ?? [],
            };
            if (!overrides.has(w.cardId)) return base;
            const r = overrides.get(w.cardId) ?? null;
            if (r !== null)
                return { ...base, rating: r, source: "override" as const };
            return {
                ...base,
                rating: base.seedRating ?? base.fallbackRating,
                source:
                    base.seedRating === null
                        ? ("fallback" as const)
                        : ("seed" as const),
            };
        });
    }, [wire, profiles, overrides]);

    const api: RatingsProtoApi = {
        scopes,
        scope: resolvedScope,
        setScope,
        cards,
        log,
        setRating: (cardId, rating) => {
            setOverrides((m) => new Map(m).set(cardId, rating));
            const name =
                cards?.find((c) => c.cardId === cardId)?.name ?? cardId;
            setLog((l) =>
                [`rating ${name} → ${rating ?? "cleared"}`, ...l].slice(0, 30)
            );
        },
    };

    const dialog = DIALOGS.find((d) => d.key === dialogKey) ?? DIALOGS[0];

    return (
        <>
            <RatingsVariantDDialog api={api} Dialog={dialog.component} />
            <PrototypeSwitcher
                variants={DIALOGS.map((d) => ({ key: d.key, name: d.name }))}
                current={dialogKey}
                onChange={(k) => {
                    writeVariant(k);
                    setDialogKey(k);
                }}
            />
        </>
    );
}
