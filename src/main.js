const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const distanceMeter = document.getElementById("distanceMeter");
const alertMeter = document.getElementById("alertMeter");
const itemLabel = document.getElementById("itemLabel");
const stateLabel = document.getElementById("stateLabel");
const hintLabel = document.getElementById("hintLabel");
const overlay = document.getElementById("overlay");
const startGuide = document.getElementById("startGuide");
const startButton = document.getElementById("startButton");

const keys = new Set();
const W = canvas.width;
const H = canvas.height;
const horizonY = 390;
const roadBottomHalf = 760;
const roadTopHalf = 230;
const maxDepth = 1180;
const minSafeDistance = 260;
const maxSafeDistance = 720;
const itemEvidence = {
  wallet: {
    label: "Wallet",
    culpritScore: 2,
    innocentScore: 0,
    culpritClue: "cash from the crime scene",
    innocentClue: "ordinary receipts",
  },
  key: {
    label: "Key",
    culpritScore: 1,
    innocentScore: 0,
    culpritClue: "a key matching the back entrance",
    innocentClue: "a house key",
  },
  card: {
    label: "Access Card",
    culpritScore: 2,
    innocentScore: 0,
    culpritClue: "an access card used near the incident",
    innocentClue: "an expired transit card",
  },
  note: {
    label: "Coded Note",
    culpritScore: 3,
    innocentScore: 0,
    culpritClue: "a coded note naming the meeting point",
    innocentClue: "a shopping memo",
  },
};
const initialCovers = [
  { id: "pole-1", kind: "pole", side: -1, depth: 220, laneX: -0.64, width: 0.09 },
  { id: "post-1", kind: "postbox", side: 1, depth: 360, laneX: 0.55, width: 0.17 },
  { id: "sign-1", kind: "sign", side: -1, depth: 560, laneX: -0.76, width: 0.18 },
  { id: "vending-1", kind: "vending", side: 1, depth: 760, laneX: 0.72, width: 0.26 },
  { id: "pole-2", kind: "pole", side: 1, depth: 980, laneX: 0.66, width: 0.08 },
  { id: "post-2", kind: "postbox", side: -1, depth: 1180, laneX: -0.58, width: 0.16 },
];

const state = {
  running: false,
  ended: false,
  playerX: -0.34,
  distance: 540,
  targetX: 0,
  targetGoalX: 0,
  targetSpeed: 46,
  targetAction: "walking",
  actionTimer: 2.5,
  targetIsCulprit: false,
  itemDropTimer: 1.6,
  itemsDropped: 0,
  itemsCollected: 0,
  requiredItems: 4,
  alert: 0,
  lookTimer: 3.2,
  lookDuration: 0,
  warningDuration: 0,
  hidden: false,
  nearCover: null,
  message: "Move with WASD / Arrows. Hide with Space.",
  elapsed: 0,
};

const covers = initialCovers.map((cover) => ({ ...cover }));
const droppedItems = [];

function resetGame() {
  state.running = true;
  state.ended = false;
  state.playerX = -0.34;
  state.distance = 540;
  state.targetX = 0;
  state.targetGoalX = 0;
  state.targetSpeed = 46;
  state.targetAction = "walking";
  state.actionTimer = 2.5;
  state.targetIsCulprit = Math.random() < 0.5;
  state.itemDropTimer = 1.6;
  state.itemsDropped = 0;
  state.itemsCollected = 0;
  state.alert = 0;
  state.lookTimer = 3.0;
  state.lookDuration = 0;
  state.warningDuration = 0;
  state.hidden = false;
  state.nearCover = null;
  state.elapsed = 0;
  state.message = "Keep the target in range.";
  resetCovers();
  droppedItems.splice(0, droppedItems.length);
  overlay.classList.remove("visible");
}

function depthScale(depth) {
  const near = 1 - depth / maxDepth;
  return Math.max(0.18, Math.pow(near, 0.82) * 1.28);
}

