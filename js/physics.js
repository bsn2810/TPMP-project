/* =====================================================================
 * physics.js — governing equations of single-particle settling.
 *
 * Primary theoretical reference: the student's handwritten notes
 * "Particle Settling theory.pdf" (cited below as "notes p.N").
 * Anything NOT in the notes is marked [LIT] (literature) or
 * [MODEL] (an explicitly stated modelling choice).
 *
 * Sign convention (notes p.2): z points DOWNWARD. A positive velocity
 * means the particle settles; a negative velocity means it rises.
 * All quantities are in SI units.
 * ===================================================================== */
(function (PS) {
  'use strict';
  const PI = Math.PI;

  /* ------------------------------------------------------------------
   * Validity limits used for warnings.
   *   - stokesOk, newtonMin (=800), snMax (=800): notes p.3–4
   *   - hlReMax, hlPsiMin: notes p.6 (Haider & Levenspiel 1989)
   *   - stokesMax (=1), newtonMax (drag crisis), francis*, rzPhiMax:
   *     [LIT] Clift, Grace & Weber (1978); Richardson & Zaki (1954)
   * ------------------------------------------------------------------ */
  const LIMITS = {
    stokesOk: 0.1,
    stokesMax: 1,
    newtonMin: 800,
    newtonMax: 2e5,
    snMax: 800,
    hlReMax: 25000,
    hlPsiMin: 0.67,
    francisReMax: 0.2,
    francisLambdaMax: 0.97,
    wallCaution: 0.1,
    rzPhiMax: 0.5,
    iterTol: 1e-6,      // notes p.4: |v_{k+1} − v_k| / v_{k+1} < 1e-6
    iterMax: 1000,
    forceTol: 1e-5,     // force balance regarded as converged below this
  };

  const LAW_NAMES = {
    stokes: "Stokes' law",
    newton: "Newton's law (C_D = 0.44)",
    sn: 'Schiller–Naumann',
    hl: 'Haider–Levenspiel (non-spherical)',
  };

  /* ------------------------------------------------------------------
   * Haider–Levenspiel (1989) coefficients — notes p.6.
   * NOTE: the notes write the last terms of C and D_n with ψ²; the
   * published correlation (and the project brief) use ψ³. The ψ³ form
   * is used here (decision confirmed by the student). D_n is renamed K
   * to avoid confusion with the column diameter D.
   * ------------------------------------------------------------------ */
  function hlCoefficients(psi) {
    const p2 = psi * psi, p3 = p2 * psi;
    return {
      A: Math.exp(2.3288 - 6.4581 * psi + 2.4486 * p2),
      B: 0.0964 + 0.5565 * psi,
      C: Math.exp(4.905 - 13.8944 * psi + 18.4222 * p2 - 10.2599 * p3),
      K: Math.exp(1.4681 + 12.2584 * psi - 20.7322 * p2 + 15.8855 * p3),
    };
  }

  /* ------------------------------------------------------------------
   * Drag-coefficient correlations C_D(Re) — notes p.3, p.5.
   * ------------------------------------------------------------------ */
  const CD = {
    stokes: (Re) => 24 / Re,                                    // notes p.4
    newton: () => 0.44,                                         // notes p.3
    sn: (Re) => (24 / Re) * (1 + 0.15 * Math.pow(Re, 0.687)),  // notes p.3
    hl: (Re, c) => (24 / Re) * (1 + c.A * Math.pow(Re, c.B)) + c.C / (1 + c.K / Re), // notes p.5
  };

  /**
   * Build a drag model for a particle of diameter d in a fluid (ρf, µ).
   * Each model provides:
   *   cd(Re)    — drag coefficient
   *   force(u)  — drag MAGNITUDE (N) at speed u ≥ 0.
   * force(u) is written in closed form (e.g. 3πµdu·(1+0.15Re^0.687))
   * so it is finite at u = 0, avoiding the 0·∞ of C_D = 24/Re.
   * It is algebraically identical to F_D = ½ C_D ρf u² A_p (notes p.2).
   */
  function makeDragModel(key, p, psi) {
    const d = p.d, mu = p.mu, rhoF = p.rhoF;
    const Ap = PI * d * d / 4;                       // notes p.1
    const Re = (u) => rhoF * u * d / mu;             // notes p.3
    const stokesForce = (u) => 3 * PI * mu * d * u;  // notes p.3
    switch (key) {
      case 'stokes':
        return { key, name: LAW_NAMES.stokes, cd: CD.stokes, force: stokesForce };
      case 'newton':
        return { key, name: LAW_NAMES.newton, cd: CD.newton,
          force: (u) => 0.5 * 0.44 * rhoF * u * u * Ap };
      case 'sn':
        return { key, name: LAW_NAMES.sn, cd: CD.sn,
          force: (u) => stokesForce(u) * (1 + 0.15 * Math.pow(Re(u), 0.687)) };
      case 'hl': {
        const c = hlCoefficients(psi);
        return {
          key, name: LAW_NAMES.hl, coeffs: c, psi,
          cd: (R) => CD.hl(R, c),
          // ½ρu²A·[24/Re(1+A Re^B)] = 3πµdu(1+A Re^B);  ½ρu²A·C/(1+K/Re) = ½ρu²A·C·Re/(Re+K)
          force: (u) => {
            const R = Re(u);
            return stokesForce(u) * (1 + c.A * Math.pow(R, c.B)) +
              0.5 * rhoF * u * u * Ap * c.C * R / (R + c.K);
          },
        };
      }
      default:
        throw new Error('Unknown drag law: ' + key);
    }
  }

  /**
   * Terminal velocity (magnitude) of the ISOLATED particle, i.e. the speed
   * at which drag balances |W − B| (notes p.2: F_d = (ρp − ρf) V_p g).
   *   Stokes : v_t = Δρ g d² / (18µ)                      (notes p.3)
   *   Newton : v_t = √[4Δρ g d / (3 C_D ρf)]               (notes p.3)
   *   S-N, H-L: fixed-point iteration of notes p.4:
   *      start from Stokes v_t → Re → C_D → v_{k+1} = √[4Δρgd/(3ρf C_D,k)]
   *      until |v_{k+1} − v_k| / v_{k+1} < 1e-6.
   * A bisection on the force balance is kept only as a safety fallback.
   */
  function terminalVelocity(model, p, Fabs) {
    if (!(Fabs > 0)) {
      return { v: 0, iterations: 0, converged: true, relChange: 0, method: 'no net force', history: [0] };
    }
    const d = p.d, mu = p.mu, rhoF = p.rhoF;
    const Ap = PI * d * d / 4;
    const vStokes = Fabs / (3 * PI * mu * d);          // = Δρ g d²/(18µ)
    const vFromCd = (cd) => Math.sqrt(2 * Fabs / (rhoF * cd * Ap)); // = √[4Δρgd/(3ρf C_D)]

    if (model.key === 'stokes') {
      return { v: vStokes, iterations: 0, converged: true, relChange: 0, method: 'analytical (notes p.3)', history: [vStokes] };
    }
    if (model.key === 'newton') {
      const v = vFromCd(0.44);
      return { v, iterations: 0, converged: true, relChange: 0, method: 'analytical (notes p.3)', history: [v] };
    }

    // Iterative solution — notes p.4
    let v = vStokes, it = 0, rel = Infinity;
    const history = [v];
    while (it < LIMITS.iterMax) {
      it++;
      const Re = rhoF * v * d / mu;
      const vNew = vFromCd(model.cd(Re));
      rel = Math.abs(vNew - v) / vNew;
      v = vNew;
      history.push(v);
      if (rel < LIMITS.iterTol) break;
    }
    let converged = rel < LIMITS.iterTol && Number.isFinite(v);
    let method = 'fixed-point iteration (notes p.4)';
    const resid = Math.abs(model.force(v) - Fabs) / Fabs;
    if (!converged || resid > 1e-4) {
      v = bisectTerminal(model, Fabs, vStokes);
      method += ' → bisection fallback';
      converged = Math.abs(model.force(v) - Fabs) / Fabs < 1e-9;
    }
    return { v, iterations: it, converged, relChange: rel, method, history };
  }

  /** Bisection on force(u) = Fabs (force(u) increases monotonically with u). */
  function bisectTerminal(model, Fabs, guess) {
    let lo = 0, hi = Math.max(guess, 1e-12);
    let guard = 0;
    while (model.force(hi) < Fabs && guard++ < 400) hi *= 2;
    for (let i = 0; i < 300; i++) {
      const mid = 0.5 * (lo + hi);
      if (model.force(mid) < Fabs) lo = mid; else hi = mid;
      if ((hi - lo) / hi < 1e-15) break;
    }
    return 0.5 * (lo + hi);
  }

  /** Francis (1933) wall factor — notes p.5: f_w = [(1 − λ)/(1 − 0.475λ)]⁴, λ = d/D. */
  function wallFactor(lambda) {
    return Math.pow((1 - lambda) / (1 - 0.475 * lambda), 4);
  }

  /** Richardson–Zaki (1954) hindrance factor — notes p.5: v_h/v_t = (1 − φ)ⁿ. */
  function rzFactor(phi, n) {
    return Math.pow(1 - phi, n);
  }

  /**
   * [LIT] Richardson & Zaki (1954) correlation for n (no wall term),
   * shown only as guidance; the user-entered n (default 4.65) is used.
   */
  function rzExponentRecommended(Re) {
    if (Re < 0.2) return 4.65;
    if (Re < 1) return 4.35 * Math.pow(Re, -0.03);
    if (Re < 500) return 4.45 * Math.pow(Re, -0.1);
    return 2.39;
  }

  /** Flow-regime label from the particle Reynolds number. */
  function regimeOf(Re) {
    if (!(Re > 0)) return 'No motion';
    if (Re <= LIMITS.stokesOk) return 'Stokes (creeping-flow) regime';
    if (Re <= LIMITS.newtonMin) return 'Intermediate (transitional) regime';
    if (Re <= LIMITS.newtonMax) return 'Newton regime (C_D ≈ const)';
    return 'Beyond drag crisis (Re > 2×10⁵)';
  }

  /** Input validation. Returns a list of error strings. */
  function validate(p) {
    const e = [];
    const pos = (v, name) => { if (!(Number.isFinite(v) && v > 0)) e.push(name + ' must be a positive number.'); };
    pos(p.d, 'Particle diameter d');
    pos(p.rhoP, 'Particle density ρp');
    pos(p.rhoF, 'Fluid density ρf');
    pos(p.mu, 'Dynamic viscosity µ');
    pos(p.g, 'Gravitational acceleration g');
    pos(p.H, 'Column height H');
    pos(p.D, 'Column diameter D');
    if (!(Number.isFinite(p.psi) && p.psi > 0 && p.psi <= 1)) e.push('Sphericity ψ must satisfy 0 < ψ ≤ 1.');
    if (!(Number.isFinite(p.phi) && p.phi >= 0 && p.phi < 1)) e.push('Volume fraction φ must satisfy 0 ≤ φ < 1.');
    if (!(Number.isFinite(p.n) && p.n >= 0)) e.push('Richardson–Zaki exponent n must be ≥ 0.');
    if (!(Number.isFinite(p.v0) && p.v0 >= 0)) e.push('Initial velocity v₀ must be ≥ 0 (it is the entry speed in the direction of motion).');
    // With wall effects OFF the column is treated as unbounded (D is not used), so d ≥ D is only a warning then.
    if (p.wallOn && Number.isFinite(p.d) && Number.isFinite(p.D) && p.D > 0 && p.d >= p.D) {
      e.push('Particle diameter d must be smaller than the column diameter D (d/D = ' + (p.d / p.D).toFixed(3) + ').');
    }
    return e;
  }

  /**
   * Main steady-state calculation. Returns every quantity the UI shows.
   * p = { d, rhoP, psi, rhoF, mu, g, H, D, phi, n, law, wallOn, concOn, shapeOn }
   */
  function compute(p) {
    if (p.v0 === undefined) p = Object.assign({}, p, { v0: 0 });   // notes: v(0) = 0
    const errors = validate(p);
    if (errors.length) return { ok: false, errors, params: p };

    // --- Geometry and forces (notes p.1–2) ---------------------------
    const V = PI * p.d ** 3 / 6;
    const Ap = PI * p.d ** 2 / 4;
    const m = p.rhoP * V;
    const W = p.rhoP * p.g * V;          // weight
    const B = p.rhoF * p.g * V;          // buoyancy (Archimedes)
    const Fnet = W - B;                  // net gravitational force (signed, + down)
    const Fabs = Math.abs(Fnet);
    const dir = Fnet > 0 ? 1 : (Fnet < 0 ? -1 : 0);
    const drho = p.rhoP - p.rhoF;

    // --- Archimedes number and notes p.4 regime recommendation --------
    const Ar = p.rhoF * Math.abs(drho) * p.g * p.d ** 3 / (p.mu * p.mu);
    const ReStokesAr = Ar / 18;

    // --- Drag models ---------------------------------------------------
    const sphereModel = makeDragModel(p.law, p);
    const model = p.shapeOn ? makeDragModel('hl', p, p.psi) : sphereModel;
    const iso = terminalVelocity(model, p, Fabs);
    const sphere = p.shapeOn ? terminalVelocity(sphereModel, p, Fabs) : iso;

    // Shape-effect reference values (shown in the non-spherical card): H-L at the chosen ψ
    // compared with H-L at ψ = 1, which separates the pure shape effect from the
    // difference between correlations.
    const hlPsi = p.shapeOn ? iso : null;
    const hlSphere = p.shapeOn ? terminalVelocity(makeDragModel('hl', p, 1), p, Fabs) : null;

    let recommendedLaw = 'stokes';
    let snForRec = null;
    if (Fabs > 0 && ReStokesAr > LIMITS.stokesOk) {
      snForRec = terminalVelocity(makeDragModel('sn', p), p, Fabs);
      const ReSN = p.rhoF * snForRec.v * p.d / p.mu;
      recommendedLaw = ReSN > LIMITS.newtonMin ? 'newton' : 'sn';
    }

    // --- Corrections (notes p.5) ---------------------------------------
    const lambda = p.d / p.D;
    const fwCalc = lambda < 1 ? wallFactor(lambda) : NaN;   // undefined if the particle cannot fit
    const fRZCalc = rzFactor(p.phi, p.n);
    const fw = p.wallOn ? fwCalc : 1;
    const fRZ = p.concOn ? fRZCalc : 1;
    const f = fw * fRZ;              // [MODEL] multiplicative combination

    const vIso = iso.v;              // uncorrected (isolated) terminal speed
    const vWall = vIso * fw;
    const vConc = vWall * fRZ;
    const vFinal = vIso * f;

    // --- Dimensionless numbers -----------------------------------------
    const ReIso = p.rhoF * vIso * p.d / p.mu;    // Re at which the drag law is evaluated
    const ReFinal = p.rhoF * vFinal * p.d / p.mu;
    const cdIso = vIso > 0 ? model.cd(ReIso) : NaN;

    // --- Force balance at terminal velocity -----------------------------
    // [MODEL] quasi-steady effective drag F_eff(v) = F_D(v/f); at v = f·v_iso
    // this gives F_D(v_iso) which must equal |W − B|.
    const FdEff = vFinal > 0 ? model.force(vFinal / f) : 0;
    const FdFromCd = vIso > 0 ? 0.5 * cdIso * p.rhoF * vIso * vIso * Ap : 0;  // notes p.2 form
    const residual = Fabs > 0 ? (Fabs - FdEff) / Fabs : 0;
    const balanceOk = Math.abs(residual) < LIMITS.forceTol;

    // Energy balance at terminal velocity (notes p.7)
    const Pg = Fabs * vFinal;
    const Pd = FdEff * vFinal;

    const res = {
      ok: true, params: p,
      V, Ap, m, W, B, Fnet, Fabs, dir, drho,
      Ar, ReStokesAr, recommendedLaw,
      model, sphereModel, iso, sphere, hlPsi, hlSphere,
      lambda, fwCalc, fRZCalc, fw, fRZ, f,
      vIso, vWall, vConc, vFinal,
      ReIso, ReFinal, cdIso, regime: regimeOf(ReIso),
      FdEff, FdFromCd, residual, balanceOk, Pg, Pd,
      rzNRecommended: rzExponentRecommended(ReIso),
      tauStokes: p.rhoP * p.d * p.d / (18 * p.mu),
    };

    res.warnings = buildWarnings(res);
    res.validity = lawValidity(res);
    return res;
  }

  /** Validity status of the active drag law. */
  function lawValidity(r) {
    const Re = r.ReIso, key = r.model.key, L = LIMITS;
    if (r.dir === 0) return { level: 'info', text: 'No motion (neutrally buoyant)' };
    switch (key) {
      case 'stokes':
        if (Re <= L.stokesOk) return { level: 'ok', text: 'Valid (Re ≤ 0.1)' };
        if (Re <= L.stokesMax) return { level: 'caution', text: 'Marginal (0.1 < Re ≤ 1)' };
        return { level: 'warning', text: 'Outside range (Re > 1)' };
      case 'newton':
        if (Re < L.newtonMin) return { level: 'warning', text: 'Re too low (< 800)' };
        if (Re > L.newtonMax) return { level: 'warning', text: 'Re > 2×10⁵ (drag crisis)' };
        return { level: 'ok', text: 'Valid (800 ≤ Re ≤ 2×10⁵)' };
      case 'sn':
        if (Re > L.snMax) return { level: 'warning', text: 'Outside range (Re > 800)' };
        return { level: 'ok', text: 'Valid (Re ≤ 800)' };
      case 'hl': {
        const bad = [];
        if (Re >= L.hlReMax) bad.push('Re ≥ 25 000');
        if (r.params.psi < L.hlPsiMin) bad.push('ψ < 0.67');
        return bad.length ? { level: 'warning', text: 'Outside range (' + bad.join(', ') + ')' } : { level: 'ok', text: 'Valid (Re < 25 000, ψ ≥ 0.67)' };
      }
    }
    return { level: 'info', text: '' };
  }

  /** Physical / applicability warnings. level ∈ info | caution | warning. */
  function buildWarnings(r) {
    const w = [];
    const p = r.params, L = LIMITS, Re = r.ReIso;
    const add = (level, text) => w.push({ level, text });

    if (r.dir === 0) add('warning', 'Neutrally buoyant (ρp = ρf): the net gravitational force is zero, so the particle stays at rest.');
    if (r.dir < 0) add('warning', 'Particle is lighter than the fluid (ρp < ρf): it RISES. Drag is applied opposite to the (upward) motion.');

    if (r.dir !== 0) {
      const key = r.model.key;
      if (key === 'stokes' && Re > L.stokesOk) {
        add(Re > L.stokesMax ? 'warning' : 'caution', "Stokes' law: Re = " + PS.fmtText(Re, 3) + ' exceeds the Stokes regime (Re ≤ 0.1, notes p.4). Stokes over-predicts the settling velocity here.');
      }
      if (key === 'newton' && Re < L.newtonMin) {
        add('warning', "Newton's law: Re = " + PS.fmtText(Re, 3) + ' is too low for a constant C_D = 0.44 (needs Re ≳ 800, notes p.4).');
      }
      if (key === 'newton' && Re > L.newtonMax) {
        add('warning', "Newton's law: Re > 2×10⁵ — beyond the drag crisis C_D falls well below 0.44 [Clift et al. 1978].");
      }
      if (key === 'sn' && Re > L.snMax) {
        add('warning', 'Schiller–Naumann: Re = ' + PS.fmtText(Re, 3) + ' is above the recommended range (Re ≤ 800, notes p.3).');
      }
      if (key === 'hl') {
        if (Re >= L.hlReMax) add('warning', 'Haider–Levenspiel: Re = ' + PS.fmtText(Re, 3) + ' ≥ 25 000 (notes p.6 range).');
        if (p.psi < L.hlPsiMin) add('warning', 'Haider–Levenspiel: ψ = ' + p.psi + ' < 0.67 is outside the recommended sphericity range (notes p.6).');
      }
      if (!r.iso.converged) add('warning', 'Terminal-velocity iteration did not converge.');
    }

    if (p.shapeOn) {
      add('info', 'Non-spherical mode: Haider–Levenspiel replaces the selected spherical law (' + LAW_NAMES[p.law] + '). d is treated as the volume-equivalent diameter.');
      if (p.psi === 1) add('info', 'ψ = 1: H-L describes a sphere, but its fit differs slightly from Schiller–Naumann.');
    }

    // Wall effects
    if (p.wallOn) {
      if (r.lambda > L.francisLambdaMax) add('warning', 'Francis correction: d/D = ' + PS.fmtText(r.lambda, 3) + ' > 0.97 is outside its range.');
      else if (r.lambda > L.wallCaution) add('caution', 'Large particle-to-column ratio d/D = ' + PS.fmtText(r.lambda, 3) + ' (> 0.1): strong wall retardation.');
      if (Re > L.francisReMax && r.dir !== 0) add('caution', 'Francis (1933) is a creeping-flow correction (Re ≲ 0.2). At Re = ' + PS.fmtText(Re, 3) + ' it over-estimates wall retardation [Clift et al. 1978].');
    } else if (r.lambda >= 1) {
      add('warning', 'd ≥ D: the particle is larger than the column diameter (d/D = ' + PS.fmtText(r.lambda, 3) + '). Wall effects are OFF, so the fluid is treated as unbounded. Enable wall effects to set a realistic D.');
    } else if (r.lambda > L.wallCaution) {
      add('caution', 'd/D = ' + PS.fmtText(r.lambda, 3) + ' > 0.1: wall effects are likely significant — consider enabling the wall correction.');
    }

    // Concentration effects
    if (p.concOn) {
      if (p.phi > L.rzPhiMax) add('warning', 'Richardson–Zaki: φ = ' + p.phi + ' > 0.5 is beyond the usual range of the correlation.');
      if (r.dir !== 0 && Math.abs(p.n - r.rzNRecommended) / r.rzNRecommended > 0.05) {
        add('info', 'Richardson–Zaki exponent: n = ' + p.n + ' is used; the R-Z correlation suggests n ≈ ' + PS.fmtText(r.rzNRecommended, 3) + ' at Re = ' + PS.fmtText(Re, 3) + ' [Richardson & Zaki 1954]. n = 4.65 strictly applies for Re < 0.2.');
      }
    }

    // Initial velocity (extension beyond the notes, which use v(0) = 0)
    if (p.v0 > 0) {
      if (r.dir === 0) {
        add('warning', 'v₀ is ignored: with no net gravitational force the particle would only coast to rest, and the model keeps it stationary.');
      } else {
        const ratio = p.v0 / r.vFinal;
        const what = ratio > 1 + 1e-9 ? 'starts faster than v_t, so drag exceeds W − B and the particle DECELERATES to v_t'
          : ratio < 1 - 1e-9 ? 'starts slower than v_t, so the particle accelerates to v_t' : 'already equals v_t, so the motion is uniform from the start';
        add('info', 'Initial velocity v₀ = ' + PS.fmtText(p.v0, 3) + ' m/s (v₀/v_t = ' + PS.fmtText(ratio, 3) + '): the particle ' + what +
          '. This extends the notes, which use v(0) = 0. v₀ is the entry speed in the direction of motion.');
      }
    }

    const nCorr = (p.wallOn ? 1 : 0) + (p.concOn ? 1 : 0);
    if (nCorr > 0) {
      add('info', 'Quasi-steady approximation: wall/concentration factors are terminal-velocity corrections. In the transient model they act through F_eff(v) = F_D(v / f), so the motion tends exactly to f·v_t. They are not independently derived drag forces.');
    }
    if (nCorr + (p.shapeOn ? 1 : 0) >= 2) {
      add('caution', 'Several effects are combined multiplicatively — an engineering approximation; the effects may interact and not be independent.');
    }
    return w;
  }

  PS.LIMITS = LIMITS;
  PS.LAW_NAMES = LAW_NAMES;
  PS.hlCoefficients = hlCoefficients;
  PS.CD = CD;
  PS.makeDragModel = makeDragModel;
  PS.terminalVelocity = terminalVelocity;
  PS.wallFactor = wallFactor;
  PS.rzFactor = rzFactor;
  PS.rzExponentRecommended = rzExponentRecommended;
  PS.validate = validate;
  PS.compute = compute;
})(window.PS = window.PS || {});
