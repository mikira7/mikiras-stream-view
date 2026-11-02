import { setting } from "../constants.js";
import { Role } from "../role.js";

/*
 * In the companion app, things that belong to the whole stream rather than one pane (the combat carousel, images and
 * journals the GM shows, the hold screen) are drawn by the app over the whole window. Pane 1 gathers them here and
 * sends them to the app; the panes themselves don't show them.
 */

const SEND_DELAY = 50;

const state = {
  carousel: null,
  /** Shown images and journals by application id, in the order they opened. */
  windows: new Map(),
  hold: null
};

let timer = null;

/** Is this the client that feeds the app's overlay? */
export function feedsOverlay() {
  return !!Role.companion && Role.isLead;
}

function send() {
  timer = null;
  Role.companion?.setOverlay?.({
    carousel: state.carousel,
    windows: [...state.windows.values()],
    hold: state.hold
  });
}

function sendSoon() {
  if (!feedsOverlay() || timer) return;
  timer = setTimeout(send, SEND_DELAY);
}

const absolute = url => (url ? new URL(url, window.location.href).href : url);

export function setCarousel(data) {
  state.carousel = data;
  sendSoon();
}

export function syncHoldOverlay() {
  state.hold = setting("hold") ? { message: setting("holdMessage") } : null;
  sendSoon();
}

/** An image the GM shared has opened (or re-rendered) in pane 1. */
export function onImageShown(app) {
  if (!feedsOverlay()) return;
  state.windows.set(app.id, {
    id: app.id,
    type: "image",
    title: app.options.window?.title ?? "",
    caption: app.options.caption ?? "",
    src: absolute(app.options.src)
  });
  sendSoon();
}

/** A journal the GM showed has opened or changed page in pane 1: send its rendered page content. */
export function onJournalShown(app, element) {
  if (!feedsOverlay()) return;
  captureJournal(app, element);
  // Page content renders a moment after the sheet; capture again once it has.
  setTimeout(() => app.rendered && captureJournal(app), 500);
}

function captureJournal(app, element) {
  const pages = (element ?? app.element)?.querySelector(".journal-entry-pages");
  if (!pages) return;
  const content = pages.cloneNode(true);
  // Make image and link addresses absolute, since the app's overlay isn't served from the game.
  for (const el of content.querySelectorAll("[src]")) el.setAttribute("src", absolute(el.getAttribute("src")));
  for (const el of content.querySelectorAll("[href]")) el.setAttribute("href", absolute(el.getAttribute("href")));
  state.windows.set(app.id, { id: app.id, type: "journal", title: app.document?.name ?? "", html: content.innerHTML });
  sendSoon();
}

export function onWindowClosed(app) {
  if (!state.windows.delete(app.id)) return;
  sendSoon();
}
