// The Limited setup flow's logic (PRD #5383, issue #5387): `/limited/new`.
//
// PURE — no React, no Convex client: the setup state, its defaults, the Sealed
// rules, the tolerant load/save of the "last setup", the fallback for a
// remembered Pack Source that is no longer draftable and the Create payload are
// all decided here, so the rail and the step bodies only render what this
// module says. The server re-validates every field on `createLimitedEvent`;
// this is the client's mirror of those rules, never its authority (ADR 0074).
import { CUBE_PACK_SIZE, maxCubeSeats } from "@convex/limited/cube";
import { CUBE_SOURCE_KEY } from "@convex/limited/cubeSource";
import {
    DEFAULT_SEALED_BOOSTER_COUNT,
    DRAFT_BOOSTER_COUNT,
    MAX_SEATS,
    MIN_SEATS,
} from "@convex/limited/eventLogic";
import type { LimitedEventType } from "@convex/limited/eventTypes";
import {
    DEFAULT_ROUND_DEADLINE_MINUTES,
    MAX_ROUND_DEADLINE_MINUTES,
    MIN_ROUND_DEADLINE_MINUTES,
    gamesFormatForBestOf,
    isValidRoundDeadlineMinutes,
    type LimitedGamesFormat,
} from "@convex/limited/gamesFormat";
import {
    DEFAULT_DIFFICULTY,
    DIFFICULTIES,
    type Difficulty,
} from "@convex/gre/difficulty";
import type { PackSourceInfo } from "~/hooks/useLimitedEvent";
import { DIFFICULTY_LABEL } from "~/lib/difficultyLabels";

/** A Pack Source catalogue key (`PackSourceEntry.key`). */
export type PackSourceKey = string;

/** Every choice of the flow. Persisted whole, so the next visit preselects the
 *  last choices (PRD #5383). */
export interface LimitedSetup {
    type: LimitedEventType;
    packSource: PackSourceKey;
    seats: number;
    gamesFormat: 1 | 3;
    /** Bot difficulty of every vs-AI Match of the event (issue #6916). */
    botDifficulty: Difficulty;
    /** Draft only — hidden (and never sent) under Sealed. */
    pickTimer: boolean;
    /** Sealed only. */
    boostersPerSeat: number;
    /** `null` = no round deadline. */
    roundDeadlineMinutes: number | null;
    openDecklists: boolean;
}

/** Every step of the flow, in order. */
export type LimitedStepKey = "type" | "packSource" | "table";

export const LIMITED_STEP_KEYS: readonly LimitedStepKey[] = [
    "type",
    "packSource",
    "table",
];

/** Steps with several controls: a choice there never advances the flow, the
 *  Next button does. The others are single-control — one pick opens the
 *  following step. */
export const LIMITED_MULTI_CONTROL_STEPS: readonly LimitedStepKey[] = ["table"];

export interface LimitedStepInfo {
    key: LimitedStepKey;
    title: string;
    /** The answer as the recap rail shows it. Every step has a default, so it
     *  is never empty. */
    answer: string;
}

/** The payload `createLimitedEvent` takes (issues #1114, #1640, #5385, #5386). */
export interface CreateLimitedEventPayload {
    type: LimitedEventType;
    seatCount: number;
    /** Pack Source catalogue key; the server resolves it into the per-pack
     *  sets the event stores. */
    packSource: string;
    sealedBoosterCount: number;
    /** Per-pick timer on/off (ADR 0060); omitted/false under Sealed. */
    timerEnabled?: boolean;
    /** Always sent: the creator's choice is explicit. */
    gamesFormat: LimitedGamesFormat;
    /** Always sent (issue #6916). */
    botDifficulty: Difficulty;
    /** Omitted when the creator leaves the deadline off. */
    roundDeadlineMinutes?: number;
    /** Always sent, like `gamesFormat`. */
    openDecklists: boolean;
}

export const LIMITED_SETUP_STORAGE_KEY = "tolaria:limited-setup";

