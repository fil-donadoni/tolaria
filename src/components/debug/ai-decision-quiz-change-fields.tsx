// The inputs of one Discriminant kind, drawn from the table (issue #4800,
// PRD #4792, ADR 0148).
//
// What a kind needs is `PAIR_CHANGE_FIELDS`' answer, not this file's: one row
// per input, one renderer, so a new kind is a row and never a component. A
// `<label>` wraps each input so the row's own sentence is its accessible name.

import { visibleFieldRows, type DiscriminantKind } from "~/lib/ai/verdict-pair";
import { DEBUG_INPUT_CLASS } from "./debug-form-styles";

export default function AiDecisionQuizChangeFields({
    kind,
    fields,
    disabled,
    onChange,
}: {
    kind: DiscriminantKind;
    fields: Record<string, string>;
    disabled: boolean;
    onChange: (key: string, value: string) => void;
}) {
    return (
        <div className="flex flex-col gap-1">
            {visibleFieldRows(kind, fields).map((row) => (
                <label
                    key={`${row.key}:${row.label}`}
                    className="flex flex-col gap-0.5 text-[10px] text-text-muted"
                >
                    {row.label}
                    {row.input === "select" ? (
                        <select
                            value={fields[row.key] ?? ""}
                            disabled={disabled}
                            onChange={(e) => onChange(row.key, e.target.value)}
                            className={DEBUG_INPUT_CLASS}
                        >
                            {row.options!.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    ) : row.input === "textarea" ? (
                        <textarea
                            value={fields[row.key] ?? ""}
                            disabled={disabled}
                            placeholder={row.placeholder}
                            rows={3}
                            onChange={(e) => onChange(row.key, e.target.value)}
                            className={`${DEBUG_INPUT_CLASS} font-mono`}
                        />
                    ) : (
                        <input
                            type={row.input}
                            value={fields[row.key] ?? ""}
                            disabled={disabled}
                            placeholder={row.placeholder}
                            onChange={(e) => onChange(row.key, e.target.value)}
                            className={DEBUG_INPUT_CLASS}
                        />
                    )}
                </label>
            ))}
        </div>
    );
}
