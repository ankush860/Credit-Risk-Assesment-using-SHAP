(() => {
  'use strict';

  /* ------------------------------------------------------------------
     Config
     Leave API_BASE empty when FastAPI serves this page (same origin).
     If you host the frontend elsewhere, set it to your API URL, e.g.
     const API_BASE = 'https://your-api.onrender.com';
  ------------------------------------------------------------------ */
  const API_BASE = '';
  const REQUEST_TIMEOUT_MS = 30000;
  const MIN_SCAN_MS = 1100; // keeps the "analysing" moment from flashing past

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const form = $('#loan-form');
  const submitBtn = $('#submit-btn');
  const panel = $('#verdict');
  const needle = $('#needle');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const INTENT_LABELS = {
    PERSONAL: 'Personal',
    EDUCATION: 'Education',
    MEDICAL: 'Medical',
    VENTURE: 'Venture',
    HOMEIMPROVEMENT: 'Home improvement',
    DEBTCONSOLIDATION: 'Debt consolidation',
  };

  /* ------------------------------------------------------------------
     Validation (mirrors the constraints in the FastAPI schema)
  ------------------------------------------------------------------ */
  const NUMERIC = {
    person_age:                 { label: 'Age', int: true, min: 18, max: 100 },
    person_income:              { label: 'Annual income', gt: 0 },
    person_emp_length:          { label: 'Employment length', min: 0, max: 100 },
    loan_amnt:                  { label: 'Loan amount', gt: 0 },
    loan_int_rate:              { label: 'Interest rate', gt: 0, max: 100 },
    cb_person_cred_hist_length: { label: 'Credit history length', int: true, min: 0 },
  };

  const CHOICES = {
    person_home_ownership:     'Choose a home ownership status.',
    loan_intent:               'Choose the purpose of the loan.',
    loan_grade:                'Choose a loan grade.',
    cb_person_default_on_file: 'Say whether a default is on file.',
  };

  const fieldEl = (name) => $(`.field[data-field="${name}"]`);

  function setError(name, message) {
    const field = fieldEl(name);
    if (!field) return;
    const out = $('.error', field);
    if (out) out.textContent = message || '';
    field.classList.toggle('invalid', Boolean(message));
    const input = $('input[type="number"]', field);
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function numberValue(name) {
    const raw = form.elements[name].value.trim();
    return raw === '' ? NaN : Number(raw);
  }

  function validateField(name) {
    if (name in CHOICES) {
      return form.elements[name].value ? '' : CHOICES[name];
    }
    const rule = NUMERIC[name];
    if (!rule) return '';
    const v = numberValue(name);
    if (Number.isNaN(v)) return `Enter the ${rule.label.toLowerCase()}.`;
    if (rule.int && !Number.isInteger(v)) return `${rule.label} must be a whole number.`;
    if (rule.gt !== undefined && !(v > rule.gt)) return `${rule.label} must be greater than ${rule.gt}.`;
    if (rule.min !== undefined && v < rule.min) return `${rule.label} must be at least ${rule.min}.`;
    if (rule.max !== undefined && v > rule.max) return `${rule.label} must be ${rule.max} or less.`;

    if (name === 'loan_amnt') {
      const income = numberValue('person_income');
      if (income > 0 && v / income > 1) {
        return 'The loan can’t be larger than annual income. The model accepts ratios up to 100%.';
      }
    }
    return '';
  }

  function validateAll() {
    let firstInvalid = null;
    [...Object.keys(NUMERIC), ...Object.keys(CHOICES)].forEach((name) => {
      const msg = validateField(name);
      setError(name, msg);
      if (msg && !firstInvalid) firstInvalid = name;
    });
    return firstInvalid;
  }

  function focusField(name) {
    const field = fieldEl(name);
    if (!field) return;
    const target = $('input', field);
    if (target) target.focus({ preventScroll: true });
    field.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }

  /* ------------------------------------------------------------------
     Loan-to-income ratio (sent to the API as loan_percent_income)
  ------------------------------------------------------------------ */
  const ratioBox = $('.ratio');
  const ratioValue = $('#ratio-value');
  const ratioFill = $('#ratio-fill');

  function currentRatio() {
    const income = numberValue('person_income');
    const amount = numberValue('loan_amnt');
    if (!(income > 0) || !(amount > 0)) return null;
    return amount / income;
  }

  function updateRatio() {
    const r = currentRatio();
    if (r === null) {
      ratioValue.textContent = 'Not calculated yet';
      ratioValue.classList.add('is-empty');
      ratioFill.style.width = '0%';
      ratioBox.classList.remove('warn');
      return;
    }
    ratioValue.classList.remove('is-empty');
    ratioValue.textContent = pct(r);
    ratioFill.style.width = `${Math.min(r, 1) * 100}%`;
    ratioBox.classList.toggle('warn', r > 1);
  }

  /* ------------------------------------------------------------------
     Gauge
  ------------------------------------------------------------------ */
  const G = { cx: 160, cy: 160, r: 104 };
  let threshold = 0.5;

  const polar = (f, r = G.r) => {
    const t = Math.PI * (1 - f);
    return [G.cx + r * Math.cos(t), G.cy - r * Math.sin(t)];
  };

  const arc = (f0, f1) => {
    const [x0, y0] = polar(f0);
    const [x1, y1] = polar(f1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${G.r} ${G.r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  function drawGauge() {
    const t = Math.min(Math.max(threshold, 0.02), 0.98);
    const gap = 0.006;
    $('#zone-low').setAttribute('d', arc(0, t - gap));
    $('#zone-high').setAttribute('d', arc(t + gap, 1));

    const [x0, y0] = polar(t, G.r - 17);
    const [x1, y1] = polar(t, G.r + 16);
    const tick = $('#cutoff-tick');
    tick.setAttribute('x1', x0.toFixed(2));
    tick.setAttribute('y1', y0.toFixed(2));
    tick.setAttribute('x2', x1.toFixed(2));
    tick.setAttribute('y2', y1.toFixed(2));

    const [lx, ly] = polar(t, G.r + 32);
    const label = $('#cutoff-label');
    label.textContent = `Cutoff ${pct(threshold, 0)}`;
    label.setAttribute('x', lx.toFixed(2));
    label.setAttribute('y', (ly + 4).toFixed(2));
    label.setAttribute('text-anchor', t < 0.18 ? 'start' : t > 0.82 ? 'end' : 'middle');
  }

  function setNeedle(f) {
    const clamped = Math.min(Math.max(f, 0), 1);
    needle.style.transform = `rotate(${(clamped - 0.5) * 180}deg)`;
  }

  let scanRaf = null;
  function startScan() {
    needle.classList.remove('settle');
    if (reduceMotion) return;
    const t0 = performance.now();
    const tick = (now) => {
      const s = (now - t0) / 1000;
      setNeedle(0.5 + 0.4 * Math.sin(s * 3.4) * Math.cos(s * 1.15));
      scanRaf = requestAnimationFrame(tick);
    };
    scanRaf = requestAnimationFrame(tick);
  }

  function stopScan() {
    if (scanRaf) cancelAnimationFrame(scanRaf);
    scanRaf = null;
  }

  function settleNeedle(f) {
    stopScan();
    needle.classList.add('settle');
    void needle.getBoundingClientRect(); // commit current angle so the transition starts from it
    setNeedle(f);
  }

  function countUp(el, to, ms = 1200) {
    if (reduceMotion) { el.textContent = pct(to); return; }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = pct(to * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* One-time intro: the needle sweeps the full range and rests at zero */
  function introSweep() {
    if (reduceMotion) return;
    needle.classList.add('settle');
    setTimeout(() => setNeedle(1), 250);
    setTimeout(() => setNeedle(0), 1400);
  }

  /* ------------------------------------------------------------------
     Panel state
  ------------------------------------------------------------------ */
  const probEl = $('#prob');
  const decisionText = $('#decision-text');
  const explainEl = $('#explain');
  const factsEl = $('#facts');

  function setPanel(state, { decision, explain } = {}) {
    panel.dataset.state = state;
    if (decision) decisionText.textContent = decision;
    if (explain) explainEl.textContent = explain;
  }

  function resetPanel() {
    stopScan();
    needle.classList.add('settle');
    setNeedle(0);
    probEl.textContent = '--';
    factsEl.hidden = true;
    setPanel('idle', {
      decision: 'Waiting for an application',
      explain: 'Complete the form and select Assess risk. The needle shows where this applicant sits against the model’s cutoff.',
    });
  }

  function showResult(body, payload) {
    const prob = Number(body.default_probability);
    if (typeof body.threshold === 'number') {
      threshold = body.threshold;
      drawGauge();
    }
    const isHigh = body.default_prediction === 1;
    const diff = Math.abs(prob - threshold) * 100;

    settleNeedle(prob);
    countUp(probEl, prob);

    setPanel(isHigh ? 'high' : 'low', {
      decision: isHigh ? 'High risk' : 'Low risk',
      explain: isHigh
        ? `The estimated ${pct(prob)} is ${diff.toFixed(1)} points above the ${pct(threshold)} cutoff, so this application is flagged as high risk.`
        : `The estimated ${pct(prob)} is ${diff.toFixed(1)} points below the ${pct(threshold)} cutoff, so this application is flagged as low risk.`,
    });

    $('#fact-cutoff').textContent = pct(threshold);
    $('#fact-margin').textContent = `${diff.toFixed(1)} pts ${isHigh ? 'above' : 'below'}`;
    $('#fact-ratio').textContent = pct(payload.loan_percent_income, 0);
    factsEl.hidden = false;

    addHistory(payload, prob, isHigh);
  }

  function showError(message) {
    stopScan();
    needle.classList.add('settle');
    setNeedle(0);
    probEl.textContent = '--';
    factsEl.hidden = true;
    setPanel('error', { decision: 'No result', explain: message });
  }

  /* ------------------------------------------------------------------
     Session history
  ------------------------------------------------------------------ */
  const historyWrap = $('#history-wrap');
  const historyList = $('#history');
  const HISTORY_MAX = 5;

  function addHistory(payload, prob, isHigh) {
    const li = document.createElement('li');
    li.className = 'enter';

    const left = document.createElement('div');
    const main = document.createElement('span');
    main.className = 'h-main';
    main.textContent = money.format(payload.loan_amnt);
    const sub = document.createElement('span');
    sub.className = 'h-sub';
    sub.textContent = `${INTENT_LABELS[payload.loan_intent]}, grade ${payload.loan_grade}`;
    left.append(main, sub);

    const right = document.createElement('span');
    right.className = 'h-result';
    const dot = document.createElement('span');
    dot.className = `h-dot ${isHigh ? 'high' : 'low'}`;
    right.append(dot, document.createTextNode(pct(prob)));

    li.append(left, right);
    historyList.prepend(li);
    while (historyList.children.length > HISTORY_MAX) historyList.lastChild.remove();
    historyWrap.hidden = false;
  }

  /* ------------------------------------------------------------------
     API
  ------------------------------------------------------------------ */
  function collectPayload() {
    const income = numberValue('person_income');
    const amount = numberValue('loan_amnt');
    return {
      person_age: numberValue('person_age'),
      person_income: income,
      person_home_ownership: form.elements.person_home_ownership.value,
      person_emp_length: numberValue('person_emp_length'),
      loan_intent: form.elements.loan_intent.value,
      loan_grade: form.elements.loan_grade.value,
      loan_amnt: amount,
      loan_int_rate: numberValue('loan_int_rate'),
      // The training data stores this ratio with two decimals
      loan_percent_income: Math.round((amount / income) * 100) / 100,
      cb_person_default_on_file: form.elements.cb_person_default_on_file.value,
      cb_person_cred_hist_length: numberValue('cb_person_cred_hist_length'),
    };
  }

  function applyServerErrors(detail) {
    if (!Array.isArray(detail)) return false;
    let applied = false;
    detail.forEach((d) => {
      const name = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null;
      if (name && fieldEl(name)) {
        setError(name, d.msg || 'This value was rejected.');
        applied = true;
      }
    });
    return applied;
  }

  class AppError extends Error {}

  async function requestPrediction(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 422 && applyServerErrors(body && body.detail)) {
          throw new AppError('The server rejected some values. Check the highlighted fields and try again.');
        }
        throw new AppError(`The model service returned an error (${res.status}). Try again in a moment.`);
      }
      if (!body || typeof body.default_probability !== 'number') {
        throw new AppError('The response from the model service was not in the expected format.');
      }
      return body;
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err.name === 'AbortError') throw new AppError('The request timed out. The service may be starting up, so try again in a few seconds.');
      throw new AppError('Can’t reach the model service. Check your connection and try again.');
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------------------------------------------------
     Health / status pill
  ------------------------------------------------------------------ */
  const statusEl = $('#status');
  const statusText = $('#status-text');
  const STATUS_COPY = {
    checking: 'Checking model',
    waking: 'Starting model',
    online: 'Model online',
    offline: 'Model unreachable',
  };

  function setStatus(state) {
    statusEl.dataset.state = state;
    statusText.textContent = STATUS_COPY[state];
  }

  async function checkHealth(attempt = 0) {
    try {
      const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
      if (!res.ok) throw new Error('bad status');
      const data = await res.json();
      if (typeof data.threshold === 'number') {
        threshold = data.threshold;
        drawGauge();
      }
      setStatus('online');
    } catch {
      if (attempt < 8) {
        setStatus('waking'); // free-tier hosts can take a while to wake up
        setTimeout(() => checkHealth(attempt + 1), 4000);
      } else {
        setStatus('offline');
      }
    }
  }

  /* ------------------------------------------------------------------
     Samples
  ------------------------------------------------------------------ */
  const SAMPLES = {
    low: {
      person_age: 34, person_income: 92000, person_home_ownership: 'MORTGAGE', person_emp_length: 9,
      loan_intent: 'HOMEIMPROVEMENT', loan_grade: 'A', loan_amnt: 8000, loan_int_rate: 7.5,
      cb_person_default_on_file: 'N', cb_person_cred_hist_length: 12,
    },
    high: {
      person_age: 23, person_income: 28000, person_home_ownership: 'RENT', person_emp_length: 1,
      loan_intent: 'DEBTCONSOLIDATION', loan_grade: 'E', loan_amnt: 15000, loan_int_rate: 17.5,
      cb_person_default_on_file: 'Y', cb_person_cred_hist_length: 2,
    },
  };

  function fillSample(kind) {
    const sample = SAMPLES[kind];
    Object.entries(sample).forEach(([name, value]) => {
      form.elements[name].value = value;
      setError(name, '');
    });
    updateRatio();
  }

  /* ------------------------------------------------------------------
     Events
  ------------------------------------------------------------------ */
  let busy = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;

    const firstInvalid = validateAll();
    if (firstInvalid) {
      focusField(firstInvalid);
      return;
    }

    const payload = collectPayload();
    busy = true;
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    $('.btn-label', submitBtn).textContent = 'Assessing';
    setPanel('loading', { decision: 'Analysing application', explain: 'Running the model on this applicant.' });
    probEl.textContent = '--';
    factsEl.hidden = true;
    startScan();

    if (window.matchMedia('(max-width: 980px)').matches) {
      panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }

    const started = performance.now();
    try {
      const body = await requestPrediction(payload);
      await wait(Math.max(0, MIN_SCAN_MS - (performance.now() - started)));
      showResult(body, payload);
    } catch (err) {
      showError(err instanceof AppError ? err.message : 'Something went wrong. Try again.');
    } finally {
      busy = false;
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
      $('.btn-label', submitBtn).textContent = 'Assess risk';
    }
  });

  $('#reset-btn').addEventListener('click', () => {
    form.reset();
    [...Object.keys(NUMERIC), ...Object.keys(CHOICES)].forEach((n) => setError(n, ''));
    updateRatio();
    resetPanel();
    form.elements.person_age.focus({ preventScroll: true });
  });

  $$('[data-sample]').forEach((btn) => btn.addEventListener('click', () => fillSample(btn.dataset.sample)));

  // Clear errors as the user corrects a field; validate on blur
  Object.keys(NUMERIC).forEach((name) => {
    const input = form.elements[name];
    input.addEventListener('input', () => {
      if (fieldEl(name).classList.contains('invalid')) setError(name, validateField(name));
      if (name === 'person_income' || name === 'loan_amnt') {
        updateRatio();
        if (name === 'person_income' && fieldEl('loan_amnt').classList.contains('invalid')) {
          setError('loan_amnt', validateField('loan_amnt'));
        }
      }
    });
    input.addEventListener('blur', () => {
      if (input.value.trim() !== '') setError(name, validateField(name));
    });
    // Stop the scroll wheel from silently changing a focused number
    input.addEventListener('wheel', () => input.blur(), { passive: true });
  });

  Object.keys(CHOICES).forEach((name) => {
    $$(`input[name="${name}"]`).forEach((radio) => radio.addEventListener('change', () => setError(name, '')));
  });

  /* ------------------------------------------------------------------
     Init
  ------------------------------------------------------------------ */
  drawGauge();
  updateRatio();
  setNeedle(0);
  checkHealth();
  window.addEventListener('load', introSweep);
})();