/** The setup a first visit opens on: Draft · Vintage Cube · 8 seats · Bo3 ·
 *  pick timer on · Open Decklists off (PRD #5383 stories 17–19). */
export const DEFAULT_LIMITED_SETUP: LimitedSetup = {
    type: "draft",
    packSource: CUBE_SOURCE_KEY,
    seats: MAX_SEATS,
    gamesFormat: 3,
    botDifficulty: DEFAULT_DIFFICULTY,
    pickTimer: true,
    boostersPerSeat: DEFAULT_SEALED_BOOSTER_COUNT,
    roundDeadlineMinutes: null,
    openDecklists: false,
};

// --- Pack Sources ---------------------------------------------------------

/** Whether a Pack Source can be chosen for the event type. The Vintage Cube is
 *  a DRAFT-only pool source (ADR 0062: the singleton pool-as-source path is
 *  wired into the draft engine, not the Sealed pool generator); every source of
 *  real Draftable Sets works for both. */
export function isSourceSelectable(
    source: PackSourceInfo,
    type: LimitedEventType
): boolean {
    if (!source.draftable) return false;
    return type === "draft" || !source.draftOnly;
}

/** Cards a non-Draftable source still lacks, summed over its sets. */
export function missingCardCount(source: PackSourceInfo): number {
    return source.sets.reduce((sum, set) => sum + set.missingCardCount, 0);
}

/** Why a source cannot be chosen for the type, or `null` when it can. */
export function sourceDisabledReason(
    source: PackSourceInfo,
    type: LimitedEventType
): string | null {
    if (isSourceSelectable(source, type)) return null;
    if (!source.draftable) {
        const missing = missingCardCount(source);
        return `${missing} card${missing === 1 ? "" : "s"} missing`;
    }
    return "Draft only";
}

/** The first source the type can use, in catalogue order (Vintage Cube first). */
export function firstSelectableSource(
    sources: readonly PackSourceInfo[],
    type: LimitedEventType
): PackSourceInfo | undefined {
    return sources.find((s) => isSourceSelectable(s, type));
}

/** The source after (`delta` 1) or before (`delta` -1) `current` among those
 *  the type can use, wrapping — what the showcase's previous/next steps over. */
export function adjacentSelectableSource(
    sources: readonly PackSourceInfo[],
    type: LimitedEventType,
    current: PackSourceKey,
    delta: 1 | -1
): PackSourceInfo | undefined {
    const usable = sources.filter((s) => isSourceSelectable(s, type));
    if (usable.length === 0) return undefined;
    const at = usable.findIndex((s) => s.key === current);
    if (at === -1) return usable[0];
    return usable[(at + delta + usable.length) % usable.length];
}

/** Share of a source's Booster Sheet cards that are implemented, 0–1 — the
 *  mean sheet coverage over its sets. `null` for the cube: a curated pool has
 *  no sheets to complete, only a card count. */
export function implementedShare(source: PackSourceInfo): number | null {
    if (source.sets.some((s) => s.isCube === true)) return null;
    const coverages = source.sets.flatMap((s) =>
        s.sheets.map((sheet) => sheet.coverage)
    );
    if (coverages.length === 0) return null;
    return coverages.reduce((sum, c) => sum + c, 0) / coverages.length;
}

// --- Rules ----------------------------------------------------------------

/** The pick timer exists for Draft only (Sealed has no picks). */
export function pickTimerVisible(setup: LimitedSetup): boolean {
    return setup.type === "draft";
}

/** Largest table the setup can seat. A Vintage Cube draft deals one copy of
 *  each card (ADR 0062 rev), so the table is capped by the implemented pool;
 *  every other source keeps the full 2–8 range. */
