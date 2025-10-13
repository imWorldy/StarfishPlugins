// Ping/TPS Always Commands
// Provides global /ping and /tps commands regardless of server support

module.exports = (api) => {
  // Metadata (read during discovery)
  api.metadata({
    name: 'pingtps',
    displayName: 'Ping & TPS',
    prefix: '§bPT',
    version: '1.0.0',
    author: 'imWorldy',
    description: 'Allows using /ping and /tps anywhere. Uses Hypixel ping API and estimates TPS from world time updates.'
  });


  try {
    const plugin = new PingTpsPlugin(api);
    plugin.register();
    return plugin;
  } catch (e) {

  }
};

class PingTpsPlugin {
  constructor(api) {
    this.api = api;
    this.prefix = this.api.getPrefix ? this.api.getPrefix() : '§bPT';


    this.lastAge = null; // server world age (ticks as bigint)
    this.lastTs = null; // local timestamp ms
    this.samples = []; // recent TPS samples
    this.maxSamples = 20;

    this.keepAlivePending = new Map(); // keep-alive id -> timestamp
    this.latencyHistory = []; // recent latency samples in ms
    this.maxLatencySamples = 20;
    this.latencyAverageWindow = 5;
    this.keepAliveTimeoutMs = 15000;
    this.maxKeepAlivePending = 40;
    this.lastLatency = null;
    this.lastLatencySource = '';

    this.unsubscribers = [];
  }

  register() {
    // Config 
    const configSchema = [
      {
        label: 'General',
        defaults: { enabled: true },
        settings: [
          { type: 'toggle', key: 'enabled', text: ['OFF', 'ON'], description: 'Enable Ping & TPS plugin' }
        ]
      }
    ];

    if (typeof this.api.initializeConfig === 'function') {
      this.api.initializeConfig(configSchema);
    }
    if (typeof this.api.configSchema === 'function') {
      this.api.configSchema(configSchema);
    }


    this.unsubscribers.push(
      this.api.on('world_time', (event) => {
        try {
          const now = Date.now();
          const age = this._normalizeTickValue(event.age);
          if (age === null) return;

          if (this.lastAge !== null && this.lastTs !== null) {
            const dAge = age - this.lastAge; // ticks (bigint)
            const dMs = now - this.lastTs; // ms
            if (dAge > 0n && dMs > 0) {
              const ticks = Number(dAge);
              if (Number.isFinite(ticks)) {
                const tps = Math.max(0, Math.min(20, ticks / (dMs / 1000)));
                this.samples.push(tps);
                if (this.samples.length > this.maxSamples) this.samples.shift();
              }
            }
          }
          this.lastAge = age;
          this.lastTs = now;
        } catch (err) {
          this.api.debugLog && this.api.debugLog(`TPS calc error: ${err.message}`);
        }
      })
    );

    this.unsubscribers.push(
      this.api.on('packet:server:keep_alive', (event) => {
        try {
          this._trackServerKeepAlive(event);
        } catch (err) {
          this.api.debugLog && this.api.debugLog(`Keep-alive track error: ${err.message}`);
        }
      })
    );

    this.unsubscribers.push(
      this.api.on('packet:client:keep_alive', (event) => {
        try {
          this._trackClientKeepAlive(event);
        } catch (err) {
          this.api.debugLog && this.api.debugLog(`Keep-alive response error: ${err.message}`);
        }
      })
    );


    this.unsubscribers.push(
      this.api.intercept('packet:client:chat', async (evt) => {
        try {
          const raw = (evt.data?.message || '').trim();
          if (!raw.startsWith('/')) return; // not a command

          const base = raw.split(/\s+/)[0].toLowerCase();
          if (base !== '/ping' && base !== '/tps') return;


          evt.cancel();

          if (base === '/ping') {
            await this.handlePing();
          } else if (base === '/tps') {
            this.handleTps();
          }
        } catch (err) {
          this.api.chat(`${this.prefix} §cError: ${err.message}`);
        }
      })
    );
  }

  _normalizeTickValue(raw) {
    try {
      if (typeof raw === 'bigint') return raw;
      if (typeof raw === 'number' && Number.isFinite(raw)) return BigInt(Math.round(raw));
      if (raw && typeof raw === 'object') {
        if (typeof raw.toBigInt === 'function') {
          return raw.toBigInt();
        }
        if (typeof raw.toNumber === 'function') {
          const num = raw.toNumber();
          if (Number.isFinite(num)) return BigInt(num);
        }
        if (Array.isArray(raw) && raw.length === 2) {
          const [high, low] = raw;
          if (typeof high === 'number' && typeof low === 'number') {
            const hi = BigInt(Math.trunc(high));
            const lo = BigInt(low >>> 0);
            return (hi << 32n) + lo;
          }
        }
        if ('high' in raw && 'low' in raw) {
          const { high, low } = raw;
          if (typeof high === 'number' && typeof low === 'number') {
            const hi = BigInt(Math.trunc(high));
            const lo = BigInt(low >>> 0);
            return (hi << 32n) + lo;
          }
        }
      }
    } catch (_) {}
    return null;
  }

  _trackServerKeepAlive(event) {
    const id = this._normalizeKeepAliveId(event?.data?.keepAliveId);
    if (id === null) return;

    const now = Date.now();
    this.keepAlivePending.set(id, now);
    this._pruneKeepAliveCache(now);
  }

