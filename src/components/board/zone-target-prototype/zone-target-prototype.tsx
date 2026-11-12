// PROTOTYPE (zone-target highlight) — throwaway, never merged (branch
// prototype/zone-target-highlight). Question: when a spell/ability on the
// stack targets cards in a graveyard (or exile), the arrow lands on the PILE —
// how does the board show WHICH cards are targeted?
//
// Round 2 (owner feedback 2026-11-12): A dropped (no visual link source →
// target); B/C/D reworked as B2/C2/D2. Shared by every variant:
//   - hover focus: pointing at a relationship (stack row, source permanent,
//     drawn target, pile) veils the rest of the board and dims the other
//     arrows/targets, leaving source + arrow + targets lit;
//   - targets are marked as INFORMATION (reticle), never with the white ring
//     that means "interactable" in our UX vocabulary.
//
//   /game?zoneProto=1&variant=<B2|C2|D2>
// Overlays sit at z 75-79: above the board, the stack panel (65) and the
// banners (70), always BELOW context menus / popovers (z-modal, 100).
// The bar's "load" buttons put a REAL scenario (prototype-scenarios.ts) into
// the current game: 1-item stack, multi-target, big stack. Dev builds only.
// Round-1 variants: commit da61fe741.
import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { normalizeScenarioSpec } from "@convex/debugScenarioSpec";
import { useGameContext } from "~/hooks/useGameContext";
import { PROTO_SCENARIOS } from "./prototype-scenarios";
import type { Player, StackItem } from "~/types/game";
import { deriveGroups, useAnchors, type Rect } from "./use-zone-target-model";
import { useProtoFocus } from "./use-proto-focus";
import ProtoFocusLayer from "./proto-focus-layer";
import ZoneProtoSwitcher, {
    readZoneProto,
    writeZoneProto,
    type ZoneProtoParams,
} from "./zone-proto-switcher";
import VariantB2Row, { VARIANT_B2_NAME } from "./variant-b2-row";
import VariantC2Lift, { VARIANT_C2_NAME } from "./variant-c2-lift";
import VariantD2Peek, { VARIANT_D2_NAME } from "./variant-d2-peek";

// Owner picked B (2026-11-12). C2/D2 stay for comparison.
const VARIANTS = [
    { key: "B2", name: VARIANT_B2_NAME, C: VariantB2Row },
    { key: "C2", name: VARIANT_C2_NAME, C: VariantC2Lift },
    { key: "D2", name: VARIANT_D2_NAME, C: VariantD2Peek },
];

/** Every variant draws its own zone-target arrows (above the focus veil), so
 *  the real layer's arrows into a graveyard are hidden while it runs. */
const HIDE_REAL = `[data-testid="board-arrows"] g:has(path[data-arrow-key*="graveyard-card"]) { display: none; }`;

export default function ZoneTargetPrototype({
    stack,
    players,
    viewerId,
}: {
    stack: StackItem[];
    players: Player[];
    viewerId: string;
}) {
    const [params, setParams] = useState<ZoneProtoParams | null>(() =>
        import.meta.env.DEV ? readZoneProto() : null
    );
    const groups = useMemo(
        () => deriveGroups(stack, players, viewerId),
        [stack, players, viewerId]
    );
    const { gameId } = useGameContext();
    const setupScenario = useMutation(api.game.debugSetupScenario);
    const [loading, setLoading] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const load = async (key: string) => {
        const sc = PROTO_SCENARIOS.find((x) => x.key === key);
        if (!sc) return;
        setLoading(key);
        setLoadError(null);
        try {
            await setupScenario({
                gameId,
                ...normalizeScenarioSpec(
                    sc.spec as Parameters<typeof normalizeScenarioSpec>[0]
                ),
            });
        } catch (e) {
            setLoadError((e as Error).message.slice(0, 160));
        } finally {
            setLoading(null);
        }
    };
    const { anchors, extra } = useAnchors(groups);
    const focus = useProtoFocus(groups);
    if (!params) return null;
    const variant =
        VARIANTS.find((v) => v.key === params.variant) ?? VARIANTS[0];
    const change = (p: ZoneProtoParams) => {
        writeZoneProto(p);
        setParams(p);
    };
    const holes: Rect[] = [];
    if (focus)
        for (const k of focus) {
            const a = anchors[k];
            if (!a) continue;
            for (const r of [a.rowRect, a.sourceRect, a.zoneRect])
                if (r) holes.push(r);
        }
    const missing = groups.filter((g) => !anchors[g.key]?.zone).length;
    return (
        <>
            <style>{HIDE_REAL}</style>
            {focus && <ProtoFocusLayer holes={holes} />}
            <variant.C
                groups={groups}
                anchors={anchors}
                extra={extra}
                focus={focus}
            />
            <ZoneProtoSwitcher
                variants={VARIANTS}
                params={params}
                onChange={change}
                onLoad={load}
                loading={loading}
                status={`${groups.length} group(s) · ${groups.reduce(
                    (n, g) => n + g.cards.length,
                    0
                )} card(s)${missing ? ` · ${missing} pile anchor(s) unmeasured` : ""}${
                    focus ? ` · focus ${focus.size}` : ""
                }${loadError ? ` · LOAD FAILED: ${loadError}` : ""}`}
            />
        </>
    );
}