function roadHalfWidthAt(y) {
  const t = (y - horizonY) / (H - horizonY);
  return roadTopHalf + (roadBottomHalf - roadTopHalf) * Math.max(0, Math.min(1, t));
}

function depthAtY(y) {
  const t = clamp((y - horizonY) / (H - horizonY), 0, 1);
  return maxDepth * (1 - Math.pow(t, 1 / 1.72));
}

function roadCenterAt(y) {
  const half = roadHalfWidthAt(y);
  const depth = depthAtY(y);
  const cameraInfluence = 1 - (depth / maxDepth) * 0.35;
  return W / 2 - state.playerX * half * cameraInfluence;
}

function project(depth, laneX = 0) {
  const t = 1 - depth / maxDepth;
  const y = horizonY + Math.pow(t, 1.72) * (H - horizonY);
  const half = roadHalfWidthAt(y);
  const cameraInfluence = 1 - (depth / maxDepth) * 0.35;
  const relativeLaneX = laneX - state.playerX * cameraInfluence;
  return { x: W / 2 + relativeLaneX * half, y, scale: depthScale(depth), half };
}

function resetCovers() {
  covers.splice(0, covers.length, ...initialCovers.map((cover) => ({ ...cover })));
}

function moveWorldObjects(delta) {
  for (const cover of covers) {
    cover.depth -= delta;
    if (cover.depth < 90) {
      const farthest = Math.max(...covers.map((item) => item.depth));
      cover.depth = farthest + 210 + Math.random() * 160;
      cover.side = Math.random() > 0.5 ? 1 : -1;
      cover.kind = ["pole", "postbox", "sign", "vending"][Math.floor(Math.random() * 4)];
      cover.laneX = cover.side * (0.54 + Math.random() * 0.26);
      cover.width = cover.kind === "vending" ? 0.26 : cover.kind === "pole" ? 0.08 : 0.17;
    }
  }
}

function update(dt) {
  if (!state.running || state.ended) return;

  state.elapsed += dt;
  updateTargetBehavior(dt);
  state.nearCover = findNearCover();
  state.hidden = Boolean(state.hidden && state.nearCover);

  const horizontal = axis("ArrowRight", "KeyD") - axis("ArrowLeft", "KeyA");
  const forward = axis("ArrowUp", "KeyW") - axis("ArrowDown", "KeyS");
  let worldDelta = 0;
  let playerDistanceChange = 0;
  if (!state.hidden) {
    const nextPlayerX = clamp(state.playerX + horizontal * dt * 0.85, -0.88, 0.88);
    if (!wouldHitCoverLaterally(state.playerX, nextPlayerX)) {
      state.playerX = nextPlayerX;
    }

    const requestedWorldDelta = forward * dt * 160;
    if (!wouldHitCover(state.playerX, requestedWorldDelta)) {
      playerDistanceChange = requestedWorldDelta;
      worldDelta = requestedWorldDelta;
    }
  }
  state.distance += state.targetSpeed * dt - playerDistanceChange;
  state.playerX = clamp(state.playerX, -0.88, 0.88);
  state.distance = clamp(state.distance, 180, 880);
  updateDroppedItems(dt, worldDelta);

  if (state.warningDuration > 0) {
    state.warningDuration -= dt;
  } else if (state.lookDuration > 0) {
    state.lookDuration -= dt;
  } else {
    state.lookTimer -= dt;
    if (state.lookTimer <= 0) {
      state.warningDuration = 0.9 + Math.random() * 0.55;
      state.lookDuration = 1.3 + Math.random() * 0.8;
      state.lookTimer = 3.4 + Math.random() * 3.6;
    }
  }

  const tooClose = state.distance < minSafeDistance;
  const tooFar = state.distance > maxSafeDistance;
  const inSightCone = Math.abs(state.playerX - state.targetX) < 0.76;
  const lineBlocked = hasCoverBlockingSight();
  const visibleWhileLooking = state.lookDuration > 0 && inSightCone && !lineBlocked;
  const distancePenalty = tooClose ? 0.65 : tooFar ? 0.34 : -0.4;
  const gazePenalty = visibleWhileLooking ? 1.05 : -0.58;
  state.alert += dt * (distancePenalty + gazePenalty);
  state.alert = clamp(state.alert, 0, 1);

  if (tooFar) {
    state.message = "You are losing the target.";
  } else if (state.warningDuration > 0) {
    state.message = "The target is about to turn.";
  } else if (state.lookDuration > 0 && state.hidden) {
    state.message = "Stay still behind cover.";
  } else if (state.lookDuration > 0 && lineBlocked) {
    state.message = "Cover is blocking the target's sight.";
  } else if (state.lookDuration > 0) {
    state.message = "Break line of sight.";
  } else if (state.nearCover) {
    state.message = "Cover available. Hold Space.";
  } else if (hasCollectibleNearby()) {
    state.message = "Line up with the dropped item to collect it.";
  } else if (state.targetAction === "paused") {
    state.message = "The target stopped. Keep distance.";
  } else if (state.targetAction === "hurrying") {
    state.message = "The target sped up.";
  } else if (state.targetAction === "drifting") {
    state.message = "The target is changing lanes.";
  } else {
    state.message = "Keep the target in range.";
  }

  if (state.alert >= 1) endGame(false, "発見", "尾行対象に気づかれてしまいました。");
  if (state.itemsCollected >= state.requiredItems) endGame(true, "CLEAR", buildInvestigationResult());

  moveWorldObjects(worldDelta);
  updateHud();
}

