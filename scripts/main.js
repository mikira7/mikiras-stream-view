import { MODULE_ID, log } from "./constants.js";
import { registerSettings, populateStreamUserChoices } from "./settings.js";
import { Role, toggleDisplayUser } from "./role.js";
import { candidateDocuments } from "./display/vision.js";
import { MultiView } from "./display/multiview.js";
import * as Popouts from "./display/popouts.js";
import * as Companion from "./display/companion.js";
import { syncCombatCarousel } from "./display/combat.js";
import { syncHold } from "./display/hold.js";
import { requestGmView, sendGmViewSoon } from "./display/gm-view.js";
import { guardLevelSwitching } from "./display/levels.js";
import { layoutFractions } from "./display/layouts.js";
import { chatColumnWidth, syncChrome, watchCalendar } from "./display/chrome.js";
import { PanePanel } from "./apps/pane-panel.js";
import { listen } from "./socket.js";

Hooks.once("init", () => {
  registerSettings();
  registerKeybindings();
  // Early, so companion panes are known before the canvas (and its fog manager) is created.
  Role.detect();
  if ((Role.isPane && !Role.isLead) || Role.isSidebar) {
    // Every stream client is the same user and would overwrite the same explored-fog record; only pane 1 saves it.
    foundry.canvas.perception.FogManager.prototype.save = async function() {};
  }
});

/**
 * The companion's chat layer keeps Foundry's canvas (Dice So Nice animates its dice on the canvas ticker) but never
 * draws the scene: the board is hidden and its render call is taken off the ticker, so only the dice show.
 */
function stopSceneRendering() {
  const app = canvas.app;
  if (!Role.isSidebar || !app) return;
  app.ticker.remove(app.render, app);
}

Hooks.once("ready", () => {
  Role.detect();
  log(`role: ${Role.current}${Role.isPane ? ` ${Role.paneIndex + 1}` : ""}`);
  listen();
  populateStreamUserChoices();
  document.body.classList.toggle("msv-display", Role.isDisplay);
  document.body.classList.toggle("msv-secondary", Role.isDisplay && !Role.isLead);
  document.body.classList.toggle("msv-companion", Role.isDisplay && !!Role.companion);
  document.body.classList.toggle("msv-chrome", Role.showsChrome);
  document.body.classList.toggle("msv-sidebar", Role.isSidebar);
  globalThis.MikirasStreamView = { diagnose: frames => MultiView.diagnose(frames) };
  guardLevelSwitching();
  stopSceneRendering();
  if (Role.drawsPanes && canvas.ready) startDisplay();
  syncChrome();
  watchCalendar();
  syncCombatCarousel();
  syncHold();
  reportLayout();
});

/** In the companion app, pane 1 tells the app how many panes to show, where, and how wide the chat column is. */
function reportLayout() {
  if (!Role.isLead || !Role.companion) return;
  const { count } = game.settings.get(MODULE_ID, "panes");
  Role.companion.setLayout({ count, fractions: layoutFractions(count), chatWidth: chatColumnWidth() });
}

function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "clearImages", {
    name: "MSV.Keys.ClearImages",
    editable: [{ key: "Comma", modifiers: ["Control"] }],
    restricted: true,
    onDown: () => { Popouts.clearImages(); return true; }
  });
  game.keybindings.register(MODULE_ID, "clearJournals", {
    name: "MSV.Keys.ClearJournals",
    editable: [{ key: "Period", modifiers: ["Control"] }],
    restricted: true,
    onDown: () => { Popouts.clearJournals(); return true; }
  });
}

/* -------------------------------------------- */
/*  Stream display                              */
/* -------------------------------------------- */

function startDisplay() {
  // Controlled tokens are always visible and always see; the display must control nothing so each pane's vision holds.
  canvas.tokens.releaseAll();
  if (!candidateDocuments().length) ui.notifications.warn("MSV.NoTokens", { localize: true });
  MultiView.enable();
  requestGmView();
}

Hooks.on("canvasReady", () => {
  stopSceneRendering();
  if (Role.drawsPanes) startDisplay();
  else if (!Role.isDisplay) sendGmViewSoon();
});

// The GM's camera, for "GM view" panes.
Hooks.on("canvasPan", () => sendGmViewSoon());

Hooks.on("canvasTearDown", () => {
  if (Role.isDisplay) MultiView.reset();
});

Hooks.on("controlToken", (token, controlled) => {
  if (Role.isDisplay && controlled) token.release();
});

// Shared images and journals: auto-close on the stream, and follow the GM closing theirs.
// In the companion app, pane 1 also passes them to the app's whole-window overlay.
Hooks.on("renderImagePopout", (app, element, context, options) => {
  Popouts.onRenderImagePopout(app, element, context, options);
  Companion.onImageShown(app);
});
Hooks.on("renderJournalEntrySheet", (app, element, context, options) => {
  Popouts.onRenderJournalSheet(app, element, context, options);
  Companion.onJournalShown(app, element);
});
Hooks.on("closeImagePopout", app => {
  Popouts.onCloseApp(app);
  Popouts.onGMCloseImagePopout(app);
  Companion.onWindowClosed(app);
});
Hooks.on("closeJournalEntrySheet", app => {
  Popouts.onCloseApp(app);
  Popouts.onGMCloseJournalSheet(app);
  Companion.onWindowClosed(app);
});

// Combat carousel on the stream.
const syncCarouselSoon = foundry.utils.debounce(syncCombatCarousel, 50);
for (const hook of ["createCombat", "updateCombat", "deleteCombat", "combatStart", "createCombatant", "updateCombatant",
  "deleteCombatant", "updateToken", "canvasReady"]) {
  Hooks.on(hook, () => syncCarouselSoon());
}

/* -------------------------------------------- */
/*  GM controls                                 */
/* -------------------------------------------- */

for (const hook of ["createUser", "updateUser", "deleteUser"]) Hooks.on(hook, populateStreamUserChoices);

Hooks.on(`${MODULE_ID}.paneConfigChanged`, () => {
  PanePanel.refresh();
  syncChrome();
  reportLayout();
});

// Keep the GM's pane panel in step with the scene.
for (const hook of ["canvasReady", "createToken", "updateToken", "deleteToken", "updateActor", "updateSetting"]) {
  Hooks.on(hook, () => { if (game.user.isGM) PanePanel.refresh(); });
}

Hooks.on("getSceneControlButtons", controls => {
  if (!controls.tokens) return;
  controls.tokens.tools.msvPanes = {
    name: "msvPanes",
    title: "MSV.Panel.Title",
    icon: "fa-solid fa-table-columns",
    order: Object.keys(controls.tokens.tools).length,
    button: true,
    visible: game.user.isGM,
    onChange: () => PanePanel.toggle()
  };
});

Hooks.on("getUserContextOptions", (app, items) => {
  items.push({
    name: "MSV.ToggleDisplay",
    icon: '<i class="fa-solid fa-tv"></i>',
    visible: li => game.user.isGM && !game.users.get(li.dataset.userId)?.isGM,
    callback: li => toggleDisplayUser(li.dataset.userId)
  });
});

// Show which player is the stream user in the player list.
Hooks.on("renderPlayers", (app, html) => {
  const row = html.querySelector(`li.player[data-user-id="${game.settings.get(MODULE_ID, "streamUser")}"]`);
  if (!row || row.querySelector(".msv-stream-user")) return;
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-tv msv-stream-user";
  icon.dataset.tooltip = game.i18n.localize("MSV.IsDisplay");
  row.append(icon);
});
