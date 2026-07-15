import { useState } from "react";
import type { CardDraft, CounterDraft } from "./scenario-draft";
import DebugCardNameField from "./debug-card-name-field";

const ZONES = ["battlefield", "hand", "library", "graveyard", "exile"] as const;

const inputClass =
    "px-2 py-1 rounded bg-black/40 border border-white/20 text-white text-xs placeholder:text-white/30 outline-none focus:border-white/40";

/** One card row in the scenario save form's repeater. Fields are laid out in
 *  descending order of use-probability: name + owner always visible, then the
 *  common placement knobs (zone, count, tapped, summoning-sick), then the rarer
 *  fields (counters, damage, attach/copy hosts, face-down flags, position)
 *  behind a per-card "More" disclosure. Every field of `ScenarioCard` is
 *  reachable. Pure/controlled — the parent owns the draft array. */
export default function DebugScenarioCardFields({
    draft,
    index,
    onPatch,
    onRemove,
}: {
    draft: CardDraft;
    index: number;
    onPatch: (patch: Partial<CardDraft>) => void;
    onRemove: () => void;
}) {
    const [showMore, setShowMore] = useState(false);

    const patchCounter = (i: number, patch: Partial<CounterDraft>) => {
        const counters = draft.counters.map((c, j) =>
            j === i ? { ...c, ...patch } : c
        );
        onPatch({ counters });
    };
    const addCounter = () =>
        onPatch({
            counters: [...draft.counters, { type: "+1/+1", count: "1" }],
        });
    const removeCounter = (i: number) =>
        onPatch({ counters: draft.counters.filter((_, j) => j !== i) });

    return (
        <div className="flex flex-col gap-1 rounded border border-white/10 bg-white/5 p-1.5">
            {/* Primary: name + owner + remove */}
            <div className="flex items-center gap-1">
                <span className="text-white/30 text-[10px] w-4 shrink-0">
                    {index + 1}
                </span>
                <DebugCardNameField
                    value={draft.name}
                    onChange={(name) => onPatch({ name })}
                    ariaLabel={`Card ${index + 1} name`}
                />
                <select
                    value={draft.owner}
                    onChange={(e) =>
                        onPatch({ owner: e.target.value as CardDraft["owner"] })
                    }
                    aria-label={`Card ${index + 1} owner`}
                    className={inputClass}
                >
                    <option value="me">me</option>
                    <option value="opp">opp</option>
                </select>
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={`Remove card ${index + 1}`}
                    className="px-1.5 py-1 rounded text-red-400/80 hover:text-red-300 hover:bg-white/10 text-xs"
                >
                    ✕
                </button>
            </div>

            {/* Common placement knobs */}
            <div className="flex flex-wrap items-center gap-2 pl-5">
                <select
                    value={draft.zone}
                    onChange={(e) =>
                        onPatch({ zone: e.target.value as CardDraft["zone"] })
                    }
                    aria-label={`Card ${index + 1} zone`}
                    className={inputClass}
                >
                    {ZONES.map((z) => (
                        <option key={z} value={z}>
                            {z}
                        </option>
                    ))}
                </select>
                <label className="flex items-center gap-1 text-white/50">
                    count
                    <input
                        type="number"
                        min={1}
                        value={draft.count}
                        onChange={(e) => onPatch({ count: e.target.value })}
                        className={`${inputClass} w-14`}
                    />
                </label>
                <label className="flex items-center gap-1 text-white/50">
                    <input
                        type="checkbox"
                        checked={draft.tapped}
                        onChange={(e) => onPatch({ tapped: e.target.checked })}
                    />
                    tapped
                </label>
                <label className="flex items-center gap-1 text-white/50">
                    <input
                        type="checkbox"
                        checked={draft.summoningSick}
                        onChange={(e) =>
                            onPatch({ summoningSick: e.target.checked })
                        }
                    />
                    sick
                </label>
                <button
                    type="button"
                    onClick={() => setShowMore((v) => !v)}
                    className="text-white/40 hover:text-white/70 text-[10px] underline"
                >
                    {showMore ? "less" : "more…"}
                </button>
            </div>

            {/* Rarer fields */}
            {showMore && (
                <div className="flex flex-col gap-1.5 pl-5 pt-1 border-t border-white/10">
                    {/* Counters */}
                    <div className="flex flex-col gap-1">
                        <span className="text-white/40 text-[10px] uppercase tracking-wide">
                            Counters
                        </span>
                        {draft.counters.map((c, i) => (
                            <div key={i} className="flex items-center gap-1">
                                <input
                                    type="text"
                                    value={c.type}
                                    placeholder="type e.g. +1/+1"
                                    onChange={(e) =>
                                        patchCounter(i, {
                                            type: e.target.value,
                                        })
                                    }
                                    className={`${inputClass} flex-1`}
                                />
                                <input
                                    type="number"
                                    value={c.count}
                                    onChange={(e) =>
                                        patchCounter(i, {
                                            count: e.target.value,
                                        })
                                    }
                                    className={`${inputClass} w-14`}
                                />
                                <button
                                    type="button"
                                    onClick={() => removeCounter(i)}
                                    className="px-1.5 py-1 text-red-400/80 hover:text-red-300 text-xs"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={addCounter}
                            className="self-start text-white/40 hover:text-white/70 text-[10px] underline"
                        >
                            + counter
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1 text-white/50">
                            dmg
                            <input
                                type="number"
                                value={draft.damageMarked}
                                onChange={(e) =>
                                    onPatch({ damageMarked: e.target.value })
                                }
                                className={`${inputClass} w-14`}
                            />
                        </label>
                        <label className="flex items-center gap-1 text-white/50">
                            pos
                            <input
                                type="number"
                                value={draft.position}
                                onChange={(e) =>
                                    onPatch({ position: e.target.value })
                                }
                                className={`${inputClass} w-14`}
                            />
                        </label>
                    </div>

                    <label className="flex items-center gap-1 text-white/50">
                        attach→
                        <DebugCardNameField
                            value={draft.attachedTo}
                            onChange={(attachedTo) => onPatch({ attachedTo })}
                            placeholder="host card…"
                            ariaLabel={`Card ${index + 1} attached to`}
                        />
                    </label>
                    <label className="flex items-center gap-1 text-white/50">
                        copyOf
                        <DebugCardNameField
                            value={draft.copyOf}
                            onChange={(copyOf) => onPatch({ copyOf })}
                            placeholder="copied card…"
                            ariaLabel={`Card ${index + 1} copy of`}
                        />
                    </label>

                    <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1 text-white/50">
                            <input
                                type="checkbox"
                                checked={draft.faceDown}
                                onChange={(e) =>
                                    onPatch({ faceDown: e.target.checked })
                                }
                            />
                            faceDown
                        </label>
                        <label className="flex items-center gap-1 text-white/50">
                            <input
                                type="checkbox"
                                checked={draft.faceDownExile}
                                onChange={(e) =>
                                    onPatch({ faceDownExile: e.target.checked })
                                }
                            />
                            fdExile
                        </label>
                        <label className="flex items-center gap-1 text-white/50">
                            <input
                                type="checkbox"
                                checked={draft.castableFromExile}
                                onChange={(e) =>
                                    onPatch({
                                        castableFromExile: e.target.checked,
                                    })
                                }
                            />
                            castExile
                        </label>
                        <label className="flex items-center gap-1 text-white/50">
                            <input
                                type="checkbox"
                                checked={draft.attackedLastTurn}
                                onChange={(e) =>
                                    onPatch({
                                        attackedLastTurn: e.target.checked,
                                    })
                                }
                            />
                            attacked
                        </label>
                    </div>
                </div>
            )}
        </div>
    );
}
