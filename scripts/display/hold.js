import { setting } from "../constants.js";
import { Role } from "../role.js";
import { syncHoldOverlay } from "./companion.js";

/*
 * The hold card: a full-window "be right back" screen the GM can put up from the Stream Panes panel. While it is up
 * the panes aren't drawn at all.
 */

const ELEMENT_ID = "msv-hold";

export function syncHold() {
  if (!Role.isDisplay) return;
  const hold = setting("hold");
  document.body.classList.toggle("msv-hold", hold);
  // In the companion app the app shows one hold card over the whole window; each pane only goes black.
  syncHoldOverlay();
  let el = document.getElementById(ELEMENT_ID);
  if (!hold) return el?.remove();
  if (!el) {
    el = document.createElement("div");
    el.id = ELEMENT_ID;
    el.append(document.createElement("p"));
    document.body.append(el);
  }
  el.firstElementChild.textContent = setting("holdMessage");
}
