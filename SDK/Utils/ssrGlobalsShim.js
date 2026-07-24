// three/webgpu references `self` and `navigator` at module top-level (device/adapter
// detection). In a real browser both exist; in SSR/Node import analysis neither does,
// which throws before any Volare code runs. Import this before any `three/webgpu`
// import to make that import safe everywhere -- it's a no-op in real browsers.
if (typeof self === 'undefined') globalThis.self = globalThis;
if (typeof navigator === 'undefined') globalThis.navigator = {};
