# Starfish Ping / TPS Plugin

A lightweight plugin for [Starfish Proxy](../README.md) that adds global `/ping` and `/tps` commands. The plugin estimates server TPS via `world_time` packets and uses the Hypixel ping API exposed by the proxy.

## Features

- `/ping` – Fetches your current latency and prints it with colored formatting.
- `/tps` – Displays the average server ticks-per-second based on recent world age updates.
- Safe proxy integration: read-only packet usage and automatic cleanup on disable.

## Installation

1. Copy `ping-tps-1-0-0.js` into the proxy's `plugins/` directory (or update the existing file).
2. Restart Starfish Proxy or reload the plugin in-game.
3. Optional: enable the plugin via `/proxy plugins` if needed.

## Development

- The plugin exports a factory function (`module.exports = (api) => { ... }`) that the proxy loads.
- Latency requests use `api.getPingAsync` when available, falling back to the callback variant.
- TPS is calculated from the Hypixel `update_time` packet; BigInt and split high/low values are normalised.

To make local changes while keeping both the standalone copy and the proxy version in sync, edit `StarfishPing/ping-tps-1-0-0.js`. The proxy's `plugins/ping-tps-1-0-0.js` simply re-exports that module.