function axis(primary, secondary) {
  return keys.has(primary) || keys.has(secondary) ? 1 : 0;
}

function updateTargetBehavior(dt) {
  state.actionTimer -= dt;
  if (state.actionTimer <= 0) {
    const roll = Math.random();
    if (roll < 0.22) {
      state.targetAction = "paused";
      state.actionTimer = 1.1 + Math.random() * 1.1;
      state.targetGoalX = state.targetX;
    } else if (roll < 0.48) {
      state.targetAction = "drifting";
      state.actionTimer = 1.8 + Math.random() * 1.6;
      state.targetGoalX = clamp((Math.random() - 0.5) * 0.72, -0.42, 0.42);
    } else if (roll < 0.7) {
      state.targetAction = "hurrying";
      state.actionTimer = 1.4 + Math.random() * 1.6;
      state.targetGoalX = state.targetX;
    } else {
      state.targetAction = "walking";
      state.actionTimer = 2.0 + Math.random() * 2.8;
      state.targetGoalX = 0;
    }
  }

  const speedByAction = {
    walking: 62,
    paused: 14,
    drifting: 52,
    hurrying: 96,
  };
  const culpritSpeedMultiplier = state.targetIsCulprit ? 1.7 : 1;
  const targetActionSpeed = speedByAction[state.targetAction] * culpritSpeedMultiplier;
  state.targetSpeed += (targetActionSpeed - state.targetSpeed) * Math.min(1, dt * 3.8);
  state.targetX += (state.targetGoalX - state.targetX) * Math.min(1, dt * 2.4);
}

function updateDroppedItems(dt, worldDelta) {
  if (state.itemsDropped < state.requiredItems) {
    state.itemDropTimer -= dt;
    if (state.itemDropTimer <= 0) {
      dropItem();
      state.itemDropTimer = 2.6 + Math.random() * 1.4;
    }
  }

  for (const item of droppedItems) {
    if (item.collected) continue;
    item.depth = clamp(item.depth - worldDelta, 58, maxDepth + 220);
    item.spin += dt * 5.5;

    const canReachDepth = item.depth <= 180;
    const aligned = Math.abs(item.laneX - state.playerX) < 0.18;
    if (canReachDepth && aligned && !state.hidden) {
      item.collected = true;
      state.itemsCollected += 1;
    }
  }
}

