// PROTOTYPE — throwaway. Table-step fields shared by every variant.
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import SegmentedControl from "~/components/ui/segmented-control";
import { Banner } from "~/components/ui/banner";
import { SEAT_RANGE } from "./setup-data";
import type { SetupApi } from "./setup-frame";

export function Field({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                {label}
            </span>
            {children}
            {hint && <span className="text-xs text-text-muted">{hint}</span>}
        </div>
    );
}

export function Switch({
    on,
    onChange,
    label,
}: {
    on: boolean;
    onChange: (v: boolean) => void;
    label: string;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            onClick={() => onChange(!on)}
            className={cn(
                "relative h-6 w-11 shrink-0 rounded-full border transition",
                on
                    ? "border-accent bg-accent/80"
                    : "border-border-strong bg-surface-elevated"
            )}
        >
            <span
                className={cn(
                    "absolute top-0.5 size-4 rounded-full bg-parchment transition-all",
                    on ? "left-[1.35rem]" : "left-0.5"
                )}
            />
        </button>
    );
}

export function SeatsField({ s, set }: SetupApi) {
    return (
        <Field
            label="Seats"
            hint="Unfilled seats become bots when the event starts — set the full table for a solo draft."
        >
            <div className="flex flex-wrap gap-1.5">
                {SEAT_RANGE.map((n) => (
                    <button
                        key={n}
                        type="button"
                        aria-pressed={s.seats === n}
                        onClick={() => set({ seats: n })}
                        className={cn(
                            "size-10 rounded-sm border text-sm font-semibold transition",
                            s.seats === n
                                ? "border-accent bg-accent text-surface-base"
                                : "border-border-strong bg-surface-elevated/40 text-parchment hover:border-accent/60"
                        )}
                    >
                        {n}
                    </button>
                ))}
            </div>
        </Field>
    );
}

export function GamesFormatField({ s, set }: SetupApi) {
    return (
        <Field
            label="Games format"
            hint={
                s.gamesFormat === "bo1"
                    ? "Bo1 — one game decides each round pairing."
                    : "Bo3 — each pairing is a best-of-three with sideboarding, like real Limited."
            }
        >
            <SegmentedControl
                ariaLabel="Games format"
                value={s.gamesFormat}
                onChange={(v) => set({ gamesFormat: v })}
                options={[
                    { value: "bo1", label: "Bo1" },
                    { value: "bo3", label: "Bo3" },
                ]}
            />
        </Field>
    );
}

export function TimerField({ s, set }: SetupApi) {
    return (
        <Field
            label="Pick timer"
            hint={
                s.timer
                    ? "Each pick tightens through the pack on the official schedule; an expired pick auto-picks."
                    : "Seats pick at their own pace."
            }
        >
            <div className="flex items-center gap-2">
                <Switch
                    on={s.timer}
                    onChange={(v) => set({ timer: v })}
                    label="Pick timer"
                />
                <span className="text-sm text-parchment">
                    {s.timer ? "On" : "Off"}
                </span>
            </div>
        </Field>
    );
}

export function BoostersField({ s, set }: SetupApi) {
    return (
        <Field
            label="Boosters per seat"
            hint="Every seat opens this many boosters into its pool."
        >
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    aria-label="Fewer boosters"
                    onClick={() =>
                        set({ boosters: Math.max(1, s.boosters - 1) })
                    }
                    className="size-10 rounded-sm border border-border-strong bg-surface-elevated/40 text-lg text-parchment"
                >
                    −
                </button>
                <span className="w-8 text-center font-display text-2xl text-parchment">
                    {s.boosters}
                </span>
                <button
                    type="button"
                    aria-label="More boosters"
                    onClick={() => set({ boosters: s.boosters + 1 })}
                    className="size-10 rounded-sm border border-border-strong bg-surface-elevated/40 text-lg text-parchment"
                >
                    +
                </button>
            </div>
        </Field>
    );
}

export function DeadlineField({ s, set }: SetupApi) {
    return (
        <Field
            label="Round deadline"
            hint={
                s.deadline
                    ? "An unplayed pairing closes as a loss when the time runs out, so one absent player cannot freeze the table."
                    : "Off — rounds never expire; the table waits for every pairing."
            }
        >
            <div className="flex flex-wrap items-center gap-2">
                <Switch
                    on={s.deadline}
                    onChange={(v) => set({ deadline: v })}
                    label="Round deadline"
                />
                <span className="text-sm text-parchment">
                    {s.deadline ? "On" : "Off"}
                </span>
                {s.deadline && (
                    <label className="ml-2 flex items-center gap-1.5 text-sm text-text-muted">
                        <input
                            type="number"
                            min={1}
                            max={10080}
                            value={s.deadlineMin}
                            aria-label="Minutes per round"
                            onChange={(e) =>
                                set({
                                    deadlineMin: Math.max(
                                        1,
                                        Math.min(
                                            10080,
                                            Number(e.currentTarget.value) || 50
                                        )
                                    ),
                                })
                            }
                            className="h-9 w-20 rounded-sm border border-border-strong bg-surface-elevated/40 px-2 text-parchment"
                        />
                        min / round
                    </label>
                )}
            </div>
        </Field>
    );
}

export function DecklistsField({ s, set }: SetupApi) {
    return (
        <Field label="Open decklists">
            <div className="flex items-center gap-2">
                <Switch
                    on={s.openDecklists}
                    onChange={(v) => set({ openDecklists: v })}
                    label="Open decklists"
                />
                <span className="text-sm text-parchment">
                    {s.openDecklists ? "On" : "Off"}
                </span>
            </div>
            {s.openDecklists ? (
                <Banner tone="prominent" title="Everyone sees every deck">
                    Opponents can read each other&apos;s decklists while games
                    are being played. Use it for casual pods only.
                </Banner>
            ) : (
                <span className="text-xs text-text-muted">
                    Off — other seats stay hidden until the event ends.
                </span>
            )}
        </Field>
    );
}

/** The whole Table step, type-aware. */
export default function TableFields(api: SetupApi) {
    return (
        <div className="grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2">
                <SeatsField {...api} />
            </div>
            <GamesFormatField {...api} />
            {api.s.type === "sealed" ? (
                <BoostersField {...api} />
            ) : (
                <TimerField {...api} />
            )}
            <DeadlineField {...api} />
            <DecklistsField {...api} />
        </div>
    );
}
