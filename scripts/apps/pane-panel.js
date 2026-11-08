import { MODULE_ID, setting } from "../constants.js";
import { MAX_PANES, PANE_MODES, resolveSlot, slotMode } from "../display/vision.js";
import { clearImages, clearJournals } from "../display/popouts.js";
import { stepZoom, ZOOM_LIMITS } from "../display/wheel-zoom.js";

/** Scene zoom percent to and from its slider position (log scale). */
const sceneToSlider = percent => Math.round(100 * Math.log2(percent / 100));
const sliderToScene = value => Math.clamp(Math.round((100 * (2 ** (value / 100))) / 5) * 5,
  ZOOM_LIMITS.sceneZoom.min, ZOOM_LIMITS.sceneZoom.max);

/** While dragging a slider, save this often so the stream follows along. */
const SLIDER_SAVE_DELAY = 250;

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
    // Re-rendering mid-drag would replace the slider under the mouse and drop the drag; render once it's let go.
    if (PanePanel.#sliding) return;
    foundry.applications.instances.get(PanePanel.DEFAULT_OPTIONS.id)?.render();
  }, 100);

  /** Is a zoom slider being dragged? */
  static #sliding = false;

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
        isScene: mode === "scene",
        tokenId: token?.id ?? key,
        choices,
        zoom: slot.zoom ?? "",
        sceneZoom: slot.sceneZoom ?? "",
        slider: PanePanel.#sliderFor(mode, slot),
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

  /**
   * The zoom slider for a pane, or null for GM view panes (they follow the GM's camera). Right is always closer:
   * - grid squares: the slider runs over the negated count, since fewer squares is closer;
   * - scene percent: the slider runs over log2 of the percent (×100), so 50→100% is as wide as 100→200%.
   */
  static #sliderFor(mode, slot) {
    if (mode === "gm") return null;
    if (mode === "scene") {
      const { min, max } = ZOOM_LIMITS.sceneZoom;
      return { kind: "scene", min: sceneToSlider(min), max: sceneToSlider(max),
        value: sceneToSlider(slot.sceneZoom || 100) };
    }
    const { min, max } = ZOOM_LIMITS.zoom;
    return { kind: "squares", min: -max, max: -min, value: -(slot.zoom || setting("paneZoom")) };
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
    for (const input of this.element.querySelectorAll(".msv-slot-zoom")) {
      input.addEventListener("wheel", event => PanePanel.#onZoomWheel(event, input), { passive: false });
      // Typing in the box moves the slider with it.
      input.addEventListener("input", () => PanePanel.#syncSlider(input));
    }
    for (const slider of this.element.querySelectorAll(".msv-slot-slider input")) {
      // Scrolling over the slider zooms like scrolling over the box.
      slider.addEventListener("wheel", event => {
        const box = PanePanel.#zoomBox(slider);
        if (box) PanePanel.#onZoomWheel(event, box);
      }, { passive: false });
      slider.addEventListener("pointerdown", () => {
        PanePanel.#sliding = true;
        // A click that doesn't move the slider fires no change event; let go of the render hold anyway.
        window.addEventListener("pointerup", () => {
          PanePanel.#sliding = false;
          PanePanel.refresh();
        }, { once: true });
      });
      slider.addEventListener("input", PanePanel.#onSliderInput);
      slider.addEventListener("change", PanePanel.#onSliderChange);
    }
  }

  /** The zoom box in the same pane row as an element. */
  static #zoomBox(el) {
    return el.closest(".msv-slot")?.querySelector(".msv-slot-zoom") ?? null;
  }

  /** Put a pane's slider where its zoom box says. */
  static #syncSlider(box) {
    const slider = box.closest(".msv-slot")?.querySelector(".msv-slot-slider input");
    if (!slider) return;
    const value = Number(box.value) || Number(box.placeholder);
    slider.value = (box.dataset.zoom === "scene") ? sceneToSlider(value) : -value;
  }

  /** Dragging a slider: show the zoom in the box at once, and save now and then so the stream follows along. */
  static #onSliderInput(event) {
    const slider = event.currentTarget;
    const box = PanePanel.#zoomBox(slider);
    if (!box) return;
    const value = Number(slider.value);
    box.value = (slider.dataset.zoom === "scene") ? sliderToScene(value) : -value;
    box._msvZoomTimer ??= setTimeout(() => {
      box._msvZoomTimer = null;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }, SLIDER_SAVE_DELAY);
  }

  /** Letting go of a slider: its change event saves the final zoom; then the panel may re-render again. */
  static #onSliderChange(event) {
    const box = PanePanel.#zoomBox(event.currentTarget);
    if (box) {
      clearTimeout(box._msvZoomTimer);
      box._msvZoomTimer = null;
    }
    PanePanel.#sliding = false;
    PanePanel.refresh();
  }

  /**
   * Scrolling over a pane's zoom box zooms that pane: up is closer, down is further away. The box updates at once;
   * the stream follows once scrolling pauses, so a quick scroll is one settings change rather than dozens.
   */
  static #onZoomWheel(event, input) {
    if (!event.deltaY) return;
    event.preventDefault();
    const closer = event.deltaY < 0;
    const current = Number(input.value) || Number(input.placeholder);
    const next = stepZoom((input.dataset.zoom === "scene") ? "sceneZoom" : "zoom", current, closer);
    if (next === current) return;
    input.value = next;
    PanePanel.#syncSlider(input);
    clearTimeout(input._msvZoomTimer);
    input._msvZoomTimer = setTimeout(() => {
      input._msvZoomTimer = null;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, 250);
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
      const slot = { ...prev, mode: row.mode || "token" };
      // Only one zoom box is shown per pane; keep the other mode's zoom as it was.
      if (row.zoom !== undefined) slot.zoom = Number(row.zoom) || null;
      if (row.sceneZoom !== undefined) slot.sceneZoom = Number(row.sceneZoom) || null;
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
