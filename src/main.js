const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const distanceMeter = document.getElementById("distanceMeter");
const alertMeter = document.getElementById("alertMeter");
const stateLabel = document.getElementById("stateLabel");
const hintLabel = document.getElementById("hintLabel");
const overlay = document.getElementById("overlay");
const startButton = document.getElementById("startButton");

const keys = new Set();
const W = canvas.width;
const H = canvas.height;
const horizonY = 170;
const roadBottomHalf = 610;
const roadTopHalf = 112;
const maxDepth = 1180;
const minSafeDistance = 260;
const maxSafeDistance = 720;

const state = {
  running: false,
  ended: false,
  playerX: -0.34,
  distance: 540,
  targetDepth: 760,
  targetX: 0,
  targetSpeed: 46,
  progress: 0,
  requiredProgress: 1200,
  alert: 0,
  suspicion: 0,
  lookTimer: 3.2,
  lookDuration: 0,
  warningDuration: 0,
  hidden: false,
  nearCover: null,
  message: "Move with WASD / Arrows. Hide with Space.",
  elapsed: 0,
};

const covers = [
  { id: "pole-1", kind: "pole", side: -1, depth: 280, laneX: -0.64, width: 0.09 },
  { id: "post-1", kind: "postbox", side: 1, depth: 420, laneX: 0.55, width: 0.17 },
  { id: "sign-1", kind: "sign", side: -1, depth: 620, laneX: -0.76, width: 0.18 },
  { id: "vending-1", kind: "vending", side: 1, depth: 820, laneX: 0.72, width: 0.26 },
  { id: "pole-2", kind: "pole", side: 1, depth: 1040, laneX: 0.66, width: 0.08 },
  { id: "post-2", kind: "postbox", side: -1, depth: 1220, laneX: -0.58, width: 0.16 },
];

function resetGame() {
  state.running = true;
  state.ended = false;
  state.playerX = -0.34;
  state.distance = 540;
  state.progress = 0;
  state.alert = 0;
  state.suspicion = 0;
  state.lookTimer = 3.0;
  state.lookDuration = 0;
  state.warningDuration = 0;
  state.hidden = false;
  state.nearCover = null;
  state.elapsed = 0;
  state.message = "Keep the target in range.";
  overlay.classList.remove("visible");
}

function depthScale(depth) {
  return Math.max(0.12, 1 - depth / maxDepth);
}

function roadHalfWidthAt(y) {
  const t = (y - horizonY) / (H - horizonY);
  return roadTopHalf + (roadBottomHalf - roadTopHalf) * Math.max(0, Math.min(1, t));
}

function project(depth, laneX = 0) {
  const t = 1 - depth / maxDepth;
  const y = horizonY + Math.pow(t, 1.72) * (H - horizonY);
  const half = roadHalfWidthAt(y);
  return { x: W / 2 + laneX * half, y, scale: depthScale(depth), half };
}

function playerScreenX() {
  return W / 2 + state.playerX * roadBottomHalf;
}

function wrapCovers(dt) {
  for (const cover of covers) {
    cover.depth -= state.targetSpeed * dt;
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
  state.progress += dt * 34;
  state.nearCover = findNearCover();
  state.hidden = Boolean(state.hidden && state.nearCover);

  const horizontal = axis("ArrowRight", "KeyD") - axis("ArrowLeft", "KeyA");
  const forward = axis("ArrowUp", "KeyW") - axis("ArrowDown", "KeyS");
  if (!state.hidden) {
    state.playerX += horizontal * dt * 0.85;
    state.distance -= forward * dt * 160;
  }
  state.playerX = clamp(state.playerX, -0.88, 0.88);
  state.distance = clamp(state.distance, 180, 880);

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
  const visibleWhileLooking = state.lookDuration > 0 && !state.hidden && Math.abs(state.playerX) < 0.72;
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
  } else if (state.lookDuration > 0) {
    state.message = "Break line of sight.";
  } else if (state.nearCover) {
    state.message = "Cover available. Hold Space.";
  } else {
    state.message = "Keep the target in range.";
  }

  if (state.alert >= 1) endGame(false, "CAUGHT", "The target noticed you.");
  if (state.progress >= state.requiredProgress) endGame(true, "CLEAR", "You reached the destination unseen.");

  wrapCovers(dt);
  updateHud();
}

function axis(primary, secondary) {
  return keys.has(primary) || keys.has(secondary) ? 1 : 0;
}

function findNearCover() {
  const px = state.playerX;
  return covers.find((cover) => {
    const depthNearPlayer = Math.abs(cover.depth - state.distance) < 95;
    const xNearPlayer = Math.abs(cover.laneX - px) < cover.width + 0.18;
    return depthNearPlayer && xNearPlayer;
  });
}

function endGame(success, label, message) {
  state.ended = true;
  state.running = false;
  stateLabel.textContent = label;
  hintLabel.textContent = message;
  overlay.querySelector("h1").textContent = success ? "Mission Clear" : "Exposed";
  overlay.querySelector("p").textContent = message;
  startButton.textContent = "Retry";
  overlay.classList.add("visible");
}

