/* =====================================================================
 * checks.js — automatic physical / numerical validation checks.
 * Each check re-runs the real model (PS.compute / PS.simulate) with a
 * perturbed input and tests the expected physical trend. Nothing is
 * hard-coded: a check fails if the model misbehaves.
 * ===================================================================== */
(function (PS) {
  'use strict';

  const F = (x) => PS.fmtText(x, 4);

  function runChecks(p, res, sim) {
    const out = [];
    const add = (name, pass, detail, skipped) => out.push({ name, pass, detail, skipped: !!skipped });
    const base = Object.assign({}, p);
    // isolated, uncorrected terminal speed with the active drag law
    const vIsoOf = (q) => { const r = PS.compute(q); return r.ok ? r.vIso : NaN; };

    // 1. Neutral buoyancy → zero net force
    {
      const r = PS.compute(Object.assign({}, base, { rhoP: base.rhoF }));
      add('ρp = ρf ⇒ zero net gravitational force', r.ok && r.Fnet === 0 && r.vFinal === 0,
        'F_net = ' + F(r.Fnet) + ' N, v_t = ' + F(r.vFinal) + ' m/s');
    }
    // 2. Lighter particle rises
    {
      const r = PS.compute(Object.assign({}, base, { rhoP: 0.5 * base.rhoF }));
      const s = r.ok ? PS.simulate(r) : null;
      const pass = r.ok && r.dir === -1 && s && s.vTerm < 0 && s.x[s.x.length - 1] < 0;
      add('ρp < ρf ⇒ particle rises', pass, 'ρp = ' + F(0.5 * base.rhoF) + ' kg/m³ → v_t = ' + (s ? F(s.vTerm) : '—') + ' m/s (negative = upward)');
    }
    const moving = res.dir !== 0;
    const skipStill = (name) => add(name, true, 'skipped: no motion (neutrally buoyant)', true);

    // 3. Larger diameter → faster (isolated particle, no corrections)
    if (!moving) skipStill('Larger d ⇒ faster settling');
    else {
      const q = Object.assign({}, base, { wallOn: false, concOn: false });
      const d2 = base.d * 1.2;
      if (d2 >= base.D) add('Larger d ⇒ faster settling', true, 'skipped: 1.2d would not fit the column', true);
      else {
        const v1 = vIsoOf(q), v2 = vIsoOf(Object.assign({}, q, { d: d2 }));
        add('Larger d ⇒ faster settling', Math.abs(v2) > Math.abs(v1), 'd ×1.2: |v_t| ' + F(Math.abs(v1)) + ' → ' + F(Math.abs(v2)) + ' m/s');
      }
    }
    // 4. Higher viscosity → slower. µ only acts through Re, so the expected trend follows the
    //    local slope of the active C_D(Re): falling C_D ⇒ slower; constant C_D (Newton) ⇒ unchanged;
    //    rising C_D (possible for H-L at low ψ) ⇒ slightly faster.
    if (!moving) skipStill('Higher µ ⇒ slower settling');
    else {
      // A small step (×1.1) keeps the test local, so the slope at the operating point predicts the trend.
      const v1 = vIsoOf(base), v2 = vIsoOf(Object.assign({}, base, { mu: base.mu * 1.1 }));
      const Re0 = res.ReIso, h = 1e-4;
      const slope = (Math.log(res.model.cd(Re0 * (1 + h))) - Math.log(res.model.cd(Re0 * (1 - h)))) / (Math.log(1 + h) - Math.log(1 - h));
      let pass, note;
      if (Math.abs(slope) < 1e-9) {
        pass = Math.abs(v2 - v1) <= 1e-9 * Math.abs(v1);
        note = ' (C_D independent of Re here ⇒ v_t independent of µ, as expected)';
      } else if (Math.abs(slope) < 0.01) {
        pass = Math.abs(v2 - v1) <= 0.01 * Math.abs(v1);
        note = ' (dlnC_D/dlnRe = ' + F(slope) + ' ≈ 0: C_D nearly constant ⇒ v_t practically independent of µ)';
      } else if (slope < 0) {
        pass = Math.abs(v2) < Math.abs(v1);
        note = ' (dlnC_D/dlnRe = ' + F(slope) + ' < 0)';
      } else {
        pass = Math.abs(v2) >= Math.abs(v1);
        note = ' (dlnC_D/dlnRe = ' + F(slope) + ' > 0 for this correlation, so higher µ → lower Re → lower C_D: the active correlation predicts slightly faster settling)';
      }
      add('Higher µ ⇒ slower settling (where C_D falls with Re)', pass, 'µ ×1.1: |v_t| ' + F(Math.abs(v1)) + ' → ' + F(Math.abs(v2)) + ' m/s' + note);
    }
    // 5. Higher fluid density (ρp fixed) → smaller net gravitational force
    {
      const r1 = PS.compute(base), r2 = PS.compute(Object.assign({}, base, { rhoF: base.rhoF * 1.05 }));
      add('Higher ρf (ρp fixed) ⇒ smaller net force', r2.Fnet < r1.Fnet, 'ρf ×1.05: F_net ' + F(r1.Fnet) + ' → ' + F(r2.Fnet) + ' N');
    }
    // 6. Higher concentration → slower hindered settling
    if (!moving) skipStill('Higher φ ⇒ slower hindered settling');
    else {
      const q = Object.assign({}, base, { concOn: true });
      const phi2 = Math.min(base.phi + 0.05, 0.95);
      const r1 = PS.compute(q), r2 = PS.compute(Object.assign({}, q, { phi: phi2 }));
      const pass = base.n > 0 ? Math.abs(r2.vFinal) < Math.abs(r1.vFinal) : Math.abs(r2.vFinal) === Math.abs(r1.vFinal);
      add('Higher φ ⇒ slower hindered settling', pass, 'φ ' + F(base.phi) + ' → ' + F(phi2) + ': |v_h| ' + F(Math.abs(r1.vFinal)) + ' → ' + F(Math.abs(r2.vFinal)) + ' m/s');
    }
    // 7. Narrower column → more wall resistance
    {
      const D2 = base.D * 0.8;
      if (base.d >= D2) add('Smaller D ⇒ more wall resistance', true, 'skipped: particle would not fit a 0.8D column', true);
      else {
        const f1 = PS.wallFactor(base.d / base.D), f2 = PS.wallFactor(base.d / D2);
        add('Smaller D ⇒ more wall resistance', f2 < f1, 'D ×0.8: f_w ' + F(f1) + ' → ' + F(f2));
      }
    }
    // 8. Lower sphericity → more drag, slower (Haider–Levenspiel).
    // A step of 0.2 is used: the H-L fit is not strictly monotonic just below ψ = 1 at
    // intermediate Re (e.g. Re ≈ 40: C_D(0.9) is ~0.4 % below C_D(1)), a property of the correlation.
    if (!moving) skipStill('Lower ψ ⇒ more drag, slower settling');
    else {
      const psi1 = base.psi >= 0.7 ? base.psi : Math.min(1, base.psi + 0.2);
      const psi2 = psi1 - 0.2;
      const q = Object.assign({}, base, { shapeOn: true, wallOn: false, concOn: false });
      const r1 = PS.compute(Object.assign({}, q, { psi: psi1 }));
      const r2 = PS.compute(Object.assign({}, q, { psi: psi2 }));
      const ReRef = r1.ReIso > 0 ? r1.ReIso : 1;
      const cd1 = PS.CD.hl(ReRef, PS.hlCoefficients(psi1)), cd2 = PS.CD.hl(ReRef, PS.hlCoefficients(psi2));
      add('Lower ψ ⇒ more drag, slower settling', cd2 > cd1 && Math.abs(r2.vIso) < Math.abs(r1.vIso),
        'ψ ' + F(psi1) + ' → ' + F(psi2) + ': C_D(Re=' + F(ReRef) + ') ' + F(cd1) + ' → ' + F(cd2) + ', |v_t| ' + F(Math.abs(r1.vIso)) + ' → ' + F(Math.abs(r2.vIso)) + ' m/s');
    }
    // 9. Net force ≈ 0 at terminal velocity
    if (res.dir === 0) add('W − B − F_D = 0 at terminal velocity', true, 'no motion (neutral buoyancy)', true);
    else add('W − B − F_D = 0 at terminal velocity', res.balanceOk, 'relative residual = ' + F(res.residual) + ' (tolerance ' + PS.LIMITS.forceTol + ')');

    // 10. RK4 asymptote equals the iterated terminal velocity
    if (!sim.static && sim.asymptoteDiff !== null) {
      add('RK4 asymptote = iterated terminal velocity', sim.asymptoteDiff < 1e-5, 'relative difference = ' + F(sim.asymptoteDiff));
    } else add('RK4 asymptote = iterated terminal velocity', true, 'not applicable (column too short to reach steady motion, or no motion)', true);

    // 11. Energy balance (notes p.7): work of (W−B) = KE + dissipation
    if (!sim.static) add('Energy balance: (W−B)·H + ½mv₀² = ½mv² + ∫F_D v dt', Math.abs(sim.energy.residual) < 1e-6, 'relative residual = ' + F(sim.energy.residual));
    else add('Energy balance', true, 'no motion', true);

    // 12b. Velocity relaxes monotonically from v₀ to v_t: a first-order ODE dv/dt = a(v) with a
    //      single root v_t cannot overshoot or oscillate.
    if (!sim.static) {
      const s = Math.sign(sim.vTerm - sim.v[0]);
      const tol = 1e-9 * Math.max(Math.abs(sim.vTerm), Math.abs(sim.v[0]));
      // v_t from the iteration is accurate to ~1e-6 (notes p.4 tolerance), so an "overshoot"
      // is only counted beyond that precision.
      const tolOver = 1e-5 * Math.abs(sim.vTerm);
      let ok = true;
      for (let i = 1; i < sim.v.length && ok; i++) {
        if ((sim.v[i] - sim.v[i - 1]) * s < -tol) ok = false;           // reversal
        if ((sim.v[i] - sim.vTerm) * s > tolOver) ok = false;           // overshoot past v_t
      }
      const kind = s > 0 ? 'accelerates' : s < 0 ? 'decelerates' : 'stays at';
      add('v(t) goes monotonically from v₀ to v_t (no overshoot)', ok,
        'v₀ = ' + F(sim.v[0]) + ' → v_t = ' + F(sim.vTerm) + ' m/s: the particle ' + kind + (s === 0 ? ' v_t' : ''));
    } else add('v(t) goes monotonically from v₀ to v_t (no overshoot)', true, 'no motion', true);

    // 12. Stokes numerical vs analytical (same corrections, sphere)
    {
      const q = Object.assign({}, base, { law: 'stokes', shapeOn: false });
      const r = PS.compute(q);
      if (!r.ok || r.dir === 0) add('Stokes: RK4 vs analytical solution', true, 'no motion', true);
      else {
        const s = PS.simulate(r);
        const a = s.analytic;
        const pass = a.errV < 1e-6 && a.errX < 1e-6 && a.errTEnd < 1e-6;
        add('Stokes: RK4 vs analytical solution', pass, 'max |Δv|/v_t = ' + F(a.errV) + ', max rel. Δx = ' + F(a.errX) + ', Δt_total/t = ' + F(a.errTEnd));
      }
    }
    return out;
  }

  PS.runChecks = runChecks;
})(window.PS = window.PS || {});
