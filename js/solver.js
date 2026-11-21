/* =====================================================================
 * solver.js — time-dependent motion of the particle (notes p.6).
 *
 *   ρp V_p dv/dt = (ρp − ρf) g V_p − F_D(v)          (notes p.6)
 *   dx/dt = v,   v(0) = 0,  x(0) = 0
 *
 * Integrated with the classical 4th-order Runge–Kutta method.
 * A third state E(t) = ∫ F_D·v dt (energy dissipated by drag) is
 * integrated alongside, so the energy balance of notes p.7 can be checked:
 *   work done by (W − B) = kinetic energy + energy dissipated.
 *
 * [MODEL] Wall / concentration corrections enter quasi-steadily as
 *   F_eff(v) = F_D(|v| / f) · sign(v),  f = f_w · f_RZ,
 * which makes the motion approach exactly f·v_t (the corrected terminal
 * velocity). For Stokes drag this is the same as dividing the drag by f.
 *
 * [LIT] Added-mass and Basset history forces are neglected, consistent
 * with the notes' τ = ρp d²/(18µ).
 * ===================================================================== */
(function (PS) {
  'use strict';

  const STEPS_PER_TAU = 400;   // RK4 steps per (local) characteristic time

  /**
   * Simulate the motion for a result object returned by PS.compute().
   * Returns arrays t, x, v, E for the transient, plus helpers to evaluate
   * the state at any time (used by the animation).
   */
  function simulate(res) {
    const p = res.params;
    const m = res.m;
    const Fg = res.Fnet;           // signed net gravitational force (+ down)
    const f = res.f;
    const model = res.model;
    const H = p.H;

    if (res.dir === 0) {
      // Neutrally buoyant: no motion at all.
      return {
        static: true, t: [0], x: [0], v: [0], E: [0],
        tEnd: Infinity, vTerm: 0, t95: null, t99: null, Tchar: Infinity,
        at: () => ({ t: 0, x: 0, v: 0 }),
      };
    }

    // Signed drag force, always opposing the velocity.
    const drag = (v) => (v === 0 ? 0 : Math.sign(v) * model.force(Math.abs(v) / f));
    const acc = (v) => (Fg - drag(v)) / m;

    const vTermPred = res.dir * res.vFinal;          // from the terminal-velocity solver
    // [EXTENSION] initial velocity v₀ ≥ 0 along the direction of motion (notes: v₀ = 0).
    const v0s = res.dir * (p.v0 || 0);
    const a0 = Math.abs(Fg) / m;                     // acceleration from rest |Δρ| g / ρp
    const Tchar = Math.abs(vTermPred) / a0;          // characteristic time (= f·τ for Stokes)

    /**
     * Adaptive step size (re-evaluated every step), resolving every relevant time scale:
     *   Tchar       : approach to terminal velocity
     *   m/(dF/dv)   : local relaxation time at the current v — much shorter than Tchar when
     *                 v ≫ v_t and drag ∝ v², and it grows as the particle slows down
     *   √(2H/a0)    : free-fall time (particles that hit the bottom while still accelerating)
     *   H/|v|       : time to cross the column at the current speed
     * For v₀ = 0 (and always for Stokes drag) this reduces to a constant step.
     */
    const tFree = Math.sqrt(2 * H / a0);
    function stepSize(vs) {
      let s = Math.min(Tchar, tFree);
      const av = Math.abs(vs);
      if (av > Math.abs(vTermPred)) {                  // only above v_t can the local time be shorter
        const hv = 1e-6 * av;
        const dFdv = Math.abs(drag(vs + hv) - drag(vs - hv)) / (2 * hv);
        if (dFdv > 0) s = Math.min(s, m / dFdv);
        s = Math.min(s, H / av);
      }
      return s / STEPS_PER_TAU;
    }
    let dt = stepSize(v0s), dtMin = Infinity, dtMax = 0;

    /** One classical RK4 step of size h on the state (x, v, E). */
    function rk4(xs, vs, Es, h) {
      const k1v = acc(vs),               k1x = vs,                  k1e = drag(vs) * vs;
      const v2 = vs + 0.5 * h * k1v;
      const k2v = acc(v2),               k2x = v2,                  k2e = drag(v2) * v2;
      const v3 = vs + 0.5 * h * k2v;
      const k3v = acc(v3),               k3x = v3,                  k3e = drag(v3) * v3;
      const v4 = vs + h * k3v;
      const k4v = acc(v4),               k4x = v4,                  k4e = drag(v4) * v4;
      return {
        x: xs + h / 6 * (k1x + 2 * k2x + 2 * k3x + k4x),
        v: vs + h / 6 * (k1v + 2 * k2v + 2 * k3v + k4v),
        E: Es + h / 6 * (k1e + 2 * k2e + 2 * k3e + k4e),
      };
    }

    const t = [0], x = [0], v = [v0s], E = [0];
    let ti = 0, xi = 0, vi = v0s, Ei = 0;
    let reachedBottom = false;
    const maxSteps = 400000;   // safety cap; typical runs need 2 000 – 40 000 steps

    for (let k = 0; k < maxSteps; k++) {
      dt = stepSize(vi);
      if (dt < dtMin) dtMin = dt;
      if (dt > dtMax) dtMax = dt;
      const nx = rk4(xi, vi, Ei, dt);

      if (Math.abs(nx.x) >= H) {
        // Bottom (or top, for a rising particle) is reached inside this step.
        // Find the exact partial step h with |x(h)| = H by secant iteration on RK4 itself.
        let h0 = 0, f0 = Math.abs(xi) - H;
        let h1 = dt, f1 = Math.abs(nx.x) - H;
        let h = dt, st = nx;
        for (let it = 0; it < 50; it++) {
          h = h1 - f1 * (h1 - h0) / (f1 - f0);
          st = rk4(xi, vi, Ei, h);
          const fh = Math.abs(st.x) - H;
          if (Math.abs(fh) <= 1e-13 * H) break;
          h0 = h1; f0 = f1; h1 = h; f1 = fh;
        }
        ti += h; xi = res.dir * H; vi = st.v; Ei = st.E;
        t.push(ti); x.push(xi); v.push(vi); E.push(Ei);
        reachedBottom = true;
        break;
      }

      ti += dt; xi = nx.x; vi = nx.v; Ei = nx.E;
      t.push(ti); x.push(xi); v.push(vi); E.push(Ei);

      // Transient finished: residual acceleration negligible.
      if (ti >= 5 * Tchar && Math.abs(acc(vi)) * Tchar <= 1e-11 * Math.abs(vi)) break;
    }

    // After the transient the motion is uniform at the ODE's own asymptote.
    const vTerm = reachedBottom ? vTermPred : vi;
    const tSwitch = ti, xSwitch = xi, ESwitch = Ei;
    const tEnd = reachedBottom ? ti : tSwitch + (H - Math.abs(xSwitch)) / Math.abs(vTerm);

    /** State at arbitrary time τ (linear interpolation inside the transient). */
    function at(time) {
      if (time <= 0) return { t: 0, x: 0, v: v0s };
      if (time >= tEnd) time = tEnd;
      if (time <= tSwitch) {
        let lo = 0, hi = t.length - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (t[mid] <= time) lo = mid; else hi = mid;
        }
        const s = t[hi] > t[lo] ? (time - t[lo]) / (t[hi] - t[lo]) : 0;
        return { t: time, x: x[lo] + s * (x[hi] - x[lo]), v: v[lo] + s * (v[hi] - v[lo]) };
      }
      return { t: time, x: xSwitch + vTerm * (time - tSwitch), v: vTerm };
    }

    /**
     * First time at which a fraction q of the velocity change v₀ → v_t has taken place,
     * i.e. |v − v_t| ≤ (1 − q)|v_t − v₀| (linear interpolation), or null if not reached.
     * For v₀ = 0 this is "|v| ≥ q·v_t"; for Stokes it is τ ln[1/(1 − q)] for any v₀.
     */
    function timeToFraction(q) {
      const dv0 = Math.abs(vTerm - v0s);
      if (dv0 === 0) return 0;
      const target = (1 - q) * dv0;
      for (let i = 1; i < t.length; i++) {
        const b = Math.abs(v[i] - vTerm);
        if (b <= target) {
          const a = Math.abs(v[i - 1] - vTerm);
          return t[i - 1] + (a - target) / (a - b) * (t[i] - t[i - 1]);
        }
      }
      return reachedBottom ? null : tSwitch;
    }

    // --- Energy balance over the whole fall (notes p.7) ---------------
    //   work of (W − B) + initial KE = final KE + energy dissipated by drag
    const dist = reachedBottom ? Math.abs(xi) : H;
    const workGravity = Math.abs(Fg) * dist;                       // ∫(W−B)·v dt
    const KE0 = 0.5 * m * v0s * v0s;
    const vEnd = reachedBottom ? vi : vTerm;
    const KE = 0.5 * m * vEnd * vEnd;
    const Ediss = ESwitch + (reachedBottom ? 0 : Math.abs(drag(vTerm) * vTerm) * (tEnd - tSwitch));
    const energyResidual = (workGravity + KE0 - KE - Ediss) / (workGravity + KE0);

    const sim = {
      static: false, t, x, v, E, dtMin, dtMax, Tchar, v0: v0s,
      Fg,          // net gravitational force (ρp − ρf) g V_p, + downward
      drag,        // F_D(v) exactly as used in the ODE (signed, includes the quasi-steady corrections)
      tSwitch, xSwitch, tEnd, vTerm, vTermPred, reachedBottomInTransient: reachedBottom,
      t95: timeToFraction(0.95), t99: timeToFraction(0.99),
      energy: { workGravity, KE0, KE, Ediss, residual: energyResidual },
      asymptoteDiff: reachedBottom ? null : Math.abs(vTerm - vTermPred) / Math.abs(vTermPred),
      at,
    };

    if (model.key === 'stokes') sim.analytic = stokesAnalytic(res, sim);
    return sim;
  }

  /**
   * Analytical Stokes solution — used to validate RK4.
   * Notes p.6 (v₀ = 0):  v(t) = v_t (1 − e^{−t/τ}),  x(t) = v_t [t − τ (1 − e^{−t/τ})]
   * [EXTENSION] same linear ODE with v(0) = v₀:
   *   v(t) = v_t + (v₀ − v_t) e^{−t/τ},   x(t) = v_t t + (v₀ − v_t) τ (1 − e^{−t/τ})
   * which reduces to the notes' result for v₀ = 0.
   * With the quasi-steady correction f the time constant becomes τ_eff = f·τ.
   */
  function stokesAnalytic(res, sim) {
    const p = res.params;
    const tau = res.f * p.rhoP * p.d * p.d / (18 * p.mu);
    const vt = res.dir * res.vFinal;
    const v0 = sim.v0;
    const vA = (tt) => vt + (v0 - vt) * Math.exp(-tt / tau);
    const xA = (tt) => vt * tt + (v0 - vt) * tau * (1 - Math.exp(-tt / tau));

    const vScale = Math.max(Math.abs(vt), Math.abs(v0));
    let errV = 0, errX = 0;
    for (let i = 0; i < sim.t.length; i++) {
      errV = Math.max(errV, Math.abs(sim.v[i] - vA(sim.t[i])) / vScale);
      const scale = Math.max(Math.abs(xA(sim.t[i])), vScale * tau * 1e-3);
      if (sim.t[i] > 0) errX = Math.max(errX, Math.abs(sim.x[i] - xA(sim.t[i])) / scale);
    }
    // Analytical time to travel H: |x_A(t)| increases monotonically, so bisect on [0, t_hi].
    let lo = 0, hi = p.H / Math.abs(vt) + 10 * tau;
    while (Math.abs(xA(hi)) < p.H) hi *= 2;
    for (let k = 0; k < 200; k++) {
      const mid = 0.5 * (lo + hi);
      if (Math.abs(xA(mid)) < p.H) lo = mid; else hi = mid;
      if (hi - lo <= 1e-15 * hi) break;
    }
    const tt = 0.5 * (lo + hi);
    return {
      tau, vt, vA, xA, errV, errX,
      tEnd: tt, errTEnd: Math.abs(sim.tEnd - tt) / tt,
      t95: tau * Math.log(20), t99: tau * Math.log(100),
    };
  }

  PS.simulate = simulate;
})(window.PS = window.PS || {});
