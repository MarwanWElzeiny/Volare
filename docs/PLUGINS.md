# Volare Plugin Guide

## Plugin Shape

A Volare plugin is a plain object with lifecycle hook methods:

```js
const myPlugin = {
  name: 'my-plugin',

  beforeInit(sdk) {
    // Called before viewer initialization
  },

  afterInit(sdk) {
    // Called after viewer is initialized and ready
  },

  beforeLoadModel(url, sdk) {
    // Called before model loading begins
  },

  afterLoadModel(model, sdk) {
    // Called after model is loaded and added to scene
  },

  onModelError(error, url, sdk) {
    // Called when model loading fails
  },

  onEnvironmentChange(diagnostics, sdk) {
    // Called after HDRI/environment changes
  },

  onSecurityCheck(context, sdk) {
    // Called before security-sensitive operations
  },

  onDiagnostics(diagnostics) {
    // Modify diagnostics output
    diagnostics.myPlugin = { active: true };
  }
};
```

All hooks are optional. Only implement the ones you need.

## Registration

### At Creation

```js
const viewer = await createVolareViewer({
  container: '#viewer',
  plugins: [myPlugin, anotherPlugin]
});
```

### At Runtime

```js
viewer.registerPlugin(myPlugin);
```

If the viewer is already initialized, `afterInit` runs immediately on registration.

## Lifecycle Hooks

| Hook | When | Arguments |
|------|------|-----------|
| `beforeInit` | Before viewer creation | `sdk` |
| `afterInit` | After viewer is ready | `sdk` |
| `beforeLoadModel` | Before model fetch | `url, sdk` |
| `afterLoadModel` | After model in scene | `model, sdk` |
| `onModelError` | Model load failed | `error, url, sdk` |
| `onEnvironmentChange` | After HDRI change | `diagnostics, sdk` |
| `onSecurityCheck` | Before protected ops | `context, sdk` |
| `onDiagnostics` | getDiagnostics() called | `diagnostics` |

## SDK Object

The `sdk` argument provides:

```js
sdk.container    // HTMLElement
sdk.config       // Normalized config
sdk.viewer       // VolareViewerInit instance
sdk.plugins      // Registered plugins
sdk.isOpen       // Viewer visibility state
sdk.loadModel(url, options)    // Load a model
sdk.setEnvironment(config)     // Change HDRI/environment
sdk.getDiagnostics()           // Get viewer state
sdk.setFeatureEnabled(id, bool) // Toggle feature buttons
sdk.close()      // Hide viewer
sdk.open()       // Show viewer
sdk.destroy()    // Dispose viewer and clean up
```

## Error Handling

Plugin hook errors are caught and logged as warnings. A crashing plugin will not take down the viewer:

```
[VolarePlugin] my-plugin.afterLoadModel failed: TypeError: ...
```

Design your plugins defensively — check for null/undefined before accessing properties.

## Example: Analytics Plugin

```js
const analyticsPlugin = {
  name: 'analytics',

  afterLoadModel(model, sdk) {
    const stats = sdk.viewer?.modelStats;
    if (stats) {
      console.log(`Model loaded: ${stats.vertexCount} vertices, ${stats.triangleCount} triangles`);
    }
  },

  onEnvironmentChange(diagnostics) {
    console.log('Environment changed:', diagnostics.hdri);
  }
};
```

## Example: Watermark Plugin

```js
const watermarkPlugin = {
  name: 'watermark',

  afterInit(sdk) {
    const div = document.createElement('div');
    div.textContent = 'Preview Only';
    div.style.cssText = 'position:absolute;bottom:10px;right:10px;color:rgba(255,255,255,0.3);font-size:12px;pointer-events:none;z-index:100;';
    sdk.container.appendChild(div);
    this._el = div;
  }
};
```

## Cleanup

Plugins should clean up resources when the viewer is destroyed. Use the `beforeInit` or `afterInit` hook to store references, and clean them up in your own dispose logic if needed. The plugin manager calls `destroy()` on itself during viewer disposal.
