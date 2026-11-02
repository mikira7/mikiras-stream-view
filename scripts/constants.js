export const MODULE_ID = "mikiras-stream-view";
export const SOCKET = `module.${MODULE_ID}`;

export const log = (...args) => console.log(`${MODULE_ID} |`, ...args);
export const setting = key => game.settings.get(MODULE_ID, key);
