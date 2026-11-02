import { MODULE_ID, setting } from "./constants.js";

/** URL parameter that marks a client as one pane of the companion app: `/game?msv=pane-2`. */
const PANE_PARAM = "msv";
const PANE_PREFIX = "pane-";

/**
 * Which part this client plays.
 * - "gm": a GM client, controls the display
 * - "display": the stream user's window, drawn as a grid of token viewpoints
 * - "pane": one pane inside the companion app, a full Foundry client drawing just that pane
 * - "player": anyone else, untouched
 */
export const Role = {
  current: "player",

  /** For "pane": which pane (0-based). */
  paneIndex: null,

  detect() {
    const param = new URLSearchParams(window.location.search).get(PANE_PARAM) ?? "";
    const pane = param.startsWith(PANE_PREFIX) ? Number(param.slice(PANE_PREFIX.length)) - 1 : NaN;
    if (game.user?.isGM) this.current = "gm";
    else if (!Role.isDisplayUser(game.userId)) this.current = "player";
    else if (Number.isInteger(pane) && (pane >= 0)) {
      this.current = "pane";
      this.paneIndex = pane;
    }
    else this.current = "display";
    return this.current;
  },

  isDisplayUser(userId) {
    return !!userId && setting("streamUser") === userId;
  },

  /** Any stream client: the single-window display or a companion pane. */
  get isDisplay() {
    return (this.current === "display") || (this.current === "pane");
  },

  get isPane() {
    return this.current === "pane";
  },

  /**
   * The client that owns things only one stream client should do: save fog, play sound, show images, journals and
   * the combat carousel. In the companion app that is pane 1.
   */
  get isLead() {
    return (this.current === "display") || ((this.current === "pane") && (this.paneIndex === 0));
  },

  /** The companion app's bridge, when running inside it. */
  get companion() {
    return globalThis.msvCompanion ?? null;
  }
};

export async function toggleDisplayUser(userId) {
  await game.settings.set(MODULE_ID, "streamUser", Role.isDisplayUser(userId) ? "" : userId);
}
