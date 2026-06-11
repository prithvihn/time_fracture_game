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
  respawnCooldown: 0
};

const ROOM_ZONES = [
  { min: 0, max: -20, label: 'SECTOR 01 / BRIDGE', hint: 'Stay in PAST — cross the green bridge, then walk forward' },
  { min: -20, max: -40, label: 'SECTOR 02 / RELAY', hint: 'PAST: press F at the switch · FUTURE: door opens after activation' },
  { min: -40, max: -60, label: 'SECTOR 03 / ESCAPE', hint: 'Switch to FUTURE — wall vanishes, enter the portal' }
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

// ═══ ROOM 2: POWER RELAY ═══
function buildRoom2() {
  const centerZ = -30;
  const depth = 20;
  createCorridorSegment(centerZ, depth, false);
  createNarrativePanel(-4.7, 2.2, centerZ, 'Security lockdown active. Find the power relay.', Math.PI / 2);

  const switchGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const switchMat = new THREE.MeshStandardMaterial({
    color: 0x003300,
    emissive: COLORS.past,
    emissiveIntensity: 0.6,
    roughness: 0.5,
    metalness: 0.4
  });
  powerSwitch = new THREE.Mesh(switchGeo, switchMat);
  powerSwitch.position.set(-4.5, 1.5, centerZ);
  powerSwitch.userData.timeline = 'past';
  powerSwitch.userData.interactive = true;
  powerSwitch.userData.interactType = 'powerSwitch';
  powerSwitch.userData.interactRadius = 1.5;
  scene.add(powerSwitch);
  tagTimeline(powerSwitch, 'past');
  interactiveObjects.push(powerSwitch);

  const switchPanel = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.8 })
  );
  switchPanel.position.set(-4.55, 1.5, centerZ);
  tagTimeline(switchPanel, 'past');

  powerPanelLight = new THREE.PointLight(COLORS.past, 0, 5);
  powerPanelLight.position.set(-4, 2.5, centerZ);
  scene.add(powerPanelLight);

  const doorGeo = new THREE.BoxGeometry(3, 3.5, 0.4);
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a3e,
    roughness: 0.6,
    metalness: 0.5,
    emissive: COLORS.future,
    emissiveIntensity: 0.15
  });
  futureDoor = new THREE.Mesh(doorGeo, doorMat);
  futureDoor.position.set(0, 1.75, -22);
  futureDoor.userData.timeline = 'future';
  futureDoor.userData.collidable = true;
  futureDoor.userData.isDoor = true;
  scene.add(futureDoor);
  tagTimeline(futureDoor, 'future');
  collidables.push(futureDoor);

  const doorFrame = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 3.8, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x0f3460, emissive: 0x0f3460, emissiveIntensity: 0.2 })
  );
  doorFrame.position.set(0, 1.9, -22);
  tagTimeline(doorFrame, 'future');
}

// ═══ ROOM 3: ESCAPE CHAMBER ═══
function buildRoom3() {
  const centerZ = -50;
  const depth = 20;
  createCorridorSegment(centerZ, depth, true);
  createNarrativePanel(-4.7, 2.2, centerZ, 'Temporal core unstable. Exit before collapse.', Math.PI / 2);

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

  const portalGeo = new THREE.BoxGeometry(2, 3, 0.3);
  const portalMat = new THREE.MeshStandardMaterial({
    color: COLORS.future,
    emissive: COLORS.future,
    emissiveIntensity: 1,
    transparent: true,
    opacity: 0.9
  });
  exitPortal = new THREE.Mesh(portalGeo, portalMat);
  exitPortal.position.set(0, 1.5, -58);
  exitPortal.userData.timeline = 'future';
  exitPortal.userData.isPortal = true;
  scene.add(exitPortal);
  tagTimeline(exitPortal, 'future');

  portalParticles = createPortalRing(exitPortal.position);
  scene.add(portalParticles);
  tagTimeline(portalParticles, 'future');

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

startOverlay.addEventListener('click', () => {
  controls.lock();
});

controls.addEventListener('lock', () => {
  startOverlay.classList.add('hidden');
  hud.classList.remove('hidden');
  hud.classList.add('timeline-past');
  gameState.playing = true;
  roomIndicator.classList.add('visible');
  updateRoomIndicator();
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
      if (obj.userData.isDoor && gameState.switchActivated && gameState.timeline === 'future') return;
      if (obj.visible !== false) collidables.push(obj);
    }
  });
}

