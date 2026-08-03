// Issue #1762 — every small "priority/choice" prompt banner used to hardcode
// `absolute top-1/2 left-1/2` (dead center of the board) via its own
// `useDraggable` call. That's exactly where a portrait player needs to click
// (a creature to target, a permanent to sacrifice/tap), and there's no room
// to drag the banner out of the way first on a narrow phone. All six now
// route through the shared `usePromptBannerPosition` hook (unit-tested on
// its own in `src/hooks/__tests__/usePromptBannerPosition.test.ts`); this
// suite is the catalogue-wide DOM proof that each banner's OWN wiring picked
// up the portrait branch — the "two pieces passing individually but failing
// together" class of bug the hook's unit test alone can't catch.
import * as fs from "fs";
import * as path from "path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type {
    AttackManaTaxPayment,
    MulliganState,
    PendingActivation,
    PendingChoice,
    PendingTarget,
    Player,
    SacrificeSelection,
} from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";

// The single seam under test — drive it explicitly so jsdom's flaky
// matchMedia never decides the branch (same pattern as
// controller-portrait.test.tsx / usePromptBannerPosition.test.ts).
let portrait = true;
vi.mock("~/hooks/useIsPortrait", () => ({
    useIsPortrait: () => portrait,
}));

vi.mock("convex/react", () => ({
    useMutation: () => async () => {},
    useQuery: () => undefined,
}));

// Every one of these banners only ever CALLS a mutation ref through
// useMutation (mocked above to ignore its argument) — a permissive proxy
// stands in for the whole generated api surface instead of naming every
// function used across six files.
vi.mock("@convex/_generated/api", () => ({
    api: new Proxy(
        {},
        {
            get: (): unknown =>
                new Proxy(
                    {},
                    {
                        get: () => ({}),
                    }
                ),
        }
    ),
}));

vi.mock("@convex/cards", () => ({
    getDefinition: (id: string) => ({ id, name: `Card ${id}` }),
    tryGetDefinition: (id: string) => ({ id, name: `Card ${id}` }),
}));

vi.mock("@convex/cards/emblems", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        // shallow overrides: by-name accessor, no emblem hydrates during this suite
        tryGetEmblemDefinition: () => undefined,
    };
});

const { default: TargetSelectionBanner } =
    await import("../target-selection-banner");
const { default: PendingChoicePrompt } =
    await import("../pending-choice-prompt");
const { default: SacrificeBanner } = await import("../sacrifice-banner");
const { default: PaymentBanner } = await import("../payment-banner");
const { default: MulliganPrompt } = await import("../mulligan-prompt");
const { default: AttackManaTaxBanner } =
    await import("../attack-mana-tax-banner");

afterEach(() => {
    cleanup();
    portrait = true;
});

function player(over: Partial<Player> = {}): Player {
    return {
        id: "me",
        name: "Me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...over,
    };
}

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: async () => {},
    isPending: false,
    lastError: null,
    reportError: () => {},
    dismissError: () => {},
};

/** Asserts the FIRST child of `container` — every one of these banners
 *  renders exactly one top-level positioning `div` — never centers on the
 *  board via the OLD dead-center recipe (`top-1/2`/`left-1/2`) and always
 *  uses the safe-area-aware fixed strip in portrait (issue #1762 original
 *  acceptance criterion). Issue #1813 narrowed WHICH banners this applies
 *  to: only ones whose own interaction routes clicks to the mid-board — see
 *  `expectPortraitCenteredPosition` below for the new default. */
function expectPortraitSafePosition(container: HTMLElement) {
    const outer = container.firstElementChild as HTMLElement | null;
    expect(outer).not.toBeNull();
    const className = outer!.className;
    expect(className).not.toContain("top-1/2");
    expect(className).not.toContain("left-1/2");
    expect(className).toContain("fixed");
    expect(className).toContain("env(safe-area-inset-top)");
}

/** Issue #1813 — the new portrait DEFAULT for a prompt banner with nothing
 *  on the mid-board for the player to tap: vertically (and horizontally)
 *  centered, never the safe-area strip (that would waste the centered
 *  screen real estate) and never the OLD dead-center `top-1/2`/`left-1/2`
 *  recipe either (this is a DIFFERENT, flex-centered implementation — see
 *  `usePromptBannerPosition`). */
