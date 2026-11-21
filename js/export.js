/* =====================================================================
 * export.js — "Export results": the time history of the current
 * simulation as a CSV file.
 *
 * Every value comes from the current RK4 solution (PS.simulate). Nothing is
 * sampled from a curve fit or invented. The file is rebuilt from the latest
 * simulation at the moment of export, so it always reflects the current
 * parameters and models.
 *
 * Rows — only the window in which the particle is accelerating (or decelerating):
 *   every RK4 step from t = 0 up to and including the first step at which
 *       |v − v_t| ≤ (1 − FRACTION)·|v_t − v₀|      (FRACTION = 0.99),
 *   i.e. t ≈ t99, the same point at which the app reports "terminal velocity
 *   reached". For Stokes drag this is t = τ ln 100 ≈ 4.6τ. The acceleration of a
 *   first-order relaxation only approaches zero asymptotically, so a cut-off is
 *   needed; beyond t99 the velocity changes by less than 1 % of the total change.
 *   If the particle reaches the end of the column first, every step up to the end
 *   is written. The uniform motion at terminal velocity is not exported.
 *
 * Sign convention (notes p.2): downward is positive, so for a settling particle
 * velocity and position are positive, and for a rising particle they are negative.
 *   Drag force F_D(v) is the term of the notes' equation of motion
 *       ρp V_p dv/dt = (ρp − ρf) g V_p − F_D(v),
 *   so it has the sign of v (positive for a settling particle), and
 *   Net force = (ρp − ρf) g V_p − F_D(v) = m dv/dt.
 *   With wall/concentration corrections on, F_D is the effective drag used in
 *   the simulation, F_D(|v|/f)·sign(v).
 *   Drag coefficient C_D = |F_D| / (½ ρf v² A_p) — consistent with the exported
 *   force; blank at v = 0 where it is undefined.
 *   Reynolds number Re = ρf |v| d / µ.
 *
 * Headers use plain ASCII units (e.g. kg/m^3) so the file opens identically
 * in Excel, pandas.read_csv and Python's csv module, without encoding issues.
 * ===================================================================== */
(function (PS) {
  'use strict';

  const FRACTION = 0.99;   // export stops once 99 % of the velocity change v₀ → v_t has occurred (t99)

  const HEADERS = [
    'Time (s)',
    'Particle diameter (m)',
    'Particle density (kg/m^3)',
    'Fluid density (kg/m^3)',
    'Velocity (m/s)',
    'Position (m)',
    'Reynolds number',
    'Drag coefficient',
    'Drag force (N)',
    'Net force (N)',
  ];

  const SCHEME_FILE = { stokes: 'Stokes', newton: 'Newton', sn: 'SchillerNaumann', hl: 'HaiderLevenspiel' };

  /**
   * Export window: indices 0..last of the RK4 transient, ending at t99.
   * Returns { last, reason, tEnd } with reason 't99' (99 % of the change v₀ → v_t reached),
   * 'bottom' (end of column reached first) or 'uniform' (v₀ = v_t: no transient).
   */
  function exportWindow(sim) {
    const vT = sim.vTerm, v0 = sim.v[0];
    const dv0 = Math.abs(vT - v0);
    if (dv0 <= 1e-12 * Math.abs(vT)) return { last: 0, reason: 'uniform', tEnd: 0 };
    const target = (1 - FRACTION) * dv0;
    const n = sim.t.length;
    for (let i = 1; i < n; i++) {
      if (Math.abs(sim.v[i] - vT) <= target) return { last: i, reason: 't99', tEnd: sim.t[i] };
    }
    return { last: n - 1, reason: 'bottom', tEnd: sim.t[n - 1] };
  }

  /** Build the numeric rows (accelerating window only) from the current result and simulation. */
  function buildRows(res, sim) {
    if (!res || !res.ok || !sim || sim.static) return [];
    const p = res.params;
    const Ap = res.Ap;
    const win = exportWindow(sim);
    const rows = [];
    for (let i = 0; i <= win.last; i++) {
      const v = sim.v[i];
      const Fd = sim.drag(v);                     // F_D(v), signed like v
      const Fnet = sim.Fg - Fd;                   // = m dv/dt
      const Re = p.rhoF * Math.abs(v) * p.d / p.mu;
      const Cd = v !== 0 ? Math.abs(Fd) / (0.5 * p.rhoF * v * v * Ap) : null;
      rows.push([sim.t[i], p.d, p.rhoP, p.rhoF, v, sim.x[i], Re, Cd, Fd, Fnet]);
    }
    return rows;
  }

  /** Number → CSV text: 12 significant digits, plain decimal or e-notation; blank if undefined. */
  function num(x) {
    if (x === null || x === undefined || !Number.isFinite(x)) return '';
    if (x === 0) return '0';
    return String(Number(x.toPrecision(12)));
  }

  function toCsv(res, sim) {
    const rows = buildRows(res, sim);
    const lines = [HEADERS.map((h) => (/[",]/.test(h) ? '"' + h.replace(/"/g, '""') + '"' : h)).join(',')];
    rows.forEach((r) => lines.push(r.map(num).join(',')));
    return { text: lines.join('\r\n') + '\r\n', rows: rows.length };
  }

  /** e.g. settling_timeseries_Stokes_d1mm_20261122_0230.csv */
  function filename(res) {
    const p = res.params;
    const dmm = Number((p.d * 1e3).toPrecision(4));
    const dTxt = dmm >= 0.1 ? 'd' + dmm + 'mm' : 'd' + Number((p.d * 1e6).toPrecision(4)) + 'um';
    const ts = new Date();
    const pad = (k) => String(k).padStart(2, '0');
    const stamp = ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) + '_' + pad(ts.getHours()) + pad(ts.getMinutes()) + pad(ts.getSeconds());
    return 'settling_timeseries_' + SCHEME_FILE[res.model.key] + '_' + dTxt + '_' + stamp + '.csv';
  }

  /** Download the CSV for the current simulation. Returns { name, rows } or null. */
  function download(res, sim) {
    const out = toCsv(res, sim);
    if (!out.rows) return null;
    const name = filename(res);
    const blob = new Blob([out.text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { name, rows: out.rows };
  }

  /** Number of rows the export would contain (for the UI summary). */
  function rowCount(sim) {
    if (!sim || sim.static) return 0;
    return exportWindow(sim).last + 1;
  }

  /** Export window description for the UI (null if nothing to export). */
  function windowInfo(sim) {
    if (!sim || sim.static) return null;
    return exportWindow(sim);
  }

  PS.exportResults = { HEADERS, FRACTION, buildRows, toCsv, filename, download, rowCount, windowInfo };
})(window.PS = window.PS || {});
