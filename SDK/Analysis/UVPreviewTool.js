import { showTopToast } from '../UI/TopToast.js';

// Tightly-packed, de-interleaved, denormalized copy of a BufferAttribute /
// InterleavedBufferAttribute, safe to hand to a Worker. See the comment at the
// _processWithWorker call site for why this can't be `attribute.array.slice()`.
function packAttribute(attribute, itemSize) {
  const out = new Float32Array(attribute.count * itemSize);
  for (let i = 0; i < attribute.count; i++) {
    out[i * itemSize] = attribute.getX(i);
    if (itemSize > 1) out[i * itemSize + 1] = attribute.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attribute.getZ(i);
  }
  return out;
}

function packIndex(indexAttribute) {
  const out = new Uint32Array(indexAttribute.count);
  for (let i = 0; i < indexAttribute.count; i++) out[i] = indexAttribute.getX(i);
  return out;
}

// Type definitions
const UVEventType = {
  PROCESSING_START: 'processing_start',
  PROCESSING_PROGRESS: 'processing_progress',
  PROCESSING_COMPLETE: 'processing_complete',
  PROCESSING_ERROR: 'processing_error',
  PROCESSING_CANCELLED: 'processing_cancelled',
  RENDER_UPDATE: 'render_update'
};

const ProcessingState = {
  IDLE: 'idle',
  INITIALIZING: 'initializing',
  PROCESSING: 'processing',
  RENDERING: 'rendering',
  COMPLETE: 'complete',
  ERROR: 'error',
  CANCELLED: 'cancelled'
};

/**
 * UV Shell detector - groups connected UV faces into shells
 */
class UVShellDetector {
  constructor() {
    this.shells = [];
    this.faceToShell = new Map();
    this.uvTolerance = 0.0001; // Tolerance for UV coordinate comparison
  }

  reset() {
    this.shells = [];
    this.faceToShell.clear();
  }

  // Check if two UV coordinates are the same within tolerance
  uvEquals(uv1, uv2) {
    return Math.abs(uv1.x - uv2.x) < this.uvTolerance &&
           Math.abs(uv1.y - uv2.y) < this.uvTolerance;
  }

  // posA/posB are position-VALUE keys (see _posKey), not raw vertex indices.
  // Non-indexed geometry gives every triangle its own synthetic per-triangle
  // index (i*3, i*3+1, i*3+2), so keying on index equality can never match two
  // different triangles even when they share a real edge -- every triangle
  // ends up in its own shell. Keying on the actual 3D position (like
  // UVSeamDetector already does) makes adjacency correct regardless of
  // whether the geometry is indexed.
  _edgeKey(posA, posB, uvA, uvB) {
    const P = this.uvTolerance < 0.001 ? 10000 : 1000;
    const a = posA < posB ? posA : posB;
    const b = posA < posB ? posB : posA;
    const ua = posA < posB ? uvA : uvB;
    const ub = posA < posB ? uvB : uvA;
    return `${a},${b},${Math.round(ua.x*P)},${Math.round(ua.y*P)},${Math.round(ub.x*P)},${Math.round(ub.y*P)}`;
  }

  _posKey(posAttr, index) {
    if (!posAttr) return String(index);
    const P = 10000;
    return `${Math.round(posAttr.getX(index)*P)},${Math.round(posAttr.getY(index)*P)},${Math.round(posAttr.getZ(index)*P)}`;
  }

  buildShells(geometry) {
    this.reset();

    const uvAttr = geometry.attributes.uv;
    if (!uvAttr || !uvAttr.count) return [];
    const posAttr = geometry.attributes.position;
    const indexAttr = geometry.index;
    const triangleCount = indexAttr ? indexAttr.count / 3 : uvAttr.count / 3;

    const faces = [];
    for (let i = 0; i < triangleCount; i++) {
      let i0, i1, i2;
      if (indexAttr) {
        i0 = indexAttr.getX(i * 3);
        i1 = indexAttr.getX(i * 3 + 1);
        i2 = indexAttr.getX(i * 3 + 2);
      } else {
        i0 = i * 3;
        i1 = i * 3 + 1;
        i2 = i * 3 + 2;
      }
      if (i0 < uvAttr.count && i1 < uvAttr.count && i2 < uvAttr.count) {
        faces.push({
          faceIndex: i,
          indices: [i0, i1, i2],
          posKeys: [this._posKey(posAttr, i0), this._posKey(posAttr, i1), this._posKey(posAttr, i2)],
          uvs: [
            { x: uvAttr.getX(i0), y: uvAttr.getY(i0) },
            { x: uvAttr.getX(i1), y: uvAttr.getY(i1) },
            { x: uvAttr.getX(i2), y: uvAttr.getY(i2) }
          ]
        });
      }
    }

    // Build adjacency map: edge → list of face indices (O(n))
    const edgeToFaces = new Map();
    for (const face of faces) {
      for (let e = 0; e < 3; e++) {
        const key = this._edgeKey(
          face.posKeys[e], face.posKeys[(e + 1) % 3],
          face.uvs[e], face.uvs[(e + 1) % 3]
        );
        if (!edgeToFaces.has(key)) edgeToFaces.set(key, []);
        edgeToFaces.get(key).push(face.faceIndex);
      }
    }

    // Build face → neighbors lookup
    const faceNeighbors = new Map();
    for (const faceList of edgeToFaces.values()) {
      for (let a = 0; a < faceList.length; a++) {
        for (let b = a + 1; b < faceList.length; b++) {
          if (!faceNeighbors.has(faceList[a])) faceNeighbors.set(faceList[a], []);
          if (!faceNeighbors.has(faceList[b])) faceNeighbors.set(faceList[b], []);
          faceNeighbors.get(faceList[a]).push(faceList[b]);
          faceNeighbors.get(faceList[b]).push(faceList[a]);
        }
      }
    }

    // Flood fill using adjacency map (O(n))
    const visited = new Set();
    const faceByIndex = new Map();
    for (const face of faces) faceByIndex.set(face.faceIndex, face);

    for (const face of faces) {
      if (visited.has(face.faceIndex)) continue;

      const shell = { id: this.shells.length, faces: [], edges: [], seamEdges: [] };
      const stack = [face.faceIndex];

      while (stack.length > 0) {
        const fi = stack.pop();
        if (visited.has(fi)) continue;
        visited.add(fi);

        const f = faceByIndex.get(fi);
        shell.faces.push(f);
        this.faceToShell.set(fi, shell.id);

        const neighbors = faceNeighbors.get(fi);
        if (neighbors) {
          for (const ni of neighbors) {
            if (!visited.has(ni)) stack.push(ni);
          }
        }
      }

      this.shells.push(shell);
    }

    for (const shell of this.shells) {
      this.generateShellEdges(shell);
    }

    return this.shells;
  }

