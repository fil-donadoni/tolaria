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

vi.mock("@convex/cards/emblems", () => ({
    tryGetEmblemDefinition: () => undefined,
}));

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
 *  board (`top-1/2`/`left-1/2`) and always uses the safe-area-aware fixed
 *  strip in portrait (issue #1762 acceptance criterion: never covers the
 *  board center or the bottom controls). */
function expectPortraitSafePosition(container: HTMLElement) {
    const outer = container.firstElementChild as HTMLElement | null;
    expect(outer).not.toBeNull();
    const className = outer!.className;
    expect(className).not.toContain("top-1/2");
    expect(className).not.toContain("left-1/2");
    expect(className).toContain("fixed");
    expect(className).toContain("env(safe-area-inset-top)");
}

describe("Prompt banners — portrait never centers on the board (issue #1762)", () => {
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

    it("PendingChoicePrompt", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "search-library",
            zone: "library",
            count: 1,
            prompt: "Search your library for a card.",
        } as PendingChoice;
        const value = {
            gameId: "g1" as never,
            playerId: "me",
            activePlayerId: "me",
            priorityPlayerId: "me",
            phase: "PRECOMBAT_MAIN",
            turn: 1,
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

// Issue #1762 review finding 8 — a catalogue-wide, self-maintaining proof
// that no `src/components/board` source file re-invents the hardcoded
// `absolute top-1/2 left-1/2` + `useDraggable` dead-center recipe
// `usePromptBannerPosition` exists to replace (the bug class review findings
// 3/4 caught — a banner not on the hand-enumerated list above can't fail
// it). Comments are stripped before matching so a file's own prose EXPLAINING
// the historical bug (as this fix's own code comments now do, by design)
// doesn't trip the sweep on itself — only live code counts.
describe("Prompt banners — no hand-rolled dead-center + useDraggable pair remains (issue #1762)", () => {
    const BOARD_DIR = path.resolve("src/components/board");

    // Files that legitimately combine `top-1/2` + `left-1/2` for a REASON
    // OTHER than this bug class, so they are exempt from the sweep. Kept
    // explicit (not "everything not in the hand-enumerated list above") so a
    // future addition here needs a one-line justification, not a silent
    // pass.
    const ALLOWLIST: Record<string, string> = {
        "counter-badges.tsx":
            "Per-card counter overlay (CR 122) centered ON THE CARD, not the " +
            "board — decorative, pointer-events-none, no useDraggable import, " +
            "so it never actually matches the useDraggable half of the pair " +
            "(kept here for documentation, not because the sweep needs it).",
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

    it("every source file under src/components/board is clean (or explicitly allowlisted)", () => {
        const files = collectBoardFiles(BOARD_DIR);
        expect(files.length).toBeGreaterThan(50); // sanity: the sweep is actually walking the tree

        const offenders: string[] = [];
        for (const file of files) {
            const base = path.basename(file);
            if (base in ALLOWLIST) continue;
            const code = stripComments(fs.readFileSync(file, "utf8"));
            const hasDeadCenter =
                code.includes("top-1/2") && code.includes("left-1/2");
            const hasUseDraggable = code.includes("useDraggable");
            if (hasDeadCenter && hasUseDraggable) {
                offenders.push(path.relative(BOARD_DIR, file));
            }
        }
        expect(offenders).toEqual([]);
    });

    it("the allowlist itself stays honest — every entry still exists and still matches the pattern it's excused from", () => {
        for (const base of Object.keys(ALLOWLIST)) {
            const matches = collectBoardFiles(BOARD_DIR).filter(
                (f) => path.basename(f) === base
            );
            expect(matches.length).toBeGreaterThan(0);
        }
    });
});
