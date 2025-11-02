# Starfish Plugin Collection

A curated set of official plugins for [Starfish Proxy](https://github.com/Hexze/Starfish-Proxy). Each plugin lives in its own directory with source code and usage instructions. Drop the generated `.js` file from any plugin folder into your Starfish installation's `plugins/` directory, reload the proxy, and you are ready to go.

## Available Plugins

| Plugin | Folder | Description |
| ------ | ------ | ----------- |
| Discord Chat Relay | `DISCORD-CHAT-RELAY` | Mirrors in-game chat to a Discord webhook with rate limiting, filtering, and status commands. |
| Ping & TPS | `PING-TPS` | Provides `/ping` and `/tps` commands globally, including latency sampling and Hypixel TPS estimation. |
| Spell Guard | `SPELL-GUARD` | Routes outgoing chat through a LanguageTool-compatible API for full grammar and spelling corrections with optional quick typo fixes. |

## Repository Layout

```
StarfishPlugins/
├── DISCORD-CHAT-RELAY/
│   ├── README.md
│   └── discord-chat-relay-1-0-0.js
├── PING-TPS/
│   ├── README.md
│   └── ping-tps-1-0-0.js
└── SPELL-GUARD/
    ├── README.md
    └── spell-guard-1-1-0.js
```

Each subfolder contains:

- **README.md** – Feature overview, configuration notes, and installation steps.
- **`*.js`** – The compiled plugin ready to drop into Starfish's `plugins/` directory.

## Contributing

Pull requests are welcome! If you plan to add a new plugin, follow this structure:

1. Create a new folder named after the plugin (e.g., `MY-PLUGIN`).
2. Document usage and configuration in `README.md`.
3. Place the distributable plugin file in the same folder.

Please lint and test your plugin in a Starfish environment before opening a PR.

## License

The original Starfish Proxy project is UNLICENSED. Unless you specify otherwise, contributions to this plugin collection are shared under the same terms. If you prefer a different license for your plugin, include a `LICENSE` file in your plugin's folder and note it in the README.