  _trackClientKeepAlive(event) {
    const id = this._normalizeKeepAliveId(event?.data?.keepAliveId);
    if (id === null) return;

    const started = this.keepAlivePending.get(id);
    if (typeof started === 'number') {
      const latency = Date.now() - started;
      this.keepAlivePending.delete(id);
      this._recordLatency(latency);
    }
  }

  _normalizeKeepAliveId(raw) {
    const value = this._normalizeTickValue(raw);
    if (value === null) return null;
    return value.toString();
  }

  _recordLatency(latency) {
    if (!Number.isFinite(latency)) return;
    const ms = Math.max(0, Math.round(latency));
    this.latencyHistory.push(ms);
    if (this.latencyHistory.length > this.maxLatencySamples) {
      this.latencyHistory.shift();
    }
    this.lastLatency = ms;
    this.lastLatencySource = 'keep-alive';
  }

  _getLatencyEstimate() {
    if (!this.latencyHistory.length) return null;
    const count = Math.min(this.latencyAverageWindow, this.latencyHistory.length);
    const samples = this.latencyHistory.slice(-count);
    const avg = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    return Math.round(avg);
  }

  async _handleRateLimitFallback() {
    const estimate = this._getLatencyEstimate();
    if (typeof estimate === 'number') {
      const source = this._getKeepAliveLabel();
      this._emitLatency(estimate, source, { cached: true });
      return true;
    }

    if (typeof this.lastLatency === 'number') {
      const source = this.lastLatencySource ? `${this.lastLatencySource}` : 'cached';
      this._emitLatency(this.lastLatency, source, { store: false, cached: true });
      return true;
    }

    this.api.chat(`${this.prefix} §cPing unavailable: §7No keep-alive samples recorded yet.`);
    return false;
  }

  _getKeepAliveLabel() {
    return this.latencyHistory.length >= this.latencyAverageWindow ? 'keep-alive avg' : 'keep-alive';
  }

  _emitLatency(ms, sourceLabel, { cached = false, store = true } = {}) {
    if (store) {
      this.lastLatency = ms;
      this.lastLatencySource = sourceLabel || '';
    }
    const color = ms <= 80 ? '§a' : ms <= 150 ? '§e' : '§c';
    let labelText = sourceLabel || '';
    if (cached) {
      labelText = labelText ? `${labelText} cached` : 'cached';
    }
    const suffix = labelText ? ` §8(${labelText})` : '';
    this.api.chat(`${this.prefix} §7Latency: ${color}${ms}ms${suffix}`);
  }

  _pruneKeepAliveCache(now) {
    if (!this.keepAlivePending.size) return;

    for (const [id, timestamp] of this.keepAlivePending) {
      if (now - timestamp > this.keepAliveTimeoutMs) {
        this.keepAlivePending.delete(id);
      } else {
        break;
      }
    }

    while (this.keepAlivePending.size > this.maxKeepAlivePending) {
      const first = this.keepAlivePending.keys().next();
      if (first.done) break;
      this.keepAlivePending.delete(first.value);
    }
  }

  async handlePing() {
    try {
      const estimated = this._getLatencyEstimate();
      if (estimated !== null) {
        const label = this._getKeepAliveLabel();
        this._emitLatency(estimated, label);
        return;
      }

      const hasAsyncPing = typeof this.api.getPingAsync === 'function';
      const hasCallbackPing = typeof this.api.getPing === 'function';

      if (!hasAsyncPing && !hasCallbackPing) {
        this.api.chat(`${this.prefix} §7Latency: §8calculating... (waiting for keep-alive packets)`);
        return;
      }

      if (!hasAsyncPing) {
        return this.api.getPing((res) => {
          this._sendPingResult(res);
        });
      }

      const res = await this.api.getPingAsync(5000);
      await this._sendPingResult(res);
    } catch (e) {
      const message = e?.message || 'Unknown error';
      if (/rate\s*limit/i.test(message)) {
        await this._handleRateLimitFallback();
        return;
      }
      this.api.chat(`${this.prefix} §cPing failed: §7${message}`);
    }
  }

  async _sendPingResult(result) {
    if (!result || result.success !== true) {
      const msg = result?.errorMessage || 'Unknown error';
      const errorCode = typeof result?.error === 'number' ? result.error : null;
      const isRateLimited = errorCode === 3 || /rate\s*limit/i.test(msg);

      if (isRateLimited) {
        await this._handleRateLimitFallback();
        return;
      }

      this.api.chat(`${this.prefix} §cPing unavailable: §7${msg}`);
      return;
    }

    const ms = Math.max(0, Math.round(result.latency || 0));
    this._emitLatency(ms, 'Hypixel API');
  }

  handleTps() {
    if (!this.samples.length) {
      this.api.chat(`${this.prefix} §7TPS: §8calculating... (move around for a few seconds)`);
      return;
    }
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    const tps = Math.min(20, Math.max(0, avg));
    const tpsFixed = tps.toFixed(2);
    const color = tps >= 19.5 ? '§a' : tps >= 18 ? '§e' : '§c';
    this.api.chat(`${this.prefix} §7TPS: ${color}${tpsFixed}`);
  }

  _cleanup() {
    this.keepAlivePending.clear();
    this.latencyHistory = [];
    this.lastLatency = null;
    this.lastLatencySource = '';

    for (const off of this.unsubscribers) {
      try { if (typeof off === 'function') off(); } catch (_) {}
    }
    this.unsubscribers = [];
  }

  disable() {
    this._cleanup();
  }
}
