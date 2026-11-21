/* =====================================================================
 * plots.js — the three interactive Plotly graphs:
 *   1. velocity vs time   2. position vs time   3. C_D vs Re (log–log)
 * Every trace is generated from the computed solution / correlations.
 * ===================================================================== */
(function (PS) {
  'use strict';

  const COLORS = {
    num: '#1f5fae', analytic: '#d1495b', solution: '#c0392b', term: '#1d8a4e', iso: '#8a94a6',
    stokes: '#7b4fb0', newton: '#c47f00', sn: '#1f5fae', hl: '#d1495b', hl1: '#e79aa6',
    marker: '#b0661b', grid: '#e3e8ef',
  };
  const CONFIG = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'] };

  function available() { return typeof window.Plotly !== 'undefined'; }

  function baseLayout(xTitle, yTitle) {
    return {
      margin: { l: 64, r: 16, t: 10, b: 48 },
      font: { family: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', size: 12, color: '#1b2533' },
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: '#ffffff',
      xaxis: { title: { text: xTitle }, gridcolor: COLORS.grid, zeroline: false, exponentformat: 'power' },
      yaxis: { title: { text: yTitle }, gridcolor: COLORS.grid, zeroline: false, exponentformat: 'power' },
      legend: { orientation: 'h', y: -0.22, x: 0, font: { size: 11 } },
      hovermode: 'closest',
      showlegend: true,
    };
  }

  /** Down-sample the transient arrays for plotting and append the uniform-motion end point. */
  function trajectory(sim, maxPts) {
    const n = sim.t.length;
    const stride = Math.max(1, Math.ceil(n / maxPts));
    const T = [], X = [], V = [];
    for (let i = 0; i < n; i += stride) { T.push(sim.t[i]); X.push(sim.x[i]); V.push(sim.v[i]); }
    if (T[T.length - 1] !== sim.t[n - 1]) { T.push(sim.t[n - 1]); X.push(sim.x[n - 1]); V.push(sim.v[n - 1]); }
    if (sim.tEnd > sim.t[n - 1]) {
      const end = sim.at(sim.tEnd);
      T.push(end.t); X.push(end.x); V.push(end.v);
    }
    return { T, X, V };
  }

  /**
   * The single solution curve shown in the v(t) and x(t) plots, on the time grid of the
   * computed trajectory (dense where the velocity changes fast). For Stokes drag the values are
   * the analytical solution; for the other laws they are the computed solution.
   */
  function solutionCurve(sim, tr) {
    if (sim.analytic) {
      return {
        V: tr.T.map(sim.analytic.vA), X: tr.T.map(sim.analytic.xA),
        label: (q) => q + '(t), Stokes analytical solution',
      };
    }
    return { V: tr.V, X: tr.X, label: (q) => q + '(t)' };
  }

  function logspace(a, b, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(Math.pow(10, a + (b - a) * i / (n - 1)));
    return out;
  }

  /**
   * Draw / redraw all plots.
   * opts.velMode: 'full' (whole fall) or 'transient' (zoom on acceleration).
   */
  function renderAll(res, sim, opts) {
    if (!available()) return;
    opts = opts || {};
    renderVelocity(res, sim, opts.velMode || 'full');
    renderPosition(res, sim);
    renderCd(res);
  }

  function transientRange(sim) {
    const tz = sim.t99 ? Math.min(sim.tEnd, 2.2 * sim.t99) : Math.min(sim.tEnd, 12 * sim.Tchar);
    return [0, tz];
  }

  function renderVelocity(res, sim, mode) {
    const el = 'plotV';
    if (!res || !res.ok || sim.static) { Plotly.react(el, [], baseLayout('Time t (s)', 'Velocity v (m/s)'), CONFIG); return; }
    const tr = trajectory(sim, 1800);
    const tMax = sim.tEnd;
    // One solution curve: the Stokes analytical solution when it exists, otherwise the
    // computed solution (Newton, Schiller–Naumann, Haider–Levenspiel have no closed form).
    const sol = solutionCurve(sim, tr);
    const traces = [
      { x: tr.T, y: sol.V, name: sol.label('v'), mode: 'lines', line: { color: COLORS.solution, width: 2.5 } },
      { x: [0, tMax], y: [sim.vTerm, sim.vTerm], name: 'terminal velocity (final)', mode: 'lines', line: { color: COLORS.term, dash: 'dash', width: 1.5 } },
    ];
    if (Math.abs(res.f - 1) > 1e-12) {
      const vIso = res.dir * res.vIso;
      traces.push({ x: [0, tMax], y: [vIso, vIso], name: 'uncorrected v_t (isolated)', mode: 'lines', line: { color: COLORS.iso, dash: 'dot', width: 1.5 } });
    }
    traces.push({ x: [0], y: [0], name: 'particle now', mode: 'markers', marker: { color: COLORS.marker, size: 10, line: { color: '#5a320a', width: 1 } }, showlegend: false });

    const layout = baseLayout('Time t (s)', 'Velocity v (m/s, + downward)');
    layout.shapes = [];
    layout.annotations = [];
    [[sim.t95, '95 %'], [sim.t99, '99 %']].forEach(([tt, lab]) => {
      if (tt === null || tt === undefined) return;
      layout.shapes.push({ type: 'line', x0: tt, x1: tt, yref: 'paper', y0: 0, y1: 1, line: { color: '#9aa5b5', width: 1, dash: 'dot' } });
      layout.annotations.push({ x: tt, yref: 'paper', y: 1, text: 't<sub>' + lab.replace(' %', '') + '</sub>', showarrow: false, yanchor: 'bottom', font: { size: 10, color: '#66758a' } });
    });
    if (mode === 'transient') layout.xaxis.range = transientRange(sim);
    layout.margin.t = 18;
    Plotly.react(el, traces, layout, CONFIG);
  }

  function renderPosition(res, sim) {
    const el = 'plotX';
    if (!res || !res.ok || sim.static) { Plotly.react(el, [], baseLayout('Time t (s)', 'Position x (m)'), CONFIG); return; }
    const tr = trajectory(sim, 1800);
    const sol = solutionCurve(sim, tr);
    const traces = [
      { x: tr.T, y: sol.X, name: sol.label('x'), mode: 'lines', line: { color: COLORS.solution, width: 2.5 } },
      { x: [0, sim.tEnd], y: [res.dir * res.params.H, res.dir * res.params.H], name: 'column height H', mode: 'lines', line: { color: '#9aa5b5', dash: 'dash', width: 1.5 } },
    ];
    traces.push({ x: [0], y: [0], name: 'particle now', mode: 'markers', marker: { color: COLORS.marker, size: 10, line: { color: '#5a320a', width: 1 } }, showlegend: false });
    const layout = baseLayout('Time t (s)', 'Position x (m, + downward)');
    Plotly.react(el, traces, layout, CONFIG);
  }

  function renderCd(res) {
    const el = 'plotCd';
    if (!res || !res.ok) { Plotly.react(el, [], baseLayout('Re', 'C_D'), CONFIG); return; }
    // Re range: at least 10⁻³…10⁶, widened to always contain the operating point.
    const lgOp = res.ReIso > 0 ? Math.log10(res.ReIso) : 0;
    const reLo = Math.min(-3, Math.floor(lgOp) - 1), reHi = Math.max(6, Math.ceil(lgOp) + 1);
    const Re = logspace(reLo, reHi, 300);
    const sel = res.params.shapeOn ? 'hl' : res.params.law;
    const w = (k) => (k === sel ? 3.2 : 1.4);
    const op = (k) => (k === sel ? 1 : 0.55);
    const traces = [
      { x: Re, y: Re.map(PS.CD.stokes), name: "Stokes 24/Re", mode: 'lines', line: { color: COLORS.stokes, width: w('stokes') }, opacity: op('stokes') },
      { x: Re, y: Re.map(PS.CD.newton), name: "Newton 0.44", mode: 'lines', line: { color: COLORS.newton, width: w('newton') }, opacity: op('newton') },
      { x: Re, y: Re.map(PS.CD.sn), name: 'Schiller–Naumann', mode: 'lines', line: { color: COLORS.sn, width: w('sn') }, opacity: op('sn') },
    ];
    if (res.params.shapeOn) {
      const c = PS.hlCoefficients(res.params.psi);
      const c1 = PS.hlCoefficients(1);
      const ReH = Re.filter((r) => r <= 2.6e5);
      traces.push({ x: ReH, y: ReH.map((r) => PS.CD.hl(r, c)), name: 'Haider–Levenspiel ψ = ' + res.params.psi, mode: 'lines', line: { color: COLORS.hl, width: w('hl') } });
      traces.push({ x: ReH, y: ReH.map((r) => PS.CD.hl(r, c1)), name: 'Haider–Levenspiel ψ = 1', mode: 'lines', line: { color: COLORS.hl1, width: 1.4, dash: 'dash' } });
    }
    if (res.dir !== 0 && res.ReIso > 0) {
      traces.push({
        x: [res.ReIso], y: [res.cdIso], name: 'operating point', mode: 'markers+text',
        text: ['Re = ' + PS.fmtText(res.ReIso, 3)], textposition: 'top right',
        marker: { color: COLORS.marker, size: 12, symbol: 'diamond', line: { color: '#5a320a', width: 1 } },
      });
    }
    const layout = baseLayout('Particle Reynolds number Re', 'Drag coefficient C_D');
    layout.xaxis.type = 'log';
    layout.yaxis.type = 'log';
    const lgCd = Number.isFinite(res.cdIso) && res.cdIso > 0 ? Math.log10(res.cdIso) : 0;
    layout.yaxis.range = [-1.3, Math.max(5, lgCd + 0.8)];
    // Legend inside the empty lower-left region (low Re, low C_D is never reached by any curve).
    layout.legend = { x: 0.01, y: 0.01, xanchor: 'left', yanchor: 'bottom', bgcolor: 'rgba(255,255,255,0.85)', bordercolor: '#dde3ea', borderwidth: 1, font: { size: 10.5 } };
    layout.shapes = [0.1, 800, 2e5].map((x) => ({ type: 'line', x0: x, x1: x, yref: 'paper', y0: 0, y1: 1, line: { color: '#c4ccd8', width: 1, dash: 'dot' } }));
    layout.annotations = [
      { x: Math.log10(0.1), y: 1, yref: 'paper', text: 'Re = 0.1', showarrow: false, yanchor: 'bottom', font: { size: 10, color: '#66758a' } },
      { x: Math.log10(800), y: 1, yref: 'paper', text: '800', showarrow: false, yanchor: 'bottom', font: { size: 10, color: '#66758a' } },
      { x: Math.log10(2e5), y: 1, yref: 'paper', text: '2×10⁵', showarrow: false, yanchor: 'bottom', font: { size: 10, color: '#66758a' } },
    ];
    layout.margin.t = 18;
    Plotly.react(el, traces, layout, CONFIG);
  }

  let lastMarker = 0;
  /** Move the "particle now" markers (throttled to ~12 Hz). */
  function updateMarkers(state, force) {
    if (!available()) return;
    const now = performance.now();
    if (!force && now - lastMarker < 80) return;
    lastMarker = now;
    ['plotV', 'plotX'].forEach((id) => {
      const gd = document.getElementById(id);
      if (!gd || !gd.data || !gd.data.length) return;
      const idx = gd.data.length - 1;
      Plotly.restyle(gd, { x: [[state.t]], y: [[id === 'plotV' ? state.v : state.x]] }, [idx]);
    });
  }

  PS.plots = { renderAll, renderVelocity, updateMarkers, available };
})(window.PS = window.PS || {});
