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

  async handlePing() {
    try {
      if (!this.api.getPingAsync) {

        return this.api.getPing((res) => {
          this._sendPingResult(res);
        });
      }
      const res = await this.api.getPingAsync(5000);
      this._sendPingResult(res);
    } catch (e) {
      this.api.chat(`${this.prefix} §cPing failed: ${e.message}`);
    }
  }

  _sendPingResult(result) {
    if (!result || result.success !== true) {
      const msg = result?.errorMessage || 'Unknown error';
      this.api.chat(`${this.prefix} §cPing unavailable: §7${msg}`);
      return;
    }

    const ms = Math.max(0, Math.round(result.latency || 0));
    const color = ms <= 80 ? '§a' : ms <= 150 ? '§e' : '§c';
    this.api.chat(`${this.prefix} §7Latency: ${color}${ms}ms`);
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

    for (const off of this.unsubscribers) {
      try { if (typeof off === 'function') off(); } catch (_) {}
    }
    this.unsubscribers = [];
  }

  disable() {
    this._cleanup();
  }
}