function expectPortraitCenteredPosition(container: HTMLElement) {
    const outer = container.firstElementChild as HTMLElement | null;
    expect(outer).not.toBeNull();
    const className = outer!.className;
    expect(className).not.toContain("top-1/2");
    expect(className).not.toContain("left-1/2");
    expect(className).toContain("fixed");
    // `inset-0` is THE class that centers vertically (full-viewport box, then
    // `items-center` centers within it) — the pinned branch is `inset-x-0
    // top-[...]` (no `inset-0`), so this line is what actually distinguishes
    // the two branches. Its absence here was a review finding on #1823: the
    // assertion below (`items-center`/`justify-center`) alone can't tell
    // "vertically centered" from "pinned but also flex-centered
    // horizontally" — only `inset-0` proves the vertical placement.
    expect(className).toContain("inset-0");
    expect(className).toContain("items-center");
    expect(className).toContain("justify-center");
    expect(className).not.toContain("env(safe-area-inset-top)");
}

describe("Prompt banners — portrait pins to the safe-area strip when board taps are required (issues #1762, #1813)", () => {
    it("TargetSelectionBanner", () => {
        const pendingTarget: PendingTarget = {
            playerId: "me",
            cardInstanceId: "inst",
            targetType: "Creature",
            count: 1,
            selected: [],
        } as PendingTarget;
        const { container } = render(
            <TargetSelectionBanner
                pendingTarget={pendingTarget}
                me={player()}
                stack={[]}
                gameId={"g1" as never}
                playerId="me"
            />
        );
        expectPortraitSafePosition(container);
    });

    it("SacrificeBanner", () => {
        const selection: SacrificeSelection = {
            playerId: "me",
            reason: "Green creatures can't attack unless their controller sacrifices a land",
            requirements: [{ filter: { types: "Land" }, count: 1 }],
            picked: [],
        };
        const { container } = render(<SacrificeBanner selection={selection} />);
        expectPortraitSafePosition(container);
    });

    it("PaymentBanner", () => {
        const pa: PendingActivation = {
            playerId: "me",
            cardInstanceId: "src",
            abilityId: "ability",
            manaCost: { R: 1 },
            tappedLandIds: [],
            tapSource: false,
            sacrificeSource: false,
        };
        const { container } = render(
            <PaymentBanner
                kind="activation"
                pendingActivation={pa}
                me={player()}
                gameId={"g1" as never}
                playerId="me"
            />
        );
        expectPortraitSafePosition(container);
    });

    it("AttackManaTaxBanner", () => {
        const payment: AttackManaTaxPayment = {
            playerId: "me",
            reason: "Propaganda",
            cost: { generic: 2 },
            tappedLandIds: [],
        };
        const { container } = render(
            <AttackManaTaxBanner
                gameId={"g1" as never}
                playerId="me"
                payment={payment}
            />
        );
        expectPortraitSafePosition(container);
    });

    // PendingChoicePrompt is dynamic — it pins ONLY when the choice itself
    // routes clicks to the battlefield (`zone: "battlefield"`, e.g. a
    // may-pay sacrifice leg or `choose-aura-host`). This exercises that
    // branch; the non-battlefield branch is covered in the centered describe
    // block below.
    it("PendingChoicePrompt — a battlefield-zone choice", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "choose-permanents",
            zone: "battlefield",
            count: 1,
            prompt: "Choose a permanent.",
        } as PendingChoice;
        const value = {
            gameId: "g1" as never,
            playerId: "me",
            activePlayerId: "me",
            priorityPlayerId: "me",
            phase: "PRECOMBAT_MAIN",
            turn: 1,
            engineTurn: 1,
            stackCount: 0,
            allPlayers: [{ id: "me", name: "Me" }],
            showAllCards: false,
            debugAllActions: false,
            onSwitchGame: () => {},
            pendingChoices: [choice],
        } as unknown as React.ContextType<typeof GameContext>;
        const { container } = render(
            <GameContext value={value}>
                <PendingChoiceBufferContext value={noopBuffer}>
                    <MinimizedChoiceContext
                        value={{
                            isMinimized: false,
                            minimize: () => {},
                            restore: () => {},
                        }}
                    >
                        <PendingChoicePrompt
                            choice={choice}
                            playerId="me"
                            gameId={"g1" as never}
                        />
                    </MinimizedChoiceContext>
                </PendingChoiceBufferContext>
            </GameContext>
        );
        expectPortraitSafePosition(container);
    });
});

