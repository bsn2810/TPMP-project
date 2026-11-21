/* =====================================================================
 * trials.js — trial log.
 *
 * Each time the user presses Start (or "Record current"), one trial is
 * recorded: the drag scheme actually used, the effects that were switched
 * on (with their factors), and the resulting Re and terminal velocity.
 * Identical consecutive settings are not recorded twice.
 * The log can be exported as CSV and reset. It is also kept in the
 * browser's localStorage so a page reload does not lose it (best effort).
 * ===================================================================== */
(function (PS) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'particle-settling-trials-v1';
  const SHORT_LAW = { stokes: 'Stokes', newton: 'Newton', sn: 'Schiller–Naumann', hl: 'Haider–Levenspiel' };

  let trials = load();
  let lastAddedIndex = -1;
  let getVelocityUnit = () => PS.VELOCITY_UNITS['m/s'];

  function load() {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function save() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(trials)); } catch (e) { /* storage unavailable: keep in memory */ }
  }

  /** Build a trial record from a PS.compute result and its PS.simulate solution. */
  function makeTrial(res, sim) {
    const p = res.params;
    return {
      // inputs (SI)
      lawSelected: p.law,
      lawActive: res.model.key,
      d: p.d, rhoP: p.rhoP, rhoF: p.rhoF, mu: p.mu, g: p.g, H: p.H, D: p.D, v0: p.v0 || 0,
      wallOn: !!p.wallOn, concOn: !!p.concOn, shapeOn: !!p.shapeOn,
      lambda: res.lambda, fw: res.fw,
      phi: p.phi, n: p.n, fRZ: res.fRZ,
      psi: p.psi,
      // results
      Ar: res.Ar,
      Re: res.ReIso,               // Re at which the drag law is evaluated (isolated particle)
      ReFinal: res.ReFinal,        // Re at the final (corrected) terminal velocity
      Cd: res.cdIso,
      vIso: res.dir * res.vIso,    // uncorrected terminal velocity (+ down)
      vFinal: res.dir * res.vFinal,
      t95: sim && !sim.static ? sim.t95 : null,
      t99: sim && !sim.static ? sim.t99 : null,
      tTotal: sim && !sim.static ? sim.tEnd : null,
      regime: res.regime,
      validity: res.validity.text,
      balanceOk: res.balanceOk,
    };
  }

  /** Key of everything that defines a trial (used to skip exact duplicates). */
  function signature(t) {
    return [t.lawSelected, t.lawActive, t.d, t.rhoP, t.rhoF, t.mu, t.g, t.H, t.wallOn ? t.D : '', t.v0,
      t.wallOn, t.concOn, t.shapeOn, t.concOn ? t.phi : '', t.concOn ? t.n : '', t.shapeOn ? t.psi : ''].join('|');
  }

  /** Record a trial. Returns { added, index }. */
  function record(res, sim) {
    if (!res || !res.ok) { flash('Cannot record: the inputs are invalid.'); return { added: false, index: -1 }; }
    const t = makeTrial(res, sim);
    const last = trials[trials.length - 1];
    if (last && signature(last) === signature(t)) {
      lastAddedIndex = trials.length - 1;
      render();
      flash('Same settings as trial #' + trials.length + ' — not recorded again.');
      return { added: false, index: trials.length - 1 };
    }
    t.trial = trials.length + 1;
    t.recordedAt = new Date().toISOString();
    trials.push(t);
    lastAddedIndex = trials.length - 1;
    save();
    render();
    flash('Recorded trial #' + t.trial + '.');
    return { added: true, index: lastAddedIndex };
  }

  function clear() {
    trials = [];
    lastAddedIndex = -1;
    save();
    render();
    flash('Trials cleared — recording starts again from trial #1.');
  }

  let flashTimer = null;
  function flash(msg) {
    const el = $('trialMsg');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  /* ---------------- table rendering ---------------- */
  const f = (x, s) => PS.fmt(x, s || 4);

  function diameterText(d) {
    return d < 1e-3 ? f(d * 1e6, 4) + ' µm' : f(d * 1e3, 4) + ' mm';
  }

  function schemeCell(t) {
    if (t.lawActive === 'hl') {
      return '<b>' + SHORT_LAW.hl + '</b><small>overrides ' + SHORT_LAW[t.lawSelected] + '</small>';
    }
    return '<b>' + SHORT_LAW[t.lawActive] + '</b>';
  }

  function render() {
    const body = $('trialBody');
    if (!body) return;
    const vu = getVelocityUnit();
    $('trialCount').textContent = trials.length + (trials.length === 1 ? ' trial' : ' trials');
    $('btnExportCsv').disabled = trials.length === 0;
    $('btnResetTrials').disabled = trials.length === 0;
    $('vtHead').textContent = 'Terminal velocity (' + vu.label + ')';

    if (!trials.length) {
      body.innerHTML = '<tr class="empty"><td colspan="9">No trials recorded yet. Press <b>Start</b> (or <b>Record current</b>) to add the current settings as a trial.</td></tr>';
      return;
    }
    body.innerHTML = trials.map((t, i) => {
      // Values actually used by the model; defaults (marked "off") when an effect is disabled.
      const off = (v) => '<span class="off">' + v + '<small>off</small></span>';
      const wall = t.wallOn ? f(t.lambda, 4) : off('—');
      const conc = t.concOn ? f(t.phi, 3) + '<small>n = ' + f(t.n, 3) + '</small>' : off('0');
      const shape = t.shapeOn ? f(t.psi, 3) : off('1');
      const v0 = t.v0 > 0 ? '<small>v₀ = ' + f(t.v0, 3) + ' m/s</small>' : '';
      const corrected = Math.abs(t.vFinal - t.vIso) > 1e-15 * Math.abs(t.vIso)
        ? '<small>uncorrected ' + f(t.vIso * vu.factor) + '</small>' : '';
      return '<tr class="' + (i === lastAddedIndex ? 'latest' : '') + '">' +
        '<td class="num">' + t.trial + '</td>' +
        '<td>' + schemeCell(t) + '</td>' +
        '<td>d = ' + diameterText(t.d) + '<small>ρ<sub>p</sub> = ' + f(t.rhoP) + ' kg/m³</small><small>ρ<sub>f</sub> = ' + f(t.rhoF) + ' kg/m³</small><small>µ = ' + f(t.mu) + ' Pa·s</small>' + v0 + '</td>' +
        '<td class="num">' + wall + '</td>' +
        '<td class="num">' + conc + '</td>' +
        '<td class="num">' + shape + '</td>' +
        '<td class="num">' + f(t.Re) + '</td>' +
        '<td class="num"><b>' + f(t.vFinal * vu.factor) + '</b>' + corrected + '</td>' +
        '<td class="num">' + PS.fmtTime(t.tTotal) + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ---------------- CSV export ---------------- */
  // Header = readable quantity name with SI units in brackets. Values are SI, full precision.
  const CSV_COLUMNS = [
    ['trial', (t) => t.trial],
    ['recorded at (UTC)', (t) => t.recordedAt],
    ['drag scheme', (t) => SHORT_LAW[t.lawActive]],
    ['d (m)', (t) => t.d],
    ['ρp (kg/m³)', (t) => t.rhoP],
    ['ρf (kg/m³)', (t) => t.rhoF],
    ['μ (Pa·s)', (t) => t.mu],
    ['g (m/s²)', (t) => t.g],
    ['H (m)', (t) => t.H],
    ['D (m)', (t) => (t.wallOn ? t.D : '')],
    ['v0 (m/s)', (t) => t.v0],
    ['wall effect', (t) => (t.wallOn ? 'ON' : 'OFF')],
    ['d/D', (t) => (t.wallOn ? t.lambda : '')],
    ['f_w', (t) => t.fw],
    ['concentration effect', (t) => (t.concOn ? 'ON' : 'OFF')],
    ['φ', (t) => (t.concOn ? t.phi : 0)],
    ['n (Richardson–Zaki)', (t) => (t.concOn ? t.n : '')],
    ['f_RZ', (t) => t.fRZ],
    ['non-spherical', (t) => (t.shapeOn ? 'ON' : 'OFF')],
    ['ψ', (t) => (t.shapeOn ? t.psi : 1)],
    ['Ar', (t) => t.Ar],
    ['Re', (t) => t.Re],
    ['Re at final velocity', (t) => t.ReFinal],
    ['C_D', (t) => t.Cd],
    ['v_t uncorrected (m/s)', (t) => t.vIso],
    ['v_t final (m/s)', (t) => t.vFinal],
    ['t95 (s)', (t) => t.t95],
    ['t99 (s)', (t) => t.t99],
    ['time to travel H (s)', (t) => t.tTotal],
    ['drag law validity', (t) => t.validity],
    ['force balance converged', (t) => (t.balanceOk ? 'yes' : 'no')],
  ];

  function csvCell(v) {
    if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
    const s = typeof v === 'number' ? String(v) : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv() {
    const lines = [CSV_COLUMNS.map((c) => csvCell(c[0])).join(',')];
    trials.forEach((t) => lines.push(CSV_COLUMNS.map((c) => csvCell(c[1](t))).join(',')));
    return lines.join('\r\n') + '\r\n';
  }

  function exportCsv() {
    if (!trials.length) return;
    // UTF-8 byte-order mark so Excel shows symbols such as ≤ and ψ correctly
    const blob = new Blob(['﻿' + toCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date();
    const pad = (k) => String(k).padStart(2, '0');
    a.href = url;
    a.download = 'settling_trials_' + ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) + '_' + pad(ts.getHours()) + pad(ts.getMinutes()) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash('Exported ' + trials.length + ' trial' + (trials.length === 1 ? '' : 's') + ' to CSV.');
  }

  function init(opts) {
    if (opts && opts.velocityUnit) getVelocityUnit = opts.velocityUnit;
    render();
  }

  PS.trials = { init, record, clear, exportCsv, render, toCsv, list: () => trials.slice() };
})(window.PS = window.PS || {});