export function seatLimit(
    setup: LimitedSetup,
    sources: readonly PackSourceInfo[]
): number {
    if (setup.type !== "draft") return MAX_SEATS;
    const cube = sources
        .find((s) => s.key === setup.packSource)
        ?.sets.find((s) => s.isCube === true);
    if (!cube) return MAX_SEATS;
    return Math.max(
        MIN_SEATS,
        Math.min(
            MAX_SEATS,
            maxCubeSeats(
                cube.availableCardCount ?? 0,
                CUBE_PACK_SIZE,
                DRAFT_BOOSTER_COUNT
            )
        )
    );
}

/** Keep the typed round deadline inside what `createLimitedEvent` accepts. */
export function clampRoundDeadline(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_ROUND_DEADLINE_MINUTES;
    return Math.max(
        MIN_ROUND_DEADLINE_MINUTES,
        Math.min(MAX_ROUND_DEADLINE_MINUTES, Math.round(value))
    );
}

/** Apply one choice, then repair what it invalidates: a source the type cannot
 *  use (the cube under Sealed) moves to the first one it can, the table shrinks
 *  to the seat limit, and the numeric fields stay inside the server's bounds. */
export function applyChange(
    setup: LimitedSetup,
    patch: Partial<LimitedSetup>,
    sources: readonly PackSourceInfo[]
): LimitedSetup {
    const next = { ...setup, ...patch };
    const current = sources.find((s) => s.key === next.packSource);
    if (!current || !isSourceSelectable(current, next.type)) {
        const fallback = firstSelectableSource(sources, next.type);
        if (fallback) next.packSource = fallback.key;
    }
    // The seat limit follows the Pack Source, so it only bites on an explicit
    // seat choice: a table of 8 survives a trip through Sealed and back.
    const seatCeiling =
        patch.seats === undefined ? MAX_SEATS : seatLimit(next, sources);
    next.seats = Math.max(
        MIN_SEATS,
        Math.min(seatCeiling, Math.round(next.seats) || MIN_SEATS)
    );
    next.boostersPerSeat = Math.max(
        1,
        Math.round(next.boostersPerSeat) || DEFAULT_SEALED_BOOSTER_COUNT
    );
    if (next.roundDeadlineMinutes !== null) {
        next.roundDeadlineMinutes = clampRoundDeadline(
            next.roundDeadlineMinutes
        );
    }
    return next;
}

/** A remembered setup against the live catalogue: a stored Pack Source that is
 *  gone or no longer draftable falls back to the first usable one, with a note
 *  saying so. Before the catalogue answers (`sources` empty) nothing changes. */
export function reconcileSetup(
    setup: LimitedSetup,
    sources: readonly PackSourceInfo[]
): { setup: LimitedSetup; note: string | null } {
    if (sources.length === 0) return { setup, note: null };
    const stored = sources.find((s) => s.key === setup.packSource);
    const fitted = applyChange(setup, {}, sources);
    // Shown within the limit of the source in force, never stored there.
    const repaired = {
        ...fitted,
        seats: Math.min(fitted.seats, seatLimit(fitted, sources)),
    };
    if (stored?.draftable) return { setup: repaired, note: null };
    const fallback = sources.find((s) => s.key === repaired.packSource);
    const was = stored?.name ?? setup.packSource;
    return {
        setup: repaired,
        note: fallback
            ? `${was} is no longer draftable — ${fallback.name} is selected instead.`
            : null,
    };
}

// --- Steps ----------------------------------------------------------------

const TYPE_LABEL: Record<LimitedEventType, string> = {
    draft: "Draft",
    sealed: "Sealed",
};

/** The recap rail's three rows with their current answers. */
export function limitedSetupSteps(
    setup: LimitedSetup,
    sources: readonly PackSourceInfo[]
): LimitedStepInfo[] {
    const source = sources.find((s) => s.key === setup.packSource);
    const table = [
        `${setup.seats} seats`,
        `Bo${setup.gamesFormat}`,
        DIFFICULTY_LABEL[setup.botDifficulty],
        ...(pickTimerVisible(setup) && setup.pickTimer ? ["timer"] : []),
    ];
    return [
        { key: "type", title: "Type", answer: TYPE_LABEL[setup.type] },
        {
            key: "packSource",
            title: "Pack Source",
            answer: source?.name ?? setup.packSource,
        },
        { key: "table", title: "Table", answer: table.join(" · ") },
    ];
}

