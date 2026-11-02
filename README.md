# Mikira's Stream View

A Foundry VTT v14 module for streaming your games. Log a dedicated **stream user** in on the streaming machine and
its window becomes a clean display for OBS: no Foundry interface, split into up to six panes, each showing its own
point of view.

## Features

- **Split screen, 1–6 panes.** Each pane can follow a token (seeing only what it sees), the active combatant, the
  whole party, your GM camera, or the whole scene. Per-pane zoom.
- **Stream Panes panel** for the GM (Token controls → table-columns button): pane count, what each pane shows, a
  hold screen with your own message, and buttons to clear shown images and journals.
- **Shown images and journals** appear on the stream and close themselves after a delay you choose, or when you close
  yours.
- **Combat carousel** along the top middle: portraits in turn order, coloured by side, dimmed once they've acted.
- **Multi-level scenes:** the stream views the level you choose (follow pane 1, where most panes are, or your own).

## Setup

1. Install the module and enable it in your world.
2. Create a player account for the stream (for example "Stream") and give it **Observer** permission on the
   characters it should see through.
3. In **Configure Settings → Mikira's Stream View**, set **Stream user** to that account.
4. Log in as the stream user on the streaming machine and capture that window in OBS.

## Companion app

For scenes where the party splits across levels, the separate companion app shows each pane as its own Foundry
client in one window, so every pane can view its own level. Both use the same Stream Panes panel.

## Compatibility

Foundry VTT v14. Works on The Forge. libWrapper is recommended.