// Issue #1813 — the new portrait default: a prompt with nothing on the
// mid-board for the player to tap renders vertically centered instead of
// pinned to the safe-area strip.
describe("Prompt banners — portrait centers vertically when no board tap is required (issue #1813)", () => {
    it("MulliganPrompt", () => {
        const mulligan: MulliganState = {
            declaringPlayerId: "me",
            mulligansTaken: [0, 0],
        } as MulliganState;
        const { container } = render(
            <MulliganPrompt
                gameId={"g1" as never}
                viewerId="me"
                mulligan={mulligan}
                allPlayers={[player()]}
            />
        );
        expectPortraitCenteredPosition(container);
    });

    // A zone-less `may-pay` choice with a LIFE-only cost (no mana leg) — the
    // review-fixup replacement for the old `search-library` case (issue
    // #1823): a library pick's real dialog surface is the full-screen pile
    // modal, which sits ON TOP of this banner (behind its scrim) in the real
    // app, so asserting this banner's OWN position there proved little. A
    // pure life-cost may-pay renders as a bare centered banner with nothing
    // else competing for the screen, so it is the meaningful example of "a
    // choice with genuinely nothing on the mid-board to cover".
    it("PendingChoicePrompt — a may-pay choice with a life-only cost (no mana leg)", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "may-pay",
            count: 1,
            cost: { life: 2 },
            prompt: "Pay 2 life?",
        } as PendingChoice;
        const value = {
            gameId: "g1" as never,
            playerId: "me",
            activePlayerId: "me",
            priorityPlayerId: "me",
            phase: "PRECOMBAT_MAIN",
            turn: 1,
            engineTurn: 1,
            stackCount: 0,
            allPlayers: [player()],
            showAllCards: false,
            debugAllActions: false,
            onSwitchGame: () => {},
            pendingChoices: [choice],
        } as unknown as React.ContextType<typeof GameContext>;
        const { container } = render(
            <GameContext value={value}>
                <PendingChoiceBufferContext value={noopBuffer}>
                    <MinimizedChoiceContext
                        value={{
                            isMinimized: false,
                            minimize: () => {},
                            restore: () => {},
                        }}
                    >
                        <PendingChoicePrompt
                            choice={choice}
                            playerId="me"
                            gameId={"g1" as never}
                        />
                    </MinimizedChoiceContext>
                </PendingChoiceBufferContext>
            </GameContext>
        );
        expectPortraitCenteredPosition(container);
    });
});

// Issue #1823 review finding 1 — regression coverage: a `may-pay` whose cost
// has a MANA leg (Echo, cumulative upkeep, "unless you pay {mana}") is
// zone-less BY DESIGN (`requestMayPay` only sets `zone` for a real
// sacrifice/discard victim pick), so `zone === "battlefield"` alone used to
// miss it entirely — it rendered centered even though the player must tap
// lands with the prompt open (there is no auto-tap; the Pay button only
// enables once the pool already covers the cost). It must now pin to the
// safe-area strip like any other board-tap choice.
describe("Prompt banners — a may-pay with a mana leg pins even though it carries no zone (issue #1823 review finding 1)", () => {
    it("PendingChoicePrompt — a may-pay choice with a mana cost", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "may-pay",
            count: 1,
            cost: { R: 1 },
            prompt: "Pay echo ({R}) to keep this permanent?",
        } as PendingChoice;
        const value = {
            gameId: "g1" as never,
            playerId: "me",
            activePlayerId: "me",
            priorityPlayerId: "me",
            phase: "PRECOMBAT_MAIN",
            turn: 1,
            engineTurn: 1,
            stackCount: 0,
            allPlayers: [player()],
            showAllCards: false,
            debugAllActions: false,
            onSwitchGame: () => {},
            pendingChoices: [choice],
        } as unknown as React.ContextType<typeof GameContext>;
        const { container } = render(
            <GameContext value={value}>
                <PendingChoiceBufferContext value={noopBuffer}>
                    <MinimizedChoiceContext
                        value={{
                            isMinimized: false,
                            minimize: () => {},
                            restore: () => {},
                        }}
                    >
                        <PendingChoicePrompt
                            choice={choice}
                            playerId="me"
                            gameId={"g1" as never}
                        />
                    </MinimizedChoiceContext>
                </PendingChoiceBufferContext>
            </GameContext>
        );
        expectPortraitSafePosition(container);
    });
});

// Issue #1762 review finding 8 — the suite above hand-enumerates six named
// banners with `portrait = true` in every case, so (a) a banner that
// re-invents the dead-center recipe INSTEAD of adopting the hook (the exact
// bug `minimized-choice-indicator.tsx` / `pile-division-picker.tsx` had —
// review findings 3/4) can't fail it, since it's simply never in the list,
// and (b) the desktop/landscape path is never exercised at all. Two more
// suites close both gaps: a source-level sweep with no hardcoded list to
// fall out of date, and one landscape case.
describe("Prompt banners — landscape/desktop path is unchanged (issue #1762)", () => {
    it("PaymentBanner still centers on the board via top-1/2 left-1/2 and stays draggable", () => {
        portrait = false;
        const pa: PendingActivation = {
            playerId: "me",
            cardInstanceId: "src",
            abilityId: "ability",
            manaCost: { R: 1 },
            tappedLandIds: [],
            tapSource: false,
            sacrificeSource: false,
        };
        const { container } = render(
            <PaymentBanner
                kind="activation"
                pendingActivation={pa}
                me={player()}
                gameId={"g1" as never}
                playerId="me"
            />
        );
        const outer = container.firstElementChild as HTMLElement | null;
        expect(outer).not.toBeNull();
        const className = outer!.className;
        expect(className).toContain("top-1/2");
        expect(className).toContain("left-1/2");
        expect(className).not.toContain("fixed");
        expect(className).not.toContain("env(safe-area-inset-top)");
    });
});

