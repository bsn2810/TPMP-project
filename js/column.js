/* =====================================================================
 * column.js — draws the single transparent settling column and the
 * single particle on a <canvas>. Purely visual: the particle position
 * comes from the RK4 solution (PS.simulate), never from random motion.
 * ===================================================================== */
(function (PS) {
  'use strict';

  function ColumnView(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.res = null;
    this.sim = null;
    this.state = { t: 0, x: 0, v: 0 };
    this.terminalReached = false;
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas.parentElement);
    this.resize();
  }

  ColumnView.prototype.resize = function () {
    const box = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(220, Math.floor(box.width));
    const h = Math.max(380, Math.floor(box.height));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    this.draw();
  };

  ColumnView.prototype.setModel = function (res, sim) {
    this.res = res; this.sim = sim;
    this.state = { t: 0, x: 0, v: 0 };
    this.terminalReached = false;
    this.draw();
  };

  ColumnView.prototype.setState = function (state, terminalReached) {
    this.state = state;
    this.terminalReached = terminalReached;
    this.draw();
  };

  /** Choose a "nice" tick spacing for the height ruler. */
  function niceStep(range, target) {
    const raw = range / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  ColumnView.prototype.draw = function () {
    const ctx = this.ctx, W = this.w, Hc = this.h;
    if (!W) return;
    ctx.clearRect(0, 0, W, Hc);

    // Column geometry (pixels)
    const top = 34, bottom = Hc - 50;
    const colW = Math.min(150, Math.max(90, W * 0.38));
    const cx = W * 0.56;
    const left = cx - colW / 2, right = cx + colW / 2;
    const fluidTop = top + 10;

    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim() || '#1b2533';
    const muted = css.getPropertyValue('--muted').trim() || '#66758a';

    // Fluid
    const grad = ctx.createLinearGradient(left, 0, right, 0);
    grad.addColorStop(0, 'rgba(56,132,200,0.22)');
    grad.addColorStop(0.5, 'rgba(56,132,200,0.10)');
    grad.addColorStop(1, 'rgba(56,132,200,0.22)');
    ctx.fillStyle = grad;
    ctx.fillRect(left, fluidTop, colW, bottom - fluidTop);
    // free surface
    ctx.strokeStyle = 'rgba(40,110,180,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(left, fluidTop); ctx.lineTo(right, fluidTop); ctx.stroke();

    // Glass walls
    ctx.strokeStyle = 'rgba(70,90,115,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(left, top); ctx.lineTo(left, bottom);
    ctx.lineTo(right, bottom); ctx.lineTo(right, top);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(left + 6, top + 14); ctx.lineTo(left + 6, bottom - 14); ctx.stroke();

    const res = this.res;
    if (!res || !res.ok) {
      ctx.fillStyle = muted;
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Fix the inputs to run', cx, (top + bottom) / 2);
      return;
    }
    const H = res.params.H;
    const travelTop = fluidTop + 4, travelBottom = bottom - 4;

    // Height ruler (left), labelled as distance from the release point
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = muted;
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    const step = niceStep(H, 8);
    for (let z = 0; z <= H + 1e-12; z += step) {
      const frac = z / H;
      const y = res.dir >= 0 ? travelTop + frac * (travelBottom - travelTop)
                             : travelBottom - frac * (travelBottom - travelTop);
      ctx.beginPath(); ctx.moveTo(left - 12, y); ctx.lineTo(left - 4, y); ctx.stroke();
      ctx.fillText(PS.fmtText(z, 3), left - 15, y + 4);
    }
    ctx.save();
    ctx.translate(14, (top + bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('distance travelled (m)', 0, 0);
    ctx.restore();

    // Diameter label
    ctx.textAlign = 'center';
    ctx.fillStyle = muted;
    ctx.fillText('D = ' + PS.fmtText(res.params.D * 1e3, 3) + ' mm', cx, Hc - 12);
    ctx.fillText('H = ' + PS.fmtText(H, 3) + ' m', cx, 18);

    // Particle position
    const frac = Math.min(1, Math.abs(this.state.x) / H);
    const ypos = res.dir >= 0 ? travelTop + frac * (travelBottom - travelTop)
                              : travelBottom - frac * (travelBottom - travelTop);

    // Particle size: true scale relative to the column width (d/D), enlarged if too small to see
    const trueR = res.lambda * colW / 2;
    const rMax = colW / 2 - 3;                  // with wall effects off, d may exceed D
    const r = Math.min(rMax, Math.max(5, trueR));
    const enlarged = trueR < 5;
    const shrunk = trueR > rMax;
    const ry = res.params.shapeOn ? r * Math.max(0.45, res.params.psi ** 2) : r; // schematic shape cue
    const pr = Math.max(r, ry);
    const yDraw = Math.min(Math.max(ypos, travelTop + pr), travelBottom - pr);

    const pg = ctx.createRadialGradient(cx - r * 0.35, yDraw - ry * 0.35, r * 0.1, cx, yDraw, r);
    pg.addColorStop(0, '#f3c46b');
    pg.addColorStop(1, '#b0661b');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.ellipse(cx, yDraw, r, ry, 0, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,50,10,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Velocity arrow (length ∝ v / v_terminal)
    const vT = this.sim && !this.sim.static ? Math.abs(this.sim.vTerm) : 0;
    if (vT > 0 && Math.abs(this.state.v) > 0) {
      // arrow length ∝ v/v_t (up to 2.5 v_t, so a decelerating particle shows a longer arrow)
      const L = 34 * Math.min(2.5, Math.abs(this.state.v) / vT);
      const ax = right + 18;
      const dirSign = res.dir >= 0 ? 1 : -1;
      ctx.strokeStyle = this.terminalReached ? '#1d8a4e' : '#1f5fae';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(ax, yDraw); ctx.lineTo(ax, yDraw + dirSign * L); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax - 5, yDraw + dirSign * (L - 7));
      ctx.lineTo(ax + 5, yDraw + dirSign * (L - 7));
      ctx.lineTo(ax, yDraw + dirSign * L);
      ctx.closePath(); ctx.fill();
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('v', ax + 7, yDraw + dirSign * L * 0.5 + 4);
    }

    if (enlarged || shrunk) {
      ctx.fillStyle = muted;
      ctx.font = '10.5px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('particle drawn ' + (enlarged ? 'enlarged' : 'reduced') + ' (true d/D = ' + PS.fmtText(res.lambda, 2) + ')', cx, Hc - 30);
    }
    ctx.fillStyle = ink;
  };

  PS.ColumnView = ColumnView;
})(window.PS = window.PS || {});
