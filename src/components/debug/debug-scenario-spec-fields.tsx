import { useState } from "react";
import DebugScenarioSpecField from "./debug-scenario-spec-field";
import type { SpecDraft } from "./scenario-draft";
import { formOwnedKeysInGroup } from "./scenario-spec-ownership";

/** Which fields are which is the TABLE's answer, not this file's (issue
 *  #3494): `scenario-spec-ownership.ts` carries a `group` on every row and
 *  `tsc` demands it, so a newly classified field cannot land in no group — the
 *  failure a hardcoded "common ones" list here would have allowed. */
const FREQUENT_KEYS = formOwnedKeysInGroup("frequent");
const OTHER_KEYS = formOwnedKeysInGroup("other");

/**
 * The SPEC-LEVEL knobs of the scenario save form — one input per `form-owned`
 * field of `ScenarioSpec` (issue #3463), in TWO groups since issue #3494.
 *
 * It renders by ITERATING the classification table rather than by spelling out
 * a fixed list of JSX rows: the table (`scenario-spec-ownership.ts`) is then
 * the only place a spec field has to be named, and a field classified
 * `form-owned` cannot be left unrendered — `tsc` demands its row in
 * `SCENARIO_SPEC_FIELD_INPUT`, the row makes this loop render it, and
 * `__tests__/scenario-spec-fields.test.tsx` asserts the aria-labels the row
 * derives are in the document.
 *
 * The split exists because the form reached ~28 inputs in one flat list, so
 * `phase` and `life` sat among `stormCount` and the qualifying-action flags
 * with nothing to tell them apart. The rare ones are still all here, one click
 * away — hiding a knob is what issue #3463 spent itself undoing, and
 * "collapsed" is not "absent".
 */
export default function DebugScenarioSpecFields({
    draft,
    onPatch,
}: {
    draft: SpecDraft;
    onPatch: (patch: Partial<SpecDraft>) => void;
}) {
    const [showOther, setShowOther] = useState(false);

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {FREQUENT_KEYS.map((key) => (
                    <DebugScenarioSpecField
                        key={key}
                        fieldKey={key}
                        draft={draft}
                        onPatch={onPatch}
                    />
                ))}
            </div>

            <button
                type="button"
                onClick={() => setShowOther((v) => !v)}
                aria-expanded={showOther}
                className="flex items-center gap-1.5 self-start rounded-sm py-1 text-xs text-text-muted hover:text-parchment"
            >
                <span aria-hidden className="font-mono">
                    {showOther ? "▾" : "▸"}
                </span>
                Other options
                <span className="tabular-nums text-text-disabled">
                    ({OTHER_KEYS.length})
                </span>
            </button>

            {/* Conditionally RENDERED, not merely hidden: a `<details>` body
                stays in the document, so every test asserting "the form has an
                input for this field" would keep passing while the disclosure
                was broken shut. */}
            {showOther && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-border-subtle/60 bg-surface-base/40 p-2">
                    {OTHER_KEYS.map((key) => (
                        <DebugScenarioSpecField
                            key={key}
                            fieldKey={key}
                            draft={draft}
                            onPatch={onPatch}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