  // Every triangle edge in the shell, not just the outer boundary -- the UV
  // preview is meant to show each face's outline (like a UV wireframe), so
  // interior edges shared by two faces must still be drawn, not deduped away.
  generateShellEdges(shell) {
    const edges = [];
    for (const face of shell.faces) {
      for (let i = 0; i < 3; i++) {
        edges.push([face.uvs[i], face.uvs[(i + 1) % 3]]);
      }
    }
    shell.edges = edges;
  }
}

/**
 * UV Seam detector - finds seams between UV shells
 */
class UVSeamDetector {
  constructor() {
    this.seams = [];
    this.positionTolerance = 0.0001;
    this.uvTolerance = 0.0001;
  }

  reset() {
    this.seams = [];
  }

  // Detect seams by finding edges that share 3D positions but have different UV coordinates
  detectSeams(geometry, shells) {
    this.reset();
    const pos = geometry.attributes.position;
    if (!pos) return this.seams;
    const edgeMap = new Map();

    // collect every 3D edge → list of UV edges
    shells.forEach(shell => {
      shell.faces.forEach(f => {
        for (let i = 0; i < 3; i++) {
          const a = f.indices[i], b = f.indices[(i + 1) % 3];
          const pA = this._posKey(pos, a), pB = this._posKey(pos, b);
          const key = pA < pB ? `${pA}|${pB}` : `${pB}|${pA}`;
          if (!edgeMap.has(key)) edgeMap.set(key, []);
          edgeMap.get(key).push([ f.uvs[i], f.uvs[(i+1)%3] ]);
        }
      });
    });

    // any edge with two distinct UV representations is a seam
    for (const uvList of edgeMap.values()) {
      if (uvList.length === 2) {
        const [e1, e2] = uvList;
        if (!this._edgesEqual(e1, e2)) {
          this.seams.push(e1, e2);
        }
      }
    }
    return this.seams;
  }

  _posKey(attr, idx) {
    const P = 10000;
    return [
      Math.round(attr.getX(idx) * P),
      Math.round(attr.getY(idx) * P),
      Math.round(attr.getZ(idx) * P)
    ].join(',');
  }

  _edgesEqual(e1, e2) {
    const eq = (u,v) => Math.abs(u.x - v.x) < this.uvTolerance && Math.abs(u.y - v.y) < this.uvTolerance;
    return (eq(e1[0], e2[0]) && eq(e1[1], e2[1])) ||
           (eq(e1[0], e2[1]) && eq(e1[1], e2[0]));
  }

  uvEquals(uv1, uv2) {
    return Math.abs(uv1.x - uv2.x) < this.uvTolerance &&
           Math.abs(uv1.y - uv2.y) < this.uvTolerance;
  }

  edgesUVEqual(edge1, edge2) {
    return (
      (this.uvEquals(edge1[0], edge2[0]) && this.uvEquals(edge1[1], edge2[1])) ||
      (this.uvEquals(edge1[0], edge2[1]) && this.uvEquals(edge1[1], edge2[0]))
    );
  }

  getPositionKey(position) {
    const precision = 10000;
    const x = Math.round(position.x * precision);
    const y = Math.round(position.y * precision);
    const z = Math.round(position.z * precision);
    return `${x},${y},${z}`;
  }
}

/**
 * High-performance canvas renderer
 */
class UVRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = {
      resolution: 2048,
      showChecker: false,
      showSeams: true,
      lineWidth: 1,
      seamWidth: 2,
      backgroundColor: '#2d2d2d',
      edgeColor: '#ffffff',
      seamColor: '#ff4444',
      checkerColor1: '#666666',
      checkerColor2: '#555555',
      checkerResolution: '1K',
      checkerScale: 32,
      ...options
    };

    this.setupCanvas();
    this.shellColors = this.generateShellColors();
  }

  setupCanvas() {
    const { resolution } = this.options;

    this.canvas.width = resolution;
    this.canvas.height = resolution;
    this.canvas.style.width = `${resolution}px`;
    this.canvas.style.height = `${resolution}px`;

    this.ctx.imageSmoothingEnabled = false;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  generateShellColors() {
    const colors = [];
    for (let i = 0; i < 32; i++) {
      const hue = (i * 137.5) % 360;
      colors.push(`hsl(${hue}, 70%, 60%)`);
    }
    return colors;
  }

  clear() {
    const { resolution, backgroundColor } = this.options;
    this.ctx.save();
    this.ctx.fillStyle = backgroundColor;
    this.ctx.fillRect(0, 0, resolution, resolution);
    this.ctx.restore();
  }

  drawChecker() {
    if (!this.options.showChecker) return;

    const { resolution, checkerColor1, checkerColor2 } = this.options;
    const checkerSize = this.getCheckerSize();

    // Create checker pattern
    const cols = Math.ceil(resolution / checkerSize);
    const rows = Math.ceil(resolution / checkerSize);

    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const x = col * checkerSize;
        const y = row * checkerSize;
        const isEven = (col + row) % 2 === 0;

        this.ctx.fillStyle = isEven ? checkerColor1 : checkerColor2;
        this.ctx.fillRect(x, y, checkerSize, checkerSize);
      }
    }
  }

  getCheckerSize() {
    const resolutionMap = {
      '512': 512,
      '1K': 1024,
      '2K': 2048,
      '4K': 4096,
      '8K': 8192
    };

    const checkerRes = resolutionMap[this.options.checkerResolution] || 1024;
    // Scale checker size based on canvas resolution vs checker resolution
    const scale = this.options.resolution / checkerRes;
    return Math.max(8, Math.min(128, this.options.checkerScale * scale));
  }

  _visibleLineWidth(baseWidth, cssPxTarget = 1.5) {
    const displayWidth = this.canvas.offsetWidth;
    if (!displayWidth) return baseWidth;
    const scale = this.options.resolution / displayWidth;
    return Math.max(baseWidth, Math.ceil(scale * cssPxTarget));
  }

  renderShells(shells) {
    if (!shells || shells.length === 0) return;

    const { resolution } = this.options;

    this.ctx.lineWidth = this._visibleLineWidth(this.options.lineWidth, 1.5);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    // Render each shell with different color
    shells.forEach((shell, index) => {
      this.ctx.strokeStyle = this.shellColors[index % this.shellColors.length];
      this.ctx.beginPath();

      for (const [uv1, uv2] of shell.edges) {
        const x1 = Math.floor(uv1.x * resolution) + 0.5;
        const y1 = Math.floor((1.0 - uv1.y) * resolution) + 0.5;
        const x2 = Math.floor(uv2.x * resolution) + 0.5;
        const y2 = Math.floor((1.0 - uv2.y) * resolution) + 0.5;

        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
      }

      this.ctx.stroke();
    });
  }

  renderSeams(seams) {
    if (!seams || seams.length === 0 || !this.options.showSeams) return;

    const { resolution, seamColor } = this.options;

    this.ctx.strokeStyle = seamColor;
    this.ctx.lineWidth = this._visibleLineWidth(this.options.seamWidth, 2.5);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.beginPath();

    for (const [uv1, uv2] of seams) {
      const x1 = Math.floor(uv1.x * resolution) + 0.5;
      const y1 = Math.floor((1.0 - uv1.y) * resolution) + 0.5;
      const x2 = Math.floor(uv2.x * resolution) + 0.5;
      const y2 = Math.floor((1.0 - uv2.y) * resolution) + 0.5;

      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
    }

    this.ctx.stroke();
  }

  updateOptions(newOptions) {
    Object.assign(this.options, newOptions);
  }
}

/**
 * Progress tracker
 */
class ProgressTracker {
  constructor() {
    this.startTime = 0;
    this.lastUpdate = 0;
    this.processedItems = 0;
    this.totalItems = 0;
    this.currentPhase = '';
    this.phases = [];
  }

  start(totalItems, phases = []) {
    this.startTime = Date.now();
    this.lastUpdate = this.startTime;
    this.processedItems = 0;
    this.totalItems = totalItems;
    this.phases = phases;
    this.currentPhase = phases[0] || 'Processing';
  }

  update(processedItems, phase = null) {
    this.processedItems = processedItems;
    if (phase) this.currentPhase = phase;
    this.lastUpdate = Date.now();
  }

  getProgress() {
    const progress = this.totalItems > 0 ? this.processedItems / this.totalItems : 0;
    const elapsed = Date.now() - this.startTime;
    const estimated = progress > 0 ? elapsed / progress : 0;
    const remaining = Math.max(0, estimated - elapsed);

    return {
      progress: Math.min(1, progress),
      percentage: Math.min(100, progress * 100),
      elapsed: elapsed,
      estimated: estimated,
      remaining: remaining,
      phase: this.currentPhase,
      itemsProcessed: this.processedItems,
      totalItems: this.totalItems,
      itemsPerSecond: elapsed > 0 ? this.processedItems / (elapsed / 1000) : 0
    };
  }

  getMemoryUsage() {
    if (performance.memory) {
      return {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
        limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
      };
    }
    return null;
  }
}

