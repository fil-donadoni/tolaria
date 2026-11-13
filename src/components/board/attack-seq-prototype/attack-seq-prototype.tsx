// PROTOTYPE (issue #9500) — throwaway, never merged (branch
// prototype/attack-sequence-9500). Question: during "Attack with all" against
// a defender with a planeswalker, the attack-target sequence walks the
// declared attackers one at a time (left → right); a player read it as a
// freeze, not seeing WHICH creature was choosing. What makes it legible?
//
//   /game/<id>?atkProto=1&variant=<A|B|C|D>   (dev builds only)
// A named banner + "n of m" + who's next, order fixed · B A + numbered badges
// on the board + click any attacker to choose for it · C a clickable queue
// strip with each attacker's chosen target · D a target menu on the creature.
// The bar's "load" buttons put a REAL scenario into the current game, opened
// at BEGINNING_OF_COMBAT: pass, then "Attack with all" starts the sequence.
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { normalizeScenarioSpec } from "@convex/debugScenarioSpec";
import { useAttackSequence } from "~/hooks/useAttackSequence";
import { useGameContext } from "~/hooks/useGameContext";
import { PROTO_SCENARIOS } from "./prototype-scenarios";
import { ATK_PROTO_VARIANTS, useAtkProtoVariant } from "./atk-proto-store";
import AtkProtoSwitcher from "./atk-proto-switcher";
import { useAttackSeqModel } from "./use-attack-seq-model";
import VariantBBadges from "./variant-b-badges";
import VariantDInline from "./variant-d-inline";

export default function AttackSeqPrototype() {
    const variant = useAtkProtoVariant();
    const { gameId } = useGameContext();
    const setupScenario = useMutation(api.game.debugSetupScenario);
    const seq = useAttackSequence();
    const model = useAttackSeqModel();
    const [loading, setLoading] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    if (!variant) return null;
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
    const status = seq.active
        ? `sequence ${seq.index + 1}/${seq.order.length}`
        : seq.awaiting.length
          ? `awaiting ${seq.awaiting.length}`
          : "no sequence";
    return (
        <>
            {model && variant === "B" && <VariantBBadges model={model} />}
            {model && variant === "D" && <VariantDInline model={model} />}
            <AtkProtoSwitcher
                variants={ATK_PROTO_VARIANTS}
                current={variant}
                onLoad={load}
                loading={loading}
                status={`${status}${loadError ? ` · LOAD FAILED: ${loadError}` : ""}`}
            />
        </>
    );
}
