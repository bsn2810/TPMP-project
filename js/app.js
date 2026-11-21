/* =====================================================================
 * app.js — user interface controller.
 * Reads the inputs (converted to SI), runs PS.compute + PS.simulate,
 * renders the results, plots and checks, and drives the animation.
 * ===================================================================== */
(function (PS) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const fmt = PS.fmt;

  /* ---------------- example presets (inputs in display units) ---------------- */
  const PRESETS = {
    glycerol: { d: 1, dUnit: 'mm', rhoP: 2500, rhoF: 1260, mu: 1.41, muUnit: 'Pas', g: 9.81, H: 0.5, Dmm: 50, law: 'stokes' },
    sand:     { d: 0.5, dUnit: 'mm', rhoP: 2650, rhoF: 998, mu: 1.0, muUnit: 'mPas', g: 9.81, H: 0.5, Dmm: 50, law: 'sn' },
    steel:    { d: 5, dUnit: 'mm', rhoP: 7800, rhoF: 998, mu: 1.0, muUnit: 'mPas', g: 9.81, H: 1.0, Dmm: 100, law: 'newton' },
    pe:       { d: 3, dUnit: 'mm', rhoP: 920, rhoF: 998, mu: 1.0, muUnit: 'mPas', g: 9.81, H: 0.5, Dmm: 50, law: 'sn' },
  };

  /* ---------------- application state ---------------- */
  const app = {
    res: null, sim: null, checks: null,
    phase: 'ready',          // ready | running | paused | finished
    simTime: 0, lastFrame: null, rafId: null,
    velMode: 'full',
  };
  let column;

  /* ---------------- input handling ---------------- */
  const num = (id) => parseFloat($(id).value);

  /** Read all inputs and convert them to SI units. */
  function readParams() {
    const dScale = $('dUnit').value === 'um' ? 1e-6 : 1e-3;
    const muScale = $('muUnit').value === 'mPas' ? 1e-3 : 1;
    return {
      d: num('d') * dScale,
      rhoP: num('rhoP'),
      psi: num('psi'),
      rhoF: num('rhoF'),
      mu: num('mu') * muScale,
      g: num('g'),
      H: num('H'),
      D: num('Dmm') * 1e-3,
      phi: num('phi'),
      n: num('n'),
      v0: num('v0'),
      law: document.querySelector('input[name="law"]:checked').value,
      wallOn: $('wallOn').checked,
      concOn: $('concOn').checked,
      shapeOn: $('shapeOn').checked,
    };
  }

  /** Highlight individual inputs that are physically invalid. */
  function markInvalidInputs(p) {
    const bad = {
      d: !(p.d > 0) || (p.wallOn && p.d >= p.D), rhoP: !(p.rhoP > 0), psi: !(p.psi > 0 && p.psi <= 1),
      rhoF: !(p.rhoF > 0), mu: !(p.mu > 0), g: !(p.g > 0), H: !(p.H > 0), Dmm: !(p.D > 0) || (p.wallOn && p.d >= p.D),
      phi: !(p.phi >= 0 && p.phi < 1), n: !(p.n >= 0), v0: !(p.v0 >= 0),
    };
    Object.keys(bad).forEach((id) => $(id).closest('.inp').classList.toggle('input-bad', bad[id]));
  }

  /** Show / hide the toggle sub-panels and the H-L override notice. */
  function syncToggleUI() {
    const wall = $('wallOn').checked, conc = $('concOn').checked, shape = $('shapeOn').checked;
    $('tcWall').classList.toggle('on', wall); $('wallSub').hidden = !wall;
    $('tcConc').classList.toggle('on', conc); $('concSub').hidden = !conc;
    $('tcShape').classList.toggle('on', shape); $('shapeSub').hidden = !shape;
    $('psi').disabled = !shape;
    if (PS.sliders) PS.sliders.setDisabled('psi', !shape);
    // The column diameter only enters the model through the wall correction.
    $('Dmm').disabled = !wall;
    if (PS.sliders) PS.sliders.setDisabled('Dmm', !wall);
    $('DHint').textContent = wall ? '(used by the Francis wall correction)' : '(enable wall effects to change)';
    $('psiHint').textContent = shape ? '(used by Haider–Levenspiel)' : '(enable the non-spherical toggle)';
    $('overrideNote').hidden = !shape;
    $('lawGroup').classList.toggle('dimmed', shape);
  }

  /* ---------------- main recalculation ---------------- */
  function recalc(fromUserChange) {
    const wasActive = app.phase === 'running' || app.phase === 'paused';
    stopLoop();
    syncToggleUI();
    const p = readParams();
    markInvalidInputs(p);
    const res = PS.compute(p);
    app.res = res;

    if (!res.ok) {
      app.sim = null;
      renderErrors(res.errors);
      column.setModel(res, null);
      clearResults();
      if (PS.plots.available()) PS.plots.renderAll(res, { static: true }, {});
      renderExportInfo();
      setPhase('ready');
      return;
    }
    renderErrors([]);
    app.sim = PS.simulate(res);
    app.checks = PS.runChecks(p, res, app.sim);

    renderResults();
    renderChecks();
    renderExportInfo();
    if (PS.plots.available()) PS.plots.renderAll(res, app.sim, { velMode: app.velMode });

    app.simTime = 0;
    column.setModel(res, app.sim);
    updateReadouts(app.sim.at(0));          // initial state, v(0) = v₀
    PS.plots.updateMarkers(app.sim.at(0), true);
    setPhase('ready');
    $('paramNotice').hidden = !(fromUserChange && wasActive);
  }

  let debounceId = null;
  function scheduleRecalc() {
    clearTimeout(debounceId);
    debounceId = setTimeout(() => recalc(true), 140);
  }

  /** While a slider is dragged: recalculate at most every ~70 ms, plus once when it stops. */
  let liveTimer = null, lastLive = 0;
  function liveRecalc() {
    clearTimeout(debounceId);
    clearTimeout(liveTimer);
    const now = performance.now();
    if (now - lastLive > 70) { lastLive = now; recalc(true); }
    liveTimer = setTimeout(() => { lastLive = performance.now(); recalc(true); }, 90);
  }

  /* ---------------- rendering helpers ---------------- */
  function vu() { return PS.VELOCITY_UNITS[$('vUnit').value]; }
  function fv(v) { return fmt(v * vu().factor, 4) + ' ' + vu().label; }
  function row(label, value, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + '</td><td>' + value + '</td></tr>'; }
  function tag(ok, okText, badText) { return '<span class="tag ' + (ok ? 'ok' : 'bad') + '">' + (ok ? okText : badText) + '</span>'; }

  function renderErrors(errors) {
    const box = $('errorBox');
    if (!errors.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<b>Invalid inputs — simulation stopped:</b><ul>' + errors.map((e) => '<li>' + e + '</li>').join('') + '</ul>';
  }

  function clearResults() {
    ['tForces', 'tFlow', 'tSettle', 'tTrans'].forEach((id) => { $(id).innerHTML = ''; });
    $('warnList').innerHTML = '';
    $('checkList').innerHTML = '';
    $('checkSummary').textContent = '—';
    $('rLaw').textContent = '—'; $('rRegime').textContent = '—'; $('rValid').textContent = '—';
    $('roVt').textContent = '—';
  }

  function renderResults() {
    const r = app.res, s = app.sim, p = r.params;
    const lawName = r.model.name;

    // status row
    $('rLaw').textContent = lawName;
    $('rRegime').textContent = r.regime;
    $('rValid').textContent = r.validity.text;
    $('rValid').className = 'pill ' + r.validity.level;

    // notes p.4 recommendation
    $('recLaw').innerHTML = 'Notes p.4 regime check: Ar = ' + fmt(r.Ar, 4) + ', Re<sub>Stokes</sub> = Ar/18 = ' + fmt(r.ReStokesAr, 4) +
      ' → recommended: <b>' + PS.LAW_NAMES[r.recommendedLaw] + '</b>';

    // initial condition
    $('kV0Ratio').innerHTML = r.vFinal > 0 ? fmt(p.v0 / r.vFinal, 4) : '—';
    $('btnV0Half').disabled = $('btnV0Twice').disabled = !(r.vFinal > 0);

    // toggle sub-panels
    $('kLambda').innerHTML = fmt(r.lambda, 4);
    $('kFw').innerHTML = fmt(r.fwCalc, 5);
    $('kRz').innerHTML = fmt(r.fRZCalc, 5);
    const c = PS.hlCoefficients(p.psi);
    $('kA').innerHTML = fmt(c.A, 5); $('kB').innerHTML = fmt(c.B, 5);
    $('kC').innerHTML = fmt(c.C, 5); $('kK').innerHTML = fmt(c.K, 5);
    if (p.shapeOn) {
      $('kCdHl').innerHTML = fmt(r.cdIso, 4);
      $('kShapeDiff').innerHTML = PS.pct(r.hlPsi.v, r.sphere.v) + ' vs ' + (p.law === 'sn' ? 'S-N' : p.law === 'newton' ? 'Newton' : 'Stokes') + ', ' + PS.pct(r.hlPsi.v, r.hlSphere.v) + ' vs H-L ψ=1';
    }

    // ---- forces ----
    const sgn = r.dir;
    $('tForces').innerHTML =
      row('Particle volume V<sub>p</sub> = πd³/6', fmt(r.V) + ' m³') +
      row('Particle mass m<sub>p</sub> = ρ<sub>p</sub>V<sub>p</sub>', fmt(r.m) + ' kg') +
      row('Weight W = ρ<sub>p</sub>gV<sub>p</sub>', fmt(r.W) + ' N') +
      row('Buoyancy B = ρ<sub>f</sub>gV<sub>p</sub>', fmt(r.B) + ' N') +
      row('Net gravitational force W − B', fmt(r.Fnet) + ' N' + (sgn < 0 ? ' (upward)' : '')) +
      row('Drag at terminal velocity F<sub>D</sub>', fmt(sgn * r.FdEff) + ' N') +
      row('½C<sub>D</sub>ρ<sub>f</sub>v<sub>t</sub>²A<sub>p</sub> (isolated, notes p.2)', fmt(sgn * r.FdFromCd) + ' N') +
      row('Force balance (W − B − F<sub>D</sub>)/(W − B)', fmt(r.residual, 3) + tag(r.balanceOk || r.dir === 0, 'converged', 'not converged'), 'em') +
      row('Power released by gravity P<sub>g</sub> = (W − B)v<sub>t</sub>', fmt(r.Pg) + ' W') +
      row('Power dissipated by drag P<sub>d</sub> = F<sub>D</sub>v<sub>t</sub>', fmt(r.Pd) + ' W');

    // ---- dimensionless ----
    let flow = row('Re = ρ<sub>f</sub>v<sub>t</sub>d/µ (isolated, used in drag law)', fmt(r.ReIso));
    if (Math.abs(r.f - 1) > 1e-12) flow += row('Re at the final (corrected) velocity', fmt(r.ReFinal));
    flow += row('Archimedes number Ar = ρ<sub>f</sub>|Δρ|gd³/µ²', fmt(r.Ar)) +
      row('Re<sub>Stokes</sub> = Ar/18', fmt(r.ReStokesAr)) +
      row('Drag coefficient C<sub>D</sub> at terminal', fmt(r.cdIso)) +
      row('Selected drag law', PS.LAW_NAMES[p.law] + (p.shapeOn ? ' → overridden by H-L' : '')) +
      row('Flow regime', r.regime) +
      row('Drag-law validity', r.validity.text);
    $('tFlow').innerHTML = flow;

    // ---- settling ----
    let st = row('Method', r.iso.method + (r.iso.iterations ? ' · ' + r.iso.iterations + ' iterations, last Δv/v = ' + fmt(r.iso.relChange, 2) : ''));
    if (p.shapeOn) st += row('Sphere, ' + PS.LAW_NAMES[p.law] + ' (reference)', fv(sgn * r.sphere.v));
    st += row('<b>Uncorrected terminal velocity v<sub>t</sub></b>', fv(sgn * r.vIso), 'sep') +
      row('Wall factor f<sub>w</sub> ' + (p.wallOn ? '(Francis, ON)' : '(OFF → 1)'), fmt(r.fw, 5)) +
      row('Wall-corrected v<sub>wall</sub> = f<sub>w</sub>v<sub>t</sub>', fv(sgn * r.vWall) + ' <span class="tag ' + (p.wallOn ? 'bad' : 'ok') + '">' + PS.pct(r.vWall, r.vIso) + '</span>') +
      row('Hindrance factor (1 − φ)ⁿ ' + (p.concOn ? '(R-Z, ON)' : '(OFF → 1)'), fmt(r.fRZ, 5)) +
      row('Concentration-corrected v<sub>h</sub> (after wall)', fv(sgn * r.vConc) + ' <span class="tag ' + (p.concOn ? 'bad' : 'ok') + '">' + PS.pct(r.vConc, r.vWall) + '</span>') +
      row('Combined factor f = f<sub>w</sub>·f<sub>RZ</sub>', fmt(r.f, 5)) +
      row('<b>Final terminal velocity</b>', fv(sgn * r.vFinal) + ' <span class="tag bad">' + PS.pct(r.vFinal, r.vIso) + '</span>', 'em');
    $('tSettle').innerHTML = st;

    // ---- transient ----
    let tr = '';
    if (s.static) {
      tr = row('Motion', 'none — particle stays at rest');
    } else {
      const a = s.analytic;
      const x99 = s.t99 !== null ? Math.abs(s.at(s.t99).x) : null;
      const fromRest = s.v0 === 0;
      const motion = fromRest ? 'accelerates from rest' : Math.abs(s.v0) > Math.abs(s.vTerm) ? 'decelerates from v₀' : Math.abs(s.v0) < Math.abs(s.vTerm) ? 'accelerates from v₀' : 'uniform (v₀ = v_t)';
      const l95 = fromRest ? 'Time to 95 % of terminal velocity' : 'Time for 95 % of the change v₀ → v<sub>t</sub>';
      const l99 = fromRest ? 'Time to 99 % of terminal velocity' : 'Time for 99 % of the change v₀ → v<sub>t</sub>';
      tr = row('Initial velocity v₀', fv(s.v0) + ' <small>(' + motion + ')</small>') +
        row('Stokes relaxation time τ = ρ<sub>p</sub>d²/(18µ)', PS.fmtTime(r.tauStokes)) +
        row('Characteristic time T = v<sub>t</sub>/(|Δρ|g/ρ<sub>p</sub>)', PS.fmtTime(s.Tchar)) +
        row(l95, s.t95 !== null ? PS.fmtTime(s.t95) + (a ? ' <small>(analytic τ ln20 = ' + PS.fmtTime(a.t95) + ')</small>' : '') : 'not reached before the end') +
        row(l99, s.t99 !== null ? PS.fmtTime(s.t99) + (a ? ' <small>(analytic τ ln100 = ' + PS.fmtTime(a.t99) + ')</small>' : '') : 'not reached before the end') +
        row('Distance covered before 99 %', x99 !== null ? fmt(x99) + ' m (' + fmt(100 * x99 / p.H, 3) + ' % of H)' : '—') +
        row('<b>Time to travel the column height</b>', PS.fmtTime(s.tEnd) + (a ? ' <small>(analytic ' + PS.fmtTime(a.tEnd) + ')</small>' : ''), 'em') +
        row('Distance travelled', fmt(p.H) + ' m ' + (r.dir > 0 ? '(downward)' : '(upward)')) +
        row('Energy balance residual (W−B)H + ½mv₀² − ½mv² − ∫F<sub>D</sub>v dt', fmt(s.energy.residual, 3) + tag(Math.abs(s.energy.residual) < 1e-6, 'OK', 'check'));
      // Numerical-method details (RK4 steps, RK4 vs analytical) are reported in the
      // "Physical & numerical checks" panel instead.
    }
    $('tTrans').innerHTML = tr;

    // ---- warnings ----
    const ws = r.warnings.slice();
    if (!ws.some((w) => w.level === 'warning' || w.level === 'caution')) ws.unshift({ level: 'ok', text: 'All inputs are within the applicability limits of the active models.' });
    $('warnList').innerHTML = ws.map((w) => '<li class="' + w.level + '">' + w.text + '</li>').join('');

    $('roVt').innerHTML = s.static ? '0' : fv(s.vTerm);
    $('roVu').textContent = vu().label;
    updateSpeedNote();
  }

  function renderChecks() {
    const list = app.checks;
    const failed = list.filter((c) => !c.pass).length;
    $('checkSummary').textContent = failed ? failed + ' failed' : 'all ' + list.length + ' passed';
    $('checkSummary').className = 'badge ' + (failed ? 'warn' : 'ok');
    $('checkList').innerHTML = list.map((c) => {
      const cls = c.skipped ? 'skip' : c.pass ? 'pass' : 'fail';
      const mark = c.skipped ? '–' : c.pass ? '✓' : '✗';
      return '<li class="' + cls + '"><span class="mark">' + mark + '</span><span>' + c.name + '<small>' + c.detail + '</small></span></li>';
    }).join('');
  }

  /** Summary of what "Export results" will write — refreshed on every recalculation. */
  function renderExportInfo() {
    const r = app.res, s = app.sim;
    const btn = $('btnExportResults');
    if (!r || !r.ok) {
      btn.disabled = true;
      $('exportRows').textContent = '—';
      $('exportSummary').textContent = 'Fix the inputs to export results.';
      return;
    }
    if (!s || s.static) {
      btn.disabled = true;
      $('exportRows').textContent = '0 rows';
      $('exportSummary').textContent = 'No motion (neutrally buoyant): there is no time history to export.';
      return;
    }
    const p = r.params;
    const n = PS.exportResults.rowCount(s);
    const effects = [p.wallOn ? 'wall (d/D = ' + PS.fmtText(r.lambda, 3) + ')' : null,
      p.concOn ? 'concentration (φ = ' + PS.fmtText(p.phi, 3) + ')' : null,
      p.shapeOn ? 'non-spherical (ψ = ' + PS.fmtText(p.psi, 3) + ')' : null].filter(Boolean);
    btn.disabled = false;
    $('exportRows').textContent = n.toLocaleString() + ' rows';
    $('exportSummary').innerHTML = 'Current run: <b>' + r.model.name + '</b> · d = ' + fmt(p.d) + ' m · ρ<sub>p</sub> = ' + fmt(p.rhoP) +
      ' · ρ<sub>f</sub> = ' + fmt(p.rhoF) + ' kg/m³ · µ = ' + fmt(p.mu) + ' Pa·s' + (p.v0 > 0 ? ' · v₀ = ' + fmt(p.v0) + ' m/s' : '') +
      ' · effects: ' + (effects.length ? effects.join(', ') : 'none');
    const w = PS.exportResults.windowInfo(s);
    const why = w.reason === 't99' ? 'until t<sub>99</sub>, when 99 % of the velocity change v₀ → v<sub>t</sub> has occurred (v = ' + fmt(s.v[w.last] / s.vTerm * 100, 4) + ' % of v<sub>t</sub>)'
      : w.reason === 'bottom' ? 'until the particle reaches the end of the column, while still accelerating'
      : 'no transient: v₀ = v<sub>t</sub>, so the velocity never changes (single row at t = 0)';
    $('exportSummary').innerHTML += '<br>Export window: <b>t = 0 → ' + PS.fmtTime(w.tEnd) + '</b>, x = 0 → ' + fmt(s.x[w.last]) + ' m, ' + why + '.';
  }

  /* ---------------- animation ---------------- */
  function speedFactor() {
    const sel = $('speed').value;
    if (!app.sim || app.sim.static) return 1;
    if (sel === 'auto') return app.sim.tEnd / 8;
    return parseFloat(sel);
  }

  function updateSpeedNote() {
    if (!app.sim || app.sim.static) { $('speedNote').textContent = ''; return; }
    const k = speedFactor();
    $('speedNote').innerHTML = 'Playback: 1 s on screen = ' + PS.fmtTime(k) + ' of simulated time · whole fall ≈ ' + PS.fmtTime(app.sim.tEnd / k) + ' on screen';
  }

  function setPhase(phase) {
    app.phase = phase;
    const valid = app.res && app.res.ok && app.sim && !app.sim.static;
    $('btnStart').disabled = !valid || phase === 'running';
    $('btnPause').disabled = phase !== 'running';
    $('btnResume').disabled = phase !== 'paused';
    $('btnReset').disabled = !valid || (phase === 'ready' && app.simTime === 0);
    const st = $('simStatus');
    const labels = { ready: 'Ready', running: 'Running', paused: 'Paused', finished: app.res && app.res.dir < 0 ? 'Reached the top' : 'Reached the bottom' };
    st.textContent = !app.res || !app.res.ok ? 'Invalid inputs' : (app.sim && app.sim.static ? 'No motion (neutrally buoyant)' : labels[phase]);
    st.className = 'badge' + (phase === 'finished' ? ' ok' : (!app.res || !app.res.ok ? ' warn' : ''));
  }

  function updateReadouts(state) {
    const s = app.sim;
    const vT = s && !s.static ? Math.abs(s.vTerm) : 0;
    const pctV = vT > 0 ? 100 * Math.abs(state.v) / vT : 0;
    const reached = s && !s.static && s.t99 !== null && state.t >= s.t99;
    $('roV').innerHTML = fmt(state.v * vu().factor, 4);
    $('roPct').textContent = pctV.toFixed(pctV > 99.95 ? 2 : 1) + ' %';
    $('roT').innerHTML = PS.fmtTime(state.t);
    $('roX').innerHTML = fmt(Math.abs(state.x), 4) + ' m';
    $('roTerm').hidden = !reached;
    column.setState(state, reached);
    PS.plots.updateMarkers(state, false);
  }

  function frame(ts) {
    if (app.phase !== 'running') return;
    if (app.lastFrame === null) app.lastFrame = ts;
    const dtReal = Math.min(0.1, (ts - app.lastFrame) / 1000);
    app.lastFrame = ts;
    app.simTime += dtReal * speedFactor();
    let done = false;
    if (app.simTime >= app.sim.tEnd) { app.simTime = app.sim.tEnd; done = true; }
    const state = app.sim.at(app.simTime);
    updateReadouts(state);
    if (done) {
      PS.plots.updateMarkers(state, true);
      setPhase('finished');
      return;
    }
    app.rafId = requestAnimationFrame(frame);
  }

  function startLoop() {
    app.lastFrame = null;
    app.rafId = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (app.rafId) cancelAnimationFrame(app.rafId);
    app.rafId = null;
  }

  function onStart() {
    $('paramNotice').hidden = true;
    PS.trials.record(app.res, app.sim);     // each run is logged as one trial
    app.simTime = 0;
    setPhase('running');
    startLoop();
  }
  function onPause() { stopLoop(); setPhase('paused'); PS.plots.updateMarkers(app.sim.at(app.simTime), true); }
  function onResume() { setPhase('running'); startLoop(); }
  function onReset() {
    stopLoop();
    app.simTime = 0;
    updateReadouts(app.sim.at(0));
    PS.plots.updateMarkers(app.sim.at(0), true);
    setPhase('ready');
  }

  /* ---------------- wiring ---------------- */
  function applyPreset(key) {
    const pr = PRESETS[key];
    if (!pr) return;
    ['d', 'rhoP', 'rhoF', 'mu', 'g', 'H', 'Dmm'].forEach((id) => { $(id).value = pr[id]; });
    $('dUnit').value = pr.dUnit;
    $('muUnit').value = pr.muUnit;
    document.querySelector('input[name="law"][value="' + pr.law + '"]').checked = true;
    PS.sliders.syncAll();
    recalc(true);
  }

  /** Keep the physical value when the user switches a display unit. */
  function bindUnitSwitch(selId, inputId, factors) {
    let prev = $(selId).value;
    $(selId).addEventListener('change', () => {
      const next = $(selId).value;
      const val = parseFloat($(inputId).value);
      if (Number.isFinite(val)) $(inputId).value = Number((val * factors[prev] / factors[next]).toPrecision(8));
      prev = next;
      PS.sliders.sync(inputId);
      recalc(true);
    });
  }

  function init() {
    column = new PS.ColumnView($('column'));
    PS.sliders.init(liveRecalc);

    ['d', 'rhoP', 'psi', 'rhoF', 'mu', 'g', 'H', 'Dmm', 'phi', 'n', 'v0'].forEach((id) => {
      $(id).addEventListener('input', scheduleRecalc);
    });

    // Quick-set buttons for the initial velocity (multiples of the current final terminal velocity)
    const setV0 = (factor) => {
      const vt = app.res && app.res.ok ? app.res.vFinal : 0;
      $('v0').value = factor === 0 ? 0 : Number((factor * vt).toPrecision(4));
      PS.sliders.sync('v0');
      recalc(true);
    };
    $('btnV0Rest').addEventListener('click', () => setV0(0));
    $('btnV0Half').addEventListener('click', () => setV0(0.5));
    $('btnV0Twice').addEventListener('click', () => setV0(2));
    document.querySelectorAll('input[name="law"]').forEach((el) => el.addEventListener('change', () => recalc(true)));
    ['wallOn', 'concOn', 'shapeOn'].forEach((id) => $(id).addEventListener('change', () => recalc(true)));
    bindUnitSwitch('dUnit', 'd', { mm: 1e-3, um: 1e-6 });
    bindUnitSwitch('muUnit', 'mu', { Pas: 1, mPas: 1e-3 });
    $('vUnit').addEventListener('change', () => {
      PS.trials.render();
      if (!app.res || !app.res.ok) return;
      renderResults();
      updateReadouts(app.sim.at(app.simTime));
    });
    $('speed').addEventListener('change', updateSpeedNote);
    $('preset').addEventListener('change', (e) => applyPreset(e.target.value));

    $('btnStart').addEventListener('click', onStart);
    $('btnPause').addEventListener('click', onPause);
    $('btnResume').addEventListener('click', onResume);
    $('btnReset').addEventListener('click', onReset);

    // Results export (time history of the current simulation)
    $('btnExportResults').addEventListener('click', () => {
      const out = PS.exportResults.download(app.res, app.sim);
      if (out) {
        $('exportSummary').innerHTML = 'Downloaded <b>' + out.name + '</b> (' + out.rows.toLocaleString() + ' rows).';
        setTimeout(renderExportInfo, 6000);
      }
    });

    // Trial log
    PS.trials.init({ velocityUnit: vu });
    $('btnRecord').addEventListener('click', () => PS.trials.record(app.res, app.sim));
    $('btnExportCsv').addEventListener('click', () => PS.trials.exportCsv());
    $('btnResetTrials').addEventListener('click', () => {
      const n = PS.trials.list().length;
      if (n && !window.confirm('Delete all ' + n + ' recorded trial' + (n === 1 ? '' : 's') + ' and start recording again from trial #1? Export the CSV first if you want to keep them.')) return;
      PS.trials.clear();
    });

    document.querySelectorAll('#velMode button').forEach((b) => b.addEventListener('click', () => {
      app.velMode = b.dataset.mode;
      document.querySelectorAll('#velMode button').forEach((x) => x.classList.toggle('on', x === b));
      if (app.res && app.res.ok && PS.plots.available()) {
        PS.plots.renderVelocity(app.res, app.sim, app.velMode);
        PS.plots.updateMarkers(app.sim.at(app.simTime), true);
      }
    }));

    if (!PS.plots.available()) $('plotFallback').hidden = false;
    recalc(false);
  }

  // Exposed for debugging / testing from the browser console.
  PS.app = app;
  PS.recalc = recalc;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.PS = window.PS || {});
