import { Role } from "../role.js";
import { emit, registerHandler } from "../socket.js";

/*
 * "GM view" panes follow the GM's camera. The active GM sends their view (at most ten times a second) whenever they
 * pan or zoom, and the stream asks for it when it loads a scene.
 */

const SEND_INTERVAL = 100;

/** The latest view received from the GM. */
let latest = null;
let pending = null;

/** The GM's view of the scene the stream is showing, if known. */
export function getGmView() {
  return (latest?.sceneId === canvas.scene?.id) ? latest : null;
}

function isResponsibleGM() {
  return game.user.isGM && (game.users.activeGM === game.user);
}

function sendNow() {
  if (!isResponsibleGM() || !canvas.ready) return;
  const stage = canvas.stage;
  emit("gmView", {
    sceneId: canvas.scene.id,
    x: stage.pivot.x,
    y: stage.pivot.y,
    scale: stage.scale.x,
    width: canvas.screenDimensions[0],
    height: canvas.screenDimensions[1]
  });
}

/** Send the GM's view soon, coalescing a burst of pans into one message with the final position. */
export function sendGmViewSoon() {
  if (!isResponsibleGM() || pending) return;
  pending = setTimeout(() => {
    pending = null;
    sendNow();
  }, SEND_INTERVAL);
}

export function requestGmView() {
  if (Role.isDisplay) emit("requestGmView");
}

registerHandler("gmView", view => {
  if (Role.isDisplay) latest = view;
});

registerHandler("requestGmView", () => sendNow());