function dropItem() {
  const itemKinds = Object.keys(itemEvidence);
  const kind = itemKinds[Math.floor(Math.random() * itemKinds.length)];
  const evidence = itemEvidence[kind];
  droppedItems.push({
    id: `item-${state.itemsDropped + 1}`,
    kind,
    evidenceScore: state.targetIsCulprit ? evidence.culpritScore : evidence.innocentScore,
    clue: state.targetIsCulprit ? evidence.culpritClue : evidence.innocentClue,
    depth: clamp(state.distance - 85, 240, 780),
    laneX: clamp(state.targetX + (Math.random() - 0.5) * 0.18, -0.48, 0.48),
    spin: Math.random() * Math.PI * 2,
    collected: false,
  });
  state.itemsDropped += 1;
}

function hasCollectibleNearby() {
  return droppedItems.some((item) => {
    return !item.collected && item.depth <= 220 && Math.abs(item.laneX - state.playerX) < 0.28;
  });
}

function findNearCover() {
  const px = state.playerX;
  return covers.find((cover) => {
    const depthNearPlayer = cover.depth > 45 && cover.depth < 230;
    const xNearPlayer = Math.abs(cover.laneX - px) < cover.width + 0.2;
    return depthNearPlayer && xNearPlayer;
  });
}

function wouldHitCover(playerX, worldDelta) {
  return covers.some((cover) => {
    const currentBlocking = isCoverBlockingPlayer(cover, playerX, cover.depth);
    const nextDepth = cover.depth - worldDelta;
    const nextBlocking = isCoverBlockingPlayer(cover, playerX, nextDepth);
    return nextBlocking && (!currentBlocking || isMovingDeeperIntoCover(cover.depth, nextDepth));
  });
}

function wouldHitCoverLaterally(currentX, nextX) {
  return covers.some((cover) => {
    const currentBlocking = isCoverBlockingPlayer(cover, currentX, cover.depth);
    const nextBlocking = isCoverBlockingPlayer(cover, nextX, cover.depth);
    const movingCloser = Math.abs(cover.laneX - nextX) < Math.abs(cover.laneX - currentX);
    return nextBlocking && (!currentBlocking || movingCloser);
  });
}

function isMovingDeeperIntoCover(currentDepth, nextDepth) {
  const playerDepth = 92;
  return Math.abs(nextDepth - playerDepth) < Math.abs(currentDepth - playerDepth);
}

function isCoverBlockingPlayer(cover, playerX, depth) {
  const depthOverlap = depth > 48 && depth < 150;
  const xOverlap = Math.abs(cover.laneX - playerX) < cover.width + coverCollisionWidth(cover.kind);
  return depthOverlap && xOverlap;
}

function coverCollisionWidth(kind) {
  if (kind === "pole") return 0.12;
  if (kind === "vending") return 0.24;
  if (kind === "sign") return 0.2;
  return 0.18;
}

function hasCoverBlockingSight() {
  if (state.hidden && state.nearCover) return true;

  return covers.some((cover) => {
    if (cover.depth < 55 || cover.depth > state.distance - 35) return false;
    const t = cover.depth / state.distance;
    const lineX = state.playerX + (state.targetX - state.playerX) * t;
    const coverReach = cover.width + coverBlockWidth(cover.kind);
    return Math.abs(cover.laneX - lineX) < coverReach;
  });
}

function coverBlockWidth(kind) {
  if (kind === "pole") return 0.06;
  if (kind === "vending") return 0.17;
  if (kind === "sign") return 0.13;
  return 0.12;
}

function buildInvestigationResult() {
  const collected = droppedItems.filter((item) => item.collected);
  const score = collected.reduce((total, item) => total + item.evidenceScore, 0);
  const clues = collected.map((item) => `${itemEvidence[item.kind].label}: ${item.clue}`).join("; ");
  const verdict = state.targetIsCulprit
    ? "Verdict: the target was the culprit."
    : "Verdict: the target was not the culprit.";
  return `${verdict} Evidence score: ${score}. Recovered evidence: ${clues}.`;
}

