// Touch up the prefilled right-hand position (issue #4800, PRD #4792, ADR 0148).
//
// The prefill changes the Discriminant and nothing else, so the position it
// leaves is the anchor's with one edit — right to confirm as it stands, or
// close to it. This is the judge's hand on the rest: the same card rows and
// spec-level inputs the scenario form uses, opened on the copied spec. A field
// the form renders no input for is carried over from the loaded spec
// (`assembleScenarioSpec`), or applying would silently delete it — the class
// `DebugSaveScenario` documents (issue #3462).

import { useMemo, useState } from "react";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import DebugButton from "./debug-button";
import DebugScenarioCardFields from "./debug-scenario-card-fields";
import DebugScenarioSpecFields from "./debug-scenario-spec-fields";
import {
    type CardDraft,
    type SpecDraft,
    cardToDraft,
    draftToCard,
    draftToSpec,
    emptyCardDraft,
    specToDraft,
} from "./scenario-draft";
import { assembleScenarioSpec } from "./scenario-spec-ownership";

export default function AiDecisionQuizTouchUp({
    spec,
    onApply,
    onCancel,
}: {
    spec: ScenarioSpec;
    onApply: (spec: ScenarioSpec) => void;
    onCancel: () => void;
}) {
    const [cards, setCards] = useState<CardDraft[]>(() =>
        spec.cards.map(cardToDraft)
    );
    const [specDraft, setSpecDraft] = useState<SpecDraft>(() =>
        specToDraft(spec)
    );

    const edited: ScenarioSpec = useMemo(
        () =>
            assembleScenarioSpec(
                {
                    cards: cards
                        .filter((card) => card.name.trim() !== "")
                        .map(draftToCard),
                    ...draftToSpec(specDraft),
                },
                spec
            ),
        [cards, specDraft, spec]
    );

    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-label">Touch up the right-hand position</span>
            {cards.map((card, i) => (
                <DebugScenarioCardFields
                    key={i}
                    draft={card}
                    index={i}
                    onPatch={(patch) =>
                        setCards((prev) =>
                            prev.map((c, j) =>
                                j === i ? { ...c, ...patch } : c
                            )
                        )
                    }
                    onRemove={() =>
                        setCards((prev) => prev.filter((_, j) => j !== i))
                    }
                />
            ))}
            <DebugButton
                onClick={() => setCards((prev) => [...prev, emptyCardDraft()])}
                className="self-start"
            >
                + card
            </DebugButton>
            <DebugScenarioSpecFields
                draft={specDraft}
                onPatch={(patch) =>
                    setSpecDraft((prev) => ({ ...prev, ...patch }))
                }
            />
            <DebugButton variant="primary" onClick={() => onApply(edited)}>
                Apply
            </DebugButton>
            <DebugButton onClick={onCancel}>Cancel</DebugButton>
        </div>
    );
}
