// Camera modes (turntable / director) must survive other tools being activated,
// and must still be torn down by a full reset / model swap.
import assert from 'node:assert/strict';
import { AnalysisManager } from '../SDK/Managers/AnalysisController.js';

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL  ${label}`);
    console.error(`        ${error?.stack || error}`);
    failed++;
  }
}

const stubTool = (isActive = false) => ({
  isActive,
  deactivate() { this.isActive = false; },
  close() { this.isActive = false; }
});

// Bypass the constructor -- it builds a dozen three.js/DOM-bound tools we don't need.
function makeManager() {
  const mgr = Object.create(AnalysisManager.prototype);
  Object.assign(mgr, {
    boundingVolumeVisualizer: stubTool(),
    normalVectorVisualizer: stubTool(),
    crossSection: stubTool(),
    vertexSelector: stubTool(),
    uvViewer: stubTool(),
    materialInspector: stubTool(),
    performanceMonitor: stubTool(),
    directorMode: stubTool(),
    turntablePlus: stubTool(),
    toolButtonMappings: new Map(),
    pendingToolTimers: new Set(),
    _meshAnalysisElements: []
  });
  return mgr;
}

test('activating another tool leaves a running camera mode alone', () => {
  const mgr = makeManager();
  mgr.turntablePlus.isActive = true;
  mgr.crossSection.isActive = true;

  mgr.deactivateAllTools({ keepCameraModes: true });

  assert.equal(mgr.turntablePlus.isActive, true, 'turntable should survive');
  assert.equal(mgr.crossSection.isActive, false, 'other tools should still be exclusive');
});

test('a camera mode replaces the other camera mode', () => {
  const mgr = makeManager();
  mgr.directorMode.isActive = true;

  mgr.deactivateAllTools({ keepCameraModes: false });

  assert.equal(mgr.directorMode.isActive, false);
});

test('full reset drops camera modes and runs their onDeactivate', () => {
  const mgr = makeManager();
  mgr.turntablePlus.isActive = true;
  let restored = 0;
  const button = { classList: { toggle() {} } };
  mgr.toolButtonMappings.set(mgr.turntablePlus, {
    button,
    options: { cameraMode: true, onDeactivate: () => { restored++; } }
  });

  mgr.deactivateAllTools();

  assert.equal(mgr.turntablePlus.isActive, false);
  assert.equal(restored, 1, 'saved animation state must be restored exactly once');

  // Already inactive: no second restore.
  mgr.deactivateAllTools();
  assert.equal(restored, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