// --- Persistence ----------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Tolerant read: each field is kept only if it is well-formed, otherwise it
 *  takes its default — a corrupt or hand-edited store never blocks the route. */
export function parseSetup(raw: string | null): LimitedSetup {
    if (raw === null) return DEFAULT_LIMITED_SETUP;
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return DEFAULT_LIMITED_SETUP;
    }
    if (!isRecord(value)) return DEFAULT_LIMITED_SETUP;
    const d = DEFAULT_LIMITED_SETUP;
    const int = (x: unknown, min: number, max: number, fallback: number) =>
        typeof x === "number" && Number.isInteger(x) && x >= min && x <= max
            ? x
            : fallback;
    return {
        type:
            value.type === "sealed" || value.type === "draft"
                ? value.type
                : d.type,
        packSource:
            typeof value.packSource === "string" && value.packSource !== ""
                ? value.packSource
                : d.packSource,
        seats: int(value.seats, MIN_SEATS, MAX_SEATS, d.seats),
        gamesFormat:
            value.gamesFormat === 1 || value.gamesFormat === 3
                ? value.gamesFormat
                : d.gamesFormat,
        botDifficulty:
            typeof value.botDifficulty === "string" &&
            (DIFFICULTIES as readonly string[]).includes(value.botDifficulty)
                ? (value.botDifficulty as Difficulty)
                : d.botDifficulty,
        pickTimer:
            typeof value.pickTimer === "boolean"
                ? value.pickTimer
                : d.pickTimer,
        boostersPerSeat: int(
            value.boostersPerSeat,
            1,
            Number.MAX_SAFE_INTEGER,
            d.boostersPerSeat
        ),
        roundDeadlineMinutes:
            typeof value.roundDeadlineMinutes === "number" &&
            isValidRoundDeadlineMinutes(value.roundDeadlineMinutes)
                ? value.roundDeadlineMinutes
                : null,
        openDecklists:
            typeof value.openDecklists === "boolean"
                ? value.openDecklists
                : d.openDecklists,
    };
}

/** The remembered setup, or the defaults on a first visit / unreadable store. */
export function loadSetup(): LimitedSetup {
    try {
        return parseSetup(localStorage.getItem(LIMITED_SETUP_STORAGE_KEY));
    } catch {
        return DEFAULT_LIMITED_SETUP;
    }
}

/** Remember the setup; a storage failure only costs the next preselection. */
export function saveSetup(setup: LimitedSetup): void {
    try {
        localStorage.setItem(LIMITED_SETUP_STORAGE_KEY, JSON.stringify(setup));
    } catch {
        // Private mode / quota: the flow still works, it just forgets.
    }
}

// --- Create ---------------------------------------------------------------

/** The `createLimitedEvent` arguments for a setup, or `null` while its Pack
 *  Source cannot be used for the type (catalogue not loaded, or nothing
 *  draftable). */
export function createPayload(
    setup: LimitedSetup,
    sources: readonly PackSourceInfo[]
): CreateLimitedEventPayload | null {
    const source = sources.find((s) => s.key === setup.packSource);
    if (!source || !isSourceSelectable(source, setup.type)) return null;
    return {
        type: setup.type,
        seatCount: Math.min(setup.seats, seatLimit(setup, sources)),
        packSource: setup.packSource,
        sealedBoosterCount: setup.boostersPerSeat,
        timerEnabled: pickTimerVisible(setup) && setup.pickTimer,
        gamesFormat: gamesFormatForBestOf(setup.gamesFormat),
        botDifficulty: setup.botDifficulty,
        roundDeadlineMinutes: setup.roundDeadlineMinutes ?? undefined,
        openDecklists: setup.openDecklists,
    };
}
