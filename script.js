(function () {
  const totalMinutes = 10;
  const secondsPerSmallBox = 10;
  const smallBoxesPerMinute = 60 / secondsPerSmallBox; // 6
  const totalSmallBoxes = totalMinutes * smallBoxesPerMinute; // 60

  const BPM_MIN_GRID = 30;
  const BPM_MAX_GRID = 240;

  let correctBaseline = null;
  let correctVariability = "";
  let correctRange = "";

  // FHR trace: bpm value per time step
  let fhrTrace = [];
  // True accelerations metadata (0–2)
  let accelMetas = [];

  // Overlays
  let showBaselineOverlay = false;
  let showAccelTruthOverlay = false;
  // User markers (each is { xNorm: 0..1 })
  let userMarkers = [];
  let draggingMarkerIndex = null;

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function randomFloat(min, max) {
    return Math.random() * (max - min) + min;
  }

  // Convert a desired CSS pixel font size into canvas units,
  // compensating for canvas scaling (and shrink a bit on narrow/mobile).
  function getFontSize(ctx, targetCssPx) {
    const rect = ctx.canvas.getBoundingClientRect();
    const scale = rect.width ? ctx.canvas.width / rect.width : 1;

    // Slightly shrink labels on narrow screens (mobile-ish)
    let factor = 1;
    if (rect.width < 700) {
      factor = 0.85; // 15% smaller on mobile
    }

    return targetCssPx * factor * scale;
  }

  // Weighted fetal variability, amplitude is ± from baseline (peak–trough = 2*amplitude)
  function pickVariability() {
    const r = Math.random();

    if (r < 0.15) {
      // Absent
      return {
        name: "Absent",
        amplitude: 0.5,
        step: 0.2
      };
    } else if (r < 0.45) {
      // Minimal 1–5 bpm
      const amp = randomFloat(0.8, 2.5);
      return {
        name: "Minimal (1–5 bpm)",
        amplitude: amp,
        step: amp * 0.6
      };
    } else if (r < 0.80) {
      // Moderate 6–25 bpm
      const amp = randomFloat(3, 12.5);
      return {
        name: "Moderate (6–25 bpm)",
        amplitude: amp,
        step: amp * 0.5
      };
    } else {
      // Marked >25 bpm
      const amp = randomFloat(13, 25);
      return {
        name: "Marked (> 25 bpm)",
        amplitude: amp,
        step: amp * 0.4
      };
    }
  }

  // Generic grid drawer (FHR & TOCO)
  // labelFontCssPx: desired on-screen px
  // useScaling: true = scale for mobile; false = use raw px in canvas units
  function drawGrid(ctx, width, height, valueMin, valueMax,
                    minorStep, majorStep, labelStep,
                    labelFontCssPx, useScaling) {

    const smallBoxWidth = width / totalSmallBoxes;
    const minuteWidth = smallBoxWidth * smallBoxesPerMinute;

    // vertical minor (10 s)
    ctx.save();
    ctx.strokeStyle = "rgba(255,0,0,0.25)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let i = 0; i <= totalSmallBoxes; i++) {
      const x = i * smallBoxWidth + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();
    ctx.restore();

    // vertical major (1 min)
    ctx.save();
    ctx.strokeStyle = "rgba(255,0,0,0.75)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= totalMinutes; i++) {
      const x = i * minuteWidth + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();
    ctx.restore();

    const valueSpan = valueMax - valueMin;
    const pixelsPerValue = height / valueSpan;

    // horizontal minor
    ctx.save();
    ctx.strokeStyle = "rgba(255,0,0,0.25)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let v = valueMin; v <= valueMax; v += minorStep) {
      const y = height - (v - valueMin) * pixelsPerValue + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.restore();

    // horizontal major
    ctx.save();
    ctx.strokeStyle = "rgba(255,0,0,0.75)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let v = valueMin; v <= valueMax; v += majorStep) {
      const y = height - (v - valueMin) * pixelsPerValue + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.restore();

    // labels at minutes 1,4,7
    const labelMinutes = [1, 4, 7];

    ctx.save();
    ctx.fillStyle = "rgba(239,68,68,1)";
    const fontPx = useScaling
      ? getFontSize(ctx, labelFontCssPx)
      : labelFontCssPx;
    ctx.font = fontPx + "px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    for (let v = valueMin; v <= valueMax; v += labelStep) {
      const y = height - (v - valueMin) * pixelsPerValue;
      labelMinutes.forEach(minute => {
        const lineX = minute * minuteWidth;
        const x = lineX + 4;
        ctx.fillText(String(v), x, y);
      });
    }
    ctx.restore();
  }

  function drawBaselineOverlayOnCtx(ctx, width, height) {
    if (correctBaseline == null) return;
    const pixelsPerBpm = height / (BPM_MAX_GRID - BPM_MIN_GRID);
    const clamped = Math.max(BPM_MIN_GRID, Math.min(BPM_MAX_GRID, correctBaseline));
    const baselineY = height - (clamped - BPM_MIN_GRID) * pixelsPerBpm;

    ctx.save();
    ctx.strokeStyle = "rgba(37,99,235,0.9)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, baselineY + 0.5);
    ctx.lineTo(width, baselineY + 0.5);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(37,99,235,0.95)";
    ctx.font = getFontSize(ctx, 15) + "px Arial"; // ~15px on screen, slightly shrunk on mobile
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(correctBaseline + " bpm", 4, baselineY - 2);
    ctx.restore();
  }

  function drawUserMarkers(ctx, width, height) {
    if (!userMarkers.length) return;

    ctx.save();
    ctx.strokeStyle = "rgba(37,99,235,0.9)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    userMarkers.forEach(marker => {
      const x = marker.xNorm * width + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    });

    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(37,99,235,0.95)";
    ctx.font = getFontSize(ctx, 15) + "px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    userMarkers.forEach(marker => {
      const x = marker.xNorm * width;
      ctx.fillText("accel", x, height - 2);
    });

    ctx.restore();
  }

  function drawAccelTruthOverlayOnCtx(ctx, width, height) {
    if (!showAccelTruthOverlay || !fhrTrace.length) return;

    const totalPoints = fhrTrace.length;
    const xStep = totalPoints > 1 ? width / (totalPoints - 1) : width;

    ctx.save();
    ctx.fillStyle = "rgba(220,38,38,0.98)";
    ctx.font = getFontSize(ctx, 15) + "px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    if (!accelMetas || accelMetas.length === 0) {
      ctx.fillText("NO ACCELS", width / 2, 2);
    } else {
      accelMetas.forEach(meta => {
        const x = meta.peakIdx * xStep;
        ctx.fillText("ACCEL", x, 2);
      });
    }

    ctx.restore();
  }

  function renderFHRStrip() {
    const canvas = document.getElementById("fhrCanvas");
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    // FHR grid with scaled labels (~14px on desktop, ~12px-ish on mobile)
    drawGrid(ctx, width, height, BPM_MIN_GRID, BPM_MAX_GRID,
             10, 30, 30, 14, true);

    if (!fhrTrace || fhrTrace.length === 0) return;

    const pixelsPerBpm = height / (BPM_MAX_GRID - BPM_MIN_GRID);
    function bpmToY(bpm) {
      const clamped = Math.max(BPM_MIN_GRID, Math.min(BPM_MAX_GRID, bpm));
      return height - (clamped - BPM_MIN_GRID) * pixelsPerBpm;
    }

    const totalPoints = fhrTrace.length;
    const xStep = totalPoints > 1 ? (width / (totalPoints - 1)) : width;

    ctx.save();
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let i = 0; i < totalPoints; i++) {
      const bpm = fhrTrace[i];
      const x = i * xStep;
      const y = bpmToY(bpm);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    if (showBaselineOverlay) {
      drawBaselineOverlayOnCtx(ctx, width, height);
    }

    drawUserMarkers(ctx, width, height);
    drawAccelTruthOverlayOnCtx(ctx, width, height);
  }

  // Apply 0–2 accelerations AFTER variability is generated
  function applyAccelerations(baseline, allowAccels) {
    accelMetas = [];
    if (!fhrTrace || fhrTrace.length === 0) return;
    if (!allowAccels) return;

    const totalPoints = fhrTrace.length;
    const totalSeconds = totalMinutes * 60;

    const accelCount = randomInt(0, 2);

    for (let k = 0; k < accelCount; k++) {
      const minDurSec = 15;
      const maxDurSec = 90;
      const accelDurationSec = randomInt(minDurSec, maxDurSec);

      const maxOnsetToPeakSec = Math.min(30, accelDurationSec - 5);
      const onsetToPeakSec = randomInt(5, maxOnsetToPeakSec);

      const accelAmp = randomInt(15, 30);

      const startSec = randomInt(10, totalSeconds - accelDurationSec - 10);
      const peakSec = startSec + onsetToPeakSec;
      const endSec = startSec + accelDurationSec;

      function secToIndex(sec) {
        return Math.floor(sec / totalSeconds * (totalPoints - 1));
      }

      const startIdx = secToIndex(startSec);
      const peakIdx = secToIndex(peakSec);
      const endIdx = secToIndex(endSec);

      for (let i = startIdx; i <= endIdx && i < totalPoints; i++) {
        let t;
        if (i <= peakIdx) {
          const denom = (peakIdx - startIdx) || 1;
          t = (i - startIdx) / denom; // 0→1
        } else {
          const denom = (endIdx - peakIdx) || 1;
          t = 1 - (i - peakIdx) / denom; // 1→0
        }
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        fhrTrace[i] += accelAmp * t;
      }

      accelMetas.push({
        startSec,
        peakSec,
        endSec,
        amp: accelAmp,
        startIdx,
        peakIdx,
        endIdx,
        baseline
      });
    }
  }

  function generateFHRStrip() {
    // Baseline: 90–180 overall, but 80% chance within 110–160.
    let rawBaseline;
    if (Math.random() < 0.8) {
      rawBaseline = randomInt(110, 160);
    } else {
      if (Math.random() < 0.5) {
        rawBaseline = randomInt(90, 109);   // brady-ish
      } else {
        rawBaseline = randomInt(161, 180);  // tachy-ish
      }
    }
    // Round to nearest 5 bpm
    const baseline = Math.round(rawBaseline / 5) * 5;

    const variability = pickVariability();
    const amplitude = variability.amplitude;
    const stepSize = variability.step;

    correctBaseline = baseline;
    correctVariability = variability.name;
    correctRange =
      (baseline - amplitude).toFixed(0) + " – " +
      (baseline + amplitude).toFixed(0) + " bpm";

    // Reset overlays and markers
    showBaselineOverlay = false;
    showAccelTruthOverlay = false;
    userMarkers = [];
    draggingMarkerIndex = null;
    accelMetas = [];

    // Build FHR trace as random walk around baseline (variability only)
    const pointsPerSmallBox = 10;
    const totalPoints = totalSmallBoxes * pointsPerSmallBox;
    fhrTrace = [];

    let currentBpm = baseline;
    const minBpm = baseline - amplitude;
    const maxBpm = baseline + amplitude;

    for (let i = 0; i < totalPoints; i++) {
      if (i > 0) {
        const delta = (Math.random() - 0.5) * 2 * stepSize;
        currentBpm += delta;
        if (currentBpm < minBpm) currentBpm = minBpm + Math.random() * stepSize;
        if (currentBpm > maxBpm) currentBpm = maxBpm - Math.random() * stepSize;
      }
      fhrTrace.push(currentBpm);
    }

    // Only allow accels if variability is NOT absent/minimal
    const allowAccels =
      !variability.name.startsWith("Absent") &&
      !variability.name.startsWith("Minimal");

    // Second pass: add 0–2 accels (not counted toward variability)
    applyAccelerations(baseline, allowAccels);

    // Reset quiz fields
    const baselineFieldEl = document.getElementById("baselineField");
    if (baselineFieldEl) baselineFieldEl.value = "";

    const lowEl = document.getElementById("rangeLowField");
    const highEl = document.getElementById("rangeHighField");
    if (lowEl) lowEl.value = "";
    if (highEl) highEl.value = "";

    document.getElementById("baselineCorrect").hidden = true;
    document.getElementById("rangeCorrect").hidden = true;

    const varCorrectEl = document.getElementById("variabilityCorrect");
    if (varCorrectEl) varCorrectEl.hidden = true;

    document.querySelectorAll('input[name="variabilityChoice"]').forEach(r => {
      r.checked = false;
    });

    // Always show TOCO, with at most 1 contraction
    generateTocoStrip();

    // Render FHR
    renderFHRStrip();
  }

  function generateTocoStrip() {
    const canvas = document.getElementById("tocoCanvas");
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    const minVal = 0;
    const maxVal = 100;

    ctx.clearRect(0, 0, width, height);
    // TOCO grid with smaller fixed labels (no scaling)
    drawGrid(ctx, width, height, minVal, maxVal,
             10, 20, 20, 10, false);

    const valueSpan = maxVal - minVal;
    const pixelsPerVal = height / valueSpan;

    function valToY(v) {
      const clamped = Math.max(minVal, Math.min(maxVal, v));
      return height - (clamped - minVal) * pixelsPerVal;
    }

    // Contractions: limit to 1 (0 or 1)
    const contractions = [];
    const contractionCount = randomInt(0, 1); // 0 or 1
    const totalSeconds = totalMinutes * 60;

    if (contractionCount === 1) {
      const centerMin = randomFloat(3, 7);
      const durationSec = randomInt(60, 120);
      const amp = randomInt(35, 70);
      const startSec = centerMin * 60 - durationSec / 2;
      const endSec = centerMin * 60 + durationSec / 2;
      contractions.push({ startSec, endSec, amp });
    }

    const pointsPerSmallBox = 10;
    const totalPoints = totalSmallBoxes * pointsPerSmallBox;
    const xStep = width / (totalPoints - 1);

    // baseline starts around 12 with more squiggly variability
    let baselineVal = randomFloat(10, 15);

    ctx.save();
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let i = 0; i < totalPoints; i++) {
      const tSec = (i / (totalPoints - 1)) * totalSeconds;

      // squiggly random walk baseline
      baselineVal += (Math.random() - 0.5) * 3.0;
      if (baselineVal < 8) baselineVal = 8;
      if (baselineVal > 25) baselineVal = 25;

      // contraction dome contribution (pure sine hump)
      let contractionAdd = 0;
      contractions.forEach(c => {
        if (tSec >= c.startSec && tSec <= c.endSec) {
          const phase = (tSec - c.startSec) / (c.endSec - c.startSec); // 0–1
          const clampedPhase = Math.max(0, Math.min(1, phase));
          const factor = Math.sin(Math.PI * clampedPhase); // symmetric hump
          contractionAdd = Math.max(contractionAdd, c.amp * factor);
        }
      });

      // total value = baseline + contraction + high-frequency noise
      let value = baselineVal + contractionAdd;
      value += (Math.random() - 0.5) * 2.0; // extra squiggly noise

      if (value < minVal) value = minVal;
      if (value > maxVal) value = maxVal;

      const x = i * xStep;
      const y = valToY(value);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.stroke();
    ctx.restore();
  }

  function setupCheckButtons() {
    document.querySelectorAll(".check-btn").forEach(btn => {
      btn.addEventListener("click", function () {
        const target = this.dataset.target;
        if (target === "baseline") {
          const el = document.getElementById("baselineCorrect");
          el.textContent = correctBaseline + " bpm";
          el.hidden = false;
          showBaselineOverlay = true;
          renderFHRStrip();
        } else if (target === "variability") {
          const el = document.getElementById("variabilityCorrect");
          if (el) {
            el.textContent = correctVariability;
            el.hidden = false;
          }
        } else if (target === "range") {
          const el = document.getElementById("rangeCorrect");
          el.textContent = correctRange;
          el.hidden = false;
        }
      });
    });
  }

  function setupTopControls() {
    document.getElementById("newStripBtn")
      .addEventListener("click", generateFHRStrip);
  }

  function setupAccelControls() {
    const addBtn = document.getElementById("addAccelBtn");
    const checkBtn = document.getElementById("checkAccelBtn");

    addBtn.addEventListener("click", function () {
      if (userMarkers.length >= 3) return;
      userMarkers.push({ xNorm: 0.5 });
      renderFHRStrip();
    });

    checkBtn.addEventListener("click", function () {
      showAccelTruthOverlay = true;
      renderFHRStrip();
    });
  }

  // Helper: get canvas-relative coords for mouse/touch (CSS pixels)
  function getCanvasPos(evt, canvas) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if (evt.touches && evt.touches.length > 0) {
      clientX = evt.touches[0].clientX;
      clientY = evt.touches[0].clientY;
    } else if (evt.changedTouches && evt.changedTouches.length > 0) {
      clientX = evt.changedTouches[0].clientX;
      clientY = evt.changedTouches[0].clientY;
    } else {
      clientX = evt.clientX;
      clientY = evt.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      rect
    };
  }

  function setupCanvasDrag() {
    const canvas = document.getElementById("fhrCanvas");

    function startDrag(evt) {
      const { x, y, rect } = getCanvasPos(evt, canvas);
      const cssWidth = rect.width;
      const cssHeight = rect.height;

      const bottomRegionHeight = 40;
      for (let i = 0; i < userMarkers.length; i++) {
        const markerCssX = userMarkers[i].xNorm * cssWidth;
        const distX = Math.abs(x - markerCssX);
        const inBottom = (y > cssHeight - bottomRegionHeight);
        if (distX < 10 && inBottom) {
          draggingMarkerIndex = i;
          break;
        }
      }
    }

    function moveDrag(evt) {
      if (draggingMarkerIndex === null) return;
      const { x, rect } = getCanvasPos(evt, canvas);
      const cssWidth = rect.width;

      let xNorm = x / cssWidth;
      if (xNorm < 0) xNorm = 0;
      if (xNorm > 1) xNorm = 1;

      userMarkers[draggingMarkerIndex].xNorm = xNorm;
      renderFHRStrip();
    }

    function endDrag() {
      draggingMarkerIndex = null;
    }

    // Mouse events
    canvas.addEventListener("mousedown", function (e) {
      startDrag(e);
    });

    canvas.addEventListener("mousemove", function (e) {
      moveDrag(e);
    });

    canvas.addEventListener("mouseup", function () {
      endDrag();
    });

    canvas.addEventListener("mouseleave", function () {
      endDrag();
    });

    // Touch events
    canvas.addEventListener("touchstart", function (e) {
      e.preventDefault();
      startDrag(e);
    }, { passive: false });

    canvas.addEventListener("touchmove", function (e) {
      e.preventDefault();
      moveDrag(e);
    }, { passive: false });

    canvas.addEventListener("touchend", function () {
      endDrag();
    });

    canvas.addEventListener("touchcancel", function () {
      endDrag();
    });
  }

  window.addEventListener("DOMContentLoaded", function () {
    generateFHRStrip();
    setupCheckButtons();
    setupTopControls();
    setupAccelControls();
    setupCanvasDrag();
  });
})();
