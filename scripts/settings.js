import { MODULE_ID } from "./constants.js";
import { Role } from "./role.js";
import { syncCombatCarousel } from "./display/combat.js";
import { syncHold } from "./display/hold.js";

export function registerSettings() {
  game.settings.register(MODULE_ID, "streamUser", {
    name: "MSV.Settings.StreamUser.Name",
    hint: "MSV.Settings.StreamUser.Hint",
    scope: "world",
    config: true,
    type: String,
    // Users aren't loaded during init, so the real choices are filled in by populateStreamUserChoices at ready.
    choices: { "": "MSV.Settings.StreamUser.None" },
    default: "",
    onChange: value => {
      // Becoming (or ceasing to be) the stream user changes how the window renders, so reload to start clean.
      if (!game.user.isGM && ((value === game.userId) !== Role.isDisplay)) foundry.utils.debouncedReload();
      ui.players?.render();
    }
  });

  game.settings.register(MODULE_ID, "paneZoom", {
    name: "MSV.Settings.PaneZoom.Name",
    hint: "MSV.Settings.PaneZoom.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 4, max: 40, step: 1 },
    default: 14
  });

  game.settings.register(MODULE_ID, "showPaneLabels", {
    name: "MSV.Settings.ShowPaneLabels.Name",
    hint: "MSV.Settings.ShowPaneLabels.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "showChat", {
    name: "MSV.Settings.ShowChat.Name",
    hint: "MSV.Settings.ShowChat.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => Hooks.callAll(`${MODULE_ID}.paneConfigChanged`)
  });

  game.settings.register(MODULE_ID, "chatWidth", {
    name: "MSV.Settings.ChatWidth.Name",
    hint: "MSV.Settings.ChatWidth.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 260, max: 600, step: 10 },
    default: 340,
    onChange: () => Hooks.callAll(`${MODULE_ID}.paneConfigChanged`)
  });

  game.settings.register(MODULE_ID, "holdMessage", {
    name: "MSV.Settings.HoldMessage.Name",
    hint: "MSV.Settings.HoldMessage.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "Be right back",
    onChange: () => syncHold()
  });

  // Which level of a multi-level scene the stream views. Set from the Stream Panes panel.
  game.settings.register(MODULE_ID, "streamLevel", {
    scope: "world",
    config: false,
    type: String,
    choices: { pane1: "MSV.Level.pane1", majority: "MSV.Level.majority", gm: "MSV.Level.gm" },
    default: "pane1",
    onChange: () => Hooks.callAll(`${MODULE_ID}.paneConfigChanged`)
  });

  // Toggled from the Stream Panes panel.
  game.settings.register(MODULE_ID, "hold", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    onChange: () => {
      syncHold();
      Hooks.callAll(`${MODULE_ID}.paneConfigChanged`);
    }
  });

  game.settings.register(MODULE_ID, "showFps", {
    name: "MSV.Settings.ShowFps.Name",
    hint: "MSV.Settings.ShowFps.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "imageCloseAfter", {
    name: "MSV.Settings.ImageCloseAfter.Name",
    hint: "MSV.Settings.ImageCloseAfter.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 600, step: 5 },
    default: 15
  });

  game.settings.register(MODULE_ID, "journalCloseAfter", {
    name: "MSV.Settings.JournalCloseAfter.Name",
    hint: "MSV.Settings.JournalCloseAfter.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 600, step: 5 },
    default: 0
  });

  game.settings.register(MODULE_ID, "closeWithGm", {
    name: "MSV.Settings.CloseWithGm.Name",
    hint: "MSV.Settings.CloseWithGm.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "showCombat", {
    name: "MSV.Settings.ShowCombat.Name",
    hint: "MSV.Settings.ShowCombat.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => syncCombatCarousel()
  });

  game.settings.register(MODULE_ID, "combatLimit", {
    name: "MSV.Settings.CombatLimit.Name",
    hint: "MSV.Settings.CombatLimit.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 10, step: 1 },
    default: 6,
    onChange: () => syncCombatCarousel()
  });

  // Edited through the Stream Panes panel. Each slot follows a token; an empty slot picks one automatically.
  // actorId lets a slot keep following the same character when the stream moves to another scene.
  game.settings.register(MODULE_ID, "panes", {
    scope: "world",
    config: false,
    type: Object,
    default: { count: 2, slots: [] },
    onChange: () => Hooks.callAll(`${MODULE_ID}.paneConfigChanged`)
  });
}

/** Offer every non-GM user as a stream user. Re-run when users are added, removed or renamed. */
export function populateStreamUserChoices() {
  const config = game.settings.settings.get(`${MODULE_ID}.streamUser`);
  const choices = { "": game.i18n.localize("MSV.Settings.StreamUser.None") };
  for (const user of game.users) if (!user.isGM) choices[user.id] = user.name;
  config.choices = choices;
}
