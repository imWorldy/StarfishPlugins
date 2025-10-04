# Discord Chat Relay (Starfish Proxy Plugin)

A Starfish Proxy plugin that forwards in-game chat messages to a Discord webhook. Chat is sanitised, rate limited, and optionally timestamped before being delivered to your Discord channel.

## Features

- Relays server chat (and optionally system/action-bar messages) to Discord
- Strips Minecraft formatting codes for cleaner output
- Optional HH:MM:SS timestamps and webhook username override
- Basic rate limiting (1.25s between posts) with queued delivery
- Built-in `/discordrelay test` and `/discordrelay status` commands
- Blocks Discord mentions by default to avoid accidental pings

## Configuration

Open the Starfish config UI (`/discordrelay config`) and provide:

- **Discord Webhook → URL** – Full Discord webhook endpoint (required)
- **General → Enabled** – Master toggle
- **General → Webhook Username** – Override the displayed performer (optional)
- **General → Strip Colours** – Remove Minecraft formatting codes (default ON)
- **General → Include Timestamps** – Prefix each message with local time
- **General → Forward System Messages** – Include position `1` packets (server notices)
- **General → Forward Action Bar** – Include action bar updates (position `2`)
- **General → Allow Mentions** – Permit Discord to resolve `@mentions` (`OFF` by default)

## Commands

- `/discordrelay test` – Queue a test message for the configured webhook
- `/discordrelay status` – Show whether the relay is enabled, queue depth, and configuration highlights

## Installation

1. Copy `discord-chat-relay-1-0-0.js` into your proxy's `plugins/` directory
2. Restart Starfish Proxy (or reload the plugin) and open `/discordrelay config`
3. Paste your Discord webhook URL and enable the options you need

## Notes

- Messages are throttled to one every 1.25 seconds to stay within Discord limits
- If the webhook URL is missing or invalid the plugin will warn you once in chat
- Three consecutive delivery failures will clear the queue to prevent buildup
- Mentions are suppressed unless explicitly enabled to avoid accidental pings
