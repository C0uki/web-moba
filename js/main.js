// ---- エントリポイント ----
'use strict';

let game = null;

// canvas以外(HUDやショップ等)で右クリックしてもブラウザメニューを出さない
document.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('load', () => {
  const canvas = document.getElementById('game');
  Renderer.init(canvas);

  UI.showHeroSelect((heroKey, lane) => {
    game = new Game(heroKey, lane);
    UI.initHUD(game);
    setupInput(game, canvas);
    startLoop();
  });
});

function startLoop() {
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!game.paused) game.update(dt);
    Renderer.draw(game);
    UI.update(game);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