function _buildUVWorkerCode() {
  return `'use strict';
class ArrayAttr {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
  }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
}
class UVShellDetector {
  constructor() { this.shells = []; this.faceToShell = new Map(); this.uvTolerance = 0.0001; }
  reset() { this.shells = []; this.faceToShell.clear(); }
  uvEquals(uv1, uv2) { return Math.abs(uv1.x - uv2.x) < this.uvTolerance && Math.abs(uv1.y - uv2.y) < this.uvTolerance; }
  _edgeKey(posA, posB, uvA, uvB) {
    const P = this.uvTolerance < 0.001 ? 10000 : 1000;
    const a = posA < posB ? posA : posB, b = posA < posB ? posB : posA;
    const ua = posA < posB ? uvA : uvB, ub = posA < posB ? uvB : uvA;
    return a+','+b+','+Math.round(ua.x*P)+','+Math.round(ua.y*P)+','+Math.round(ub.x*P)+','+Math.round(ub.y*P);
  }
  _posKey(posAttr, index) {
    if (!posAttr) return String(index);
    const P = 10000;
    return Math.round(posAttr.getX(index)*P)+','+Math.round(posAttr.getY(index)*P)+','+Math.round(posAttr.getZ(index)*P);
  }
  buildShells(geometry) {
    this.reset();
    const uvAttr = geometry.attributes.uv;
    if (!uvAttr || !uvAttr.count) return [];
    const posAttr = geometry.attributes.position;
    const indexAttr = geometry.index;
    const triangleCount = indexAttr ? indexAttr.count / 3 : uvAttr.count / 3;
    const faces = [];
    for (let i = 0; i < triangleCount; i++) {
      let i0, i1, i2;
      if (indexAttr) { i0 = indexAttr.getX(i*3); i1 = indexAttr.getX(i*3+1); i2 = indexAttr.getX(i*3+2); }
      else { i0 = i*3; i1 = i*3+1; i2 = i*3+2; }
      if (i0 < uvAttr.count && i1 < uvAttr.count && i2 < uvAttr.count) {
        faces.push({ faceIndex: i, indices: [i0,i1,i2],
          posKeys: [this._posKey(posAttr,i0), this._posKey(posAttr,i1), this._posKey(posAttr,i2)],
          uvs: [
          { x: uvAttr.getX(i0), y: uvAttr.getY(i0) },
          { x: uvAttr.getX(i1), y: uvAttr.getY(i1) },
          { x: uvAttr.getX(i2), y: uvAttr.getY(i2) }
        ]});
      }
    }
    const edgeToFaces = new Map();
    for (const face of faces) {
      for (let e = 0; e < 3; e++) {
        const key = this._edgeKey(face.posKeys[e], face.posKeys[(e+1)%3], face.uvs[e], face.uvs[(e+1)%3]);
        if (!edgeToFaces.has(key)) edgeToFaces.set(key, []);
        edgeToFaces.get(key).push(face.faceIndex);
      }
    }
    const faceNeighbors = new Map();
    for (const faceList of edgeToFaces.values()) {
      for (let a = 0; a < faceList.length; a++) {
        for (let b = a+1; b < faceList.length; b++) {
          if (!faceNeighbors.has(faceList[a])) faceNeighbors.set(faceList[a], []);
          if (!faceNeighbors.has(faceList[b])) faceNeighbors.set(faceList[b], []);
          faceNeighbors.get(faceList[a]).push(faceList[b]);
          faceNeighbors.get(faceList[b]).push(faceList[a]);
        }
      }
    }
    const visited = new Set();
    const faceByIndex = new Map();
    for (const face of faces) faceByIndex.set(face.faceIndex, face);
    for (const face of faces) {
      if (visited.has(face.faceIndex)) continue;
      const shell = { id: this.shells.length, faces: [], edges: [], seamEdges: [] };
      const stack = [face.faceIndex];
      while (stack.length > 0) {
        const fi = stack.pop();
        if (visited.has(fi)) continue;
        visited.add(fi);
        const f = faceByIndex.get(fi);
        shell.faces.push(f);
        this.faceToShell.set(fi, shell.id);
        const neighbors = faceNeighbors.get(fi);
        if (neighbors) { for (const ni of neighbors) { if (!visited.has(ni)) stack.push(ni); } }
      }
      this.shells.push(shell);
    }
    for (const shell of this.shells) this.generateShellEdges(shell);
    return this.shells;
  }
  generateShellEdges(shell) {
    const edges = [];
    for (const face of shell.faces) {
      for (let i = 0; i < 3; i++) {
        edges.push([face.uvs[i], face.uvs[(i+1)%3]]);
      }
    }
    shell.edges = edges;
  }
}
class UVSeamDetector {
  constructor() { this.seams = []; this.uvTolerance = 0.0001; }
  reset() { this.seams = []; }
  detectSeams(geometry, shells) {
    this.reset();
    const pos = geometry.attributes.position;
    if (!pos) return this.seams;
    const edgeMap = new Map();
    shells.forEach(shell => {
      shell.faces.forEach(f => {
        for (let i = 0; i < 3; i++) {
          const a = f.indices[i], b = f.indices[(i+1)%3];
          const pA = this._posKey(pos, a), pB = this._posKey(pos, b);
          const key = pA < pB ? pA+'|'+pB : pB+'|'+pA;
          if (!edgeMap.has(key)) edgeMap.set(key, []);
          edgeMap.get(key).push([ f.uvs[i], f.uvs[(i+1)%3] ]);
        }
      });
    });
    for (const uvList of edgeMap.values()) {
      if (uvList.length === 2) {
        const [e1, e2] = uvList;
        if (!this._edgesEqual(e1, e2)) { this.seams.push(e1, e2); }
      }
    }
    return this.seams;
  }
  _posKey(attr, idx) {
    const P = 10000;
    return Math.round(attr.getX(idx)*P)+','+Math.round(attr.getY(idx)*P)+','+Math.round(attr.getZ(idx)*P);
  }
  _edgesEqual(e1, e2) {
    const T = this.uvTolerance;
    const eq = (u,v) => Math.abs(u.x-v.x)<T && Math.abs(u.y-v.y)<T;
    return (eq(e1[0],e2[0]) && eq(e1[1],e2[1])) || (eq(e1[0],e2[1]) && eq(e1[1],e2[0]));
  }
}
self.onmessage = function(e) {
  const { uvArray, indexArray, positionArray, meshIndex, meshName } = e.data;
  const uvAttr = new ArrayAttr(new Float32Array(uvArray), 2);
  const indexAttr = indexArray ? { count: new Uint32Array(indexArray).length, getX: function(i) { return new Uint32Array(indexArray)[i]; } } : null;
  if (indexArray) {
    const idx = new Uint32Array(indexArray);
    indexAttr.count = idx.length;
    indexAttr.getX = function(i) { return idx[i]; };
  }
  const posAttr = positionArray ? new ArrayAttr(new Float32Array(positionArray), 3) : null;
  const geometry = { attributes: { uv: uvAttr, position: posAttr }, index: indexAttr };
  const shellDetector = new UVShellDetector();
  const shells = shellDetector.buildShells(geometry);
  const seamDetector = new UVSeamDetector();
  const seams = seamDetector.detectSeams(geometry, shells);
  const lightShells = shells.map(s => ({ id: s.id, edges: s.edges, faces: [], seamEdges: s.seamEdges }));
  self.postMessage({ meshIndex, meshName, shells: lightShells, seams, shellCount: shells.length, seamCount: seams.length });
};`;
}

