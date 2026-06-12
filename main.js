'use strict';

// Fallback PointerLockControls if CDN script fails to load
if (typeof THREE !== 'undefined' && !THREE.PointerLockControls) {
  THREE.PointerLockControls = function (camera, domElement) {
    this.camera = camera;
    this.domElement = domElement || document.body;
    this.isLocked = false;
    this.minPolarAngle = 0;
    this.maxPolarAngle = Math.PI;
    this.pitchObject = new THREE.Object3D();
    this.pitchObject.add(camera);
    this.yawObject = new THREE.Object3D();
    this.yawObject.position.y = 1.6;
    this.yawObject.add(this.pitchObject);
    const scope = this;
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const PI_2 = Math.PI / 2;
    function onMouseMove(event) {
      if (!scope.isLocked) return;
      euler.setFromQuaternion(scope.pitchObject.quaternion);
      euler.y -= event.movementX * 0.002;
      euler.x -= event.movementY * 0.002;
      euler.x = Math.max(PI_2 - scope.maxPolarAngle, Math.min(PI_2 - scope.minPolarAngle, euler.x));
      scope.pitchObject.quaternion.setFromEuler(euler);
    }
    function onPointerlockChange() {
      scope.isLocked = document.pointerLockElement === scope.domElement;
      if (scope.isLocked) scope.dispatchEvent({ type: 'lock' });
      else scope.dispatchEvent({ type: 'unlock' });
    }
    this.connect = function () {
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('pointerlockchange', onPointerlockChange);
    };
    this.disconnect = function () {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onPointerlockChange);
    };
    this.dispose = function () { this.disconnect(); };
    this.getObject = function () { return scope.yawObject; };
    this.getDirection = function (v) {
      return v.set(0, 0, -1).applyQuaternion(scope.pitchObject.quaternion);
    };
    this.moveForward = function (d) {
      const v = new THREE.Vector3();
      scope.getDirection(v);
      v.y = 0;
      v.normalize();
      scope.yawObject.position.addScaledVector(v, d);
    };
    this.moveRight = function (d) {
      const v = new THREE.Vector3();
      scope.getDirection(v);
      v.y = 0;
      v.normalize();
      v.crossVectors(scope.yawObject.up, v);
      scope.yawObject.position.addScaledVector(v, d);
    };
    this.lock = function () { scope.domElement.requestPointerLock(); };
    this.unlock = function () { document.exitPointerLock(); };
    this.connect();
  };
  THREE.PointerLockControls.prototype = Object.create(THREE.EventDispatcher.prototype);
  THREE.PointerLockControls.prototype.constructor = THREE.PointerLockControls;
}

// ═══ GAME STATE ═══
const gameState = {
  timeline: 'past',
  switchActivated: false,
  timelineSwitches: 0,
  currentRoom: 0,
  playing: false,
  won: false,
  respawnCooldown: 0,
  // Feature 1: Time Stability
  stability: 100,
  // Feature 2: Energy Nodes
  energyNodes: { a: false, b: false, c: false },
  energyNodesComplete: false,
  // Feature 4: Memory Fragments
  memoryFragments: 0,
  // Feature 5: False Portal
  falsePortalTriggered: false,
  realPortalSpawned: false,
  // New Features
  challengeMode: false,
  timerStartTime: 0,
  completionTime: 0,
  pastUsage: 0,
  futureUsage: 0,
  sectorsVisited: [false, false, false],
  achievements: {}
};

const ROOM_ZONES = [
  { min: 0, max: -20, label: 'SECTOR 01 / BRIDGE', hint: 'Stay in PAST — cross the green bridge, then walk forward' },
  { min: -20, max: -40, label: 'SECTOR 02 / ENERGY CORE', hint: 'Activate all 3 Energy Nodes across timelines' },
  { min: -40, max: -60, label: 'SECTOR 03 / ESCAPE', hint: 'Find the correct timeline to escape' }
];

const COLORS = {
  bg: 0x0d0d14,
  past: 0x00ff88,
  future: 0x00cfff,
  wall: 0x1a1a2e,
  floor: 0x16213e,
  ceiling: 0x0f3460,
  danger: 0xff2d55
};

const PLAYER = {
  height: 1.6,
  radius: 0.35,
  speed: 5,
  startPos: { x: 0, y: 1.6, z: 2 }
};

// ═══ DOM REFERENCES ═══
const canvas = document.getElementById('game-canvas');
const startOverlay = document.getElementById('start-overlay');
const hud = document.getElementById('hud');
const timelineFlash = document.getElementById('timeline-flash');
const timelineValue = document.getElementById('timeline-value');
const roomIndicator = document.getElementById('room-indicator');
const roomText = document.getElementById('room-text');
const roomHint = document.getElementById('room-hint');
const interactionPrompt = document.getElementById('interaction-prompt');
const interactControlLine = document.getElementById('interact-control-line');
const winFade = document.getElementById('win-fade');
const winOverlay = document.getElementById('win-overlay');
const statSwitches = document.getElementById('stat-switches');
const playAgainBtn = document.getElementById('play-again-btn');

// New DOM references for features
const stabilityBarFill = document.getElementById('stability-bar-fill');
const stabilityValue = document.getElementById('stability-value');
const energyNodePanel = document.getElementById('energy-node-panel');
const energyNodeValue = document.getElementById('energy-node-value');
const memoryPanel = document.getElementById('memory-panel');
const memoryValue = document.getElementById('memory-value');
const memoryPopup = document.getElementById('memory-popup');
const temporalCollapse = document.getElementById('temporal-collapse');
const temporalLockMsg = document.getElementById('temporal-lock-msg');
const chromaticOverlay = document.getElementById('chromatic-overlay');
const statFragments = document.getElementById('stat-fragments');
const statStability = document.getElementById('stat-stability');

// Feature 1+2+3+4+5+6+7+8: New DOM refs
const challengeTimer = document.getElementById('challenge-timer');
const timerValue = document.getElementById('timer-value');
const btnStory = document.getElementById('btn-story');
const btnChallenge = document.getElementById('btn-challenge');
const bestTimeDisplay = document.getElementById('best-time-display');
const bestTimeValue = document.getElementById('best-time-value');
const sectorIntro = document.getElementById('sector-intro');
const sectorIntroLabel = document.getElementById('sector-intro-label');
const sectorIntroName = document.getElementById('sector-intro-name');
const achievementToast = document.getElementById('achievement-toast');
const achievementTitle = document.getElementById('achievement-title');
const achievementDesc = document.getElementById('achievement-desc');
const statPastUsage = document.getElementById('stat-past-usage');
const statFutureUsage = document.getElementById('stat-future-usage');
const statTime = document.getElementById('stat-time');
const statTimeRow = document.getElementById('stat-time-row');
const statMedalRow = document.getElementById('stat-medal-row');
const statMedal = document.getElementById('stat-medal');
const portalLockedMsg = document.getElementById('portal-locked-msg');
const portalLockProgress = document.getElementById('portal-lock-progress');

// ═══ SCENE SETUP ═══
const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.bg);
scene.fog = new THREE.Fog(COLORS.bg, 15, 55);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(PLAYER.startPos.x, PLAYER.startPos.y, PLAYER.startPos.z);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

// ═══ LIGHTING ═══
const ambientLight = new THREE.AmbientLight(0x1a1a2e, 0.15);
scene.add(ambientLight);

const timelineLight = new THREE.PointLight(COLORS.past, 1.2, 20);
timelineLight.position.set(0, 3.5, 0);
scene.add(timelineLight);

