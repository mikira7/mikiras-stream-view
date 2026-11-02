import { setting } from "../constants.js";
import { Role } from "../role.js";
import { feedsOverlay, setCarousel } from "./companion.js";

/*
 * While a combat is running, the stream shows a carousel along the top middle: the round and the combatants as
 * portraits with names. With a normal turn order it starts at the current combatant (highlighted) and shows the
 * next few. Systems without a single current turn (STA 2e, popcorn initiative) show everyone, dimming those who
 * have already acted this round. In the companion app the app draws it across the whole window instead.
 */

const ELEMENT_ID = "msv-carousel";

const DISPOSITION_CLASSES = {
  [CONST.TOKEN_DISPOSITIONS.FRIENDLY]: "friendly",
  [CONST.TOKEN_DISPOSITIONS.NEUTRAL]: "neutral",
  [CONST.TOKEN_DISPOSITIONS.HOSTILE]: "hostile",
  [CONST.TOKEN_DISPOSITIONS.SECRET]: "secret"
};

/** Has this combatant already taken its turn this round, for systems that track it per combatant? */
function hasActed(combatant) {
  return !!combatant.getFlag?.("sta", "turnDone");
}

/** Combatants the stream user may see, in display order. */
function carouselCombatants(combat) {
  const visible = c => !c.hidden || c.isOwner;
  const turns = combat.turns;
  const linear = Number.isInteger(combat.turn);
  const start = linear ? combat.turn : 0;
  const ordered = [...turns.slice(start), ...turns.slice(0, start)].filter(visible);
  const limit = setting("combatLimit");
  return limit ? ordered.slice(0, limit) : ordered;
}

/** The carousel as plain data, or null when there is nothing to show. */
function carouselData() {
  const combat = game.combat;
  if (!setting("showCombat") || !combat?.started) return null;
  return {
    round: game.i18n.format("MSV.Carousel.Round", { round: combat.round }),
    combatants: carouselCombatants(combat).map(c => ({
      name: c.name,
      img: new URL(c.img || CONST.DEFAULT_TOKEN, window.location.href).href,
      classes: [
        DISPOSITION_CLASSES[c.token?.disposition] ?? "neutral",
        (combat.combatant && (c === combat.combatant)) ? "active" : null,
        hasActed(c) ? "acted" : null,
        c.isDefeated ? "defeated" : null
      ].filter(Boolean)
    }))
  };
}

function buildCarousel(data) {
  const el = document.createElement("div");
  el.id = ELEMENT_ID;
  const round = document.createElement("div");
  round.className = "msv-round";
  round.textContent = data.round;
  const list = document.createElement("ol");
  for (const c of data.combatants) {
    const li = document.createElement("li");
    li.classList.add(...c.classes);
    const img = document.createElement("img");
    img.src = c.img;
    img.alt = "";
    const name = document.createElement("span");
    name.className = "msv-name";
    name.textContent = c.name;
    li.append(img, name);
    list.append(li);
  }
  el.append(round, list);
  return el;
}

/** Show, update or remove the carousel to match the current combat and settings. */
export function syncCombatCarousel() {
  if (!Role.isLead) return;
  const data = carouselData();
  if (feedsOverlay()) return setCarousel(data);

  const existing = document.getElementById(ELEMENT_ID);
  if (!data) return existing?.remove();
  const carousel = buildCarousel(data);
  if (existing) existing.replaceWith(carousel);
  else document.body.append(carousel);
}
