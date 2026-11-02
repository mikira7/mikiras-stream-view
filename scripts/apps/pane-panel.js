import { MODULE_ID, setting } from "../constants.js";
import { MAX_PANES, PANE_MODES, resolveSlot, slotMode } from "../display/vision.js";
import { clearImages, clearJournals } from "../display/popouts.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The select value for a stored slot: its token ID, or a marker for a slot that follows an actor only. */
const slotKey = slot => slot?.tokenId ?? (slot?.actorId ? `actor.${slot.actorId}` : "");

/** The token fields of a slot, kept when the pane switches to another mode so switching back restores them. */
const tokenFields = slot => ({ tokenId: slot?.tokenId ?? null, actorId: slot?.actorId ?? null, name: slot?.name ?? null });

/** GM window controlling the stream: pane count, what each pane shows, the hold screen and shared windows. */
export class PanePanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "msv-pane-panel",
    classes: ["msv-pane-panel"],
    tag: "form",
    window: { title: "MSV.Panel.Title", icon: "fa-solid fa-table-columns", resizable: true },
    position: { width: 520, height: "auto" },
    form: { handler: PanePanel.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      setCount: PanePanel.#onSetCount,
      useSelected: PanePanel.#onUseSelected,
      clearSlot: PanePanel.#onClearSlot,
      toggleHold: PanePanel.#onToggleHold,
      clearImages: () => clearImages(),
      clearJournals: () => clearJournals()
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/pane-panel.hbs` }
  };

  static toggle() {
    const existing = foundry.applications.instances.get(this.DEFAULT_OPTIONS.id);
    if (existing) existing.close();
    else new this().render({ force: true });
  }

  /** Re-render the open panel, if any, when tokens, users or the pane config change. */
  static refresh = foundry.utils.debounce(() => {
    foundry.applications.instances.get(PanePanel.DEFAULT_OPTIONS.id)?.render();
  }, 100);

  async _prepareContext(options) {
    const { count, slots = [] } = setting("panes");
    const streamUser = game.users.get(setting("streamUser"));
    // Token documents rather than canvas tokens, so tokens on every level of the scene can be picked.
    const scene = canvas.scene;
    const multiLevel = (scene?.levels.size ?? 0) > 1;
    const tokens = (scene?.tokens.contents ?? []).filter(d => d.sight.enabled);
    tokens.sort((a, b) => a.name.localeCompare(b.name));
    const tokenChoices = Object.fromEntries(tokens.map(d => [d.id,
      multiLevel ? `${d.name} (${scene.levels.get(d.level)?.name ?? "?"})` : d.name]));
    const modeChoices = Object.fromEntries(PANE_MODES.map(m => [m, game.i18n.localize(`MSV.Mode.${m}`)]));

    const panes = Array.from({ length: count }, (_, index) => {
      const slot = slots[index] ?? {};
      const mode = slotMode(slot);
      const token = resolveSlot(slot);
      // A slot can point at something not in this scene; keep it listed so the select doesn't silently clear it.
      const choices = { ...tokenChoices };
      const key = slotKey(slot);
      if (key && !token) choices[key] = game.i18n.format("MSV.Panel.NotInScene", { name: slot.name ?? "?" });
      return {
        index,
        number: index + 1,
        mode,
        isToken: mode === "token",
        tokenId: token?.id ?? key,
        choices,
        zoom: slot.zoom ?? "",
        img: (mode === "token") ? (token?.texture.src ?? null) : null,
        icon: PanePanel.#modeIcon(mode),
        warning: (mode === "token") ? this.#slotWarning(token, streamUser) : null
      };
    });

    return {
      streamUser: streamUser?.name,
      countButtons: Array.from({ length: MAX_PANES }, (_, i) => ({ n: i + 1, active: (i + 1) === count })),
      panes,
      modeChoices,
      defaultZoom: setting("paneZoom"),
      hold: setting("hold"),
      holdMessage: setting("holdMessage"),
      multiLevel,
      streamLevel: setting("streamLevel"),
      levelChoices: { pane1: "MSV.Level.pane1", majority: "MSV.Level.majority", gm: "MSV.Level.gm" },
      sceneName: canvas.scene?.name
    };
  }

  static #modeIcon(mode) {
    return {
      token: "fa-solid fa-wand-magic-sparkles",
      combatant: "fa-solid fa-swords",
      party: "fa-solid fa-users",
      gm: "fa-solid fa-video",
      scene: "fa-solid fa-map"
    }[mode];
  }

  #slotWarning(doc, streamUser) {
    if (!doc || !streamUser) return null;
    if (!doc.actor?.testUserPermission(streamUser, "OBSERVER")) {
      return game.i18n.format("MSV.Panel.NoObserver", { user: streamUser.name, token: doc.name });
    }
    if (doc.hidden) return game.i18n.localize("MSV.Panel.Hidden");
    return null;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    new foundry.applications.ux.DragDrop({
      dropSelector: ".msv-slot",
      callbacks: { drop: this.#onDrop.bind(this) }
    }).bind(this.element);
  }

  /** Accept an Actor dragged from the sidebar, or a Token document reference. */
  async #onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const index = Number(event.target.closest(".msv-slot")?.dataset.index);
    if (!Number.isInteger(index) || !data.uuid) return;
    const doc = await fromUuid(data.uuid);
    let token = null;
    if (doc?.documentName === "Token") token = doc;
    else if (doc?.documentName === "Actor") token = canvas.scene?.tokens.find(d => d.actorId === doc.id) ?? null;
    if (doc?.documentName === "Actor" && !token) {
      // No token on this scene yet: follow the actor wherever it appears.
      return PanePanel.#updateSlot(index, { mode: "token", tokenId: null, actorId: doc.id, name: doc.name });
    }
    if (token) return PanePanel.#updateSlot(index, { mode: "token", ...PanePanel.#slotFor(token) });
  }

  /** Slot fields for a token document. */
  static #slotFor(doc) {
    return { tokenId: doc.id, actorId: doc.actorId ?? null, name: doc.name };
  }

  /** Merge changes into one pane's slot, keeping its other settings. */
  static async #updateSlot(index, changes) {
    const panes = foundry.utils.deepClone(setting("panes"));
    panes.slots ??= [];
    panes.slots[index] = { ...(panes.slots[index] ?? {}), ...changes };
    await game.settings.set(MODULE_ID, "panes", panes);
  }

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const current = setting("panes");
    const slots = (current.slots ?? []).slice();
    for (const [i, row] of Object.entries(data.slots ?? {})) {
      const prev = slots[i] ?? {};
      const slot = { ...prev, mode: row.mode || "token", zoom: Number(row.zoom) || null };
      // The token select is only shown in token mode; otherwise keep the remembered token.
      if ((slot.mode === "token") && (row.tokenId !== undefined) && (row.tokenId !== slotKey(prev))) {
        const token = row.tokenId ? canvas.scene?.tokens.get(row.tokenId) : null;
        Object.assign(slot, token ? PanePanel.#slotFor(token) : tokenFields(null));
      }
      slots[i] = slot;
    }
    await game.settings.set(MODULE_ID, "panes", { ...current, slots });
    if ((data.holdMessage !== undefined) && (data.holdMessage !== setting("holdMessage"))) {
      await game.settings.set(MODULE_ID, "holdMessage", data.holdMessage);
    }
    if (data.streamLevel && (data.streamLevel !== setting("streamLevel"))) {
      await game.settings.set(MODULE_ID, "streamLevel", data.streamLevel);
    }
  }

  static async #onSetCount(event, target) {
    const panes = foundry.utils.deepClone(setting("panes"));
    panes.count = Number(target.dataset.count);
    await game.settings.set(MODULE_ID, "panes", panes);
  }

  static async #onUseSelected(event, target) {
    const token = canvas.tokens.controlled[0];
    if (!token) return ui.notifications.warn("MSV.Panel.NothingSelected", { localize: true });
    await PanePanel.#updateSlot(Number(target.dataset.index), { mode: "token", ...PanePanel.#slotFor(token.document) });
  }

  /** Back to an Auto token pane. */
  static async #onClearSlot(event, target) {
    await PanePanel.#updateSlot(Number(target.dataset.index), { mode: "token", ...tokenFields(null) });
  }

  static async #onToggleHold() {
    await game.settings.set(MODULE_ID, "hold", !setting("hold"));
  }
}