function addFacilityLight(x, y, z) {
  const light = new THREE.PointLight(0xfff4cc, 0.3, 12);
  light.position.set(x, y, z);
  scene.add(light);
}

// ═══ GLOBAL ARRAYS ═══
const collidables = [];
const timelineObjects = { past: [], future: [] };
const interactiveObjects = [];
let powerSwitch = null;
let powerPanelLight = null;
let futureDoor = null;
let exitPortal = null;
let portalParticles = null;
let bridgeGapBounds = null;
let room1RespawnPoint = null;

// Feature 2: Energy Nodes
const energyNodeMeshes = [];

// Feature 4: Memory Fragments
const memoryFragmentMeshes = [];
const MEMORY_FRAGMENT_DATA = [
  { id: 'frag1', title: 'LOG 01', text: 'Temporal Experiment Initiated.', pos: { x: 3, y: 1.5, z: -5 }, timeline: 'past' },
  { id: 'frag2', title: 'LOG 02', text: 'Timeline Fracture Detected.', pos: { x: -3, y: 1.5, z: -30 }, timeline: 'future' },
  { id: 'frag3', title: 'LOG 03', text: 'Reality Collapse Imminent.', pos: { x: 3, y: 1.5, z: -50 }, timeline: 'past' }
];

// Feature 5: False Portal
let falsePortal = null;
let falsePortalParticles = null;
let realPortal = null;
let realPortalParticles = null;

const clock = new THREE.Clock();
const keys = { w: false, a: false, s: false, d: false };

// ═══ ENVIRONMENT (floor, walls, ceiling) ═══
function createGridFloor(x, z, width, depth) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const floorGeo = new THREE.PlaneGeometry(width, depth);
  const floorMat = new THREE.MeshStandardMaterial({
    color: COLORS.floor,
    roughness: 0.8,
    metalness: 0.3
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const gridDivisions = Math.max(Math.floor(width), Math.floor(depth));
  const gridGeo = new THREE.PlaneGeometry(width, depth, gridDivisions, gridDivisions);
  const gridEdges = new THREE.EdgesGeometry(gridGeo);
  const gridLines = new THREE.LineSegments(
    gridEdges,
    new THREE.LineBasicMaterial({ color: COLORS.past, transparent: true, opacity: 0.25 })
  );
  gridLines.rotation.x = -Math.PI / 2;
  gridLines.position.y = 0.02;
  gridLines.name = 'gridLines';
  group.add(gridLines);

  scene.add(group);
  return group;
}

function addFloorSegment(parent, x, z, width, depth) {
  const floorGeo = new THREE.PlaneGeometry(width, depth);
  const floorMat = new THREE.MeshStandardMaterial({
    color: COLORS.floor,
    roughness: 0.8,
    metalness: 0.3
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(x, 0, z);
  floor.receiveShadow = true;
  parent.add(floor);

  const gridGeo = new THREE.PlaneGeometry(width, depth, Math.max(4, Math.floor(width)), Math.max(4, Math.floor(depth)));
  const gridEdges = new THREE.EdgesGeometry(gridGeo);
  const gridLines = new THREE.LineSegments(
    gridEdges,
    new THREE.LineBasicMaterial({ color: COLORS.past, transparent: true, opacity: 0.2 })
  );
  gridLines.rotation.x = -Math.PI / 2;
  gridLines.position.set(x, 0.02, z);
  parent.add(gridLines);
}

function createWall(x, y, z, w, h, d, addCollision) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({
    color: COLORS.wall,
    roughness: 0.9,
    metalness: 0.1
  });
  const wall = new THREE.Mesh(geo, mat);
  wall.position.set(x, y, z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);

  const edges = new THREE.EdgesGeometry(geo);
  const edgeLines = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x2a2a4e, transparent: true, opacity: 0.5 })
  );
  edgeLines.position.copy(wall.position);
  scene.add(edgeLines);

  if (addCollision) {
    wall.userData.collidable = true;
    collidables.push(wall);
  }
  return wall;
}

function createCeiling(x, z, width, depth) {
  const geo = new THREE.PlaneGeometry(width, depth);
  const mat = new THREE.MeshStandardMaterial({ color: COLORS.ceiling, roughness: 0.7, metalness: 0.2 });
  const ceiling = new THREE.Mesh(geo, mat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(x, 4, z);
  scene.add(ceiling);

  for (let i = -width / 2 + 1; i < width / 2; i += 2) {
    const stripGeo = new THREE.BoxGeometry(1.5, 0.05, 0.3);
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0xfff4cc,
      emissive: 0xfff4cc,
      emissiveIntensity: 0.4
    });
    const strip = new THREE.Mesh(stripGeo, stripMat);
    strip.position.set(x + i, 3.95, z);
    scene.add(strip);
    addFacilityLight(x + i, 3.8, z);
  }
}

function createNarrativePanel(x, y, z, text, rotY) {
  const canvas2d = document.createElement('canvas');
  canvas2d.width = 512;
  canvas2d.height = 128;
  const ctx = canvas2d.getContext('2d');
  ctx.fillStyle = '#0d0d14';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#00cfff';
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, 504, 120);
  ctx.fillStyle = '#00ff88';
  ctx.font = '16px Share Tech Mono, monospace';
  ctx.fillText('> FACILITY LOG', 16, 30);
  ctx.fillStyle = '#e0e0ff';
  ctx.font = '14px Share Tech Mono, monospace';
  wrapText(ctx, text, 16, 55, 480, 20);

  const texture = new THREE.CanvasTexture(canvas2d);
  const geo = new THREE.PlaneGeometry(3, 0.75);
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    emissive: 0x001122,
    emissiveIntensity: 0.3
  });
  const panel = new THREE.Mesh(geo, mat);
  panel.position.set(x, y, z);
  panel.rotation.y = rotY || 0;
  scene.add(panel);
  return panel;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let currentY = y;
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + ' ';
    if (ctx.measureText(testLine).width > maxWidth && i > 0) {
      ctx.fillText(line, x, currentY);
      line = words[i] + ' ';
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, currentY);
}

function createCorridorSegment(centerZ, length, addBackWall) {
  const width = 10;
  createGridFloor(0, centerZ, width, length);
  createCeiling(0, centerZ, width, length);
  createWall(-5, 2, centerZ, 0.3, 4, length, true);
  createWall(5, 2, centerZ, 0.3, 4, length, true);
  if (addBackWall) {
    createWall(0, 2, centerZ - length / 2, width, 4, 0.3, true);
  }
}

function tagTimeline(obj, timeline) {
  obj.userData.timeline = timeline;
  timelineObjects[timeline].push(obj);
  obj.visible = timeline === gameState.timeline;
}

function createRoomFloorWithGap(roomMinZ, roomMaxZ, width, gapMinZ, gapMaxZ) {
  const group = new THREE.Group();
  const halfWidth = width / 2;
  const gapHalfX = 2;

  const frontDepth = roomMaxZ - gapMaxZ;
  if (frontDepth > 0.1) {
    addFloorSegment(group, 0, (roomMaxZ + gapMaxZ) / 2, width, frontDepth);
  }

  const backDepth = gapMinZ - roomMinZ;
  if (backDepth > 0.1) {
    addFloorSegment(group, 0, (gapMinZ + roomMinZ) / 2, width, backDepth);
  }

  const gapDepth = gapMaxZ - gapMinZ;
  const sideWidth = halfWidth - gapHalfX;
  if (sideWidth > 0.1) {
    addFloorSegment(group, -halfWidth + sideWidth / 2, (gapMaxZ + gapMinZ) / 2, sideWidth, gapDepth);
    addFloorSegment(group, halfWidth - sideWidth / 2, (gapMaxZ + gapMinZ) / 2, sideWidth, gapDepth);
  }

  scene.add(group);
}