function endGame(success, label, message) {
  state.ended = true;
  state.running = false;
  stateLabel.textContent = label;
  hintLabel.textContent = message;
  overlay.querySelector("h1").textContent = success ? "ミッションクリア" : "尾行失敗";
  overlay.querySelector("p").textContent = message;
  startGuide.style.display = "none";
  startButton.textContent = "もう一度プレイ";
  overlay.classList.add("visible");
}

function updateHud() {
  const closeness = 1 - (state.distance - 180) / (880 - 180);
  distanceMeter.style.width = `${clamp(closeness, 0, 1) * 100}%`;
  alertMeter.style.width = `${state.alert * 100}%`;
  itemLabel.textContent = `${state.itemsCollected} / ${state.requiredItems}`;
  stateLabel.textContent = state.hidden
    ? "HIDDEN"
    : state.lookDuration > 0
      ? "WATCH"
      : state.warningDuration > 0
        ? "WARNING"
        : "TAILING";
  hintLabel.textContent = state.message;
}

function draw() {
  drawSky();
  drawStreet();
  drawDepthMarks();
  drawLookCone();
  drawWorldObjects();
  drawFirstPersonOverlay();
  requestAnimationFrame(loop);
}

function drawSky() {
  const sky = ctx.createLinearGradient(0, 0, 0, horizonY + 80);
  sky.addColorStop(0, "#27323a");
  sky.addColorStop(0.55, "#554637");
  sky.addColorStop(1, "#d99855");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "rgba(255, 214, 122, 0.7)";
  ctx.beginPath();
  ctx.arc(W * 0.79, 74, 32, 0, Math.PI * 2);
  ctx.fill();

  drawBuildings();
}

function drawBuildings() {
  const colors = ["#252c2f", "#303637", "#22282d", "#383835"];
  const cameraOffset = state.playerX * 95;
  for (let i = 0; i < 12; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = (side < 0 ? i * 46 - 60 : W - i * 44 - 120) - cameraOffset;
    const width = 90 + (i % 4) * 16;
    const height = 150 + (i % 5) * 24;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x, horizonY - height + 28, width, height);
    ctx.fillStyle = "rgba(247, 208, 95, 0.25)";
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        ctx.fillRect(x + 18 + col * 34, horizonY - height + 56 + row * 32, 14, 18);
      }
    }
  }
}

function drawStreet() {
  const road = ctx.createLinearGradient(0, horizonY, 0, H);
  road.addColorStop(0, "#42423a");
  road.addColorStop(1, "#171818");
  const topCenter = roadCenterAt(horizonY);
  const bottomCenter = roadCenterAt(H);
  ctx.fillStyle = road;
  ctx.beginPath();
  ctx.moveTo(topCenter - roadTopHalf, horizonY);
  ctx.lineTo(topCenter + roadTopHalf, horizonY);
  ctx.lineTo(bottomCenter + roadBottomHalf, H);
  ctx.lineTo(bottomCenter - roadBottomHalf, H);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#2b342d";
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(bottomCenter - roadBottomHalf, H);
  ctx.lineTo(topCenter - roadTopHalf, horizonY);
  ctx.lineTo(0, horizonY + 36);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(W, H);
  ctx.lineTo(bottomCenter + roadBottomHalf, H);
  ctx.lineTo(topCenter + roadTopHalf, horizonY);
  ctx.lineTo(W, horizonY + 36);
  ctx.closePath();
  ctx.fill();
}

