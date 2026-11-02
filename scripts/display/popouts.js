import { setting } from "../constants.js";
import { Role } from "../role.js";
import { emit, registerHandler } from "../socket.js";

/*
 * Images and journals the GM shows to players open on the stream as ordinary windows over the panes.
 * The stream closes them by itself after a delay, when the GM clears them, or when the GM closes their own copy.
 */

const ImagePopout = () => foundry.applications.apps.ImagePopout;
const JournalEntrySheet = () => foundry.applications.sheets.journal.JournalEntrySheet;

/** Pending auto-close timers, keyed by application id. */
const timers = new Map();

function openApps(cls) {
  return [...foundry.applications.instances.values()].filter(app => app instanceof cls() && app.rendered);
}

function closeApp(app) {
  clearTimeout(timers.get(app.id));
  timers.delete(app.id);
  app.close();
}

/** (Re)start the auto-close countdown for an app shown on the stream. A delay of 0 keeps it open. */
function scheduleClose(app, seconds) {
  clearTimeout(timers.get(app.id));
  timers.delete(app.id);
  if (!seconds) return;
  timers.set(app.id, setTimeout(() => closeApp(app), seconds * 1000));
}

/* -------------------------------------------- */
/*  Stream side                                 */
/* -------------------------------------------- */

export function onRenderImagePopout(app, element, context, options) {
  if (Role.isDisplay && options.isFirstRender) scheduleClose(app, setting("imageCloseAfter"));
}

export function onRenderJournalSheet(app, element, context, options) {
  if (Role.isDisplay && options.isFirstRender) scheduleClose(app, setting("journalCloseAfter"));
}

export function onCloseApp(app) {
  clearTimeout(timers.get(app.id));
  timers.delete(app.id);
}

registerHandler("clearImages", ({ src } = {}) => {
  if (!Role.isDisplay) return;
  for (const app of openApps(ImagePopout)) if (!src || (app.options.src === src)) closeApp(app);
});

registerHandler("clearJournals", ({ uuid } = {}) => {
  if (!Role.isDisplay) return;
  for (const app of openApps(JournalEntrySheet)) if (!uuid || (app.document.uuid === uuid)) closeApp(app);
});

/* -------------------------------------------- */
/*  GM side                                     */
/* -------------------------------------------- */

export function clearImages() {
  emit("clearImages");
}

export function clearJournals() {
  emit("clearJournals");
}

/** When the GM closes their own copy of an image or journal, close it on the stream too. */
export function onGMCloseImagePopout(app) {
  if (game.user.isGM && setting("closeWithGm") && app.options.src) emit("clearImages", { src: app.options.src });
}

export function onGMCloseJournalSheet(app) {
  if (game.user.isGM && setting("closeWithGm") && app.document?.uuid) emit("clearJournals", { uuid: app.document.uuid });
}
