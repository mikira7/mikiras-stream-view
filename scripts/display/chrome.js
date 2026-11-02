import { setting } from "../constants.js";
import { Role } from "../role.js";

/*
 * Stream "chrome" around the panes: Foundry's chat log as a column down the right, the STA 2e Toolkit's calendar at
 * the top centre of the pane area, and its Momentum/Threat tracker docked beside the chat at mid-height (the
 * toolkit's own docking, which measures the chat column). Everything else of
 * Foundry's interface, and the toolkit's combat HUD, stays hidden (see stream-view.css).
 *
 * In single-window mode the display client shows all of this itself. In the companion app the "sidebar" client does,
 * as a transparent layer over the panes, and reports where the calendar ends so the app can place the carousel.
 */

const CALENDAR_ID = "sta2e-hud-container";
const GAP = 6;
const WATCH_INTERVAL = 500;

/** Width reserved for the chat column on the right, in pixels; 0 when there is none. */
export function chatColumnWidth() {
  return setting("showChat") ? setting("chatWidth") : 0;
}

/** Show the chat column (or not) and size it. Safe to call whenever settings change. */
export function syncChrome() {
  if (!Role.isDisplay) return;
  const width = Role.showsChrome ? chatColumnWidth() : 0;
  document.body.classList.toggle("msv-chat", width > 0);
  // Dice So Nice rolls once across the whole stream: on the companion's chat layer when it has one, else on pane 1.
  document.body.classList.toggle("msv-hide-dice", Role.isPane && ((chatColumnWidth() > 0) || !Role.isLead));
  // Companion panes size their own window; only the full-window clients reserve the column.
  document.body.style.setProperty("--msv-chat-width", `${width}px`);
  if (width && ui.sidebar) {
    try {
      ui.sidebar.changeTab("chat", "primary");
      if (!ui.sidebar.expanded) ui.sidebar.expand();
    } catch(err) {
      console.warn(err);
    }
  }
}

let lastInset = null;

/** How far below the top of the window an element ends, plus a gap; 0 when it isn't showing. */
function bottomOf(id) {
  const el = document.getElementById(id);
  if (!el || (getComputedStyle(el).display === "none")) return 0;
  const rect = el.getBoundingClientRect();
  return rect.height ? Math.ceil(rect.bottom) + GAP : 0;
}

/** Keep the carousel just below the calendar, as the calendar appears, collapses or changes size. */
export function watchCalendar() {
  if (!Role.showsChrome) return;
  setInterval(() => {
    const inset = bottomOf(CALENDAR_ID);
    if (inset === lastInset) return;
    lastInset = inset;
    document.body.style.setProperty("--msv-top-inset", `${inset}px`);
    if (Role.isSidebar) Role.companion?.setChrome?.({ topInset: inset });
  }, WATCH_INTERVAL);
}