function drawDepthMarks() {
  ctx.strokeStyle = "rgba(247, 208, 95, 0.46)";
  ctx.lineWidth = 5;
  ctx.setLineDash([28, 36]);
  ctx.beginPath();
  for (let depth = 70; depth < maxDepth; depth += 55) {
    const p = project(depth, 0);
    if (depth === 70) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  for (let depth = 180; depth < maxDepth; depth += 180) {
    const p = project(depth);
    const half = roadHalfWidthAt(p.y);
    const center = roadCenterAt(p.y);
    ctx.strokeStyle = `rgba(245, 241, 223, ${0.08 + p.scale * 0.1})`;
    ctx.lineWidth = 1 + p.scale * 2;
    ctx.beginPath();
    ctx.moveTo(center - half, p.y);
    ctx.lineTo(center + half, p.y);
    ctx.stroke();
  }
}

function drawTarget() {
  const bob = Math.sin(state.elapsed * 7) * 5;
  const p = project(state.distance, state.targetX);
  const size = 155 * p.scale;
  const looking = state.lookDuration > 0;
  const warning = state.warningDuration > 0;
  const paused = state.targetAction === "paused";
  const hurrying = state.targetAction === "hurrying";

  ctx.save();
  ctx.translate(p.x, p.y + bob);
  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.beginPath();
  ctx.ellipse(0, size * 0.68, size * 0.35, size * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#201918";
  ctx.lineWidth = Math.max(4, size * 0.09);
  ctx.beginPath();
  ctx.moveTo(-size * 0.16, size * 0.36);
  ctx.lineTo(-size * (paused ? 0.18 : hurrying ? 0.34 : 0.27), size * 0.72);
  ctx.moveTo(size * 0.14, size * 0.36);
  ctx.lineTo(size * (paused ? 0.17 : hurrying ? 0.32 : 0.24), size * 0.72);
  ctx.stroke();

  ctx.fillStyle = looking ? "#c8463b" : hurrying ? "#3c4d65" : paused ? "#3f3b34" : "#26323b";
  roundRect(-size * 0.28, -size * 0.16, size * 0.56, size * 0.62, size * 0.1);
  ctx.fill();

  ctx.fillStyle = "#d3a376";
  ctx.beginPath();
  ctx.arc(0, -size * 0.32, size * 0.22, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#171313";
  ctx.beginPath();
  if (looking) {
    ctx.arc(-size * 0.07, -size * 0.35, size * 0.025, 0, Math.PI * 2);
    ctx.arc(size * 0.07, -size * 0.35, size * 0.025, 0, Math.PI * 2);
  } else {
    ctx.arc(0, -size * 0.36, size * 0.2, Math.PI, Math.PI * 2);
  }
  ctx.fill();

  if (warning) {
    ctx.strokeStyle = "#f7d05f";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, -size * 0.32, size * 0.34, -0.7, 0.7);
    ctx.stroke();
  }
  if (state.targetAction === "drifting") {
    ctx.strokeStyle = "rgba(247, 208, 95, 0.72)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-size * 0.48, size * 0.1);
    ctx.lineTo(size * 0.48, size * 0.1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWorldObjects() {
  const objects = [
    ...covers.map((cover) => ({ type: "cover", depth: cover.depth, cover })),
    ...droppedItems
      .filter((item) => !item.collected)
      .map((item) => ({ type: "item", depth: item.depth, item })),
    { type: "target", depth: state.distance },
  ];

  objects
    .sort((a, b) => b.depth - a.depth)
    .forEach((object) => {
      if (object.type === "target") {
        drawTarget();
        return;
      }

      if (object.type === "item") {
        drawDroppedItem(object.item);
        return;
      }

      const cover = object.cover;
      const p = project(cover.depth, cover.laneX);
      if (p.y < horizonY || p.y > H + 80) return;
      const active = state.nearCover && state.nearCover.id === cover.id;
      const blocking = state.lookDuration > 0 && coverBlocksSight(cover);
      drawCover(cover, p, active, blocking);
    });
}

function drawDroppedItem(item) {
  const p = project(item.depth, item.laneX);
  if (p.y < horizonY || p.y > H + 90) return;

  const s = p.scale * 1.55;
  const reachable = item.depth <= 180 && Math.abs(item.laneX - state.playerX) < 0.28;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.sin(item.spin) * 0.18);

  ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
  ctx.beginPath();
  ctx.ellipse(0, 16 * s, 42 * s, 14 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  if (item.kind === "wallet") {
    ctx.fillStyle = "#6d3f2c";
    roundRect(-32 * s, -28 * s, 64 * s, 44 * s, 8 * s);
    ctx.fill();
    ctx.fillStyle = "#d8b16a";
    ctx.fillRect(14 * s, -8 * s, 12 * s, 10 * s);
  } else if (item.kind === "key") {
    ctx.strokeStyle = "#f7d05f";
    ctx.lineWidth = Math.max(3, 7 * s);
    ctx.beginPath();
    ctx.arc(-18 * s, -8 * s, 12 * s, 0, Math.PI * 2);
    ctx.moveTo(-4 * s, -8 * s);
    ctx.lineTo(34 * s, -8 * s);
    ctx.moveTo(21 * s, -8 * s);
    ctx.lineTo(21 * s, 7 * s);
    ctx.stroke();
  } else if (item.kind === "card") {
    ctx.fillStyle = "#e7f1ef";
    roundRect(-34 * s, -24 * s, 68 * s, 42 * s, 7 * s);
    ctx.fill();
    ctx.fillStyle = "#1f696d";
    ctx.fillRect(-24 * s, -10 * s, 48 * s, 8 * s);
  } else {
    ctx.fillStyle = "#f1e2ae";
    roundRect(-30 * s, -32 * s, 60 * s, 48 * s, 4 * s);
    ctx.fill();
    ctx.fillStyle = "#383835";
    ctx.fillRect(-18 * s, -16 * s, 36 * s, 5 * s);
    ctx.fillRect(-18 * s, -4 * s, 28 * s, 5 * s);
  }

  if (reachable) {
    ctx.strokeStyle = "#61d394";
    ctx.lineWidth = Math.max(2, 4 * s);
    ctx.beginPath();
    ctx.ellipse(0, 18 * s, 62 * s, 20 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function coverBlocksSight(cover) {
  if (cover.depth < 55 || cover.depth > state.distance - 35) return false;
  const t = cover.depth / state.distance;
  const lineX = state.playerX + (state.targetX - state.playerX) * t;
  return Math.abs(cover.laneX - lineX) < cover.width + coverBlockWidth(cover.kind);
}

function drawCover(cover, p, active, blocking) {
  ctx.save();
  ctx.translate(p.x, p.y);
  const s = p.scale * 1.28;
  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.beginPath();
  ctx.ellipse(0, 8 * s, 84 * s, 24 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  if (cover.kind === "pole") {
    ctx.fillStyle = "#2e3030";
    roundRect(-14 * s, -265 * s, 28 * s, 282 * s, 5 * s);
    ctx.fill();
    ctx.fillStyle = "#f7d05f";
    ctx.fillRect(-26 * s, -172 * s, 52 * s, 12 * s);
  } else if (cover.kind === "postbox") {
    ctx.fillStyle = "#bd2d2d";
    roundRect(-68 * s, -136 * s, 136 * s, 148 * s, 20 * s);
    ctx.fill();
    ctx.fillStyle = "#611a1a";
    ctx.fillRect(-42 * s, -92 * s, 84 * s, 16 * s);
  } else if (cover.kind === "sign") {
    ctx.fillStyle = "#2d2d2a";
    ctx.fillRect(-9 * s, -180 * s, 18 * s, 192 * s);
    ctx.fillStyle = "#e7d7a6";
    roundRect(-76 * s, -245 * s, 152 * s, 82 * s, 10 * s);
    ctx.fill();
    ctx.fillStyle = "#30332f";
    ctx.fillRect(-50 * s, -214 * s, 100 * s, 13 * s);
  } else {
    ctx.fillStyle = "#1f696d";
    roundRect(-82 * s, -230 * s, 164 * s, 244 * s, 14 * s);
    ctx.fill();
    ctx.fillStyle = "#e7f1ef";
    ctx.fillRect(-56 * s, -194 * s, 112 * s, 92 * s);
    ctx.fillStyle = "#f7d05f";
    ctx.fillRect(32 * s, -82 * s, 29 * s, 42 * s);
  }

  if (active || blocking) {
    ctx.strokeStyle = state.hidden || blocking ? "#61d394" : "#f7d05f";
    ctx.lineWidth = Math.max(2, 5 * s);
    ctx.beginPath();
    ctx.ellipse(0, 14 * s, 112 * s, 32 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (active) {
    ctx.fillStyle = "rgba(19, 20, 17, 0.78)";
    roundRect(-86 * s, -292 * s, 172 * s, 38 * s, 7 * s);
    ctx.fill();
    ctx.fillStyle = state.hidden ? "#61d394" : "#f7d05f";
    ctx.font = `${Math.max(12, 19 * s)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(state.hidden ? "HIDDEN" : "SPACE", 0, -266 * s);
  }
  ctx.restore();
}

function drawFirstPersonOverlay() {
  const sway = Math.sin(state.elapsed * 5.2) * (state.hidden ? 1.4 : 4);
  const crouch = state.hidden ? 28 : 0;
  const sideLean = state.playerX * 34;

  const shadow = ctx.createLinearGradient(0, H - 250, 0, H);
  shadow.addColorStop(0, "rgba(0, 0, 0, 0)");
  shadow.addColorStop(0.6, state.hidden ? "rgba(3, 18, 12, 0.58)" : "rgba(0, 0, 0, 0.42)");
  shadow.addColorStop(1, "rgba(0, 0, 0, 0.84)");
  ctx.fillStyle = shadow;
  ctx.fillRect(0, H - 250, W, 250);

  ctx.save();
  ctx.translate(sideLean, crouch + sway);

  ctx.fillStyle = state.hidden ? "rgba(12, 34, 22, 0.92)" : "rgba(18, 20, 19, 0.88)";
  ctx.beginPath();
  ctx.ellipse(W * 0.5, H + 52, 260, 118, 0, Math.PI, Math.PI * 2);
  ctx.fill();

  drawHand(W * 0.21, H - 38, -0.28, state.hidden);
  drawHand(W * 0.79, H - 38, 0.28, state.hidden);

  if (state.hidden) {
    ctx.fillStyle = "rgba(8, 20, 13, 0.62)";
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, H - 260);
    ctx.quadraticCurveTo(155, H - 170, 190, H);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W, H);
    ctx.lineTo(W, H - 260);
    ctx.quadraticCurveTo(W - 155, H - 170, W - 190, H);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawHand(x, y, tilt, hidden) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);

  ctx.fillStyle = hidden ? "rgba(34, 54, 39, 0.96)" : "rgba(39, 34, 30, 0.94)";
  roundRect(-72, -12, 144, 44, 22);
  ctx.fill();

  ctx.fillStyle = hidden ? "rgba(84, 116, 81, 0.86)" : "rgba(199, 144, 101, 0.86)";
  roundRect(-45, -34, 90, 38, 19);
  ctx.fill();

  ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
  for (let i = -2; i <= 2; i += 1) {
    roundRect(i * 17 - 5, -42, 10, 36, 5);
    ctx.fill();
  }
  ctx.restore();
}

function drawLookCone() {
  if (state.lookDuration <= 0) return;
  const target = project(state.distance, state.targetX);
  const playerY = H - 46;
  const playerRoadCenter = roadCenterAt(playerY);
  const playerRoadHalf = roadHalfWidthAt(playerY);
  const gradient = ctx.createLinearGradient(0, target.y, 0, H);
  gradient.addColorStop(0, "rgba(255, 95, 79, 0.02)");
  gradient.addColorStop(1, "rgba(255, 95, 79, 0.25)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(target.x, target.y - 20);
  ctx.lineTo(playerRoadCenter - playerRoadHalf * 0.74, playerY);
  ctx.lineTo(playerRoadCenter + playerRoadHalf * 0.74, playerY);
  ctx.closePath();
  ctx.fill();
}

function roundRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

let last = performance.now();
function loop(now = performance.now()) {
  const dt = Math.min(0.04, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
}

window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (event.code === "Space") {
    event.preventDefault();
    if (!state.running && !state.ended) resetGame();
    state.hidden = Boolean(state.nearCover);
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
  if (event.code === "Space") state.hidden = false;
});

startButton.addEventListener("click", resetGame);

updateHud();
loop();
