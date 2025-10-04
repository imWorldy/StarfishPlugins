// Discord Chat Relay Plugin
// Forwards in-game chat messages to a configured Discord webhook.

const https = require('https');
const { URL } = require('url');

module.exports = (api) => {
  api.metadata({
    name: 'discordrelay',
    displayName: 'Discord Chat Relay',
    prefix: '§9DR',
    version: '1.0.0',
    author: 'imWorldy',
    description: 'Relays chat messages to a Discord webhook with simple formatting and rate limiting.'
  });

  const plugin = new DiscordChatRelay(api);
  plugin.register();
  return plugin;
};

class DiscordChatRelay {
  constructor(api) {
    this.api = api;
    this.prefix = typeof api.getPrefix === 'function' ? api.getPrefix() : '§9DR';

    this.queue = [];
    this.processing = false;
    this.queueTimer = null;
    this.destroyed = false;
    this.warnedMissingWebhook = false;
    this.reportedDeliveryError = false;
    this.consecutiveFailures = 0;

    this.rateLimitMs = 1250;
    this.unsubscribers = [];
  }

  register() {
    const configSchema = [
      {
        label: 'General',
        defaults: {
          enabled: true,
          webhookUsername: 'Starfish Relay',
          stripColors: true,
          includeTimestamps: true,
          forwardSystemMessages: false,
          forwardActionBar: false,
          allowMentions: false
        },
        settings: [
          {
            type: 'toggle',
            key: 'enabled',
            text: ['OFF', 'ON'],
            description: 'Enable or disable forwarding chat messages to Discord.'
          },
          {
            type: 'text',
            key: 'webhookUsername',
            description: 'Optional username override for the webhook.',
            placeholder: 'Starfish Relay'
          },
          {
            type: 'toggle',
            key: 'stripColors',
            text: ['RAW', 'CLEAN'],
            description: 'Remove Minecraft colour codes before sending messages.'
          },
          {
            type: 'toggle',
            key: 'includeTimestamps',
            text: ['OFF', 'ON'],
            description: 'Prefix forwarded messages with the local time (HH:MM:SS).'
          },
          {
            type: 'toggle',
            key: 'forwardSystemMessages',
            text: ['CHAT ONLY', 'INCLUDE'],
            description: 'Forward system/announcement messages (position 1).'
          },
          {
            type: 'toggle',
            key: 'forwardActionBar',
            text: ['IGNORE', 'FORWARD'],
            description: 'Forward action bar updates (position 2).'
          },
          {
            type: 'toggle',
            key: 'allowMentions',
            text: ['BLOCK', 'ALLOW'],
            description: 'Allow Discord to parse @mentions in forwarded messages.'
          }
        ]
      },
      {
        label: 'Discord Webhook',
        defaults: {
          webhook: {
            url: ''
          }
        },
        settings: [
          {
            type: 'text',
            key: 'webhook.url',
            description: 'The Discord webhook URL to receive forwarded messages.',
            placeholder: 'https://discord.com/api/webhooks/...'
          }
        ]
      }
    ];

    if (typeof this.api.initializeConfig === 'function') {
      this.api.initializeConfig(configSchema);
    }
    if (typeof this.api.configSchema === 'function') {
      this.api.configSchema(configSchema);
    }

    if (typeof this.api.commands === 'function') {
      this.api.commands((registry) => {
        registry
          .command('test')
          .description('Send a test message to the configured Discord webhook.')
          .handler(() => this.handleTestCommand());

        registry
          .command('status')
          .description('Show the Discord relay configuration and queue status.')
          .handler(() => this.showStatus());
      });
    }

    if (typeof this.api.on === 'function') {
      const off = this.api.on('chat', (event) => this.handleChat(event));
      if (typeof off === 'function') {
        this.unsubscribers.push(off);
      }
    }
  }

  disable() {
    this.destroyed = true;
    this.clearTimer();
    this.queue = [];
    this.processing = false;

    for (const off of this.unsubscribers) {
      try {
        if (typeof off === 'function') off();
      } catch (err) {
        this.debug(`Error during unsubscribe: ${err.message}`);
      }
    }
    this.unsubscribers = [];
  }

  handleChat(event = {}) {
    if (!this.isEnabled()) return;

    const webhookUrl = this.getWebhookUrl();
    if (!webhookUrl) {
      this.notifyMissingWebhook();
      return;
    }
    this.warnedMissingWebhook = false;

    if (!this.shouldForwardPosition(event.position)) {
      return;
    }

    const formatted = this.formatMessage(event);
    if (!formatted) return;

    const payload = this.createPayload(formatted);
    if (!payload.content) return;

    this.enqueue({ payload, webhookUrl });
  }

  handleTestCommand() {
    if (!this.isEnabled()) {
      this.sendPrefixed('§cThe Discord relay plugin is disabled in the config.');
      return;
    }

    const webhookUrl = this.getWebhookUrl();
    if (!webhookUrl) {
      this.notifyMissingWebhook();
      return;
    }

    const timestamp = this.buildTimestamp();
    const payload = this.createPayload(`[TEST] Discord relay is active at ${timestamp}`);
    this.enqueue({ payload, webhookUrl });
    this.sendPrefixed('§aTest message queued for delivery.');
  }

  showStatus() {
    const active = this.isEnabled();
    const webhookUrl = this.getWebhookUrl();
    const forwardSystem = this.getConfig('forwardSystemMessages', false);
    const forwardActionBar = this.getConfig('forwardActionBar', false);

    this.sendPrefixed(`Status: ${active ? '§aenabled' : '§cdisabled'}`);
    this.sendPrefixed(`Webhook: ${webhookUrl ? '§aset' : '§cmissing'}`);
    this.sendPrefixed(`Queue: §b${this.queue.length} §7pending`);
    this.sendPrefixed(`System messages: ${forwardSystem ? '§aON' : '§cOFF'}, action bar: ${forwardActionBar ? '§aON' : '§cOFF'}`);
  }

