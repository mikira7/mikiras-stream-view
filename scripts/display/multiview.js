import { MODULE_ID, setting } from "../constants.js";
import { layoutRects } from "./layouts.js";
import { paneView } from "./vision.js";
import { getGmView } from "./gm-view.js";
import { syncLevel } from "./levels.js";
import { Role } from "../role.js";
import { chatColumnWidth } from "./chrome.js";

/** Key under which other tokens' vision sources are suppressed while a pane is drawn. */
const SUPPRESSION_KEY = MODULE_ID;

/** Each pane may add to explored fog at most this often (ms); committing on every pass would be far too slow. */
const FOG_COMMIT_INTERVAL = 1000;

/** Pixels of black between panes. */
const GAP = 4;

/** How quickly a pane's camera catches up with its goal each frame (0–1). */
const CAMERA_FOLLOW = 0.2;

/** Grid squares of space kept around a group of tokens framed together. */
const GROUP_PADDING = 2;

/** Border drawn around the pane following the active combatant. */
const HIGHLIGHT = { width: 4, color: 0xF0C040 };

/**
 * Draws the stream window as a grid of panes, each from its own point of view.
 *
 * Foundry renders one perception per client, so each frame this replaces the normal render with one pass per pane:
 * suppress every vision source the pane doesn't use, refresh lighting and visibility, move the camera, and render the
 * stage into that pane's screen-sized texture. The panes are then composited onto the screen.
 */
export class MultiView {
  static #enabled = false;

  /** Per-pane state: render target, on-screen sprite, label, border, current view and smoothed camera. */
  static #panes = [];

  static #root = new PIXI.Container();
  static #background = new PIXI.Graphics();
  static #fpsText = new PIXI.Text("", { fontSize: 14, fill: 0xFFFFFF, stroke: 0x000000, strokeThickness: 3 });
  static #fps = { frames: 0, since: 0 };

  /** Which set of vision sources the canvas is currently configured for, so a repeated set isn't refreshed again. */
  static #currentKey;

  /**
   * Tokens that roofs and other overhead surfaces should fade or cut away around. While a pane is drawn these are that
   * pane's tokens; between frames they are every pane's tokens. Null means Foundry's default.
   */
  static #occluders = null;

