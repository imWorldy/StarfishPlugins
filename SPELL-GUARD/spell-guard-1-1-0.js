const { URLSearchParams } = require('url');

const MAX_CHAT_LENGTH = 256;
const DEFAULT_API_ENDPOINT = 'https://api.languagetool.org/v2/check';

module.exports = (api) => {
  api.metadata({
    name: 'spellguard',
    displayName: 'Spell Guard',
    prefix: '§dSG',
    version: '1.1.0',
    author: 'Codex',
    description: 'Autocorrects outgoing chat using a LanguageTool-compatible API before forwarding to the server.'
  });

  const plugin = new SpellGuardPlugin(api);
  plugin.register();
  return plugin;
};

class SpellGuardPlugin {
  constructor(api) {
    this.api = api;
    this.prefix = typeof api.getPrefix === 'function' ? api.getPrefix() : '§dSG';
    this.unsubscribers = [];
    this.sendingDirect = false;
    this.replacements = this.buildCommonReplacements();
  }

  register() {
    const configSchema = [
      {
        label: 'General',
        defaults: {
          enabled: true,
          fixCommon: true,
          autoCapitalize: true,
          ensurePunctuation: false,
          notifyFix: true
        },
        settings: [
          {
            type: 'toggle',
            key: 'enabled',
            text: ['OFF', 'ON'],
            description: 'Enable automatic corrections for outgoing chat.'
          },
          {
            type: 'toggle',
            key: 'fixCommon',
            text: ['OFF', 'ON'],
            description: 'Apply quick replacements for well-known typos before contacting the API.'
          },
          {
            type: 'toggle',
            key: 'autoCapitalize',
            text: ['KEEP', 'AUTO'],
            description: 'Capitalise the first letter after sentence boundaries.'
          },
          {
            type: 'toggle',
            key: 'ensurePunctuation',
            text: ['NO', 'ADD'],
            description: 'Append a full stop if a sentence ends without punctuation (ignored for very short messages).'
          },
          {
            type: 'toggle',
            key: 'notifyFix',
            text: ['SILENT', 'SHOW'],
            description: 'Show an action bar preview whenever a message is adjusted.'
          }
        ]
      },
      {
        label: 'API Service',
        defaults: {
          api: {
            endpoint: DEFAULT_API_ENDPOINT,
            language: 'auto',
            level: 'default',
            timeoutMs: 3000,
            key: ''
          }
        },
        settings: [
          {
            type: 'text',
            key: 'api.endpoint',
            description: 'LanguageTool-compatible endpoint. Example: https://api.languagetool.org/v2/check',
            placeholder: DEFAULT_API_ENDPOINT
          },
          {
            type: 'cycle',
            key: 'api.language',
            description: 'Language profile to send to the API.',
            values: [
              { text: 'Auto', value: 'auto' },
              { text: 'English (US)', value: 'en-US' },
              { text: 'English (GB)', value: 'en-GB' },
              { text: 'German (DE)', value: 'de-DE' }
            ]
          },
          {
            type: 'cycle',
            key: 'api.level',
            description: 'LanguageTool rule level.',
            values: [
              { text: 'Default', value: 'default' },
              { text: 'Picky', value: 'picky' }
            ]
          },
          {
            type: 'cycle',
            key: 'api.timeoutMs',
            description: 'Timeout before abandoning the API request (milliseconds).',
            values: [
              { text: '1500', value: 1500 },
              { text: '2500', value: 2500 },
              { text: '3000', value: 3000 },
              { text: '4000', value: 4000 }
            ]
          },
          {
            type: 'text',
            key: 'api.key',
            description: 'Optional API key (sent as Bearer token). Leave blank for the public LanguageTool endpoint.',
            placeholder: 'LT_API_KEY'
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
          .command('preview')
          .description('Preview Spell Guard corrections for a message without sending it.')
          .argument('<message>', { type: 'greedy', description: 'Message to evaluate' })
          .handler((ctx) => this.handlePreview(ctx));
      });
    }

    const unsubscribe = typeof this.api.intercept === 'function'
      ? this.api.intercept('packet:client:chat', (event) => this.handleOutgoingChat(event))
      : null;

    if (typeof unsubscribe === 'function') {
      this.unsubscribers.push(unsubscribe);
    }
  }

  disable() {
    for (const off of this.unsubscribers) {
      try {
        if (typeof off === 'function') off();
      } catch (err) {
        this.logDebug(`Failed to unsubscribe: ${err.message}`);
      }
    }
    this.unsubscribers = [];
  }

  async handlePreview(ctx) {
    const raw = ctx?.args?.message;
    const input = Array.isArray(raw)
      ? raw.map((piece) => (piece ?? '').toString()).join(' ').trim()
      : (raw ?? '').toString().trim();
    if (!input) {
      ctx.send(`${this.prefix} §7Provide a message to preview.`);
      return;
    }

    try {
      const preprocessed = this.applyCommonReplacements(input);
      const apiResult = await this.requestApiCorrection(preprocessed);
      const formatted = this.postProcessMessage(apiResult);
      ctx.send(`${this.prefix} §7API: §f${formatted}`);
    } catch (err) {
      ctx.send(`${this.prefix} §cAPI preview failed: ${err.message}`);
    }
  }

  handleOutgoingChat(event) {
    try {
      if (!this.isEnabled()) return;
      if (this.sendingDirect) return;

      const message = event?.data?.message;
      if (typeof message !== 'string') return;
      if (!message.trim()) return;
      if (message.startsWith('/')) return;

      if (typeof event.cancel === 'function') {
        event.cancel();
      }

      const baseline = this.applyCommonReplacements(message);
      this.processWithApi(message, baseline);
    } catch (err) {
      this.logDebug(err.message);
    }
  }

  async processWithApi(original, baseline) {
    try {
      const apiResult = await this.requestApiCorrection(baseline);
      const formatted = this.postProcessMessage(apiResult);
      this.sendCorrectedMessage(original, formatted);
    } catch (err) {
      this.logDebug(`API correction failed: ${err.message}`);
      this.sendCorrectedMessage(original, baseline); // fallback to baseline replacements (or original if unchanged)
    }
  }

  async requestApiCorrection(text) {
    if (typeof fetch !== 'function') {
      throw new Error('fetch API not available in this runtime');
    }

    const endpointRaw = this.getConfig('api.endpoint', DEFAULT_API_ENDPOINT) || DEFAULT_API_ENDPOINT;
    const endpoint = endpointRaw.trim() || DEFAULT_API_ENDPOINT;

    const params = new URLSearchParams();
    params.set('text', text);
    params.set('language', this.getApiLanguage(text));

    const level = (this.getConfig('api.level', 'default') || 'default').toLowerCase();
    if (level === 'picky') {
      params.set('level', 'picky');
    }

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const apiKey = (this.getConfig('api.key', '') || '').trim();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const timeoutMs = Number(this.getConfig('api.timeoutMs', 3000)) || 3000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: params,
        signal: controller.signal
      });
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? `API timeout after ${timeoutMs}ms` : err.message);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const bodyText = await safeReadBody(response);
      throw new Error(`API error ${response.status}: ${bodyText || response.statusText}`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new Error(`Failed to parse API response: ${err.message}`);
    }

    const matches = Array.isArray(payload?.matches) ? payload.matches : [];
    return applyLanguageToolMatches(text, matches);
  }

  sendCorrectedMessage(original, corrected) {
    const finalMessage = this.prepareOutgoingMessage(corrected || original);

    let success = false;
    if (typeof this.api.sendChatToServer === 'function') {
      try {
        this.sendingDirect = true;
        success = this.api.sendChatToServer(finalMessage) !== false;
      } catch (err) {
        this.logDebug(`Failed to send corrected message: ${err.message}`);
      } finally {
        setTimeout(() => { this.sendingDirect = false; }, 0);
      }
    }

    if (!success) {
      if (typeof this.api.chat === 'function') {
        this.api.chat(`${this.prefix} §cKonnte die Nachricht nicht senden.`);
      }
      return;
    }

    if (this.getConfig('notifyFix', true)) {
      this.notifyPreview(original, finalMessage);
    }
  }

  prepareOutgoingMessage(message) {
    if (typeof message !== 'string' || !message) return '';
    const singleLine = message.replace(/[\r\n]+/g, ' ').trim();
    return singleLine.length > MAX_CHAT_LENGTH
      ? singleLine.slice(0, MAX_CHAT_LENGTH)
      : singleLine;
  }

  postProcessMessage(message) {
    let result = message;
    if (this.getConfig('autoCapitalize', true)) {
      result = this.applyCapitalization(result);
    }
    if (this.getConfig('ensurePunctuation', false)) {
      result = this.ensureTrailingPunctuation(result);
    }
    return result;
  }

  applyCommonReplacements(message) {
    if (message === undefined || message === null) return '';
    const text = message.toString();
    if (!this.getConfig('fixCommon', true)) return text;
    if (!this.replacements || this.replacements.size === 0) return text;
    return text.replace(/\b([\p{L}\p{M}]+)\b/gu, (match) => {
      const lower = match.toLowerCase();
      if (!this.replacements.has(lower)) return match;
      return this.applyOriginalCase(match, this.replacements.get(lower));
    });
  }

  getApiLanguage(message) {
    const configured = (this.getConfig('api.language', 'auto') || 'auto').toLowerCase();
    if (configured !== 'auto') return configured;
    return /[äöüß]/i.test(message) ? 'de-DE' : 'en-US';
  }

  notifyPreview(original, corrected) {
    const preview = corrected.length > 60 ? `${corrected.slice(0, 57)}...` : corrected;
    const message = `${this.prefix} §aAPI §7${original} §8→ §f${preview}`;
    if (typeof this.api.sendActionBar === 'function') {
      this.api.sendActionBar(message);
    } else if (typeof this.api.chat === 'function') {
      this.api.chat(message);
    }
  }

  buildCommonReplacements() {
    const entries = [
      ['teh', 'the'],
      ['recieve', 'receive'],
      ['seperate', 'separate'],
      ['definately', 'definitely'],
      ['adress', 'address'],
      ['wich', 'which'],
      ['wierd', 'weird'],
      ['awsome', 'awesome'],
      ['alot', 'a lot'],
      ['vieleicht', 'vielleicht'],
      ['villeicht', 'vielleicht'],
      ['wärend', 'während'],
      ['wehre', 'wäre'],
      ['seperat', 'separat'],
      ['wierklich', 'wirklich']
    ];

    const map = new Map();
    for (const [typo, correction] of entries) {
      map.set(typo, correction);
    }
    return map;
  }

  applyOriginalCase(source, replacement) {
    if (!source) return replacement;
    if (source === source.toUpperCase()) {
      return replacement.toUpperCase();
    }
    if (source[0] === source[0].toUpperCase()) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
  }

  applyCapitalization(message) {
    return message.replace(/(^|[.!?]\s+)([a-zäöüß])/gu, (full, lead, letter) => `${lead}${letter.toUpperCase()}`);
  }

  ensureTrailingPunctuation(message) {
    const trimmed = message.replace(/\s+$/u, '');
    if (trimmed.length <= 3) return message;
    if (!trimmed) return message;

    const lastChar = trimmed.charAt(trimmed.length - 1);
    if (!/[\p{L}\p{M}0-9]/u.test(lastChar)) return message;
    if (/[.!?…]$/u.test(trimmed)) return message;

    const trailingSpaces = message.slice(trimmed.length);
    return `${trimmed}.${trailingSpaces}`;
  }

  isEnabled() {
    return !!this.getConfig('enabled', true);
  }

  getConfig(pathKey, fallback) {
    try {
      if (this.api.config && typeof this.api.config.get === 'function') {
        const value = this.api.config.get(pathKey);
        return value === undefined ? fallback : value;
      }
    } catch (err) {
      this.logDebug(`Failed to read config '${pathKey}': ${err.message}`);
    }
    return fallback;
  }

  logDebug(message) {
    if (typeof this.api.debugLog === 'function') {
      this.api.debugLog(`[spellguard] ${message}`);
    }
  }
}

function applyLanguageToolMatches(text, matches) {
  if (!Array.isArray(matches) || matches.length === 0) return text;

  let corrected = text;
  let offsetDelta = 0;

  const applicable = matches
    .filter((match) => Array.isArray(match?.replacements) && match.replacements.length > 0 && typeof match.offset === 'number' && typeof match.length === 'number')
    .sort((a, b) => a.offset - b.offset);

  for (const match of applicable) {
    const replacement = match.replacements[0]?.value;
    if (!replacement) continue;

    const start = match.offset + offsetDelta;
    const end = start + match.length;
    if (start < 0 || start > corrected.length) continue;

    corrected = corrected.slice(0, start) + replacement + corrected.slice(end);
    offsetDelta += replacement.length - match.length;
  }

  return corrected;
}

async function safeReadBody(response) {
  try {
    return await response.text();
  } catch (_) {
    return '';
  }
}