  enqueue(entry) {
    if (this.destroyed) return;
    if (!entry || !entry.payload || !entry.webhookUrl) return;
    this.queue.push(entry);
    if (!this.processing && !this.queueTimer) {
      this.processQueue();
    }
  }

  processQueue() {
    if (this.processing || this.destroyed) return;

    const entry = this.queue.shift();
    if (!entry) {
      return;
    }

    this.processing = true;

    this.postToWebhook(entry.webhookUrl, entry.payload)
      .then(() => {
        this.consecutiveFailures = 0;
        this.reportedDeliveryError = false;
      })
      .catch((err) => {
        this.consecutiveFailures += 1;
        this.debug(`Discord webhook send failed: ${err.message}`);

        if (!this.reportedDeliveryError) {
          this.reportedDeliveryError = true;
          this.sendPrefixed(`§cFailed to send chat to Discord: §7${err.message}`);
        }

        if (this.consecutiveFailures >= 3) {
          this.queue = [];
          this.debug('Cleared message queue after repeated failures.');
        }
      })
      .finally(() => {
        this.processing = false;
        if (this.destroyed) return;

        if (this.queue.length > 0) {
          this.queueTimer = setTimeout(() => {
            this.queueTimer = null;
            this.processQueue();
          }, this.rateLimitMs);
        }
      });
  }

  async postToWebhook(urlString, payload) {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (err) {
      throw new Error('Invalid webhook URL');
    }

    if (parsed.protocol !== 'https:') {
      throw new Error('Webhook URL must use HTTPS');
    }

    const body = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      const options = {
        method: 'POST',
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'Starfish-Proxy-Discord-Relay/1.0.0'
        }
      };

      const req = https.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          res.resume();
          resolve();
          return;
        }

        let responseData = '';
        res.on('data', (chunk) => {
          if (responseData.length < 400) {
            responseData += chunk;
          }
        });
        res.on('end', () => {
          const summary = responseData.toString('utf8').replace(/\s+/g, ' ').trim();
          const message = summary ? `${res.statusCode} ${summary}` : `${res.statusCode}`;
          reject(new Error(`Discord responded with status ${message}`));
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Discord webhook request timed out'));
      });

      req.write(body);
      req.end();
    });
  }

  shouldForwardPosition(position) {
    if (position === 0 || typeof position === 'undefined') {
      return true;
    }
    if (position === 1) {
      return !!this.getConfig('forwardSystemMessages', false);
    }
    if (position === 2) {
      return !!this.getConfig('forwardActionBar', false);
    }
    return !!this.getConfig('forwardSystemMessages', false);
  }

  formatMessage(event) {
    const message = typeof event.message === 'string' ? event.message : '';
    let output = message;

    if (!output && event.json) {
      output = this.extractFromComponent(event.json);
    }

    if (!output) return '';

    if (this.getConfig('stripColors', true)) {
      output = output.replace(/§[0-9a-fklmnor]/gi, '');
    }
    output = output.replace(/§/g, '').trimEnd();

    if (!output.trim()) {
      return '';
    }

    if (this.getConfig('includeTimestamps', true)) {
      output = `[${this.buildTimestamp()}] ${output}`;
    }

    if (output.length > 1900) {
      output = `${output.slice(0, 1900)}…`;
    }

    return output;
  }

  extractFromComponent(component) {
    if (!component) return '';
    if (typeof component === 'string') return component;

    let text = '';
    if (typeof component.text === 'string') {
      text += component.text;
    }

    if (Array.isArray(component.extra)) {
      for (const child of component.extra) {
        text += this.extractFromComponent(child);
      }
    }

    if (component.translate && Array.isArray(component.with)) {
      const parts = component.with.map((part) => this.extractFromComponent(part));
      text += parts.join(' ');
    }

    return text;
  }

  createPayload(content) {
    const payload = { content };

    const username = this.getConfig('webhookUsername', 'Starfish Relay');
    if (username && typeof username === 'string') {
      const trimmed = username.trim();
      if (trimmed.length > 0) {
        payload.username = trimmed.slice(0, 32);
      }
    }

    if (!this.getConfig('allowMentions', false)) {
      payload.allowed_mentions = { parse: [] };
    }

    return payload;
  }

  getWebhookUrl() {
    const raw = this.getConfig('webhook.url', '');
    if (!raw) return '';
    return String(raw).trim();
  }

  isEnabled() {
    return !!this.getConfig('enabled', true);
  }

  notifyMissingWebhook() {
    if (this.warnedMissingWebhook) return;
    this.warnedMissingWebhook = true;
    this.sendPrefixed('§cNo Discord webhook configured. Set it via /discordrelay config.');
  }

  buildTimestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  sendPrefixed(message) {
    if (typeof this.api.chat === 'function') {
      this.api.chat(`${this.prefix} §7${message}`);
    }
  }

  getConfig(path, fallback) {
    try {
      if (this.api.config && typeof this.api.config.get === 'function') {
        const value = this.api.config.get(path);
        return value === undefined ? fallback : value;
      }
    } catch (err) {
      this.debug(`Failed to read config '${path}': ${err.message}`);
    }
    return fallback;
  }

  clearTimer() {
    if (this.queueTimer) {
      clearTimeout(this.queueTimer);
      this.queueTimer = null;
    }
  }

  debug(message) {
    if (typeof this.api.debugLog === 'function') {
      this.api.debugLog(`[discord-relay] ${message}`);
    }
  }
}
