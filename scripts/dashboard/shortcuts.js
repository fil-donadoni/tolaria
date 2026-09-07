/**
 * BRIDGE (PRD #3148 S2). The keyboard layer is now a typed module owned by
 * React — `dashboard/lib/shortcuts.ts` — and its sheet is a shadcn dialog
 * (`dashboard/components/ShortcutsSheet.tsx`). This file exists only so
 * `scripts/__tests__/dashboard-shortcuts.test.ts` can keep driving the
 * decision table with the import it already had, from the `node` project.
 *
 * Dies with the last vanilla module (S4), when that test moves to
 * `@testing-library/react` in the `dom` project.
 */
export {
    SHORTCUTS,
    isTypingTarget,
    handleKeydown,
    sheetOpen,
    openSheet,
    closeSheet,
    toggleSheet,
} from "../../dashboard/lib/shortcuts";
