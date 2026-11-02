import { MODULE_ID, setting } from "../constants.js";
import { Role } from "../role.js";
import { paneSubject } from "./vision.js";

/*
 * Foundry v14 draws one level of a scene at a time, and switching levels redraws the whole canvas. The stream
 * therefore views a single level, chosen by the GM: pane 1's token's level, the level most panes' tokens are on, or
 * whichever level the GM is viewing. Panes whose token is elsewhere show an "on another level" card.
 *
 * Foundry also switches a player's view by itself when a token they observe changes level. The stream ignores that
 * and only switches when its own choice changes.
 */

const CHECK_INTERVAL = 1000;

let switching = false;
let lastCheck = 0;

/** The level the stream should be viewing, or null to stay where it is. */
export function desiredLevel() {
  const scene = canvas.scene;
  if (!scene || (scene.levels.size <= 1)) return null;

  // A companion pane is its own client, so it simply views its own token's level.
  if (Role.isPane) {
    const subject = paneSubject(Role.paneIndex);
    if (subject) return subject.level;
    const gmMode = setting("panes").slots?.[Role.paneIndex]?.mode === "gm";
    const gm = game.users.activeGM;
    return (gmMode && (gm?.viewedScene === scene.id)) ? gm.viewedLevel : null;
  }

  const source = setting("streamLevel");
  if (source === "gm") {
    const gm = game.users.activeGM;
    return (gm?.viewedScene === scene.id) ? gm.viewedLevel : null;
  }

  const { count } = setting("panes");
  const levels = [];
  for (let i = 0; i < count; i++) {
    const level = paneSubject(i)?.level;
    if (level) levels.push(level);
  }
  if (!levels.length) return null;
  if (source === "pane1") return levels[0];

  // Most panes' tokens; ties go to the earlier pane.
  const counts = new Map();
  for (const level of levels) counts.set(level, (counts.get(level) ?? 0) + 1);
  return levels.reduce((best, level) => (counts.get(level) > counts.get(best) ? level : best), levels[0]);
}

/** Switch the stream's viewed level if it no longer matches the GM's choice. Cheap enough to call every frame. */
export function syncLevel() {
  if (!Role.isDisplay || switching || canvas.loading || !canvas.ready) return;
  const now = performance.now();
  if ((now - lastCheck) < CHECK_INTERVAL) return;
  lastCheck = now;

  const level = desiredLevel();
  if (!level || (level === canvas.level?.id) || !canvas.scene.levels.has(level)) return;
  switching = true;
  canvas.scene.view({ level, msvLevelSync: true }).finally(() => switching = false);
}

/** On the stream, ignore level switches that didn't come from {@link syncLevel}. Scene changes still go through. */
export function guardLevelSwitching() {
  if (!Role.isDisplay) return;
  function guard(wrapped, options = {}) {
    const levelOnly = (this === canvas.scene) && (options.level !== undefined) && (options.level !== canvas.level?.id);
    if (levelOnly && !options.msvLevelSync) return Promise.resolve(this);
    return wrapped(options);
  }
  // Monk's Scene Navigation and others wrap Scene#view too; libWrapper lets the wrappers chain cleanly.
  if (game.modules.get("lib-wrapper")?.active) {
    libWrapper.register(MODULE_ID, "Scene.prototype.view", guard, "MIXED");
    return;
  }
  const proto = CONFIG.Scene.documentClass.prototype;
  const view = proto.view;
  proto.view = function(options) {
    return guard.call(this, view.bind(this), options);
  };
}

export function levelName(levelId) {
  return canvas.scene?.levels.get(levelId)?.name ?? "?";
}