// Issue #1762 review finding 8 (widened) — a catalogue-wide, self-maintaining
// proof that no `src/components/board` source file re-invents the hardcoded
// `absolute top-1/2 left-1/2` dead-center recipe `usePromptBannerPosition`
// exists to replace. The original gate here was `hasDeadCenter &&
// hasUseDraggable` — but that let a HARDCODED `top-1/2 left-1/2` with NO
// `useDraggable` call through clean, which is exactly the pre-fix shape of
// `minimized-choice-indicator.tsx` (dead-center markup with no drag wiring
// at all). The gate is now `hasDeadCenter && !importsUsePromptBannerPosition`
// — any board file that dead-centers AND has not adopted the shared hook is
// an offender, regardless of whether it happens to also call
// `useDraggable`. Comments are stripped before matching so a file's own
// prose EXPLAINING the historical bug (as this fix's own code comments now
// do, by design) doesn't trip the sweep on itself — only live code counts.
describe("Prompt banners — no hand-rolled dead-center positioning remains (issue #1762)", () => {
    const BOARD_DIR = path.resolve("src/components/board");

    // Files that legitimately combine `top-1/2` + `left-1/2` for a REASON
    // OTHER than this bug class, so they are exempt from the sweep. Kept
    // explicit (not "everything not in the hand-enumerated list above") so a
    // future addition here needs a one-line justification, not a silent
    // pass. The companion test below asserts every entry here still actually
    // trips the widened pattern — a stale entry (one that no longer matches)
    // fails CI as a signal to remove it.
    const ALLOWLIST: Record<string, string> = {
        "counter-badges.tsx":
            "Per-card counter overlay (CR 122) centered ON THE CARD, not the " +
            "board — decorative, pointer-events-none, positioned relative to " +
            "its own battlefield-card container rather than the viewport. " +
            "It is not a prompt banner, has never called useDraggable, and " +
            "has no reason to ever adopt usePromptBannerPosition, so it " +
            "legitimately trips `hasDeadCenter && !importsHook` forever.",
    };

    function stripComments(src: string): string {
        return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    }

    function collectBoardFiles(dir: string): string[] {
        const out: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "__tests__") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                out.push(...collectBoardFiles(full));
            } else if (entry.name.endsWith(".tsx")) {
                out.push(full);
            }
        }
        return out;
    }

    /** The widened offense predicate (issue #1762 fixup): dead-centered AND
     *  has not adopted the shared positioning hook. Deliberately does NOT
     *  also require `useDraggable` — a hardcoded dead-center div with no
     *  drag wiring at all is still the bug class. */
    function tripsWidenedPattern(code: string): boolean {
        const hasDeadCenter =
            code.includes("top-1/2") && code.includes("left-1/2");
        const importsHook = code.includes("usePromptBannerPosition");
        return hasDeadCenter && !importsHook;
    }

    it("every source file under src/components/board is clean (or explicitly allowlisted)", () => {
        const files = collectBoardFiles(BOARD_DIR);
        expect(files.length).toBeGreaterThan(50); // sanity: the sweep is actually walking the tree

        const offenders: string[] = [];
        for (const file of files) {
            const base = path.basename(file);
            if (base in ALLOWLIST) continue;
            const code = stripComments(fs.readFileSync(file, "utf8"));
            if (tripsWidenedPattern(code)) {
                offenders.push(path.relative(BOARD_DIR, file));
            }
        }
        expect(offenders).toEqual([]);
    });

    it("the allowlist itself stays honest — every entry still exists and still trips the widened pattern it's excused from", () => {
        const files = collectBoardFiles(BOARD_DIR);
        for (const base of Object.keys(ALLOWLIST)) {
            const matches = files.filter((f) => path.basename(f) === base);
            expect(matches.length).toBeGreaterThan(0);
            for (const file of matches) {
                const code = stripComments(fs.readFileSync(file, "utf8"));
                expect(tripsWidenedPattern(code)).toBe(true);
            }
        }
    });
});
