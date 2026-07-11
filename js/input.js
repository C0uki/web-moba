// ---- 入力処理 ----
'use strict';

// タッチデバイス判定 (スマホ/タブレット)
const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// タッチ操作の共有状態 (updateTouchInputが毎フレーム参照)
const TOUCH = {
  enabled: false,
  joy: { active: false, dx: 0, dy: 0, id: null },
  lastDir: { x: 1, y: -1 },  // スキルの照準フォールバック用 (敵陣方向で初期化)
  btns: [],
};

function setupInput(game, canvas) {
  const mouse = { sx: 0, sy: 0 };

  function mouseWorld() {
    return Renderer.screenToWorld(game, mouse.sx, mouse.sy);
  }

  function issueOrderAt(sx, sy) {
    const p = game.player;
    if (p.dead || game.over) return;

    // ミニマップ上なら移動指示
    const mm = Renderer.minimapToWorld(sx, sy);
    if (mm) {
      p.recallT = null;
      p.order = { type: 'move', x: mm.x, y: mm.y };
      return;
    }

    const w = Renderer.screenToWorld(game, sx, sy);
    // カーソル下の敵を探す
    let target = null, bd = Infinity;
    for (const u of game.units) {
      if (u.team !== enemyOf(p.team) || u.dead) continue;
      if (u.kind === 'hero' && u.stealth && !isRevealed(game, u)) continue;
      const d = distXY(w.x, w.y, u.x, u.y);
      if (d < u.radius + 26 && d < bd) { bd = d; target = u; }
    }
    p.recallT = null;
    if (target) {
      p.order = { type: 'attack', target };
      game.addEffect({ kind: 'click', x: target.x, y: target.y, ttl: 0.35, color: '#ff6b6b' });
    } else {
      p.order = { type: 'move', x: w.x, y: w.y };
      game.addEffect({ kind: 'click', x: w.x, y: w.y, ttl: 0.35, color: '#8bc34a' });
    }
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('mousedown', e => {
    SFX.init();
    if (e.button === 0 || e.button === 2) {
      issueOrderAt(e.clientX, e.clientY);
    }
  });

  window.addEventListener('mousemove', e => {
    mouse.sx = e.clientX;
    mouse.sy = e.clientY;
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const cam = game.camera;
    cam.zoom = clamp(cam.zoom * (e.deltaY > 0 ? 0.9 : 1.11), 0.55, 1.5);
  }, { passive: false });

  window.addEventListener('keydown', e => {
    const p = game.player;
    const key = e.key.toLowerCase();

    if (key === 'escape') {
      game.paused = !game.paused;
      return;
    }
    if (game.paused) return;

    switch (key) {
      case 'q': case 'w': case 'e': case 'r': {
        const idx = { q: 0, w: 1, e: 2, r: 3 }[key];
        const w = mouseWorld();
        game.castAbility(p, idx, w.x, w.y);
        break;
      }
      case 'a': {
        if (p.dead || game.over) break;
        const w = mouseWorld();
        p.recallT = null;
        p.order = { type: 'amove', x: w.x, y: w.y };
        game.addEffect({ kind: 'click', x: w.x, y: w.y, ttl: 0.35, color: '#ffd54f' });
        break;
      }
      case 's':
        if (p.dead) break;
        p.order = null;
        p.recallT = null;
        break;
      case 'b': {
        if (p.dead || game.over || p.recallT != null) break;
        if (distU(p, game.nexus[p.team]) <= CONFIG.FOUNTAIN_R) break; // 既に泉
        p.order = null;
        p.recallT = CONFIG.RECALL_TIME;
        SFX.play('recall');
        break;
      }
      case 'p':
        UI.toggleShop(game);
        break;
      case 'h':
        UI.toggleHelp();
        break;
      case 'm':
        SFX.muted = !SFX.muted;
        game.msg(SFX.muted ? 'ミュート ON' : 'ミュート OFF', 1.2);
        break;
    }
  });

  if (IS_TOUCH) setupTouch(game, canvas, issueOrderAt);
}

// ---- タッチ操作 (スマホ用) ----
function setupTouch(game, canvas, issueOrderAt) {
  TOUCH.enabled = true;
  Renderer.mobile = true;
  document.body.classList.add('mobile');

  const joyEl = document.getElementById('joystick');
  const knobEl = document.getElementById('joy-knob');
  const padEl = document.getElementById('skill-pad');
  joyEl.classList.remove('hidden');
  padEl.classList.remove('hidden');

  // --- バーチャルジョイスティック ---
  const JOY_R = 48;
  function joyCenter() {
    const r = joyEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function setJoy(cx, cy) {
    const c = joyCenter();
    let dx = cx - c.x, dy = cy - c.y;
    const len = Math.hypot(dx, dy);
    if (len > JOY_R) { dx = dx / len * JOY_R; dy = dy / len * JOY_R; }
    knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    if (len > 8) {
      TOUCH.joy.dx = dx / JOY_R;
      TOUCH.joy.dy = dy / JOY_R;
      const n = norm(dx, dy);
      if (n) TOUCH.lastDir = { x: n.x, y: n.y };
    } else {
      TOUCH.joy.dx = 0; TOUCH.joy.dy = 0;
    }
  }
  function resetJoy() {
    TOUCH.joy.active = false;
    TOUCH.joy.id = null;
    TOUCH.joy.dx = 0; TOUCH.joy.dy = 0;
    knobEl.style.transform = 'translate(-50%, -50%)';
    const p = game.player;
    if (p && !p.dead && p.order && p.order.type === 'move') p.order = null;
  }
  joyEl.addEventListener('touchstart', e => {
    e.preventDefault();
    SFX.init();
    const t = e.changedTouches[0];
    TOUCH.joy.active = true;
    TOUCH.joy.id = t.identifier;
    setJoy(t.clientX, t.clientY);
  }, { passive: false });
  joyEl.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === TOUCH.joy.id) setJoy(t.clientX, t.clientY);
    }
  }, { passive: false });
  joyEl.addEventListener('touchend', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === TOUCH.joy.id) resetJoy();
    }
  }, { passive: false });
  joyEl.addEventListener('touchcancel', resetJoy);

  // --- スキルの自動照準: 最寄りの敵ヒーロー優先、次に敵ミニオン ---
  function autoAimPoint(idx) {
    const p = game.player;
    const ab = p.def.abilities[idx];
    const rng = Math.max((ab.ai && ab.ai.range) || 0, 400);
    let best = null, bestKey = Infinity;
    for (const u of game.units) {
      if (u.team !== enemyOf(p.team) || u.dead) continue;
      if (u.kind !== 'hero' && u.kind !== 'minion') continue;
      if (u.kind === 'hero' && u.stealth && !isRevealed(game, u)) continue;
      const d = distU(p, u);
      if (d > Math.max(rng, 620)) continue;
      const key = (u.kind === 'hero' ? 0 : 10000) + d;
      if (key < bestKey) { bestKey = key; best = u; }
    }
    if (best) return { x: best.x, y: best.y };
    return { x: p.x + TOUCH.lastDir.x * 400, y: p.y + TOUCH.lastDir.y * 400 };
  }

  // --- スキル/攻撃/リコールボタン ---
  padEl.querySelectorAll('.tbtn[data-ab]').forEach(btn => {
    const idx = Number(btn.dataset.ab);
    TOUCH.btns[idx] = { el: btn, cd: btn.querySelector('.tcd') };
    btn.addEventListener('touchstart', e => {
      e.preventDefault();
      SFX.init();
      const aim = autoAimPoint(idx);
      game.castAbility(game.player, idx, aim.x, aim.y);
    }, { passive: false });
  });

  document.getElementById('tbtn-atk').addEventListener('touchstart', e => {
    e.preventDefault();
    SFX.init();
    const p = game.player;
    if (p.dead || game.over) return;
    const t = p.acquire(game, 800);
    p.recallT = null;
    if (t) {
      p.order = { type: 'attack', target: t };
      game.addEffect({ kind: 'click', x: t.x, y: t.y, ttl: 0.35, color: '#ff6b6b' });
    } else {
      p.order = { type: 'amove', x: p.x + TOUCH.lastDir.x * 500, y: p.y + TOUCH.lastDir.y * 500 };
    }
  }, { passive: false });

  document.getElementById('tbtn-recall').addEventListener('touchstart', e => {
    e.preventDefault();
    const p = game.player;
    if (p.dead || game.over || p.recallT != null) return;
    if (distU(p, game.nexus[p.team]) <= CONFIG.FOUNTAIN_R) return;
    p.order = null;
    p.recallT = CONFIG.RECALL_TIME;
    SFX.play('recall');
  }, { passive: false });

  // --- キャンバスのタップ/ドラッグ = 移動・攻撃指示、2本指ピンチ = ズーム ---
  let pinch = null;
  let dragT = 0;
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    SFX.init();
    if (e.touches.length >= 2) {
      const [a, b] = e.touches;
      pinch = { d0: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY), z0: game.camera.zoom };
      return;
    }
    const t = e.changedTouches[0];
    issueOrderAt(t.clientX, t.clientY);
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (pinch && e.touches.length >= 2) {
      const [a, b] = e.touches;
      const d = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      game.camera.zoom = clamp(pinch.z0 * d / Math.max(1, pinch.d0), 0.55, 1.5);
      return;
    }
    // ドラッグ中は指の位置へ移動指示を出し続ける (0.1秒間隔)
    const now = performance.now();
    if (now - dragT > 100) {
      dragT = now;
      const t = e.changedTouches[0];
      issueOrderAt(t.clientX, t.clientY);
    }
  }, { passive: false });
  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    if (e.touches.length < 2) pinch = null;
  }, { passive: false });
}

// 毎フレーム呼ばれる: ジョイスティック移動の反映とボタンのCD表示更新
function updateTouchInput(game) {
  if (!TOUCH.enabled || !game || game.over) return;
  const p = game.player;

  if (TOUCH.joy.active && !p.dead && (TOUCH.joy.dx || TOUCH.joy.dy)) {
    p.recallT = null;
    p.order = {
      type: 'move',
      x: clamp(p.x + TOUCH.joy.dx * 400, 30, CONFIG.WORLD - 30),
      y: clamp(p.y + TOUCH.joy.dy * 400, 30, CONFIG.WORLD - 30),
    };
  }

  for (let i = 0; i < TOUCH.btns.length; i++) {
    const b = TOUCH.btns[i];
    if (!b) continue;
    const cd = p.cds[i];
    if (cd > 0) {
      b.cd.classList.remove('hidden');
      b.cd.textContent = cd > 1 ? Math.ceil(cd) : cd.toFixed(1);
    } else {
      b.cd.classList.add('hidden');
    }
    const ab = p.def.abilities[i];
    b.el.classList.toggle('nomana', ab && p.mana < ab.mana);
  }
}
