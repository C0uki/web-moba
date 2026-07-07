// ---- DOM UI ----
'use strict';

const UI = {
  els: {},
  feedVer: -1,
  shopOpen: false,
  overShown: false,

  $(id) { return document.getElementById(id); },

  cache() {
    const ids = ['topbar', 'score-blue', 'score-red', 'game-timer', 'feed', 'center-msg',
      'respawn-note', 'hud', 'p-letter', 'p-level', 'hpfill', 'hptext', 'manafill',
      'manatext', 'xpfill', 'abilities', 'stat-gold', 'stat-kda', 'stat-cs', 'shop-btn',
      'shop', 'shop-note', 'shop-items', 'shop-stats', 'help', 'hint', 'pause-overlay',
      'overlay-select', 'hero-cards', 'overlay-over', 'over-title', 'over-stats', 'restart-btn',
      'lane-picker'];
    for (const id of ids) this.els[id] = this.$(id);
  },

  // ---- ヒーロー選択 ----
  showHeroSelect(onPick) {
    this.cache();
    let selectedLane = 'mid';
    const laneBtns = this.els['lane-picker'].querySelectorAll('.lane-btn');
    laneBtns.forEach(btn => {
      if (btn.dataset.lane === selectedLane) btn.classList.add('active');
      btn.addEventListener('click', () => {
        selectedLane = btn.dataset.lane;
        laneBtns.forEach(b => b.classList.toggle('active', b === btn));
      });
    });

    const wrap = this.els['hero-cards'];
    wrap.innerHTML = '';
    for (const key of HERO_KEYS) {
      const d = HEROES[key];
      const card = document.createElement('button');
      card.className = 'hero-card';
      card.innerHTML = `
        <div class="hc-avatar" style="background:${d.color}">${d.letter}</div>
        <h2>${d.name}</h2>
        <div class="hc-title">${d.title}</div>
        <div class="hc-desc">${d.desc}</div>
        <div class="hc-ab">${d.abilities.map(a => `<b>${a.key}</b>${a.name}: ${a.desc}`).join('<br>')}</div>
      `;
      card.addEventListener('click', () => {
        SFX.init();
        SFX.play('buy');
        this.els['overlay-select'].classList.add('hidden');
        onPick(key, selectedLane);
      });
      wrap.appendChild(card);
    }
  },

  // ---- HUD 初期化 ----
  initHUD(game) {
    const p = game.player;
    this.els['topbar'].classList.remove('hidden');
    this.els['feed'].classList.remove('hidden');
    this.els['hud'].classList.remove('hidden');
    this.els['hint'].classList.remove('hidden');

    this.els['p-letter'].textContent = p.def.letter;
    this.els['p-letter'].style.color = p.def.color;

    // スキルスロット
    const ab = this.els['abilities'];
    ab.innerHTML = '';
    this.slotEls = [];
    p.def.abilities.forEach((a, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot' + (a.key === 'R' ? ' ultimate' : '');
      slot.title = `${a.name} (CD ${a.cd}秒 / マナ ${a.mana})\n${a.desc}`;
      slot.innerHTML = `<span class="ab-key">${a.key}</span><span class="ab-mana">${a.mana}</span><span class="ab-cd hidden"></span>`;
      ab.appendChild(slot);
      this.slotEls.push({ el: slot, cd: slot.querySelector('.ab-cd') });
    });

    // ショップ
    this.buildShop(game);
    this.els['shop-btn'].addEventListener('click', () => this.toggleShop(game));
    this.els['restart-btn'].addEventListener('click', () => location.reload());
  },

  buildShop(game) {
    const wrap = this.els['shop-items'];
    wrap.innerHTML = '';
    this.shopBtns = [];
    for (const it of ITEMS) {
      const btn = document.createElement('button');
      btn.className = 'shop-item';
      btn.innerHTML = `
        <div class="si-name"><span class="si-icon">${it.icon}</span>${it.name} <span class="si-own"></span></div>
        <div class="si-desc">${it.desc}</div>
        <div class="si-cost">${it.cost} G</div>
      `;
      btn.addEventListener('click', () => game.buyItem(it.id));
      wrap.appendChild(btn);
      this.shopBtns.push({ btn, it, own: btn.querySelector('.si-own') });
    }
  },

  toggleShop(game) {
    this.shopOpen = !this.shopOpen;
    this.els['shop'].classList.toggle('hidden', !this.shopOpen);
    if (this.shopOpen) this.updateShop(game);
  },

  toggleHelp() {
    this.els['help'].classList.toggle('hidden');
  },

  updateShop(game) {
    const p = game.player;
    const can = game.canShop();
    this.els['shop-note'].textContent = can ? '' : '※ 自陣の泉に戻ると購入できます (B)';
    for (const s of this.shopBtns) {
      s.btn.disabled = !can || p.gold < s.it.cost;
      const n = p.items.filter(id => id === s.it.id).length;
      s.own.textContent = n > 0 ? `×${n}` : '';
    }
    this.els['shop-stats'].textContent =
      `攻撃力 ${Math.round(p.ad)} / 魔力 ${Math.round(p.power)} / 防御 ${Math.round(p.armor)} / ` +
      `移動速度 ${Math.round(p.speed)} / 攻撃速度 +${Math.round((p.atkSpeedMult - 1) * 100)}% / 吸血 ${Math.round(p.lifesteal * 100)}%`;
  },

  // ---- 毎フレーム更新 ----
  update(game) {
    const p = game.player;

    // 上部バー
    this.els['score-blue'].textContent = game.kills.blue;
    this.els['score-red'].textContent = game.kills.red;
    this.els['game-timer'].textContent = formatTime(game.time);

    // HP/マナ/XP
    this.els['hpfill'].style.width = (p.hp / p.maxHp * 100) + '%';
    this.els['hptext'].textContent = `${Math.ceil(p.hp)} / ${Math.ceil(p.maxHp)}`;
    this.els['manafill'].style.width = (p.mana / p.maxMana * 100) + '%';
    this.els['manatext'].textContent = `${Math.ceil(p.mana)} / ${Math.ceil(p.maxMana)}`;
    this.els['xpfill'].style.width =
      (p.level >= CONFIG.MAX_LEVEL ? 100 : p.xp / p.xpNeed() * 100) + '%';
    this.els['p-level'].textContent = p.level;

    // スキルCD
    p.def.abilities.forEach((a, i) => {
      const s = this.slotEls[i];
      const cd = p.cds[i];
      if (cd > 0) {
        s.cd.classList.remove('hidden');
        s.cd.textContent = cd > 1 ? Math.ceil(cd) : cd.toFixed(1);
      } else {
        s.cd.classList.add('hidden');
      }
      s.el.classList.toggle('nomana', p.mana < a.mana);
    });

    // ステータス
    this.els['stat-gold'].firstChild.textContent = Math.floor(p.gold) + ' ';
    this.els['stat-kda'].textContent = `${p.kills} / ${p.deaths}`;
    this.els['stat-cs'].textContent = `CS ${p.cs}`;

    // キルフィード
    if (game.feedVer !== this.feedVer) {
      this.feedVer = game.feedVer;
      this.els['feed'].innerHTML = game.feedList
        .map(f => `<div class="msg" style="color:${f.color}">${f.txt}</div>`)
        .join('');
    }

    // センターメッセージ
    const cm = this.els['center-msg'];
    if (game.centerMsg) {
      cm.textContent = game.centerMsg.txt;
      cm.style.opacity = Math.min(1, game.centerMsg.ttl / 0.5);
    } else {
      cm.textContent = '';
    }

    // リスポーン表示
    const rn = this.els['respawn-note'];
    if (p.dead && !game.over) {
      rn.classList.remove('hidden');
      rn.textContent = `リスポーンまで ${Math.ceil(p.respawnT)} 秒`;
    } else {
      rn.classList.add('hidden');
    }

    if (this.shopOpen) this.updateShop(game);

    // 一時停止
    this.els['pause-overlay'].classList.toggle('hidden', !game.paused);

    // ゲーム終了
    if (game.over && !this.overShown) {
      this.overShown = true;
      const win = game.winner === 'blue';
      const t = this.els['over-title'];
      t.textContent = win ? '勝利!' : '敗北…';
      t.className = win ? 'win' : 'lose';
      this.els['over-stats'].textContent =
        `${p.kills} キル / ${p.deaths} デス / CS ${p.cs} / Lv${p.level} / 試合時間 ${formatTime(game.time)}`;
      this.els['overlay-over'].classList.remove('hidden');
    }
  },
};
