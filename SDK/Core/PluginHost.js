export class VolarePluginManager {
  constructor({ viewer = null, allowUI = false, warn = console.warn } = {}) {
    this.viewer = viewer;
    this.allowUI = allowUI;
    this.warn = warn;
    this.plugins = [];
    this.pluginKeys = new Set();
    this.cleanupCallbacks = new Map();
    this.errors = [];
    this.errorKeys = new Set();
  }

  setViewer(viewer) {
    this.viewer = viewer;
  }

  getPluginKey(plugin) {
    return plugin?.name || plugin?.id || plugin;
  }

  createContext(plugin) {
    return {
      viewer: this.viewer,
      plugin,
      allowUI: this.allowUI,
      addUI: (factory) => {
        if (!this.allowUI) {
          this.warn?.(`[VolarePlugin] Plugin "${plugin?.name || 'anonymous'}" requested UI, but plugin UI is disabled.`);
          return null;
        }
        if (typeof factory !== 'function') return null;
        return this.guard(plugin, 'addUI', () => factory(this.viewer));
      },
      onCleanup: (callback) => {
        if (typeof callback !== 'function') return;
        if (!this.cleanupCallbacks.has(plugin)) this.cleanupCallbacks.set(plugin, []);
        this.cleanupCallbacks.get(plugin).push(callback);
      }
    };
  }

  guard(plugin, hookName, callback) {
    try {
      return callback();
    } catch (error) {
      this.recordError(plugin, hookName, error);
      return undefined;
    }
  }

  async guardAsync(plugin, hookName, callback) {
    try {
      return await callback();
    } catch (error) {
      this.recordError(plugin, hookName, error);
      return undefined;
    }
  }

  recordError(plugin, hookName, error) {
    const pluginName = plugin?.name || plugin?.id || 'anonymous';
    const message = error?.message || String(error);
    const key = `${pluginName}:${hookName}:${message}`;
    if (this.errorKeys.has(key)) return;
    this.errorKeys.add(key);
    this.errors.push({ plugin: pluginName, hook: hookName, message });
    this.warn?.(`[VolarePlugin] ${pluginName}.${hookName} failed: ${message}`);
  }

  register(plugin) {
    if (!plugin || typeof plugin !== 'object') return false;
    const key = this.getPluginKey(plugin);
    if (this.pluginKeys.has(key)) return false;
    this.plugins.push(plugin);
    this.pluginKeys.add(key);
    this.guard(plugin, 'install', () => plugin.install?.(this.viewer, this.createContext(plugin)));
    return true;
  }

  async run(hookName, ...args) {
    const results = [];
    for (const plugin of this.plugins) {
      const hook = plugin?.[hookName];
      if (typeof hook !== 'function') continue;
      const result = await this.guardAsync(plugin, hookName, () => hook(...args, this.createContext(plugin)));
      results.push(result);
    }
    return results;
  }

  runSync(hookName, ...args) {
    const results = [];
    for (const plugin of this.plugins) {
      const hook = plugin?.[hookName];
      if (typeof hook !== 'function') continue;
      const result = this.guard(plugin, hookName, () => hook(...args, this.createContext(plugin)));
      results.push(result);
    }
    return results;
  }

  getDiagnostics(baseDiagnostics = {}) {
    const diagnostics = {
      ...baseDiagnostics,
      plugins: this.plugins.map(plugin => plugin?.name || plugin?.id || 'anonymous'),
      pluginErrors: [...this.errors]
    };
    this.runSync('onDiagnostics', diagnostics, this.viewer);
    return diagnostics;
  }

  destroy() {
    this.runSync('onDestroy', this.viewer);
    for (const [plugin, callbacks] of this.cleanupCallbacks.entries()) {
      callbacks.forEach(callback => this.guard(plugin, 'cleanup', callback));
    }
    this.cleanupCallbacks.clear();
    this.plugins = [];
    this.pluginKeys.clear();
    this.errorKeys.clear();
  }
}

export { VolarePluginManager as PluginHost };