// ═══ ROOM 1: BRIDGE ═══
function buildRoom1() {
  const centerZ = -10;
  const depth = 20;
  const width = 10;
  const gapCenterZ = -12;
  const gapWidth = 4;
  const roomMaxZ = 0;
  const roomMinZ = -20;
  const gapMaxZ = gapCenterZ + gapWidth / 2;
  const gapMinZ = gapCenterZ - gapWidth / 2;

  createRoomFloorWithGap(roomMinZ, roomMaxZ, width, gapMinZ, gapMaxZ);
  createCeiling(0, centerZ, width, depth);
  createWall(-5, 2, centerZ, 0.3, 4, depth, true);
  createWall(5, 2, centerZ, 0.3, 4, depth, true);
  createNarrativePanel(-4.7, 2.2, centerZ, 'Temporal rift detected. Bridge integrity: FAILED.', Math.PI / 2);

  room1RespawnPoint = { x: 0, y: PLAYER.height, z: 0 };

  bridgeGapBounds = new THREE.Box3(
    new THREE.Vector3(-gapWidth / 2, -1, gapCenterZ - 4),
    new THREE.Vector3(gapWidth / 2, 0.5, gapCenterZ + 4)
  );

  const bridgeGeo = new THREE.BoxGeometry(2, 0.15, 8);
  const bridgeMat = new THREE.MeshStandardMaterial({
    color: 0x1a3a1a,
    roughness: 0.7,
    metalness: 0.3,
    emissive: 0x003311,
    emissiveIntensity: 0.3
  });
  const bridge = new THREE.Mesh(bridgeGeo, bridgeMat);
  bridge.position.set(0, 0.5, gapCenterZ);
  bridge.castShadow = true;
  scene.add(bridge);
  tagTimeline(bridge, 'past');

  const bridgeTrimGeo = new THREE.BoxGeometry(2.1, 0.05, 8.1);
  const bridgeTrimMat = new THREE.MeshStandardMaterial({
    color: COLORS.past,
    emissive: COLORS.past,
    emissiveIntensity: 0.8
  });
  const bridgeTrim = new THREE.Mesh(bridgeTrimGeo, bridgeTrimMat);
  bridgeTrim.position.set(0, 0.58, gapCenterZ);
  tagTimeline(bridgeTrim, 'past');

  const warningCanvas = document.createElement('canvas');
  warningCanvas.width = 512;
  warningCanvas.height = 128;
  const wctx = warningCanvas.getContext('2d');
  wctx.fillStyle = '#1a0a0a';
  wctx.fillRect(0, 0, 512, 128);
  wctx.strokeStyle = '#ff2d55';
  wctx.lineWidth = 3;
  wctx.strokeRect(4, 4, 504, 120);
  wctx.fillStyle = '#ff2d55';
  wctx.font = 'bold 22px Orbitron, sans-serif';
  wctx.textAlign = 'center';
  wctx.fillText('BRIDGE COLLAPSED', 256, 50);
  wctx.font = '16px Share Tech Mono, monospace';
  wctx.fillText('— SWITCH TIMELINE —', 256, 85);

  const warningTex = new THREE.CanvasTexture(warningCanvas);
  const warningGeo = new THREE.PlaneGeometry(3, 0.75);
  const warningMat = new THREE.MeshStandardMaterial({
    map: warningTex,
    emissive: COLORS.danger,
    emissiveIntensity: 0.5,
    transparent: true,
    side: THREE.DoubleSide
  });
  const warningSign = new THREE.Mesh(warningGeo, warningMat);
  warningSign.position.set(0, 2.5, gapCenterZ);
  scene.add(warningSign);
  tagTimeline(warningSign, 'future');
}

// ═══ ROOM 2: ENERGY CORE (Feature 2) ═══
function createEnergyNode(id, x, y, z, timeline, label) {
  const group = new THREE.Group();
  group.position.set(x, y, z);

  // Core cube
  const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const mat = new THREE.MeshStandardMaterial({
    color: timeline === 'past' ? 0x003300 : 0x002233,
    emissive: timeline === 'past' ? COLORS.past : COLORS.future,
    emissiveIntensity: 0.6,
    roughness: 0.4,
    metalness: 0.5
  });
  const core = new THREE.Mesh(geo, mat);
  group.add(core);

  // Outer wireframe ring
  const ringGeo = new THREE.TorusGeometry(0.45, 0.03, 8, 16);
  const ringMat = new THREE.MeshStandardMaterial({
    color: timeline === 'past' ? COLORS.past : COLORS.future,
    emissive: timeline === 'past' ? COLORS.past : COLORS.future,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.6
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  // Point light
  const light = new THREE.PointLight(timeline === 'past' ? COLORS.past : COLORS.future, 0.3, 4);
  light.position.set(0, 0.5, 0);
  group.add(light);

  group.userData.interactive = true;
  group.userData.interactType = 'energyNode';
  group.userData.nodeId = id;
  group.userData.interactRadius = 2;
  group.userData.timeline = timeline;
  group.userData.activated = false;
  group.userData.coreMat = mat;
  group.userData.ringMat = ringMat;
  group.userData.nodeLight = light;

  scene.add(group);
  tagTimeline(group, timeline);
  interactiveObjects.push(group);
  energyNodeMeshes.push(group);
  return group;
}

function buildRoom2() {
  const centerZ = -30;
  const depth = 20;
  createCorridorSegment(centerZ, depth, false);
  createNarrativePanel(-4.7, 2.2, -25, 'Energy core offline. Activate all nodes to restore power.', Math.PI / 2);

  // Node A: Past timeline, left wall
  createEnergyNode('a', -3.5, 1.5, -27, 'past', 'NODE A');

  // Node B: Future timeline, right wall
  createEnergyNode('b', 3.5, 1.5, -30, 'future', 'NODE B');

  // Node C: Past timeline, center-back
  createEnergyNode('c', 0, 1.5, -35, 'past', 'NODE C');

  // Door blocking sector 3 (visible in both timelines until all nodes activated)
  const doorGeo = new THREE.BoxGeometry(3, 3.5, 0.4);
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a3e,
    roughness: 0.6,
    metalness: 0.5,
    emissive: COLORS.future,
    emissiveIntensity: 0.15
  });
  futureDoor = new THREE.Mesh(doorGeo, doorMat);
  futureDoor.position.set(0, 1.75, -40);
  futureDoor.userData.collidable = true;
  futureDoor.userData.isDoor = true;
  scene.add(futureDoor);
  collidables.push(futureDoor);

  const doorFrame = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 3.8, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x0f3460, emissive: 0x0f3460, emissiveIntensity: 0.2 })
  );
  doorFrame.position.set(0, 1.9, -40);
  scene.add(doorFrame);
}

