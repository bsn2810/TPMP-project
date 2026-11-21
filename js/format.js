/* =====================================================================
 * format.js — number formatting and unit-conversion helpers.
 * Creates the global namespace `PS` used by every other script.
 * All physics is done in SI units; these helpers only affect DISPLAY.
 * ===================================================================== */
(function (PS) {
  'use strict';

  /**
   * Format a number as HTML with `sig` significant figures.
   * Very small / very large values use ×10ⁿ notation.
   */
  function fmt(x, sig) {
    sig = sig || 4;
    if (x === null || x === undefined || Number.isNaN(x)) return '—';
    if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞';
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 1e-3 && a < 1e5) {
      let s = Number(x.toPrecision(sig)).toString();
      return s.replace('-', '−');
    }
    const parts = x.toExponential(sig - 1).split('e');
    return parts[0].replace('-', '−') + '×10<sup>' + Number(parts[1]) + '</sup>';
  }

  /** Plain-text version (for plot labels / tooltips). */
  function fmtText(x, sig) {
    sig = sig || 4;
    if (x === null || x === undefined || Number.isNaN(x)) return '—';
    if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞';
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 1e-3 && a < 1e5) return Number(x.toPrecision(sig)).toString();
    return x.toExponential(sig - 1);
  }

  /** Percentage change from `ref` to `val`, formatted with sign. */
  function pct(val, ref) {
    if (!ref || !Number.isFinite(val / ref)) return '—';
    const p = (val / ref - 1) * 100;
    if (Math.abs(p) < 5e-4) return '0 %';
    return (p > 0 ? '+' : '−') + Math.abs(p).toFixed(Math.abs(p) < 1 ? 3 : 2) + ' %';
  }

  /** Format a time in seconds with a sensible unit. */
  function fmtTime(t) {
    if (t === null || t === undefined || Number.isNaN(t)) return '—';
    if (!Number.isFinite(t)) return '∞';
    const a = Math.abs(t);
    if (a === 0) return '0 s';
    if (a < 1e-3) return fmt(t * 1e6, 4) + ' µs';
    if (a < 1) return fmt(t * 1e3, 4) + ' ms';
    if (a < 120) return fmt(t, 4) + ' s';
    if (a < 7200) return fmt(t / 60, 4) + ' min (' + fmt(t, 4) + ' s)';
    return fmt(t / 3600, 4) + ' h (' + fmt(t, 4) + ' s)';
  }

  /** Display-unit definitions (factor converts SI → display). */
  const VELOCITY_UNITS = {
    'm/s': { factor: 1, label: 'm/s' },
    'mm/s': { factor: 1e3, label: 'mm/s' },
    'um/s': { factor: 1e6, label: 'µm/s' },
  };

  PS.fmt = fmt;
  PS.fmtText = fmtText;
  PS.pct = pct;
  PS.fmtTime = fmtTime;
  PS.VELOCITY_UNITS = VELOCITY_UNITS;
})(window.PS = window.PS || {});
