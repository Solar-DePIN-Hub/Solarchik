'use strict';
// Plate export driver: renders one frame of the scene into the canvas (no HTML UI overlay).
const params = Object.fromEntries(new URLSearchParams(location.search));
window.STATE = { scene: params.scene || 'day', lang: params.lang || 'uk', alerts: false, t: +(params.t || 0), fly: 0, doorOpen: 0, tap: null, solSide: false, blink: false, reduced: true, portal: 0 };
(async () => {
  const c = document.getElementById('c'); c.width = W; c.height = HT;
  document.getElementById('stage').style.width = W + 'px'; document.getElementById('stage').style.height = HT + 'px';
  await loadArt();
  await Promise.all(['500 20px Manrope', '700 20px Manrope', '800 20px Manrope', '700 20px Unbounded'].map(f => document.fonts.load(f)));
  await document.fonts.ready;
  renderScene(c.getContext('2d'), window.STATE);
  window.READY = true;
})().catch(e => { window.READY = 'error:' + e; });
