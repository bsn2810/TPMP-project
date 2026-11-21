/* =====================================================================
 * sliders.js — a range slider for every numeric input.
 *
 * Each slider works in SI units, so switching a display unit (mm ↔ µm,
 * Pa·s ↔ mPa·s) never moves the physical value. The number box next to
 * the slider stays editable for exact values; slider and box are kept in sync.
 * Wide-range quantities (d, µ) use logarithmic sliders.
 * ===================================================================== */
(function (PS) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const RES = 1000;   // slider resolution (positions)

  /**
   * id: number-input id · min/max: slider range in SI · log: logarithmic scale
   * step: rounding step in SI (linear sliders) · siPer(): SI value of one display unit
   * fmtEnd: label for the range ends
   */
  const CONFIG = [
    { id: 'd', min: 1e-6, max: 0.05, log: true,
      siPer: () => ($('dUnit').value === 'um' ? 1e-6 : 1e-3), ends: ['1 µm', '50 mm'] },
    { id: 'rhoP', min: 100, max: 12000, step: 10, siPer: () => 1, ends: ['100', '12 000 kg/m³'] },
    { id: 'psi', min: 0.3, max: 1, step: 0.01, siPer: () => 1, ends: ['0.3', '1 (sphere)'] },
    { id: 'rhoF', min: 500, max: 2000, step: 1, siPer: () => 1, ends: ['500', '2000 kg/m³'] },
    { id: 'mu', min: 1e-5, max: 10, log: true,
      siPer: () => ($('muUnit').value === 'mPas' ? 1e-3 : 1), ends: ['10⁻⁵ Pa·s', '10 Pa·s'] },
    { id: 'g', min: 1, max: 25, step: 0.01, siPer: () => 1, ends: ['1', '25 m/s²'] },
    { id: 'H', min: 0.05, max: 3, step: 0.01, siPer: () => 1, ends: ['0.05', '3 m'] },
    { id: 'Dmm', min: 0.005, max: 0.3, step: 0.0005, siPer: () => 1e-3, ends: ['5', '300 mm'] },
    { id: 'v0', min: 0, max: 3, sqrt: true, siPer: () => 1, ends: ['0', '3 m/s'] },
    { id: 'phi', min: 0, max: 0.6, step: 0.005, siPer: () => 1, ends: ['0', '0.6'] },
    { id: 'n', min: 2, max: 5.5, step: 0.01, siPer: () => 1, ends: ['2', '5.5'] },
  ];

  const sliders = {};   // id → { cfg, range }

  function posToSI(cfg, pos) {
    const f = pos / RES;
    if (cfg.log) {
      const lo = Math.log10(cfg.min), hi = Math.log10(cfg.max);
      return Math.pow(10, lo + f * (hi - lo));
    }
    // square-root scale: fine resolution near zero (small v₀ for slow particles), still reaches 3 m/s
    if (cfg.sqrt) return cfg.min + f * f * (cfg.max - cfg.min);
    const v = cfg.min + f * (cfg.max - cfg.min);
    return Math.round(v / cfg.step) * cfg.step;
  }

  function siToPos(cfg, si) {
    let f;
    if (cfg.log) {
      if (!(si > 0)) return 0;
      const lo = Math.log10(cfg.min), hi = Math.log10(cfg.max);
      f = (Math.log10(si) - lo) / (hi - lo);
    } else if (cfg.sqrt) {
      f = Math.sqrt(Math.max(0, (si - cfg.min) / (cfg.max - cfg.min)));
    } else {
      f = (si - cfg.min) / (cfg.max - cfg.min);
    }
    return Math.round(Math.min(1, Math.max(0, f)) * RES);
  }

  /** Clean display number: 3 significant figures on log sliders, step-rounded otherwise. */
  function displayValue(cfg, si) {
    const disp = si / cfg.siPer();
    return (cfg.log || cfg.sqrt) ? Number(disp.toPrecision(3)) : Number(disp.toPrecision(10));
  }

  /** Move a slider to match its number box (e.g. after typing, a preset or a unit change). */
  function sync(id) {
    const s = sliders[id];
    if (!s) return;
    const val = parseFloat($(id).value);
    const si = val * s.cfg.siPer();
    s.range.value = siToPos(s.cfg, si);
    const outside = Number.isFinite(si) && (si < s.cfg.min * (1 - 1e-9) || si > s.cfg.max * (1 + 1e-9));
    s.wrap.classList.toggle('outside', outside);
    s.range.title = outside ? 'Typed value is outside the slider range' : '';
  }

  function syncAll() { Object.keys(sliders).forEach(sync); }

  function setDisabled(id, disabled) {
    if (sliders[id]) sliders[id].range.disabled = disabled;
  }

  /**
   * Build the sliders. onChange() is called while a slider is dragged.
   */
  function init(onChange) {
    CONFIG.forEach((cfg) => {
      const input = $(cfg.id);
      const inp = input.closest('.inp');
      const field = input.closest('.field');

      // Layout: [ slider ][ number box + unit ]  then the range ends underneath
      const row = document.createElement('div');
      row.className = 'srow';
      const range = document.createElement('input');
      range.type = 'range';
      range.min = 0; range.max = RES; range.step = 1;
      range.className = 'slider';
      range.setAttribute('aria-label', field.querySelector('span').textContent.trim());
      field.insertBefore(row, inp);
      row.appendChild(range);
      row.appendChild(inp);

      const ends = document.createElement('div');
      ends.className = 'sends';
      ends.innerHTML = '<span>' + cfg.ends[0] + '</span><span>' + (cfg.log ? 'log scale · ' : cfg.sqrt ? '√ scale · ' : '') + cfg.ends[1] + '</span>';
      field.appendChild(ends);

      sliders[cfg.id] = { cfg, range, wrap: row };

      range.addEventListener('input', () => {
        const si = posToSI(cfg, Number(range.value));
        input.value = displayValue(cfg, si);
        row.classList.remove('outside');
        onChange(cfg.id);
      });
      input.addEventListener('input', () => sync(cfg.id));
    });
    syncAll();
  }

  PS.sliders = { init, sync, syncAll, setDisabled };
})(window.PS = window.PS || {});
