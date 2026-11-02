import { SOCKET } from "./constants.js";

/** Handlers for messages from the GM, keyed by action name. Registered by the features that own them. */
const handlers = {};

export function registerHandler(action, handler) {
  handlers[action] = handler;
}

export function emit(action, args = {}) {
  game.socket.emit(SOCKET, { action, args });
}

export function listen() {
  game.socket.on(SOCKET, ({ action, args } = {}) => handlers[action]?.(args));
}