// ═══ ROOM 3: ESCAPE CHAMBER (Feature 5: False Portal Twist) ═══
function buildRoom3() {
  const centerZ = -50;
  const depth = 20;
  createCorridorSegment(centerZ, depth, true);
  createNarrativePanel(-4.7, 2.2, centerZ, 'Temporal core unstable. Exit before collapse.', Math.PI / 2);

  // Past-only wall
  const wallGeo = new THREE.BoxGeometry(10, 4, 1);
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.95,
    metalness: 0.05
  });
  const exitWall = new THREE.Mesh(wallGeo, wallMat);
  exitWall.position.set(0, 2, -48);
  exitWall.userData.collidable = true;
  scene.add(exitWall);
  tagTimeline(exitWall, 'past');
  collidables.push(exitWall);

  // False portal (visible in FUTURE initially)
  const falsePortalGeo = new THREE.BoxGeometry(2, 3, 0.3);
  const falsePortalMat = new THREE.MeshStandardMaterial({
    color: COLORS.future,
    emissive: COLORS.future,
    emissiveIntensity: 1,
    transparent: true,
    opacity: 0.9
  });
  falsePortal = new THREE.Mesh(falsePortalGeo, falsePortalMat);
  falsePortal.position.set(0, 1.5, -58);
  falsePortal.userData.timeline = 'future';
  falsePortal.userData.isFalsePortal = true;
  scene.add(falsePortal);
  tagTimeline(falsePortal, 'future');

  falsePortalParticles = createPortalRing(falsePortal.position);
  scene.add(falsePortalParticles);
  tagTimeline(falsePortalParticles, 'future');

  // Real portal (visible in PAST, spawns after false portal fails)
  const realPortalGeo = new THREE.BoxGeometry(2, 3, 0.3);
  const realPortalMat = new THREE.MeshStandardMaterial({
    color: COLORS.past,
    emissive: COLORS.past,
    emissiveIntensity: 1,
    transparent: true,
    opacity: 0.9
  });
  realPortal = new THREE.Mesh(realPortalGeo, realPortalMat);
  realPortal.position.set(0, 1.5, -58);
  realPortal.userData.isPortal = true;
  scene.add(realPortal);
  realPortal.visible = false; // Hidden until false portal triggered

  realPortalParticles = createPortalRing(realPortal.position);
  scene.add(realPortalParticles);
  realPortalParticles.visible = false;

  // Keep exitPortal reference for backward compat with pulsing
  exitPortal = falsePortal;
  portalParticles = falsePortalParticles;

  createWall(0, 2, -60, 10, 4, 0.3, true);
}

function buildEntranceCorridor() {
  createGridFloor(0, 5, 10, 10);
  createCeiling(0, 5, 10, 10);
  createWall(-5, 2, 5, 0.3, 4, 10, true);
  createWall(5, 2, 5, 0.3, 4, 10, true);
  createWall(0, 2, 10, 10, 4, 0.3, true);
}

// ═══ PARTICLES ═══
let activeBurst = null;

