## Spell Guard 1.1.0

Spell Guard sends every outgoing chat line through a LanguageTool-compatible API, applies the returned grammar/spelling corrections, and forwards the cleaned message to the server. A tiny optional preset of common typo replacements is applied locally before the API call and reused if the request fails.

### Highlights
- Async API workflow: messages are intercepted, corrected via LanguageTool, then re-emitted through the proxy without manual intervention.
- Optional quick replacements fix a handful of high-frequency typos instantly (`teh → the`, `awsome → awesome`, `vieleicht → vielleicht`, …).
- Formatting polish (auto-capitalisation, trailing punctuation) and action-bar previews show exactly what changed.
- Works with the public LanguageTool endpoint or your own self-hosted instance; supports bearer authentication, language profiles, and timeout tuning.

### Configuration
| Group | Key(s) | Description |
| ----- | ------ | ----------- |
| General | `enabled`, `fixCommon`, `autoCapitalize`, `ensurePunctuation`, `notifyFix` | Toggle the plugin, enable quick replacements, adjust formatting polish, and control action-bar previews. |
| API Service | `api.endpoint`, `api.language`, `api.level`, `api.timeoutMs`, `api.key` | Point to your LanguageTool server, choose language profile and rule depth, set timeouts, and optionally supply a bearer token. |

All changes take effect immediately; no restart is required.

### Commands
```
/spellguard preview <message...>   # Ask the API for corrections without sending the message to the server
```

### API Notes
- The public LanguageTool endpoint enforces rate limits; self-host for heavy usage.
- Messages longer than 256 characters are trimmed to fit Minecraft 1.8.9 chat limits after correction.
- If an API call times out or fails, the proxy sends the locally preprocessed message (quick replacements + formatting) instead of the raw original.

### Installing
1. Copy `spell-guard-1-1-0.js` into your Starfish `plugins/` directory (see the project README for plugin loading details).
2. Restart the proxy
3. Open `/spellguard config` in-game to point the API endpoint at your preferred LanguageTool server and tweak formatting preferences.

Only the `.js` file is required at runtime; no local dictionary assets remain.