/**
 * Fixed UV Processor with proper shell detection
 */
class UVProcessor {
  constructor(options = {}) {
    this.options = {
      maxMemoryMB: 500,
      chunkDelay: 8,
      uvWorker: true,
      ...options
    };

    this.state = ProcessingState.IDLE;
    this.cancelled = false;
    this.shellDetector = new UVShellDetector();
    this.seamDetector = new UVSeamDetector();
    this.progressTracker = new ProgressTracker();
    this.meshData = [];
    this.processedResults = [];
    this._worker = null;

    if (this.options.uvWorker) {
      try {
        const blob = new Blob([_buildUVWorkerCode()], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        this._worker = new Worker(url);
        URL.revokeObjectURL(url);
      } catch (e) {
        console.warn('[Volare] UV Worker unavailable, using main thread:', e.message);
        this._worker = null;
      }
    }
  }

  async processScene(scene, onProgress = null) {
    try {
      this.state = ProcessingState.INITIALIZING;
      this.cancelled = false;
      this.meshData = [];
      this.processedResults = [];

      // Analyze scene
      const analysis = this.analyzeScene(scene);
      if (analysis.uvMeshes.length === 0) {
        throw new Error('No UV-mapped meshes found in scene');
      }

      this.meshData = analysis.uvMeshes;
      this.progressTracker.start(
        analysis.uvMeshes.length,
        ['Analyzing', 'Processing Shells', 'Detecting Seams', 'Complete']
      );

      // Process meshes
      this.state = ProcessingState.PROCESSING;
      const results = await this.processMeshes(onProgress);

      this.state = ProcessingState.COMPLETE;
      this.processedResults = results;
      return results;

    } catch (error) {
      this.state = ProcessingState.ERROR;
      throw error;
    }
  }

  analyzeScene(scene) {
    const uvMeshes = [];

    scene.traverse(obj => {
      if (!obj.isMesh) return;
      if (!obj.geometry?.attributes?.uv) return;
      // Skip wireframe/helper meshes added by Volare tools
      if (obj.userData?.volareHelper || obj.userData?.isWireframeMesh) return;
      if (obj.type === 'LineSegments' || obj.type === 'Line') return;
      uvMeshes.push({
        mesh: obj,
        name: obj.name || `Mesh_${uvMeshes.length}`
      });
    });

    return { uvMeshes };
  }

  async processMeshes(onProgress) {
    const results = [];
    const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));

    for (let i = 0; i < this.meshData.length; i++) {
      if (this.cancelled) {
        this.state = ProcessingState.CANCELLED;
        return results;
      }

      const meshData = this.meshData[i];
      this.progressTracker.update(i, `Processing ${meshData.name}`);

      if (onProgress) {
        onProgress(this.progressTracker.getProgress());
      }
      // Yield so progress UI paints before heavy computation
      await yieldFrame();

      const memory = this.progressTracker.getMemoryUsage();
      if (memory && memory.used > this.options.maxMemoryMB) {
        console.warn(`Memory limit reached: ${memory.used}MB`);
        break;
      }

      const result = await this.processMesh(meshData);
      results.push(result);

      await yieldFrame();
    }

    return results;
  }

  async processMesh(meshData) {
    const { mesh, name } = meshData;
    const geometry = mesh.geometry;

    if (!geometry?.attributes?.uv) {
      return { meshName: name, shells: [], seams: [], shellCount: 0, seamCount: 0 };
    }

    if (this._worker) {
      try {
        return await this._processWithWorker(geometry, name);
      } catch (e) {
        console.warn('[Volare] UV Worker failed, falling back to main thread:', e.message);
      }
    }

    const shells = this.shellDetector.buildShells(geometry);
    const seams = this.seamDetector.detectSeams(geometry, shells);

    return {
      meshName: name,
      shells: shells,
      seams: seams,
      shellCount: shells.length,
      seamCount: seams.length
    };
  }

  _processWithWorker(geometry, meshName) {
    return new Promise((resolve, reject) => {
      // Never take `.array` directly off a BufferAttribute headed for a worker.
      // For InterleavedBufferAttribute, `.array` is the *whole shared buffer*
      // (e.g. position+normal+uv packed together per vertex) -- GLTFLoader
      // creates these whenever a glTF bufferView has a byteStride, which many
      // real-world exports use. Slicing that raw gives the worker garbage it
      // reads back as tightly-packed 2/3-float tuples. `.getX()/.getY()/.getZ()`
      // are the only accessors that correctly apply stride/offset (and denormalize
      // quantized data), so pack through those instead. Cheap even for large
      // meshes -- this is the same O(n) walk the main-thread path already does.
      const uvArray = packAttribute(geometry.attributes.uv, 2);
      const indexArray = geometry.index ? packIndex(geometry.index) : null;
      const posArray = geometry.attributes.position ? packAttribute(geometry.attributes.position, 3) : null;

      const transfers = [uvArray.buffer];
      if (indexArray) transfers.push(indexArray.buffer);
      if (posArray) transfers.push(posArray.buffer);

      this._worker.onmessage = (e) => resolve(e.data);
      this._worker.onerror = (e) => reject(new Error(e.message || 'UV Worker error'));

      this._worker.postMessage({
        uvArray: uvArray.buffer,
        indexArray: indexArray?.buffer || null,
        positionArray: posArray?.buffer || null,
        meshName
      }, transfers);
    });
  }

  cancel() {
    this.cancelled = true;
    this.state = ProcessingState.CANCELLED;
  }

  cleanup() {
    this.shellDetector.reset();
    this.seamDetector.reset();
    this.meshData = [];
    this.processedResults = [];
    this._worker?.terminate?.();
    this._worker = null;
  }
}