function createTimelineBurst(position, timeline) {
  const count = 200;
  const positions = new Float32Array(count * 3);
  const velocities = [];

  for (let i = 0; i < count; i++) {
    positions[i * 3] = position.x + (Math.random() - 0.5) * 0.5;
    positions[i * 3 + 1] = position.y + (Math.random() - 0.5) * 0.5;
    positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.5;

    if (timeline === 'past') {
      velocities.push({
        x: (Math.random() - 0.5) * 0.02,
        y: 0.03 + Math.random() * 0.04,
        z: (Math.random() - 0.5) * 0.02
      });
    } else {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.02 + Math.random() * 0.05;
      velocities.push({
        x: Math.cos(angle) * speed,
        y: (Math.random() - 0.5) * 0.02,
        z: Math.sin(angle) * speed
      });
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const color = timeline === 'past' ? COLORS.past : COLORS.future;
  const mat = new THREE.PointsMaterial({
    color,
    size: 0.08,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);

  return {
    mesh: points,
    velocities,
    life: 1,
    maxLife: 1.2
  };
}

function createPortalRing(portalPos) {
  const count = 100;
  const positions = new Float32Array(count * 3);
  const angles = [];

  for (let i = 0; i < count; i++) {
    angles.push((i / count) * Math.PI * 2);
    positions[i * 3] = portalPos.x;
    positions[i * 3 + 1] = portalPos.y;
    positions[i * 3 + 2] = portalPos.z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: COLORS.future,
    size: 0.06,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const points = new THREE.Points(geo, mat);
  points.userData.angles = angles;
  points.userData.portalPos = portalPos.clone();
  return points;
}

function createSwitchBurst(position) {
  activeBurst = createTimelineBurst(position, 'past');
  activeBurst.maxLife = 0.8;
}

function updateParticles(delta, elapsed) {
  if (activeBurst) {
    const b = activeBurst;
    b.life -= delta / b.maxLife;
    b.mesh.material.opacity = Math.max(0, b.life);

    const posArr = b.mesh.geometry.attributes.position.array;
    for (let i = 0; i < b.velocities.length; i++) {
      posArr[i * 3] += b.velocities[i].x;
      posArr[i * 3 + 1] += b.velocities[i].y;
      posArr[i * 3 + 2] += b.velocities[i].z;
      b.velocities[i].y -= 0.0005;
    }
    b.mesh.geometry.attributes.position.needsUpdate = true;

    if (b.life <= 0) {
      scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      activeBurst = null;
    }
  }

  if (portalParticles && portalParticles.visible) {
    const posArr = portalParticles.geometry.attributes.position.array;
    const angles = portalParticles.userData.angles;
    const pp = portalParticles.userData.portalPos;
    const radius = 1.8;
    const color = gameState.timeline === 'past' ? COLORS.past : COLORS.future;
    portalParticles.material.color.setHex(color);

    for (let i = 0; i < angles.length; i++) {
      const a = angles[i] + elapsed * 0.8;
      posArr[i * 3] = pp.x + Math.cos(a) * radius;
      posArr[i * 3 + 1] = pp.y + Math.sin(a * 2 + elapsed) * 0.5;
      posArr[i * 3 + 2] = pp.z + Math.sin(a) * radius * 0.3;
    }
    portalParticles.geometry.attributes.position.needsUpdate = true;
  }
}

// ═══ PLAYER / CONTROLS ═══
const controls = new THREE.PointerLockControls(camera, canvas);
scene.add(controls.getObject());

controls.getObject().position.set(PLAYER.startPos.x, PLAYER.startPos.y, PLAYER.startPos.z);
controls.getObject().rotation.y = Math.PI;

canvas.addEventListener('click', () => {
  if (gameState.playing && !gameState.won && !controls.isLocked) {
    controls.lock();
  }
});

const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

document.addEventListener('keydown', (e) => {
  if (!gameState.playing || gameState.won) return;
  const k = e.code;
  if (k === 'KeyW') keys.w = true;
  if (k === 'KeyA') keys.a = true;
  if (k === 'KeyS') keys.s = true;
  if (k === 'KeyD') keys.d = true;
  if (k === 'KeyQ') switchTimeline('past');
  if (k === 'KeyE') switchTimeline('future');
  if (k === 'KeyF') tryInteract();
});

document.addEventListener('keyup', (e) => {
  const k = e.code;
  if (k === 'KeyW') keys.w = false;
  if (k === 'KeyA') keys.a = false;
  if (k === 'KeyS') keys.s = false;
  if (k === 'KeyD') keys.d = false;
});

startOverlay.addEventListener('click', (e) => {
  if (e.target.classList.contains('mode-btn')) return;
  controls.lock();
});

// Feature 1: Mode selection
btnStory.addEventListener('click', (e) => {
  e.stopPropagation();
  gameState.challengeMode = false;
  btnStory.classList.add('mode-btn-active');
  btnChallenge.classList.remove('mode-btn-active');
});

btnChallenge.addEventListener('click', (e) => {
  e.stopPropagation();
  gameState.challengeMode = true;
  btnChallenge.classList.add('mode-btn-active');
  btnStory.classList.remove('mode-btn-active');
});

// Feature 4: Load best time
(function loadBestTime() {
  try {
    const best = localStorage.getItem('timeFracture_bestTime');
    if (best) {
      bestTimeDisplay.classList.remove('hidden');
      bestTimeValue.textContent = formatTime(parseFloat(best));
    }
  } catch(e) {}
})();

controls.addEventListener('lock', () => {
  startOverlay.classList.add('hidden');
  hud.classList.remove('hidden');
  hud.classList.add('timeline-past');
  gameState.playing = true;
  roomIndicator.classList.add('visible');
  updateRoomIndicator();

  // Start timer for challenge mode
  if (gameState.challengeMode && gameState.timerStartTime === 0) {
    gameState.timerStartTime = performance.now();
    challengeTimer.classList.remove('hidden');
  }

  // Show initial sector intro
  if (!gameState.sectorsVisited[0]) {
    gameState.sectorsVisited[0] = true;
    showSectorIntro('SECTOR 01', 'BRIDGE CHAMBER');
  }
});

controls.addEventListener('unlock', () => {
  if (!gameState.won) {
    startOverlay.classList.remove('hidden');
    document.getElementById('start-prompt').textContent = '[ CLICK TO RESUME ]';
  }
});

playAgainBtn.addEventListener('click', () => {
  window.location.reload();
});

// ═══ COLLISION SYSTEM ═══
const playerBox = new THREE.Box3();
const tempBox = new THREE.Box3();

function updatePlayerBox() {
  const pos = controls.getObject().position;
  playerBox.min.set(pos.x - PLAYER.radius, 0, pos.z - PLAYER.radius);
  playerBox.max.set(pos.x + PLAYER.radius, PLAYER.height, pos.z + PLAYER.radius);
}

function resolveCollisions() {
  const obj = controls.getObject();
  updatePlayerBox();

  for (let i = 0; i < collidables.length; i++) {
    const col = collidables[i];
    if (!col.visible) continue;
    if (col.userData.timeline && col.userData.timeline !== gameState.timeline) continue;

    tempBox.setFromObject(col);
    if (playerBox.intersectsBox(tempBox)) {
      const overlapX = Math.min(playerBox.max.x, tempBox.max.x) - Math.max(playerBox.min.x, tempBox.min.x);
      const overlapZ = Math.min(playerBox.max.z, tempBox.max.z) - Math.max(playerBox.min.z, tempBox.min.z);

      if (overlapX < overlapZ) {
        if (obj.position.x > col.position.x) {
          obj.position.x += overlapX;
        } else {
          obj.position.x -= overlapX;
        }
      } else {
        if (obj.position.z > col.position.z) {
          obj.position.z += overlapZ;
        } else {
          obj.position.z -= overlapZ;
        }
      }
      updatePlayerBox();
    }
  }
}

function isOnBridge(pos) {
  return Math.abs(pos.x) <= 1 && pos.z >= -16 && pos.z <= -8;
}

function checkGapFall() {
  if (!bridgeGapBounds || gameState.respawnCooldown > 0) return;

  const pos = controls.getObject().position;
  const inGap = bridgeGapBounds.containsPoint(new THREE.Vector3(pos.x, 0, pos.z));

  if (inGap) {
    const safeOnBridge = gameState.timeline === 'past' && isOnBridge(pos);
    if (!safeOnBridge) {
      respawnPlayer();
    }
  }
}

function respawnPlayer() {
  const rp = room1RespawnPoint || PLAYER.startPos;
  controls.getObject().position.set(rp.x, rp.y, rp.z);
  velocity.set(0, 0, 0);
  gameState.respawnCooldown = 1;

  timelineFlash.className = '';
  void timelineFlash.offsetWidth;
  timelineFlash.classList.add('flash-past');
  playTone(180, 0.3);
}

function rebuildCollidables() {
  collidables.length = 0;

  scene.traverse((obj) => {
    if (obj.userData.collidable) {
      if (obj.userData.timeline && obj.userData.timeline !== gameState.timeline) return;
      if (obj.userData.isDoor && gameState.energyNodesComplete) return;
      if (obj.visible !== false) collidables.push(obj);
    }
  });
}

// ═══ TIMELINE SYSTEM (Feature 1: Stability + Feature 3: Transition FX) ═══
function switchTimeline(timeline) {
  if (!gameState.playing || gameState.won || gameState.timeline === timeline) return;

  gameState.timeline = timeline;
  gameState.timelineSwitches++;

  // Feature 3: Timeline analytics
  if (timeline === 'past') gameState.pastUsage++;
  else gameState.futureUsage++;

  // Feature 6: First Fracture achievement
  if (gameState.timelineSwitches === 1) {
    unlockAchievement('FIRST FRACTURE', 'Switch timeline for the first time');
  }

  // Feature 1: Reduce stability
  gameState.stability = Math.max(0, gameState.stability - 10);
  updateStabilityUI();

  if (gameState.stability <= 0) {
    triggerTemporalCollapse();
    return;
  }

  // Feature 3: Enhanced flash
  timelineFlash.className = '';
  void timelineFlash.offsetWidth;
  timelineFlash.classList.add(timeline === 'past' ? 'flash-past' : 'flash-future');

  // Feature 3: Chromatic distortion
  chromaticOverlay.className = '';
  void chromaticOverlay.offsetWidth;
  chromaticOverlay.classList.add('glitch-active');

  // Feature 3: Camera shake
  triggerCameraShake();

  timelineLight.color.setHex(timeline === 'past' ? COLORS.past : COLORS.future);
  timelineLight.intensity = 1.2;

  timelineObjects.past.forEach((obj) => { obj.visible = timeline === 'past'; });
  timelineObjects.future.forEach((obj) => { obj.visible = timeline === 'future'; });

  // Show real portal if it was spawned
  if (gameState.realPortalSpawned && realPortal) {
    realPortal.visible = (timeline === 'past');
    realPortalParticles.visible = (timeline === 'past');
  }

  updateDoorState();
  rebuildCollidables();
  updateGridColors();
  updateHUDTimeline();
  playTone(timeline === 'past' ? 220 : 440, 0.2);

  const pos = controls.getObject().position.clone();
  activeBurst = createTimelineBurst(pos, timeline);
}

// Feature 3: Camera shake
let cameraShakeTime = 0;
function triggerCameraShake() {
  cameraShakeTime = 0.3;
}

function updateCameraShake(delta) {
  if (cameraShakeTime > 0) {
    cameraShakeTime -= delta;
    const intensity = cameraShakeTime * 0.008;
    camera.rotation.z = (Math.random() - 0.5) * intensity;
    if (cameraShakeTime <= 0) {
      camera.rotation.z = 0;
    }
  }
}

// Feature 1: Stability UI
function updateStabilityUI() {
  const pct = gameState.stability;
  stabilityBarFill.style.width = pct + '%';
  stabilityValue.textContent = pct + '%';

  // Remove old classes
  stabilityBarFill.classList.remove('warning', 'critical');
  stabilityValue.classList.remove('warning', 'critical');

  if (pct <= 20) {
    stabilityBarFill.classList.add('critical');
    stabilityValue.classList.add('critical');
  } else if (pct <= 40) {
    stabilityBarFill.classList.add('warning');
    stabilityValue.classList.add('warning');
  }
}

// Feature 1: Temporal Collapse
function triggerTemporalCollapse() {
  gameState.playing = false;
  controls.unlock();
  hud.classList.add('hidden');
  temporalCollapse.classList.remove('hidden');
  playTone(80, 1);
  setTimeout(() => playTone(60, 1), 300);
  setTimeout(() => {
    window.location.reload();
  }, 3000);
}

function updateDoorState() {
  if (!futureDoor) return;
  const doorOpen = gameState.energyNodesComplete;
  futureDoor.visible = !doorOpen;

  // Update portal visual state
  updatePortalLockState();
  rebuildCollidables();
}

function updatePortalLockState() {
  // False portal: red if locked, normal if unlocked
  if (falsePortal) {
    if (gameState.energyNodesComplete) {
      falsePortal.material.color.setHex(COLORS.future);
      falsePortal.material.emissive.setHex(COLORS.future);
    } else {
      falsePortal.material.color.setHex(COLORS.danger);
      falsePortal.material.emissive.setHex(COLORS.danger);
    }
  }
  // Real portal color is always green (past) — no change needed
}

function updateGridColors() {
  const color = gameState.timeline === 'past' ? COLORS.past : COLORS.future;
  scene.traverse((obj) => {
    if (obj.name === 'gridLines' && obj.material) {
      obj.material.color.setHex(color);
    }
  });
}

// ═══ INTERACTION SYSTEM ═══
function getNearestInteractive() {
  const pos = controls.getObject().position;
  let nearest = null;
  let nearestDist = Infinity;

  for (let i = 0; i < interactiveObjects.length; i++) {
    const obj = interactiveObjects[i];
    if (!obj.visible) continue;
    if (obj.userData.timeline && obj.userData.timeline !== gameState.timeline) continue;
    if (obj.userData.activated) continue;

    const dist = pos.distanceTo(obj.position);
    const radius = obj.userData.interactRadius || 1.5;
    if (dist < radius && dist < nearestDist) {
      nearest = obj;
      nearestDist = dist;
    }
  }
  return nearest;
}

function tryInteract() {
  const target = getNearestInteractive();
  if (!target) return;

  // Feature 2: Energy Node interaction
  if (target.userData.interactType === 'energyNode' && !target.userData.activated) {
    const nodeId = target.userData.nodeId;
    gameState.energyNodes[nodeId] = true;
    target.userData.activated = true;

    // Visual feedback: glow up
    target.userData.coreMat.emissiveIntensity = 2;
    target.userData.coreMat.color.setHex(0xffffff);
    target.userData.ringMat.emissiveIntensity = 2;
    target.userData.nodeLight.intensity = 1.5;

    createSwitchBurst(target.position.clone());
    playTone(660, 0.3);

    // Count activated nodes
    const count = Object.values(gameState.energyNodes).filter(Boolean).length;
    energyNodeValue.textContent = count + ' / 3';

    if (count >= 3) {
      gameState.energyNodesComplete = true;
      updateDoorState();
      playTone(880, 0.5);
      setTimeout(() => playTone(1100, 0.3), 200);
      // Feature 6: Achievement
      unlockAchievement('TEMPORAL ENGINEER', 'Activate all energy nodes');
      // Feature 8: Unlock sound
      setTimeout(() => playTone(1320, 0.2), 400);
      // Show portal online notification
      showPortalOnline();
    }
  }

  // Feature 4: Memory Fragment interaction
  if (target.userData.interactType === 'memoryFragment' && !target.userData.activated) {
    target.userData.activated = true;
    gameState.memoryFragments++;

    // Hide the fragment
    target.visible = false;

    // Update counter
    memoryValue.textContent = gameState.memoryFragments + ' / 3';

    // Show popup
    showMemoryPopup(target.userData.fragTitle, target.userData.fragText);
    playTone(550, 0.3);
    setTimeout(() => playTone(770, 0.2), 150);

    // Feature 6: Achievement
    if (gameState.memoryFragments >= 3) {
      unlockAchievement('ARCHIVIST', 'Collect all memory fragments');
    }
  }
}

function updateInteractionUI() {
  const target = getNearestInteractive();
  const show = target !== null && gameState.playing && !gameState.won;

  interactionPrompt.classList.toggle('hidden', !show);
  interactControlLine.classList.toggle('hidden', !show);

  if (show && target) {
    if (target.userData.interactType === 'energyNode') {
      interactionPrompt.textContent = '[F] ACTIVATE ENERGY NODE';
    } else if (target.userData.interactType === 'memoryFragment') {
      interactionPrompt.textContent = '[F] COLLECT MEMORY FRAGMENT';
    } else {
      interactionPrompt.textContent = '[F] ACTIVATE POWER RELAY';
    }
  }
}

// Feature 4: Memory Popup
let memoryPopupTimer = null;
function showMemoryPopup(title, text) {
  memoryPopup.querySelector('.memory-popup-title').textContent = title;
  memoryPopup.querySelector('.memory-popup-text').textContent = text;
  memoryPopup.classList.remove('hidden');

  if (memoryPopupTimer) clearTimeout(memoryPopupTimer);
  memoryPopupTimer = setTimeout(() => {
    memoryPopup.classList.add('hidden');
  }, 3000);
}

// ═══ HUD UPDATES ═══
function updateHUDTimeline() {
  const isPast = gameState.timeline === 'past';
  hud.classList.toggle('timeline-past', isPast);
  hud.classList.toggle('timeline-future', !isPast);
  timelineValue.className = isPast ? 'timeline-past' : 'timeline-future';
  timelineValue.innerHTML = isPast
    ? '<span class="diamond">◈</span> PAST'
    : '<span class="diamond">◈</span> FUTURE';
}

function updateRoomIndicator() {
  const z = controls.getObject().position.z;
  let roomIdx = 0;
  if (z <= -20 && z > -40) roomIdx = 1;
  else if (z <= -40) roomIdx = 2;

  const zone = ROOM_ZONES[roomIdx];
  if (roomIdx !== gameState.currentRoom) {
    gameState.currentRoom = roomIdx;
    roomIndicator.classList.remove('visible');
    setTimeout(() => {
      roomText.textContent = zone.label;
      roomHint.textContent = zone.hint;
      roomIndicator.classList.add('visible');
    }, 100);

    // Feature 5: Sector intro popups
    if (!gameState.sectorsVisited[roomIdx]) {
      gameState.sectorsVisited[roomIdx] = true;
      const SECTOR_NAMES = ['BRIDGE CHAMBER', 'ENERGY RELAY', 'TEMPORAL ESCAPE CORE'];
      showSectorIntro('SECTOR 0' + (roomIdx + 1), SECTOR_NAMES[roomIdx]);
    }
  } else {
    roomText.textContent = zone.label;
    roomHint.textContent = zone.hint;
  }
}

// ═══ AUDIO ═══
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playTone(frequency, duration) {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    /* audio optional */
  }
}

// ═══ WIN SEQUENCE (Enhanced Ending — Features 2,3,6,7) ═══
function triggerWin() {
  if (gameState.won) return;

  // VALIDATION: All energy nodes must be activated
  const nodesActivated = Object.values(gameState.energyNodes).filter(Boolean).length;
  if (nodesActivated < 3) {
    return;
  }

  gameState.won = true;
  gameState.playing = false;

  // Calculate completion time
  if (gameState.challengeMode && gameState.timerStartTime > 0) {
    gameState.completionTime = (performance.now() - gameState.timerStartTime) / 1000;
  }

  controls.unlock();
  winFade.classList.add('active');

  // Feature 6: Escape Artist achievement
  unlockAchievement('ESCAPE ARTIST', 'Complete the game');

  // Feature 8: Portal enter sound
  playTone(440, 0.3);
  setTimeout(() => playTone(660, 0.3), 100);
  setTimeout(() => playTone(880, 0.4), 200);

  setTimeout(() => {
    hud.classList.add('hidden');
    winOverlay.classList.remove('hidden');

    // Core stats
    statFragments.textContent = gameState.memoryFragments + ' / 3';
    statStability.textContent = gameState.stability + '%';
    statSwitches.textContent = gameState.timelineSwitches;

    // Feature 3: Timeline analytics
    statPastUsage.textContent = gameState.pastUsage;
    statFutureUsage.textContent = gameState.futureUsage;

    // Feature 1+2: Challenge mode time + medal
    if (gameState.challengeMode && gameState.completionTime > 0) {
      statTimeRow.classList.remove('hidden');
      statTime.textContent = formatTime(gameState.completionTime);

      // Medal
      statMedalRow.classList.remove('hidden');
      const t = gameState.completionTime;
      let medalText, medalClass;
      if (t < 45) {
        medalText = '★ GOLD ★';
        medalClass = 'medal-gold';
      } else if (t <= 90) {
        medalText = '◆ SILVER ◆';
        medalClass = 'medal-silver';
      } else {
        medalText = '● BRONZE ●';
        medalClass = 'medal-bronze';
      }
      statMedal.textContent = medalText;
      statMedal.className = 'medal-display ' + medalClass;

      // Feature 4: Save best time
      saveBestTime(gameState.completionTime);
    }

    playTone(523, 0.3);
    setTimeout(() => playTone(659, 0.3), 200);
    setTimeout(() => playTone(784, 0.5), 400);
  }, 1500);
}

// Feature 5: False Portal Check + Real Portal Check
function checkPortalWin() {
  const pos = controls.getObject().position;
  if (gameState.won) return;

  // Check false portal approach
  if (falsePortal && falsePortal.visible && !gameState.falsePortalTriggered) {
    const dist = pos.distanceTo(falsePortal.position);
    if (dist < 2 && gameState.timeline === 'future') {
      // Gate behind energy nodes
      if (!gameState.energyNodesComplete) {
        showPortalLockedWarning();
        return;
      }
      triggerFalsePortal();
    }
  }

  // Check real portal
  if (realPortal && realPortal.visible && gameState.realPortalSpawned) {
    const dist = pos.distanceTo(realPortal.position);
    if (dist < 1.5 && gameState.timeline === 'past') {
      // Gate behind energy nodes
      if (!gameState.energyNodesComplete) {
        showPortalLockedWarning();
        return;
      }
      triggerWin();
    }
  }
}

// Portal locked warning
let portalLockedTimer = null;
let portalLockedCooldown = false;
function showPortalLockedWarning() {
  if (portalLockedCooldown) return;
  portalLockedCooldown = true;

  const count = Object.values(gameState.energyNodes).filter(Boolean).length;
  portalLockProgress.textContent = 'ENERGY NODES: ' + count + ' / 3';
  portalLockedMsg.classList.remove('hidden');
  // Re-trigger animation
  portalLockedMsg.style.animation = 'none';
  void portalLockedMsg.offsetWidth;
  portalLockedMsg.style.animation = '';

  playTone(120, 0.4);
  setTimeout(() => playTone(90, 0.3), 150);

  if (portalLockedTimer) clearTimeout(portalLockedTimer);
  portalLockedTimer = setTimeout(() => {
    portalLockedMsg.classList.add('hidden');
    portalLockedCooldown = false;
  }, 2500);
}

// Portal Online notification
function showPortalOnline() {
  // Re-use temporalLockMsg position/style temporarily
  temporalLockMsg.querySelector('.lock-title').textContent = '✓ TEMPORAL POWER RESTORED';
  temporalLockMsg.querySelector('.lock-title').style.color = '#00ff88';
  temporalLockMsg.querySelector('.lock-title').style.textShadow = '0 0 20px #00ff88';
  temporalLockMsg.querySelector('.lock-hint').textContent = 'PORTAL ONLINE';
  temporalLockMsg.querySelector('.lock-hint').style.color = '#00cfff';
  temporalLockMsg.classList.remove('hidden');
  temporalLockMsg.style.animation = 'none';
  void temporalLockMsg.offsetWidth;
  temporalLockMsg.style.animation = '';

  playTone(660, 0.3);
  setTimeout(() => playTone(880, 0.3), 150);
  setTimeout(() => playTone(1100, 0.4), 300);

  setTimeout(() => {
    temporalLockMsg.classList.add('hidden');
    // Reset styles for later use by false portal
    temporalLockMsg.querySelector('.lock-title').textContent = '⚠ TEMPORAL LOCK DETECTED';
    temporalLockMsg.querySelector('.lock-title').style.color = '';
    temporalLockMsg.querySelector('.lock-title').style.textShadow = '';
    temporalLockMsg.querySelector('.lock-hint').textContent = 'Timeline Mismatch — Switch Timeline';
    temporalLockMsg.querySelector('.lock-hint').style.color = '';
  }, 3000);
}

function triggerFalsePortal() {
  gameState.falsePortalTriggered = true;

  // Portal fails — disappear
  falsePortal.visible = false;
  falsePortalParticles.visible = false;

  // Show temporal lock message
  temporalLockMsg.classList.remove('hidden');
  playTone(120, 0.5);
  setTimeout(() => playTone(90, 0.5), 200);

  // Spawn real portal after delay
  setTimeout(() => {
    gameState.realPortalSpawned = true;
    // Real portal is in PAST timeline
    if (gameState.timeline === 'past') {
      realPortal.visible = true;
      realPortalParticles.visible = true;
    }
    temporalLockMsg.classList.add('hidden');
    // Update hint
    ROOM_ZONES[2].hint = 'Switch to PAST — the real portal awaits';
    updateRoomIndicator();
  }, 2500);
}

function updatePulsingObjects(elapsed) {
  // Pulse false portal if visible
  if (falsePortal && falsePortal.visible) {
    const pulse = (Math.sin(elapsed * 2) + 1) * 0.5;
    if (gameState.energyNodesComplete) {
      // Unlocked: green-to-blue pulse
      const green = new THREE.Color(COLORS.past);
      const blue = new THREE.Color(COLORS.future);
      falsePortal.material.emissive.copy(green).lerp(blue, pulse);
      falsePortal.material.color.copy(falsePortal.material.emissive);
      falsePortal.material.emissiveIntensity = 0.8 + pulse * 0.6;
    } else {
      // Locked: red pulse
      falsePortal.material.emissive.setHex(COLORS.danger);
      falsePortal.material.color.setHex(COLORS.danger);
      falsePortal.material.emissiveIntensity = 0.4 + pulse * 0.3;
    }
  }

  // Pulse real portal if visible
  if (realPortal && realPortal.visible) {
    const pulse = (Math.sin(elapsed * 3) + 1) * 0.5;
    realPortal.material.emissive.setHex(COLORS.past);
    realPortal.material.color.setHex(COLORS.past);
    realPortal.material.emissiveIntensity = 1 + pulse * 0.8;
  }

  // Pulse energy nodes (non-activated ones spin)
  for (let i = 0; i < energyNodeMeshes.length; i++) {
    const node = energyNodeMeshes[i];
    if (node.visible && !node.userData.activated) {
      node.children[0].rotation.y = elapsed * 1.5;
      node.children[0].rotation.x = Math.sin(elapsed * 2) * 0.3;
      node.children[1].rotation.z = elapsed * 0.5;
      node.userData.coreMat.emissiveIntensity = 0.4 + Math.sin(elapsed * 3) * 0.3;
    }
  }

  // Pulse memory fragments (floating bob)
  for (let i = 0; i < memoryFragmentMeshes.length; i++) {
    const frag = memoryFragmentMeshes[i];
    if (frag.visible && !frag.userData.activated) {
      frag.position.y = frag.userData.baseY + Math.sin(elapsed * 2 + i) * 0.15;
      frag.children[0].rotation.y = elapsed * 1;
      frag.children[0].rotation.x = elapsed * 0.5;
    }
  }
}

// ═══ BUILD WORLD ═══
buildEntranceCorridor();
buildRoom1();
buildRoom2();
buildRoom3();
buildMemoryFragments();
rebuildCollidables();
updateHUDTimeline();

[-10, -30, -50].forEach((z) => {
  addFacilityLight(-3, 3.5, z);
  addFacilityLight(3, 3.5, z);
});

// Feature 4: Build Memory Fragments
function buildMemoryFragments() {
  for (let i = 0; i < MEMORY_FRAGMENT_DATA.length; i++) {
    const data = MEMORY_FRAGMENT_DATA[i];
    const group = new THREE.Group();
    group.position.set(data.pos.x, data.pos.y, data.pos.z);

    // Holographic cube
    const geo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xcc66ff,
      emissive: 0xcc66ff,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.7,
      roughness: 0.2,
      metalness: 0.8
    });
    const cube = new THREE.Mesh(geo, mat);
    group.add(cube);

    // Glow light
    const light = new THREE.PointLight(0xcc66ff, 0.4, 3);
    light.position.set(0, 0.3, 0);
    group.add(light);

    group.userData.interactive = true;
    group.userData.interactType = 'memoryFragment';
    group.userData.interactRadius = 2;
    group.userData.timeline = data.timeline;
    group.userData.activated = false;
    group.userData.fragTitle = data.title;
    group.userData.fragText = data.text;
    group.userData.baseY = data.pos.y;

    scene.add(group);
    tagTimeline(group, data.timeline);
    interactiveObjects.push(group);
    memoryFragmentMeshes.push(group);
  }
}

// ═══ ANIMATION LOOP ═══
function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.getElapsedTime();

  if (gameState.respawnCooldown > 0) {
    gameState.respawnCooldown -= delta;
  }

  // Feature 3: Camera shake
  updateCameraShake(delta);

  // Feature 1: Update challenge timer
  if (gameState.challengeMode && gameState.playing && !gameState.won && gameState.timerStartTime > 0) {
    const elapsed_t = (performance.now() - gameState.timerStartTime) / 1000;
    timerValue.textContent = formatTime(elapsed_t);
  }

  if (gameState.playing && !gameState.won && controls.isLocked) {
    velocity.x -= velocity.x * 10 * delta;
    velocity.z -= velocity.z * 10 * delta;

    direction.z = Number(keys.w) - Number(keys.s);
    direction.x = Number(keys.d) - Number(keys.a);
    direction.normalize();

    if (keys.w || keys.s) velocity.z -= direction.z * PLAYER.speed * delta * 10;
    if (keys.a || keys.d) velocity.x -= direction.x * PLAYER.speed * delta * 10;

    controls.moveRight(-velocity.x * delta);
    controls.moveForward(-velocity.z * delta);

    const pos = controls.getObject().position;
    pos.y = PLAYER.height;
    pos.x = THREE.MathUtils.clamp(pos.x, -4.5, 4.5);

    timelineLight.position.set(pos.x, 3.5, pos.z);

    resolveCollisions();
    checkGapFall();
    checkPortalWin();
    updateRoomIndicator();
    updateInteractionUI();

    // Feature 2: Show energy node panel in sector 2
    const inSector2 = pos.z <= -20 && pos.z > -40;
    energyNodePanel.classList.toggle('hidden', !inSector2 && !gameState.energyNodesComplete);
  }

  updateParticles(delta, elapsed);
  updatePulsingObjects(elapsed);

  // Update real portal particles
  if (realPortalParticles && realPortalParticles.visible) {
    const posArr = realPortalParticles.geometry.attributes.position.array;
    const angles = realPortalParticles.userData.angles;
    const pp = realPortalParticles.userData.portalPos;
    const radius = 1.8;
    realPortalParticles.material.color.setHex(COLORS.past);

    for (let i = 0; i < angles.length; i++) {
      const a = angles[i] + elapsed * 0.8;
      posArr[i * 3] = pp.x + Math.cos(a) * radius;
      posArr[i * 3 + 1] = pp.y + Math.sin(a * 2 + elapsed) * 0.5;
      posArr[i * 3 + 2] = pp.z + Math.sin(a) * radius * 0.3;
    }
    realPortalParticles.geometry.attributes.position.needsUpdate = true;
  }

  renderer.render(scene, camera);
}

