/**
 * BRIDGE (PRD #3148 S1). Tab navigation is now a typed store owned by React —
 * `dashboard/lib/view.ts` — and this file exists only so the keyboard layer
 * (`shortcuts.js`, #2635) can keep switching views with the import it already
 * had. One function changes which view is visible, so a tab click and a `1` /
 * `2` keystroke can never disagree about what "switch to Now" does.
 *
 * Dies with the last vanilla module (S4).
 */
export {
    VIEWS,
    DEFAULT_VIEW,
    viewFromParams,
    switchView,
} from "../../dashboard/lib/view";