/**
 * Main UV Viewer class
 */
class UVViewer {
  constructor(options = {}) {
    this.options = {
      resolution: 2048,
      showChecker: false,
      showSeams: true,
      checkerResolution: '1K',
      ...options
    };

    this.isActive = false;
    this.processor = new UVProcessor({ uvWorker: this.options.uvWorker !== false });
    this.renderer = null;
    this.eventListeners = new Map();
    this.currentResults = [];

    // UI elements
    this.overlay = null;
    this.container = null;
    this.canvas = null;
    this.progressUI = null;
    this.controlsUI = null;

    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this._domCleanups = [];

    this.bindMethods();
  }

  bindMethods() {
    this.handleProgress = this.handleProgress.bind(this);
    this.close = this.close.bind(this);
  }

  _trackListener(el, event, handler, options) {
    el.addEventListener(event, handler, options);
    this._domCleanups.push(() => el.removeEventListener(event, handler, options));
  }

  _removeAllDomListeners() {
    for (const cleanup of this._domCleanups) cleanup();
    this._domCleanups = [];
  }

  // Event system
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  off(event, callback) {
    if (this.eventListeners.has(event)) {
      const listeners = this.eventListeners.get(event);
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('Event callback error:', error);
        }
      });
    }
  }

  async open(scene) {
    if (this.isActive) return;

    this.isActive = true;
    document.body.classList.add('vlr-uv-open');
    this.createUI();

    // Fade in
    requestAnimationFrame(() => {
      this.overlay.classList.add('active');
    });

    // Process scene
    try {
      this.emit(UVEventType.PROCESSING_START, { scene });
      const results = await this.processor.processScene(scene, this.handleProgress);

      if (this.processor.state === ProcessingState.CANCELLED) {
        this.emit(UVEventType.PROCESSING_CANCELLED);
        return;
      }

      this.currentResults = results;
      this.renderResults(results);
      this.emit(UVEventType.PROCESSING_COMPLETE, { results });

    } catch (error) {
      if (error.message === 'No UV-mapped meshes found in scene') {
        showTopToast('UV Preview', 'This model does not contain UV-mapped meshes.', 4000);
        this.close();
      } else {
        this.emit(UVEventType.PROCESSING_ERROR, { error });
        this.showError(error.message);
      }
    }
  }

  close() {
    if (!this.isActive) return;

    this.isActive = false;
    this.onClose?.();
    document.body.classList.remove('vlr-uv-open');
    this.processor.cancel();
    this._removeAllDomListeners();

    // Fade out
    this.overlay.classList.remove('active');

    setTimeout(() => {
      this.destroyUI();
      this.processor.cleanup();
    }, 300);
  }

  createUI() {
    let lastTouchDistance = 0;
    let lastTouchCenter = { x: 0, y: 0 };
    // Main overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'uv-viewer-overlay';

    // Container
    this.container = document.createElement('div');
    this.container.className = 'uv-viewer-container';
    this.container.innerHTML = `
    <div class="uv-viewer-zoom-info">
      <span>Zoom: <span class="zoom-level">100%</span></span>
    </div>
    `;

    // Header
    const header = document.createElement('div');
    header.className = 'uv-viewer-header';
    header.innerHTML = `
      <h3 class="uv-viewer-title">UV Map Viewer</h3>
      <div class="uv-viewer-close"><i class="fas fa-times"></i></div>
    `;

    // Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'uv-viewer-canvas';
    this.canvas.width = this.options.resolution;
    this.canvas.height = this.options.resolution;

    this.canvasWrapper = document.createElement('div');
    this.canvasWrapper.className = 'uv-canvas-wrapper';
    this.canvasWrapper.style.transformOrigin = '0 0';
    this.canvasWrapper.appendChild(this.canvas);
    // Progress UI
    this.progressUI = document.createElement('div');
    this.progressUI.className = 'uv-viewer-progress';
    this.progressUI.innerHTML = `
      <div>Processing UV shells...</div>
      <div class="uv-viewer-progress-bar">
        <div class="uv-viewer-progress-fill" style="width: 0%"></div>
      </div>
      <div class="uv-viewer-progress-details">Initializing...</div>
    `;

    this.sliderContainer = document.createElement('div');
    this.sliderContainer.className = 'uv-viewer-slider-container';
    this.sliderContainer.innerHTML = `
      <div class="uv-viewer-slider-label">
        <i class="fa-solid fa-chess-board"></i>
      </div>
      <input type="range" class="uv-viewer-slider" min="0" max="4" value="1" step="1" data-action="change-resolution">
      <span class="uv-viewer-slider-value">1K</span>
    `;

    // Controls
    this.controlsUI = document.createElement('div');
    this.controlsUI.className = 'uv-viewer-controls-container';
    this.controlsUI.innerHTML = `
      <div class="uv-viewer-controls-buttons">
        <div class="uv-viewer-control" data-action="toggle-checker">Checker</div>
        <div class="uv-viewer-control active" data-action="toggle-seams">Seams</div>
        <div class="uv-viewer-control" data-action="export">Export PNG</div>
        <div class="uv-viewer-control" data-action="reset-view">Reset View</div>
      </div>
    `;

    // Assemble UI
    this.container.appendChild(header);
    this.container.appendChild(this.canvasWrapper);
    this.container.appendChild(this.progressUI);
    this.container.appendChild(this.controlsUI);
    this.container.appendChild(this.sliderContainer);
    this.overlay.appendChild(this.container);
    document.body.appendChild(this.overlay);

    this._trackListener(document, 'keydown', (e) => {
      if (!this.isActive) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        this.resetView();
      }
    });

    this._trackListener(this.canvas, 'wheel', (e) => {
      e.preventDefault();

      // Get mouse position relative to the container (viewport)
      const containerRect = this.container.getBoundingClientRect();
      const mouseX = e.clientX - containerRect.left;
      const mouseY = e.clientY - containerRect.top;

      // Account for any header offset
      const header = this.container.querySelector('.uv-viewer-header');
      const headerHeight = header ? header.offsetHeight : 0;
      const adjustedMouseY = mouseY - headerHeight;

      // Convert to canvas space (what point on the canvas is under the mouse)
      const canvasPointX = (mouseX - this.panX) / this.zoom;
      const canvasPointY = (adjustedMouseY - this.panY) / this.zoom;

      const oldZoom = this.zoom;
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      this.zoom = Math.max(0.1, Math.min(10, oldZoom * zoomFactor));

      // Adjust pan so the same canvas point stays under the mouse
      this.panX = mouseX - canvasPointX * this.zoom;
      this.panY = adjustedMouseY - canvasPointY * this.zoom;

      this.updateCanvasTransform();
      this.updateZoomInfo();
    });

    this._trackListener(this.canvas, 'mousedown', (e) => {
      if (e.button === 0) {
        this.isDragging = true;
        const rect = this.canvas.getBoundingClientRect();
        this.lastMouseX = e.clientX - rect.left;
        this.lastMouseY = e.clientY - rect.top;
        this.canvas.style.cursor = 'grabbing';
      }
    });

    this._trackListener(this.canvas, 'mousemove', (e) => {
      if (this.isDragging) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        this.panX += e.movementX;
        this.panY += e.movementY;

        this.lastMouseX = mouseX;
        this.lastMouseY = mouseY;

        this.updateCanvasTransform();
      }
    });

    this._trackListener(this.canvas, 'mouseup', (e) => {
      if (e.button === 0) {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
      }
    });

    this._trackListener(this.canvas, 'mouseleave', () => {
      this.isDragging = false;
      this.canvas.style.cursor = 'grab';
    });
    this._trackListener(this.canvas, 'touchstart', (e) => {
      e.preventDefault();

      if (e.touches.length === 1) {
        // Single touch - start panning
        this.isDragging = true;
        const rect = this.canvas.getBoundingClientRect();
        this.lastMouseX = e.touches[0].clientX - rect.left;
        this.lastMouseY = e.touches[0].clientY - rect.top;
      } else if (e.touches.length === 2) {
        // Two finger pinch - start zooming
        this.isDragging = false;
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];

        lastTouchDistance = Math.sqrt(
          Math.pow(touch2.clientX - touch1.clientX, 2) +
          Math.pow(touch2.clientY - touch1.clientY, 2)
        );

        const rect = this.canvas.getBoundingClientRect();
        lastTouchCenter = {
          x: (touch1.clientX + touch2.clientX) / 2 - rect.left,
          y: (touch1.clientY + touch2.clientY) / 2 - rect.top
        };
      }
    });

    this._trackListener(this.canvas, 'touchmove', (e) => {
      e.preventDefault();

      if (e.touches.length === 1 && this.isDragging) {
        // Single touch - pan
        const rect = this.canvas.getBoundingClientRect();
        const touchX = e.touches[0].clientX - rect.left;
        const touchY = e.touches[0].clientY - rect.top;

        const deltaX = touchX - this.lastMouseX;
        const deltaY = touchY - this.lastMouseY;

        this.panX += deltaX;
        this.panY += deltaY;

        this.lastMouseX = touchX;
        this.lastMouseY = touchY;

        this.updateCanvasTransform();
      } else if (e.touches.length === 2) {
        // Two finger pinch - zoom
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];

        const currentDistance = Math.sqrt(
          Math.pow(touch2.clientX - touch1.clientX, 2) +
          Math.pow(touch2.clientY - touch1.clientY, 2)
        );

        const rect = this.canvas.getBoundingClientRect();
        const currentCenter = {
          x: (touch1.clientX + touch2.clientX) / 2 - rect.left,
          y: (touch1.clientY + touch2.clientY) / 2 - rect.top
        };

        if (lastTouchDistance > 0) {
          const zoomFactor = currentDistance / lastTouchDistance;
          const newZoom = Math.max(0.1, Math.min(10, this.zoom * zoomFactor));

          // Keep the touch center point fixed during zoom
          this.panX = currentCenter.x - (currentCenter.x - this.panX) * (newZoom / this.zoom);
          this.panY = currentCenter.y - (currentCenter.y - this.panY) * (newZoom / this.zoom);
          this.zoom = newZoom;

          this.updateCanvasTransform();
          this.updateZoomInfo();
        }

        lastTouchDistance = currentDistance;
        lastTouchCenter = currentCenter;
      }
    });

    this._trackListener(this.canvas, 'touchend', (e) => {
      e.preventDefault();
      this.isDragging = false;
      lastTouchDistance = 0;
    });

    this._trackListener(this.canvas, 'touchcancel', (e) => {
      e.preventDefault();
      this.isDragging = false;
      lastTouchDistance = 0;
    });
    this.canvas.style.cursor = 'grab';

    this.controlsUI.style.display = 'none';

    this._trackListener(header.querySelector('.uv-viewer-close'), 'click', (e) => {
      e.stopPropagation();
      this.close();
    });

    // Control buttons
    this._trackListener(this.controlsUI, 'click', (e) => {
      const button = e.target.closest('.uv-viewer-control');
      if (button) {
        const action = button.dataset.action;
        this.handleControlAction(action, button);
      }
    });

    this._trackListener(this.sliderContainer, 'input', (e) => {
      const slider = e.target.closest('.uv-viewer-slider');
      if (slider) {
        const resolutions = ['512', '1K', '2K', '4K', '8K'];
        const value = parseInt(slider.value);
        this.options.checkerResolution = resolutions[value];

        // Update label
        const valueSpan = this.sliderContainer.querySelector('.uv-viewer-slider-value');
        if (valueSpan) {
          valueSpan.textContent = resolutions[value];
        }

        this.renderer.updateOptions(this.options);
        this.renderResults(this.currentResults);
      }
    });

    // Initialize renderer
    this.renderer = new UVRenderer(this.canvas, this.options);

    // Hide controls initially
    this.controlsUI.style.display = 'none';
  }

  handleControlAction(action, button) {
    switch (action) {
      case 'toggle-checker':
        this.options.showChecker = !this.options.showChecker;
        button.classList.toggle('active', this.options.showChecker);

        // Smooth container expansion
        if (this.options.showChecker) {
          this.controlsUI.classList.add('expanded');
          // Small delay to start slider animation after container expands
          setTimeout(() => {
            this.sliderContainer.classList.add('active');
          }, 50);
        } else {
          this.sliderContainer.classList.remove('active');
          // Wait for slider to hide before contracting container
          setTimeout(() => {
            this.controlsUI.classList.remove('expanded');
          }, 100);
        }
        break;

      case 'toggle-seams':
        this.options.showSeams = !this.options.showSeams;
        button.classList.toggle('active', this.options.showSeams);
        break;

      case 'export':
        this.exportImage();
        return;

      case 'reset-view':
        this.resetView();
        return;
    }

    this.renderer.updateOptions(this.options);
    this.renderResults(this.currentResults);
  }

  updateCanvasTransform() {
    if (!this.canvasWrapper) return;
    this.canvasWrapper.style.transform = `translate(${Math.round(this.panX)}px, ${Math.round(this.panY)}px) scale(${this.zoom})`;
  }

  updateZoomInfo() {
    const zoomInfo = this.container?.querySelector('.zoom-level');
    if (zoomInfo) {
      zoomInfo.textContent = `${Math.round(this.zoom * 100)}%`;
    }
  }

  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.updateCanvasTransform();
    this.updateZoomInfo();
  }

  handleProgress(progress) {
    if (!this.progressUI) return;

    const fill = this.progressUI.querySelector('.uv-viewer-progress-fill');
    const details = this.progressUI.querySelector('.uv-viewer-progress-details');

    if (fill) {
      fill.style.width = `${progress.percentage}%`;
    }

    if (details) {
      const { phase, itemsProcessed, totalItems, itemsPerSecond } = progress;
      details.textContent = `${phase} - ${itemsProcessed}/${totalItems} (${itemsPerSecond.toFixed(1)} items/sec)`;
    }

    this.emit(UVEventType.PROCESSING_PROGRESS, progress);
  }

  renderResults(results) {
    if (!results || results.length === 0) return;

    // Hide progress, show controls
    if (this.progressUI) {
      this.progressUI.style.display = 'none';
    }
    if (this.controlsUI) {
      this.controlsUI.style.display = 'flex';
    }

    if (this.sliderContainer) {
      if (this.options.showChecker) {
        this.controlsUI.classList.add('expanded');
        setTimeout(() => {
          this.sliderContainer.classList.add('active');
        }, 50);
      } else {
        this.sliderContainer.classList.remove('active');
        this.controlsUI.classList.remove('expanded');
      }
    }

    // Combine all shells and seams
    const allShells = [];
    const allSeams = [];

    results.forEach(result => {
      allShells.push(...result.shells);
      allSeams.push(...result.seams);
    });

    // Reset canvas context transform (no context transformations)
    this.renderer.ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Render
    this.renderer.clear();
    this.renderer.drawChecker();
    this.renderer.renderShells(allShells);
    this.renderer.renderSeams(allSeams);

    this.emit(UVEventType.RENDER_UPDATE, { shells: allShells, seams: allSeams });
  }

  showError(message) {
    if (this.progressUI) {
      this.progressUI.style.display = 'none';
    }

    const errorDiv = document.createElement('div');
    errorDiv.className = 'uv-viewer-error';
    errorDiv.textContent = `Error: ${message}`;

    this.container.appendChild(errorDiv);
  }

  exportImage() {
    if (!this.canvas) return;

    const link = document.createElement('a');
    link.download = `uv_map_${Date.now()}.png`;
    link.href = this.canvas.toDataURL('image/png', 1.0);
    link.click();
  }

  destroyUI() {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }

    this.overlay = null;
    this.container = null;
    this.canvas = null;
    this.progressUI = null;
    this.controlsUI = null;
    this.sliderContainer = null;
    this.renderer = null;
  }
}

// Export for use
export { UVViewer, UVEventType, ProcessingState };
export { UVViewer as UVPreviewTool };
export default UVViewer;