// ═══ UTILITY: Format time as MM:SS ═══
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

// ═══ FEATURE 4: Best Time System ═══
function saveBestTime(time) {
  try {
    const prev = localStorage.getItem('timeFracture_bestTime');
    if (!prev || time < parseFloat(prev)) {
      localStorage.setItem('timeFracture_bestTime', time.toFixed(2));
    }
  } catch(e) {}
}

// ═══ FEATURE 5: Sector Intro Popups ═══
let sectorIntroTimer = null;
function showSectorIntro(label, name) {
  sectorIntroLabel.textContent = label;
  sectorIntroName.textContent = name;
  sectorIntro.classList.remove('hidden');
  // Re-trigger animation
  sectorIntro.style.animation = 'none';
  void sectorIntro.offsetWidth;
  sectorIntro.style.animation = '';

  if (sectorIntroTimer) clearTimeout(sectorIntroTimer);
  sectorIntroTimer = setTimeout(() => {
    sectorIntro.classList.add('hidden');
  }, 3000);
}

// ═══ FEATURE 6: Achievement System ═══
let achievementTimer = null;
let achievementQueue = [];
let achievementShowing = false;

function unlockAchievement(title, desc) {
  if (gameState.achievements[title]) return;
  gameState.achievements[title] = true;

  achievementQueue.push({ title, desc });
  if (!achievementShowing) {
    showNextAchievement();
  }
}

function showNextAchievement() {
  if (achievementQueue.length === 0) {
    achievementShowing = false;
    return;
  }
  achievementShowing = true;
  const { title, desc } = achievementQueue.shift();

  achievementTitle.textContent = title;
  achievementDesc.textContent = desc;
  achievementToast.classList.remove('hidden');
  // Re-trigger animation
  achievementToast.style.animation = 'none';
  void achievementToast.offsetWidth;
  achievementToast.style.animation = '';

  // Play achievement sound
  playTone(880, 0.15);
  setTimeout(() => playTone(1100, 0.15), 100);
  setTimeout(() => playTone(1320, 0.2), 200);

  if (achievementTimer) clearTimeout(achievementTimer);
  achievementTimer = setTimeout(() => {
    achievementToast.classList.add('hidden');
    setTimeout(() => showNextAchievement(), 300);
  }, 3000);
}

// ═══ FEATURE 8: Enhanced Audio ═══
function playChord(freqs, duration) {
  freqs.forEach((f, i) => {
    setTimeout(() => playTone(f, duration), i * 80);
  });
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