  /** Make the token layer ask us which tokens roofs should respond to. Safe to call on every scene load. */
  static #installOccluders() {
    const layer = canvas.tokens;
    if (layer._msvOccluders) return;
    const original = layer._getOccludableTokens.bind(layer);
    layer._getOccludableTokens = () => this.#occluders?.filter(t => !t.destroyed) ?? original();
    layer._msvOccluders = true;
  }

  /** An in-progress diagnostic recording, if any. */
  static #recording = null;

  /**
   * Record what each pane draws over a number of frames and print a summary to the console.
   * Run from the stream window's console: `MikirasStreamView.diagnose()`.
   * @param {number} [frames=120]
   * @returns {Promise<object[]>}  One row per pane and token.
   */
  static diagnose(frames = 120) {
    return new Promise(resolve => {
      this.#recording = { framesLeft: frames, frames, rows: new Map(), resolve };
    });
  }

  /** Note the state each token is in as a pane is about to be drawn. */
  static #record(index, pane) {
    const rec = this.#recording;
    const active = canvas.effects.visionSources.filter(s => s.active).map(s => s.object?.name ?? "?").join(", ") || "none";
    for (const t of canvas.tokens.placeables) {
      const key = `${index}:${t.id}`;
      let row = rec.rows.get(key);
      if (!row) {
        row = { pane: index + 1, follows: pane.view.label, token: t.name, frames: 0,
          visible: 0, meshVisible: 0, drawable: 0, activeVision: new Set() };
        rec.rows.set(key, row);
      }
      row.frames++;
      if (t.visible) row.visible++;
      if (t.mesh?.visible) row.meshVisible++;
      if (t.mesh?.visible && t.mesh.renderable && (t.mesh.alpha > 0) && !t.mesh.destroyed) row.drawable++;
      row.activeVision.add(active);
    }
  }

  static #finishRecordingFrame() {
    const rec = this.#recording;
    if (!rec || (--rec.framesLeft > 0)) return;
    this.#recording = null;
    const pct = (n, of) => `${Math.round(100 * n / Math.max(of, 1))}%`;
    const rows = [...rec.rows.values()].map(r => ({
      pane: r.pane, follows: r.follows, token: r.token,
      visible: pct(r.visible, r.frames), meshVisible: pct(r.meshVisible, r.frames), drawable: pct(r.drawable, r.frames),
      activeVision: [...r.activeVision].join(" | ")
    }));
    console.log(`mikiras-stream-view | diagnosis over ${rec.frames} frames`);
    console.table(rows);
    console.log("Active modules:", game.modules.filter(m => m.active).map(m => m.id).join(", "));
    rec.resolve(rows);
  }

  static enable() {
    if (this.#enabled) return;
    this.#enabled = true;
    this.#root.eventMode = "none";
    this.#root.addChild(this.#background, this.#fpsText);
    // PIXI's Application registers its render on the ticker at LOW priority; take its place.
    const app = canvas.app;
    app.ticker.remove(app.render, app);
    app.ticker.add(this.#render, this, PIXI.UPDATE_PRIORITY.LOW);
  }

  static disable() {
    if (!this.#enabled) return;
    this.#enabled = false;
    const app = canvas.app;
    app.ticker.remove(this.#render, this);
    app.ticker.add(app.render, app, PIXI.UPDATE_PRIORITY.LOW);
    this.#releaseSuppression();
  }

  /** Forget per-scene state when the canvas is torn down. Render targets are kept and reused. */
  static reset() {
    this.#currentKey = undefined;
    for (const pane of this.#panes) pane.camera = null;
  }

  /* -------------------------------------------- */

  static #render() {
    const renderer = canvas.app.renderer;

    // Between scenes there is nothing to split: render normally.
    if (!canvas.ready || !canvas.visibility?.initialized) return renderer.render(canvas.stage);
    syncLevel();

    // In the companion app each client draws only its own pane, filling the window; the app lays the windows out.
    // In single-window mode the panes leave room on the right for the chat column.
    const { width, height } = renderer.screen;
    const count = Role.isPane ? 1 : setting("panes").count;
    const rects = Role.isPane ? [new PIXI.Rectangle(0, 0, width, height)]
      : layoutRects(count, Math.max(width - chatColumnWidth(), 1), height, GAP);
    this.#syncPanes(count, width, height);

    // On hold, the panes aren't drawn at all; the hold card covers the window.
    const hold = setting("hold");
    if (!hold) this.#renderPanes(rects);

    this.#compose(rects, width, height, hold);
    renderer.render(this.#root);
    // PIXI routes pointer events to the last object rendered. Foundry (and its emulated mouse moves, which fire
    // whenever token visibility changes) expects that to be the stage, not our composite.
    renderer.objectRenderer.lastObjectRendered = canvas.stage;
    this.#finishRecordingFrame();
  }

  static #renderPanes(rects) {
    this.#installOccluders();
    const stage = canvas.stage;
    const saved = { x: stage.pivot.x, y: stage.pivot.y, scale: stage.scale.x };
    try {
      rects.forEach((rect, i) => this.#renderPane(this.#panes[i], Role.isPane ? Role.paneIndex : i, rect));
    } finally {
      this.#restoreSources();
      // Between frames, roofs fade around every pane's tokens, so Foundry's fade animations stay steady.
      this.#occluders = [...new Set(this.#panes.flatMap(p => p.view?.vision ?? []))];
      canvas.masks.occlusion._updateOccludableTokens();
      // Leave Foundry's own camera where it was.
      stage.pivot.set(saved.x, saved.y);
      if (stage.scale.x !== saved.scale) {
        stage.scale.set(saved.scale, saved.scale);
        canvas.updateBlur();
      }
    }
  }

  /** Create, resize or drop per-pane render targets to match the pane count and screen size. */
  static #syncPanes(count, width, height) {
    const resolution = canvas.app.renderer.resolution;
    while (this.#panes.length > count) {
      const pane = this.#panes.pop();
      pane.sprite.destroy();
      pane.portrait.destroy();
      pane.border.destroy();
      pane.label.destroy();
      pane.target.destroy(true);
    }
    while (this.#panes.length < count) {
      const target = PIXI.RenderTexture.create({ width, height, resolution });
      const sprite = new PIXI.Sprite(new PIXI.Texture(target.baseTexture));
      const portrait = new PIXI.Sprite();
      portrait.anchor.set(0.5);
      const border = new PIXI.Graphics();
      const label = new PIXI.Text("", { fontSize: 18, fill: 0xFFFFFF, stroke: 0x000000, strokeThickness: 4,
        align: "center" });
      this.#root.addChildAt(sprite, 1);
      this.#root.addChild(portrait, border, label);
      this.#panes.push({ target, sprite, portrait, border, label, view: null, sources: [], camera: null,
        lastFogCommit: 0 });
    }
    for (const pane of this.#panes) {
      if ((pane.target.width === width) && (pane.target.height === height)) continue;
      // The sprite's texture is cropped to the pane. Shrinking the target under that crop throws, so drop the
      // cropped texture first and make a fresh one; #compose crops it again.
      pane.sprite.texture.destroy(false);
      pane.target.resize(width, height);
      pane.sprite.texture = new PIXI.Texture(pane.target.baseTexture);
    }
  }

  /* -------------------------------------------- */

  static #renderPane(pane, index, rect) {
    pane.view = paneView(index);
    if (pane.view.empty) return;
    pane.sources = pane.view.vision.map(t => t.vision).filter(s => s?.attached);
    this.#applyPerception(pane);
    this.#applyCamera(pane, index, rect);

    if (this.#recording) this.#record(index, pane);

    // Masks are cached in screen space; after moving the camera they must be redrawn, as Canvas#pan does.
    canvas.hidden.invalidateMasks();
    canvas.effects.illumination.invalidateDarknessLevelContainer();
    canvas.app.renderer.render(canvas.stage, { renderTexture: pane.target, clear: true });
  }

  /** Configure lighting, visibility and token visibility as if only this pane's tokens could see. */
  static #applyPerception(pane) {
    const wanted = new Set(pane.sources);
    let changed = false;
    for (const source of canvas.effects.visionSources) {
      if (this.#setSuppressed(source, !wanted.has(source))) changed = true;
    }
    // Panes that share the same vision (or a single pane) don't need refreshing again.
    const key = pane.sources.map(s => s.object?.id).sort().join("|");
    if (!changed && (this.#currentKey === key)) return;
    this.#currentKey = key;

    // Vision modes (darkvision and the like) change lighting post-processing; only rebuild when they differ.
    const vm = canvas.visibility.visionModeData;
    const modes = new Set(pane.sources.map(s => s.visionMode));
    if (modes.size ? !modes.has(vm.source?.visionMode) : !!vm.source) {
      canvas.visibility.initializeVisionMode();
      canvas.effects.refreshLightSources();
      canvas.primary.refreshPrimarySpriteMesh();
    }
    canvas.effects.refreshLighting();

    // Fog commits are expensive: let each pane add to explored fog only now and then.
    const now = performance.now();
    const commitFog = (now - pane.lastFogCommit) > FOG_COMMIT_INTERVAL;
    if (commitFog) pane.lastFogCommit = now;
    else canvas.fog.commit = () => {};
    try {
      canvas.visibility.refresh();
    } finally {
      delete canvas.fog.commit;
    }

    // Token visibility is normally applied on the next tick; this pane is drawn now.
    for (const token of canvas.tokens.placeables) token.applyRenderFlags();
    for (const note of canvas.notes.placeables) note.applyRenderFlags();

    // The occlusion mask cuts roofs away around tokens and draws their line of sight, using whichever vision is
    // active. Foundry builds it once per frame with the last pane's vision, so rebuild it for this pane.
    this.#occluders = pane.view.vision;
    canvas.masks.occlusion._updateOccludableTokens();
    canvas.masks.occlusion._updateOcclusionMask();
  }

  /**
   * Suppress or restore one vision source. Returns whether anything changed.
   * `refresh()` skips inactive sources, which would leave a suppressed source's layers marked active and still drawn
   * into the vision mask, so the protected `_refresh()` is called directly.
   */
  static #setSuppressed(source, suppress) {
    if (!!source.suppression[SUPPRESSION_KEY] === suppress) return false;
    if (suppress) source.suppression[SUPPRESSION_KEY] = true;
    else delete source.suppression[SUPPRESSION_KEY];
    try {
      source._refresh();
    } catch(err) {
      console.warn(`${MODULE_ID} | could not refresh vision source`, err);
    }
    return true;
  }

  /**
   * Give every vision source back its normal state between frames. Foundry rebuilds a source's polygons whenever its
   * token moves, and a source rebuilt while suppressed gets a radius of 0 and sees nothing, so nothing may stay
   * suppressed while Foundry's own updates run.
   */
  static #restoreSources() {
    for (const source of canvas.effects.visionSources) {
      this.#setSuppressed(source, false);
      // Repair a source that was rebuilt while suppressed (by an earlier version, or a module acting mid-frame).
      if (!source.data.disabled && (source.los?.config?.radius === 0)) source.object?.initializeVisionSource();
    }
    this.#currentKey = undefined;
  }

  /* -------------------------------------------- */
  /*  Cameras                                     */
  /* -------------------------------------------- */

  /** Move the stage camera to this pane's goal, easing towards it from where it was last frame. */
  static #applyCamera(pane, index, rect) {
    const goal = this.#cameraGoal(pane.view, index, rect);
    if (!pane.camera) pane.camera = { ...goal };
    else {
      pane.camera.x += (goal.x - pane.camera.x) * CAMERA_FOLLOW;
      pane.camera.y += (goal.y - pane.camera.y) * CAMERA_FOLLOW;
      // Ease zoom in log space so zooming in and out feel the same speed.
      pane.camera.scale *= (goal.scale / pane.camera.scale) ** CAMERA_FOLLOW;
    }

    // screen = (world - pivot) * scale + stage.position, solved for the pivot that puts the camera at the pane centre.
    const stage = canvas.stage;
    const { x, y, scale } = pane.camera;
    const cx = rect.x + (rect.width / 2);
    const cy = rect.y + (rect.height / 2);
    stage.pivot.set(x - ((cx - stage.position.x) / scale), y - ((cy - stage.position.y) / scale));
    if (stage.scale.x !== scale) {
      stage.scale.set(scale, scale);
      canvas.updateBlur();
    }
  }

  /** Where a pane's camera wants to be: a world point to centre on and a zoom scale. */
  static #cameraGoal(view, index, rect) {
    const slot = setting("panes").slots?.[index];
    const squares = slot?.zoom || setting("paneZoom");
    const tokenScale = rect.height / (squares * canvas.grid.size);
    const scene = canvas.dimensions.sceneRect;
    const fitScene = () => ({
      x: scene.x + (scene.width / 2),
      y: scene.y + (scene.height / 2),
      scale: Math.min(rect.width / scene.width, rect.height / scene.height) * 0.95
    });

    if (view.camera === "scene") return fitScene();

    if (view.camera === "gm") {
      const gm = getGmView();
      if (!gm) return fitScene();
      // Show the same stretch of the scene the GM sees, fitted to the pane.
      const scale = gm.scale * Math.min(rect.width / gm.width, rect.height / gm.height);
      return { x: gm.x, y: gm.y, scale };
    }

    // Follow animated positions, not destinations, so panes glide with movement.
    const tokens = view.focus;
    if (!tokens.length) return fitScene();
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const t of tokens) {
      left = Math.min(left, t.x);
      top = Math.min(top, t.y);
      right = Math.max(right, t.x + t.w);
      bottom = Math.max(bottom, t.y + t.h);
    }
    const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
    if (tokens.length === 1) return { ...center, scale: tokenScale };

    // Fit the group with some room around it, but never closer than a single token would be.
    const pad = GROUP_PADDING * canvas.grid.size * 2;
    const fit = Math.min(rect.width / (right - left + pad), rect.height / (bottom - top + pad));
    return { ...center, scale: Math.min(fit, tokenScale) };
  }

  /* -------------------------------------------- */
  /*  Composition                                 */
  /* -------------------------------------------- */

  static #compose(rects, width, height, hold) {
    this.#background.clear().beginFill(0x000000).drawRect(0, 0, width, height).endFill();
    const showLabels = setting("showPaneLabels");
    const activeToken = game.combat?.started ? game.combat.combatant?.token : null;

    this.#panes.forEach((pane, i) => {
      const rect = rects[i];
      const view = pane.view;
      const texture = pane.sprite.texture;
      const frame = texture.frame;
      if ((frame.x !== rect.x) || (frame.y !== rect.y) || (frame.width !== rect.width) || (frame.height !== rect.height)) {
        texture.frame = rect.clone();
        texture.updateUvs();
      }
      pane.sprite.position.set(rect.x, rect.y);
      pane.sprite.visible = !hold && !!view && !view.empty;

      // Gold border on the pane about the active combatant.
      const highlighted = !hold && !!activeToken && (view?.subject === activeToken);
      pane.border.clear();
      if (highlighted) {
        const w = HIGHLIGHT.width;
        pane.border.lineStyle(w, HIGHLIGHT.color, 1, 0)
          .drawRect(rect.x, rect.y, rect.width, rect.height);
      }

      const label = !view ? "" : view.blind ? game.i18n.format("MSV.Pane.NoVision", { name: view.label }) : view.label;
      pane.label.visible = !hold && (showLabels || !!view?.empty || !!view?.blind);
      pane.label.text = label;

      // A pane whose token is on another level shows its portrait and where it is, centred in the pane.
      const card = !hold && !!view?.portrait;
      pane.portrait.visible = card;
      if (card) {
        const size = Math.min(rect.width, rect.height) * 0.35;
        // Tokens on other levels aren't drawn, so load the image from its source (cached after the first time).
        pane.portrait.texture = PIXI.Texture.from(view.portrait);
        pane.portrait.width = pane.portrait.height = size;
        pane.portrait.position.set(rect.x + (rect.width / 2), rect.y + (rect.height / 2) - (size * 0.2));
        pane.label.position.set(rect.x + ((rect.width - pane.label.width) / 2), pane.portrait.y + (size / 2) + 12);
      }
      else pane.label.position.set(rect.x + 10, rect.y + rect.height - pane.label.height - 8);
    });

    this.#updateFps(width, hold);
  }

  static #updateFps(width, hold) {
    const show = setting("showFps") && !hold;
    this.#fpsText.visible = show;
    if (!show) return;
    const fps = this.#fps;
    const now = performance.now();
    fps.frames++;
    if ((now - fps.since) >= 500) {
      this.#fpsText.text = `${Math.round(fps.frames * 1000 / (now - fps.since))} fps`;
      fps.frames = 0;
      fps.since = now;
    }
    this.#fpsText.position.set(width - this.#fpsText.width - 10, 8);
  }

  static #releaseSuppression() {
    if (!canvas.ready) return;
    this.#restoreSources();
    canvas.perception.update({ initializeVisionModes: true, refreshLighting: true, refreshVision: true });
  }
}
