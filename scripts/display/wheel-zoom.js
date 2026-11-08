import { MODULE_ID, setting } from "../constants.js";
import { Role } from "../role.js";
import { emit, registerHandler } from "../socket.js";

/*
 * Mouse-wheel zoom, both over a pane's zoom box in the GM's pane panel and over a pane in the stream window itself.
 *
 * The stream user can't change world settings, so the stream zooms its pane at once with a local override and asks the
 * active GM to save the new zoom. The override is dropped once the saved setting catches up.
 */

/** Limits for the two kinds of pane zoom: grid squares top to bottom, or percent of the fitted scene. */
export const ZOOM_LIMITS = {
  zoom: { min: 4, max: 40 },
  sceneZoom: { min: 50, max: 1000 }
};

/** Wait this long after the last wheel tick before saving, so a quick scroll is one settings change. */
const SAVE_DELAY = 250;

/** Drop a local override this long after the last wheel tick even if the setting never caught up. */
const OVERRIDE_TIMEOUT = 3000;

/**
 * One wheel tick's step from the current zoom.
 * @param {"zoom"|"sceneZoom"} kind
 * @param {number} current
 * @param {boolean} closer      Wheel up: zoom in.
 * @returns {number}
 */
export function stepZoom(kind, current, closer) {
  let next;
  // Percent of the fitted scene, in steps of a quarter so each tick feels the same size.
  if (kind === "sceneZoom") next = Math.round((closer ? current * 1.25 : current / 1.25) / 5) * 5;
  // Grid squares top to bottom: fewer is closer.
  else next = current + (closer ? -1 : 1);
  return Math.clamp(next, ZOOM_LIMITS[kind].min, ZOOM_LIMITS[kind].max);
}

/** The zoom a pane's slot has saved, or the default. */
function savedZoom(index, kind) {
  const slot = setting("panes").slots?.[index];
  if (kind === "sceneZoom") return slot?.sceneZoom || 100;
  return slot?.zoom || setting("paneZoom");
}

/* -------------------------------------------- */
/*  Stream side                                 */
/* -------------------------------------------- */

/** Local zoom per pane index while a scroll on the stream waits to be saved: { kind, value, expires }. */
const overrides = new Map();
const saveTimers = new Map();

/**
 * The zoom a pane should use right now: a pending scroll on the stream, else the saved setting.
 * @param {number} index
 * @param {"zoom"|"sceneZoom"} kind
 * @returns {number|undefined}  undefined when there is no override.
 */
export function zoomOverride(index, kind) {
  const o = overrides.get(index);
  if (!o || (o.kind !== kind)) return undefined;
  const settled = (savedZoom(index, kind) === o.value) && !saveTimers.has(index);
  if (settled || (performance.now() > o.expires)) {
    overrides.delete(index);
    return undefined;
  }
  return o.value;
}

let installed = false;

/**
 * Listen for the wheel over the stream window's canvas.
 * @param {(x: number, y: number) => {index: number, camera: string}|null} paneAt  Which pane is under a screen point.
 */
export function installStreamWheelZoom(paneAt) {
  if (installed || !Role.drawsPanes) return;
  installed = true;
  // Capture on the window so this runs before Foundry's own wheel handling, which would pan and zoom the board.
  window.addEventListener("wheel", event => {
    const view = canvas.app?.view;
    if (!view || (event.target !== view) || !event.deltaY) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = view.getBoundingClientRect();
    const pane = paneAt(event.clientX - rect.left, event.clientY - rect.top);
    if (!pane) return;
    // GM view panes follow the GM's camera; there's nothing of their own to zoom.
    const kind = { token: "zoom", scene: "sceneZoom" }[pane.camera];
    if (!kind) return;
    const current = zoomOverride(pane.index, kind) ?? savedZoom(pane.index, kind);
    const value = stepZoom(kind, current, event.deltaY < 0);
    if (value === current) return;
    overrides.set(pane.index, { kind, value, expires: performance.now() + OVERRIDE_TIMEOUT });
    clearTimeout(saveTimers.get(pane.index));
    saveTimers.set(pane.index, setTimeout(() => {
      saveTimers.delete(pane.index);
      emit("zoomPane", { index: pane.index, kind, value });
    }, SAVE_DELAY));
  }, { capture: true, passive: false });
}

/* -------------------------------------------- */
/*  GM side                                     */
/* -------------------------------------------- */

registerHandler("zoomPane", async ({ index, kind, value } = {}) => {
  if (!game.user.isGM || (game.users.activeGM !== game.user)) return;
  if (!Number.isInteger(index) || (index < 0) || !(kind in ZOOM_LIMITS) || !Number.isFinite(value)) return;
  const panes = foundry.utils.deepClone(setting("panes"));
  panes.slots ??= [];
  panes.slots[index] = { ...(panes.slots[index] ?? {}),
    [kind]: Math.clamp(value, ZOOM_LIMITS[kind].min, ZOOM_LIMITS[kind].max) };
  await game.settings.set(MODULE_ID, "panes", panes);
});