// ═══ TIMELINE SYSTEM ═══
function switchTimeline(timeline) {
  if (!gameState.playing || gameState.won || gameState.timeline === timeline) return;

  gameState.timeline = timeline;
  gameState.timelineSwitches++;

  timelineFlash.className = '';
  void timelineFlash.offsetWidth;
  timelineFlash.classList.add(timeline === 'past' ? 'flash-past' : 'flash-future');

  timelineLight.color.setHex(timeline === 'past' ? COLORS.past : COLORS.future);
  timelineLight.intensity = 1.2;

  timelineObjects.past.forEach((obj) => { obj.visible = timeline === 'past'; });
  timelineObjects.future.forEach((obj) => { obj.visible = timeline === 'future'; });

  updateDoorState();
  rebuildCollidables();
  updateGridColors();
  updateHUDTimeline();
  playTone(timeline === 'past' ? 220 : 440, 0.2);

  const pos = controls.getObject().position.clone();
  activeBurst = createTimelineBurst(pos, timeline);
}

function updateDoorState() {
  if (!futureDoor) return;
  const doorOpen = gameState.switchActivated && gameState.timeline === 'future';
  futureDoor.visible = !doorOpen;
  rebuildCollidables();
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

  if (target.userData.interactType === 'powerSwitch' && !gameState.switchActivated) {
    gameState.switchActivated = true;
    target.userData.activated = true;
    target.material.emissiveIntensity = 2;
    target.material.color.setHex(COLORS.past);

    if (powerPanelLight) {
      powerPanelLight.intensity = 1.5;
    }

    createSwitchBurst(target.position.clone());
    updateDoorState();
  }
}

function updateInteractionUI() {
  const target = getNearestInteractive();
  const show = target !== null && gameState.playing && !gameState.won;

  interactionPrompt.classList.toggle('hidden', !show);
  interactControlLine.classList.toggle('hidden', !show);
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

// ═══ WIN SEQUENCE ═══
function triggerWin() {
  if (gameState.won) return;
  gameState.won = true;
  gameState.playing = false;
  controls.unlock();

  winFade.classList.add('active');

  setTimeout(() => {
    hud.classList.add('hidden');
    winOverlay.classList.remove('hidden');
    statSwitches.textContent = gameState.timelineSwitches;
    playTone(523, 0.3);
    setTimeout(() => playTone(659, 0.3), 200);
    setTimeout(() => playTone(784, 0.5), 400);
  }, 1500);
}

function checkPortalWin() {
  if (!exitPortal || !exitPortal.visible || gameState.won) return;
  const pos = controls.getObject().position;
  const dist = pos.distanceTo(exitPortal.position);
  if (dist < 1.5 && gameState.timeline === 'future') {
    triggerWin();
  }
}

function updatePulsingObjects(elapsed) {
  if (exitPortal && exitPortal.visible) {
    const pulse = (Math.sin(elapsed * 2) + 1) * 0.5;
    const green = new THREE.Color(COLORS.past);
    const blue = new THREE.Color(COLORS.future);
    exitPortal.material.emissive.copy(green).lerp(blue, pulse);
    exitPortal.material.color.copy(exitPortal.material.emissive);
    exitPortal.material.emissiveIntensity = 0.8 + pulse * 0.6;
  }

  if (powerSwitch && powerSwitch.visible && !gameState.switchActivated) {
    powerSwitch.material.emissiveIntensity = 0.4 + Math.sin(elapsed * 3) * 0.3;
  }
}

// ═══ BUILD WORLD ═══
buildEntranceCorridor();
buildRoom1();
buildRoom2();
buildRoom3();
rebuildCollidables();
updateHUDTimeline();

[-10, -30, -50].forEach((z) => {
  addFacilityLight(-3, 3.5, z);
  addFacilityLight(3, 3.5, z);
});

// ═══ ANIMATION LOOP ═══
function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.getElapsedTime();

  if (gameState.respawnCooldown > 0) {
    gameState.respawnCooldown -= delta;
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
  }

  updateParticles(delta, elapsed);
  updatePulsingObjects(elapsed);

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
