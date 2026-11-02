import { setting } from "../constants.js";

export const MAX_PANES = 6;

/**
 * What a pane can show.
 * - token: one token's point of view (a chosen token, or Auto)
 * - combatant: whoever's turn it is, falling back to the party when nobody is up
 * - party: everyone the stream can see through, framed together
 * - gm: the party's combined vision, through the GM's own camera
 * - scene: the party's combined vision, fitted to the whole scene
 */
export const PANE_MODES = ["token", "combatant", "party", "gm", "scene"];

/*
 * Foundry v14 draws one level of a scene at a time and only creates canvas Tokens for that level. Panes are therefore
 * worked out from TokenDocuments, which exist for every level, and use the canvas Token only when it is drawn.
 */

/** Is this token on the level the canvas is viewing (and so drawn, and able to see)? */
export const onViewedLevel = doc => (doc.level === canvas.level?.id) && !!doc.object;

/** Token documents the display user could see through, on any level, in a stable order. */
export function candidateDocuments() {
  return (canvas.scene?.tokens.contents ?? [])
    .filter(d => d.sight.enabled && !d.hidden && d.testUserPermission(game.user, "OBSERVER"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Canvas tokens the display user could see through on the viewed level. */
export function candidateTokens() {
  return candidateDocuments().filter(onViewedLevel).map(d => d.object);
}

/** Find the token document a slot points at: the exact token if present, else one of the same actor. */
export function resolveSlot(slot) {
  if (!slot?.tokenId && !slot?.actorId) return null;
  const tokens = canvas.scene?.tokens;
  if (!tokens) return null;
  return tokens.get(slot.tokenId) ?? (slot.actorId ? tokens.find(d => d.actorId === slot.actorId) : null) ?? null;
}

export const slotMode = slot => slot?.mode ?? "token";
const isAssigned = slot => !!(slot?.tokenId || slot?.actorId);

/**
 * The token document a token-mode pane follows. Assigned slots win; Auto panes take the observable tokens that no
 * other token-mode pane has claimed, in name order, on any level.
 */
export function paneToken(index) {
  const { slots = [] } = setting("panes");
  const slot = slots[index];
  if (isAssigned(slot)) return resolveSlot(slot);

  const tokenSlots = slots.filter(s => slotMode(s) === "token");
  const claimed = new Set(tokenSlots.map(resolveSlot).filter(Boolean));
  const autoIndex = slots.slice(0, index).filter(s => (slotMode(s) === "token") && !isAssigned(s)).length;
  return candidateDocuments().filter(d => !claimed.has(d))[autoIndex] ?? null;
}

/** The active combatant's token document, if a combat is running and it isn't hidden. */
function activeCombatantToken() {
  const combat = game.combat;
  const doc = combat?.started ? combat.combatant?.token : null;
  return (doc && !doc.hidden && (doc.parent === canvas.scene)) ? doc : null;
}

/** The single token document a pane is about, if any: its followed token, or the active combatant. */
export function paneSubject(index) {
  const slot = setting("panes").slots?.[index];
  switch (slotMode(slot)) {
    case "token": return paneToken(index);
    case "combatant": return activeCombatantToken();
    default: return null;
  }
}

/**
 * @typedef PaneView
 * @property {string} mode
 * @property {Token[]} vision     Canvas tokens whose vision the pane uses.
 * @property {Token[]} focus      Canvas tokens the camera keeps in frame.
 * @property {"focus"|"gm"|"scene"} camera
 * @property {string} label
 * @property {boolean} [empty]    Nothing to draw.
 * @property {boolean} [blind]    The followed token can't be seen through by the stream user.
 * @property {string} [portrait]  For a token on another level: its image, shown on a card.
 * @property {TokenDocument} [subject]  The token the pane is about, if any.
 */

/** A card for a pane whose token is on a level the stream isn't viewing. */
function offLevelView(mode, doc) {
  const level = canvas.scene?.levels.get(doc.level)?.name ?? "?";
  return {
    mode, vision: [], focus: [], camera: "scene", empty: true, subject: doc, portrait: doc.texture.src,
    label: game.i18n.format("MSV.Pane.OnLevel", { name: doc.name, level })
  };
}

/** Work out what a pane shows right now. */
export function paneView(index) {
  const slot = setting("panes").slots?.[index];
  const mode = slotMode(slot);
  const partyLabel = game.i18n.localize("MSV.Pane.Party");
  const partyView = () => {
    const tokens = candidateTokens();
    return { mode, vision: tokens, focus: tokens, camera: "focus", label: partyLabel };
  };

  switch (mode) {
    case "combatant": {
      const doc = activeCombatantToken();
      if (!doc) return partyView();
      if (!onViewedLevel(doc)) return offLevelView(mode, doc);
      const token = doc.object;
      // An NPC the stream can't see through is shown with the party's vision, so only what they can see is drawn.
      const own = token.vision?.attached && doc.testUserPermission(game.user, "OBSERVER");
      return { mode, vision: own ? [token] : candidateTokens(), focus: [token], camera: "focus", label: doc.name,
        subject: doc };
    }
    case "party":
      return partyView();
    case "gm":
      return { mode, vision: candidateTokens(), focus: [], camera: "gm", label: game.i18n.localize("MSV.Pane.GmView") };
    case "scene":
      return { mode, vision: candidateTokens(), focus: [], camera: "scene", label: canvas.scene?.name ?? "" };
    default: {
      const doc = paneToken(index);
      if (!doc) return { mode, vision: [], focus: [], camera: "scene", label: game.i18n.localize("MSV.Pane.NoToken"), empty: true };
      if (!onViewedLevel(doc)) return offLevelView(mode, doc);
      const token = doc.object;
      return { mode, vision: [token], focus: [token], camera: "focus", label: doc.name, subject: doc,
        blind: !token.vision?.attached };
    }
  }
}