function updateHud() {
  const distanceScore = 1 - Math.abs(state.distance - 520) / 360;
  distanceMeter.style.width = `${clamp(distanceScore, 0, 1) * 100}%`;
  alertMeter.style.width = `${state.alert * 100}%`;
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
  drawPlayerCue();
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
  for (let i = 0; i < 12; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side < 0 ? i * 46 - 60 : W - i * 44 - 120;
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
  ctx.fillStyle = road;
  ctx.beginPath();
  ctx.moveTo(W / 2 - roadTopHalf, horizonY);
  ctx.lineTo(W / 2 + roadTopHalf, horizonY);
  ctx.lineTo(W / 2 + roadBottomHalf, H);
  ctx.lineTo(W / 2 - roadBottomHalf, H);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#2b342d";
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(W / 2 - roadBottomHalf, H);
  ctx.lineTo(W / 2 - roadTopHalf, horizonY);
  ctx.lineTo(0, horizonY + 36);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(W, H);
  ctx.lineTo(W / 2 + roadBottomHalf, H);
  ctx.lineTo(W / 2 + roadTopHalf, horizonY);
  ctx.lineTo(W, horizonY + 36);
  ctx.closePath();
  ctx.fill();
}

function drawDepthMarks() {
  ctx.strokeStyle = "rgba(247, 208, 95, 0.46)";
  ctx.lineWidth = 5;
  ctx.setLineDash([28, 36]);
  ctx.beginPath();
  ctx.moveTo(W / 2, H);
  ctx.lineTo(W / 2, horizonY);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let depth = 180; depth < maxDepth; depth += 180) {
    const p = project(depth);
    const half = roadHalfWidthAt(p.y);
    ctx.strokeStyle = `rgba(245, 241, 223, ${0.08 + p.scale * 0.1})`;
    ctx.lineWidth = 1 + p.scale * 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 - half, p.y);
    ctx.lineTo(W / 2 + half, p.y);
    ctx.stroke();
  }
}

function drawTarget() {
  const bob = Math.sin(state.elapsed * 7) * 5;
  const p = project(state.targetDepth, state.targetX);
  const size = 120 * p.scale;
  const looking = state.lookDuration > 0;
  const warning = state.warningDuration > 0;

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
  ctx.lineTo(-size * 0.27, size * 0.72);
  ctx.moveTo(size * 0.14, size * 0.36);
  ctx.lineTo(size * 0.24, size * 0.72);
  ctx.stroke();

  ctx.fillStyle = looking ? "#c8463b" : "#26323b";
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
  ctx.restore();
}

function drawWorldObjects() {
  const objects = [
    ...covers.map((cover) => ({ type: "cover", depth: cover.depth, cover })),
    { type: "target", depth: state.targetDepth },
  ];

  objects
    .sort((a, b) => b.depth - a.depth)
    .forEach((object) => {
      if (object.type === "target") {
        drawTarget();
        return;
      }

      const cover = object.cover;
      const p = project(cover.depth, cover.laneX);
      if (p.y < horizonY || p.y > H + 80) return;
      const active = state.nearCover && state.nearCover.id === cover.id;
      drawCover(cover, p, active);
    });
}

function drawCover(cover, p, active) {
  ctx.save();
  ctx.translate(p.x, p.y);
  const s = p.scale;
  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.beginPath();
  ctx.ellipse(0, 8 * s, 70 * s, 20 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  if (cover.kind === "pole") {
    ctx.fillStyle = "#2e3030";
    roundRect(-10 * s, -220 * s, 20 * s, 235 * s, 4 * s);
    ctx.fill();
    ctx.fillStyle = "#f7d05f";
    ctx.fillRect(-18 * s, -140 * s, 36 * s, 9 * s);
  } else if (cover.kind === "postbox") {
    ctx.fillStyle = "#bd2d2d";
    roundRect(-52 * s, -105 * s, 104 * s, 114 * s, 16 * s);
    ctx.fill();
    ctx.fillStyle = "#611a1a";
    ctx.fillRect(-32 * s, -70 * s, 64 * s, 12 * s);
  } else if (cover.kind === "sign") {
    ctx.fillStyle = "#2d2d2a";
    ctx.fillRect(-7 * s, -140 * s, 14 * s, 150 * s);
    ctx.fillStyle = "#e7d7a6";
    roundRect(-58 * s, -190 * s, 116 * s, 62 * s, 8 * s);
    ctx.fill();
    ctx.fillStyle = "#30332f";
    ctx.fillRect(-38 * s, -165 * s, 76 * s, 10 * s);
  } else {
    ctx.fillStyle = "#1f696d";
    roundRect(-62 * s, -175 * s, 124 * s, 186 * s, 12 * s);
    ctx.fill();
    ctx.fillStyle = "#e7f1ef";
    ctx.fillRect(-42 * s, -148 * s, 84 * s, 70 * s);
    ctx.fillStyle = "#f7d05f";
    ctx.fillRect(24 * s, -62 * s, 22 * s, 32 * s);
  }

  if (active) {
    ctx.strokeStyle = state.hidden ? "#61d394" : "#f7d05f";
    ctx.lineWidth = Math.max(2, 5 * s);
    ctx.beginPath();
    ctx.ellipse(0, 14 * s, 92 * s, 26 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlayerCue() {
  const x = playerScreenX();
  ctx.fillStyle = state.hidden ? "rgba(97, 211, 148, 0.9)" : "rgba(245, 241, 223, 0.9)";
  ctx.beginPath();
  ctx.moveTo(x, H - 78);
  ctx.lineTo(x - 22, H - 36);
  ctx.lineTo(x + 22, H - 36);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(245, 241, 223, 0.2)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, H - 32);
  ctx.lineTo(x, H);
  ctx.stroke();
}

function drawLookCone() {
  if (state.lookDuration <= 0) return;
  const target = project(state.targetDepth, state.targetX);
  const playerY = H - 46;
  const gradient = ctx.createLinearGradient(0, target.y, 0, H);
  gradient.addColorStop(0, "rgba(255, 95, 79, 0.02)");
  gradient.addColorStop(1, "rgba(255, 95, 79, 0.25)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(target.x, target.y - 20);
  ctx.lineTo(W / 2 - roadBottomHalf * 0.74, playerY);
  ctx.lineTo(W / 2 + roadBottomHalf * 0.74, playerY);
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
