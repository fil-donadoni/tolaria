// PROTOTYPE — throwaway. Dialog "pack": a rating exists to order a pack (ADR
// 0073), so judge it there. A 15-card pack from the scope sorted as the rating
// sorts it, this card in it; clicking another card says "mine goes above that".
// The pick slider shows the context cap live (`contextCapForPick`): a card
// within the cap can go either way, a card outside it is decided by the rating.
// The pack is a uniform sample of the scope: exact for the cube, an
// approximation for a set (no rarity slots).
import { useEffect, useMemo, useState } from "react";
import { Dices } from "lucide-react";
import CardImage from "~/components/cards/card-image";
import CardPreview from "~/components/cards/card-preview";
import { Button } from "~/components/ui/button";
import {
    contextCapForPick,
    DEFAULT_DRAFT_PICKS,
} from "@convex/limited/botDrafter";
import {
    RatingDialogShell,
    RatingStepBar,
    type RatingDialogProps,
} from "./ratings-dialog-shared";
import type { ProtoRatingCard } from "./proto-data";

import { PACK_SIZE, topOfPackChance } from "./ratings-dialog-utils";

function hash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function rng(seed: number) {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function samplePackIds(
    all: readonly ProtoRatingCard[],
    cardId: string,
    roll: number
): string[] {
    const random = rng(hash(cardId) + roll);
    const others = all.filter((c) => c.cardId !== cardId).map((c) => c.cardId);
    for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [others[i], others[j]] = [others[j], others[i]];
    }
    return [cardId, ...others.slice(0, PACK_SIZE - 1)];
}

export default function RatingsDialogPack(props: RatingDialogProps) {
    return (
        <RatingDialogShell props={props}>
            <PackBody {...props} />
        </RatingDialogShell>
    );
}

export function PackBody({ card, all, api }: RatingDialogProps) {
    const [roll, setRoll] = useState(0);
    const [pick, setPick] = useState(1);

    const cardId = card?.cardId;
    useEffect(() => {
        if (!cardId) return;
        const onKey = (e: KeyboardEvent) => {
            const t = e.target;
            if (t instanceof Element && t.closest("input, textarea")) return;
            if (e.key === "r") setRoll((n) => n + 1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [cardId]);

    const packIds = useMemo(
        () => (cardId ? samplePackIds(all, cardId, roll) : []),
        // The pack's membership must not move when a rating moves.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [cardId, roll, all.length]
    );
    const byId = useMemo(() => new Map(all.map((c) => [c.cardId, c])), [all]);
    const pack = packIds
        .map((id) => byId.get(id))
        .filter((c): c is ProtoRatingCard => c !== undefined)
        .sort(
            (a, b) =>
                (b.rating ?? 0) - (a.rating ?? 0) ||
                Number(b.cardId === cardId) - Number(a.cardId === cardId) ||
                a.name.localeCompare(b.name)
        );

    const cap = contextCapForPick(pick, DEFAULT_DRAFT_PICKS);
    const r = card?.rating ?? 0;
    const above = pack.filter((c) => (c.rating ?? 0) > r).length;
    const tied = pack.filter(
        (c) => c.cardId !== cardId && c.rating === r
    ).length;
    const chance = card ? topOfPackChance(all, card) : 0;

    return (
        <>
            {card && (
                <div className="flex flex-col gap-3">
                    <RatingStepBar card={card} api={api} />
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-text-muted">
                        <span>
                            In this pack{" "}
                            <span className="font-mono text-parchment">
                                #{above + 1}
                            </span>{" "}
                            of {pack.length}
                            {tied > 0 && ` (tied with ${tied})`}
                        </span>
                        <span title="Share of random 15-card packs of this scope with no higher-rated card, ties counted as top.">
                            Top of a random pack{" "}
                            <span className="font-mono text-parchment">
                                {Math.round(chance * 100)}%
                            </span>
                        </span>
                        <label className="flex items-center gap-2">
                            Pick{" "}
                            <input
                                type="range"
                                min={1}
                                max={DEFAULT_DRAFT_PICKS}
                                value={pick}
                                onChange={(e) =>
                                    setPick(Number(e.currentTarget.value))
                                }
                                className="w-32"
                            />
                            <span className="font-mono text-parchment">
                                {pick}
                            </span>
                            <span>
                                · context up to{" "}
                                <span className="font-mono text-parchment">
                                    {cap.toFixed(1)}
                                </span>
                            </span>
                        </label>
                        <Button
                            variant="secondary"
                            size="xs"
                            className="ml-auto"
                            onClick={() => setRoll((n) => n + 1)}
                        >
                            <Dices className="size-3.5" /> New pack (r)
                        </Button>
                    </div>
                    <div
                        className="grid gap-1.5"
                        style={{
                            gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
                        }}
                    >
                        {pack.map((c, i) => {
                            const self = c.cardId === card.cardId;
                            const open = Math.abs((c.rating ?? 0) - r) <= cap;
                            return (
                                <CardPreview
                                    key={c.cardId}
                                    cardId={c.cardId}
                                    cardName={c.name}
                                    holdPreview={false}
                                >
                                    <button
                                        type="button"
                                        disabled={self}
                                        onClick={() =>
                                            api.setRating(
                                                card.cardId,
                                                Math.min(
                                                    5,
                                                    (c.rating ?? 0) + 0.5
                                                )
                                            )
                                        }
                                        title={
                                            self
                                                ? c.name
                                                : `${c.name} · click to rate ${card.name} above it`
                                        }
                                        className={
                                            "relative block aspect-5/7 w-full overflow-hidden rounded-md transition " +
                                            (self
                                                ? "ring-2 ring-accent-strong"
                                                : "hover:ring-1 hover:ring-border-subtle") +
                                            (open || self
                                                ? ""
                                                : " opacity-35 hover:opacity-100")
                                        }
                                    >
                                        <CardImage
                                            card={{ id: c.cardId }}
                                            lazy
                                            sizes="132px"
                                        />
                                        <span className="absolute top-1 left-1 rounded-xs bg-black/75 px-1 font-mono text-[11px] text-white">
                                            #{i + 1}
                                        </span>
                                        <span className="absolute top-1 right-1 rounded-xs bg-black/75 px-1 font-mono text-[11px] text-white">
                                            {(c.rating ?? 0).toFixed(1)}
                                        </span>
                                    </button>
                                </CardPreview>
                            );
                        })}
                    </div>
                    <p className="text-[10px] text-text-disabled">
                        Sorted by rating. Bright = within the context cap of
                        this card at this pick, could go either way; dimmed =
                        the rating alone decides. Click a card to rate this one
                        half a point above it.
                    </p>
                </div>
            )}
        </>
    );
}
