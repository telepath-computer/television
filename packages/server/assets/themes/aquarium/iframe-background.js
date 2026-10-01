/* Aquarium background. Runs in Television's sandboxed background frame: no app DOM access, input arrives only as pointer messages. */
(() => {
  "use strict";

  const POINTER = {
    move: "television-theme-pointer-move",
    down: "television-theme-pointer-down",
    up: "television-theme-pointer-up",
    cancel: "television-theme-pointer-cancel",
    click: "television-theme-pointer-click",
  };
  const FRAME_MS = 1000 / 30; // 30fps is plenty for drifting fish
  const rand = (a, b) => a + Math.random() * (b - a);

  function start() {
    // Television's frame document already supplies full size, zero margin, hidden overflow, a transparent ground and the
    // matching color-scheme. Leave the root element's styles alone: changing color-scheme there turns the frame opaque.
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100vw;height:100vh";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    // Television stamps the effective appearance on this document's root and recreates the frame when it changes,
    // so one read at startup is enough and no listener is needed.
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    let W = 0, H = 0, dpr = 1;
    const pointer = { x: -9999, y: -9999, active: false };

    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 1.5);
      W = innerWidth; H = innerHeight;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    addEventListener("resize", resize);
    resize();

    const DAY_FISH = ["#ff7a59", "#ffc145", "#ff5d8f", "#f4f1de", "#7bdff2", "#b388eb"];
    const fish = Array.from({ length: 22 }, (_, i) => ({
      x: rand(0, 1600), y: rand(60, 800), vx: rand(-1, 1) || 0.5, vy: 0,
      size: rand(9, 22), hue: i % DAY_FISH.length, phase: rand(0, 6.28), speed: rand(0.5, 1.3), depth: rand(0.55, 1),
    }));
    const bubbles = Array.from({ length: 34 }, () => newBubble(true));
    const jellies = Array.from({ length: 5 }, () => ({ x: rand(0, 1600), y: rand(0, 900), r: rand(16, 34), phase: rand(0, 6.28), hue: rand(170, 320) }));
    const plankton = Array.from({ length: 70 }, () => ({ x: rand(0, 1600), y: rand(0, 900), p: rand(0, 6.28) }));

    function newBubble(anywhere, x, y) {
      return { x: x ?? rand(0, Math.max(W, 800)), y: y ?? (anywhere ? rand(0, Math.max(H, 600)) : Math.max(H, 600) + 10), r: rand(1.5, 5.5), vy: rand(0.4, 1.4), wob: rand(0, 6.28) };
    }

    addEventListener("message", (event) => {
      if (event.source !== parent) return;
      const d = event.data;
      if (!d || typeof d.type !== "string") return;
      if (d.type === POINTER.move) { pointer.x = d.clientX; pointer.y = d.clientY; pointer.active = true; }
      else if (d.type === POINTER.down) {
        pointer.x = d.clientX; pointer.y = d.clientY;
        for (let i = 0; i < 9 && bubbles.length < 90; i++) bubbles.push(newBubble(false, d.clientX + rand(-10, 10), d.clientY + rand(-6, 6)));
        for (const f of fish) { // a tap on the glass startles nearby fish
          const dx = f.x - d.clientX, dy = f.y - d.clientY, dist = Math.hypot(dx, dy) || 1;
          if (dist < 260) { f.vx += (dx / dist) * 5; f.vy += (dy / dist) * 3; }
        }
      } else if (d.type === POINTER.cancel) pointer.active = false;
    });

    function drawWater(dark, t) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      if (dark) { g.addColorStop(0, "#0b2545"); g.addColorStop(0.6, "#06142e"); g.addColorStop(1, "#02060f"); }
      else { g.addColorStop(0, "#9be7f0"); g.addColorStop(0.55, "#3aa7d6"); g.addColorStop(1, "#1b5fa8"); }
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (!dark) { // sun shafts
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 5; i++) {
          const x = (W * (i + 0.5)) / 5 + Math.sin(t / 4000 + i) * 60, w = 50 + 25 * Math.sin(t / 3000 + i * 2);
          const rg = ctx.createLinearGradient(0, 0, 0, H * 0.85);
          rg.addColorStop(0, "rgba(255,255,230,0.16)"); rg.addColorStop(1, "rgba(255,255,230,0)");
          ctx.fillStyle = rg; ctx.beginPath(); ctx.moveTo(x - w / 2, 0); ctx.lineTo(x + w / 2, 0); ctx.lineTo(x + w * 1.6 - 120, H * 0.85); ctx.lineTo(x - w * 1.6 - 120, H * 0.85); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
    }

    function drawFish(f, dark, t) {
      const dir = f.vx >= 0 ? 1 : -1, s = f.size * f.depth, wag = Math.sin(t / 110 * f.speed + f.phase) * 0.45;
      ctx.save(); ctx.translate(f.x, f.y); ctx.scale(dir, 1); ctx.rotate(Math.max(-0.4, Math.min(0.4, f.vy * 0.25)));
      ctx.globalAlpha = 0.45 + 0.55 * f.depth;
      if (dark) { ctx.fillStyle = "rgba(10,25,50,0.9)"; ctx.strokeStyle = `hsla(${170 + f.hue * 25},90%,65%,0.85)`; ctx.lineWidth = 1.2; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 8; }
      else { ctx.fillStyle = DAY_FISH[f.hue]; }
      ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.48, 0, 0, 6.2832); ctx.fill(); if (dark) ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-s * 0.85, 0); ctx.lineTo(-s * 1.7, -s * 0.55 + wag * s); ctx.lineTo(-s * 1.7, s * 0.55 + wag * s); ctx.closePath(); ctx.fill(); if (dark) ctx.stroke();
      ctx.shadowBlur = 0; ctx.fillStyle = dark ? "rgba(200,255,250,0.9)" : "rgba(20,30,50,0.85)";
      ctx.beginPath(); ctx.arc(s * 0.55, -s * 0.1, Math.max(1, s * 0.09), 0, 6.2832); ctx.fill();
      ctx.restore();
    }

    function drawJelly(j, t) {
      const pulse = 1 + 0.12 * Math.sin(t / 700 + j.phase);
      ctx.save(); ctx.translate(j.x, j.y); ctx.globalAlpha = 0.55;
      ctx.shadowColor = `hsla(${j.hue},90%,70%,0.9)`; ctx.shadowBlur = 22; ctx.fillStyle = `hsla(${j.hue},85%,72%,0.5)`;
      ctx.beginPath(); ctx.ellipse(0, 0, j.r * pulse, j.r * 0.75 / pulse, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = `hsla(${j.hue},85%,78%,0.45)`; ctx.lineWidth = 1.2;
      for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(k * j.r * 0.35, 0); for (let y = 4; y < j.r * 2.2; y += 4) ctx.lineTo(k * j.r * 0.35 + Math.sin(t / 400 + y / 9 + k + j.phase) * 4, y); ctx.stroke(); }
      ctx.restore();
    }

    function step(t) {
      for (const f of fish) {
        f.vx += Math.cos(t / 2300 * f.speed + f.phase) * 0.01; f.vy += Math.sin(t / 1700 + f.phase) * 0.012;
        if (pointer.active) { const dx = f.x - pointer.x, dy = f.y - pointer.y, dist = Math.hypot(dx, dy) || 1; if (dist < 150) { const k = (150 - dist) / 150; f.vx += (dx / dist) * k * 0.9; f.vy += (dy / dist) * k * 0.6; } }
        const cruise = f.speed * (f.vx >= 0 ? 1 : -1); f.vx += (cruise - f.vx) * 0.02; f.vy *= 0.95;
        f.x += f.vx * f.depth; f.y += f.vy * f.depth;
        if (f.x < -50) f.x = W + 40; else if (f.x > W + 50) f.x = -40;
        if (f.y < 40) f.vy += 0.05; else if (f.y > H - 40) f.vy -= 0.05;
      }
      for (let i = bubbles.length - 1; i >= 0; i--) { const b = bubbles[i]; b.y -= b.vy; b.wob += 0.04; b.x += Math.sin(b.wob) * 0.35; if (b.y < -10) { if (bubbles.length > 34) bubbles.splice(i, 1); else bubbles[i] = newBubble(false); } }
      for (const j of jellies) { j.y -= 0.18 + 0.12 * Math.sin(t / 700 + j.phase); j.x += Math.sin(t / 2600 + j.phase) * 0.2; if (j.y < -80) { j.y = H + 80; j.x = rand(0, W); } }

      drawWater(dark, t);
      if (dark) { ctx.fillStyle = "rgba(160,255,240,0.55)"; for (const p of plankton) { const a = 0.5 + 0.5 * Math.sin(t / 900 + p.p); ctx.globalAlpha = a * 0.6; ctx.fillRect(p.x % Math.max(W, 1), (p.y + t / 140) % Math.max(H, 1), 1.5, 1.5); } ctx.globalAlpha = 1; for (const j of jellies) drawJelly(j, t); }
      fish.sort((a, b) => a.depth - b.depth); for (const f of fish) drawFish(f, dark, t);
      ctx.lineWidth = 1; for (const b of bubbles) { ctx.strokeStyle = dark ? "rgba(170,230,255,0.35)" : "rgba(255,255,255,0.7)"; ctx.fillStyle = dark ? "rgba(170,230,255,0.06)" : "rgba(255,255,255,0.18)"; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.2832); ctx.fill(); ctx.stroke(); }
    }

    let last = 0;
    function loop(t) {
      requestAnimationFrame(loop);
      if (document.hidden || t - last < FRAME_MS) return;
      last = t; step(t);
    }
    if (still.matches) { step(0); addEventListener("resize", () => step(0)); }
    else requestAnimationFrame(loop);
  }

  if (document.body) start(); else addEventListener("DOMContentLoaded", start, { once: true });
})();
