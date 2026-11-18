/* The Pineda's Blessed CC Tracker — BPI credit card expense tracker. */
(() => {
  "use strict";

  const STORAGE_KEY = "bpi-tracker-v1";
  const DEVICE_KEY = "bpi-tracker-device";   // per-device only (passcode, sync time) — never synced

  const DEFAULT_CATEGORIES = [
    "Groceries", "Dining", "Transportation & Gas", "Utilities & Bills",
    "Shopping", "Health & Pharmacy", "Travel", "Entertainment",
    "Subscriptions", "Education", "Home", "Others",
  ];

  const defaultSettings = () => ({
    cardName: "BPI Credit Card",
    last4: "",
    creditLimit: 0,
    cutoffDay: 15,
    dueDays: 20,
    reminderDays: 3,
    cardholders: ["Principal", "Supplementary"],
    categories: DEFAULT_CATEGORIES.slice(),
    budgets: {},
    updatedAt: 0,
  });
  const defaultState = () => ({ settings: defaultSettings(), transactions: [], statements: {} });

  // ---------- Storage ----------
  function normalize(data) {
    data = data || {};
    return {
      settings: { ...defaultSettings(), ...(data.settings || {}) },
      transactions: (Array.isArray(data.transactions) ? data.transactions : [])
        .map((t) => ({ ...t, updatedAt: t.updatedAt || t.createdAt || 1 })),
      statements: data.statements && typeof data.statements === "object" ? data.statements : {},
    };
  }
  function load() {
    try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
    catch (e) { console.error("Could not load saved data", e); return defaultState(); }
  }
  function saveLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function save() { saveLocal(); scheduleSync(); }

  let state = load();
  let device = (() => { try { return JSON.parse(localStorage.getItem(DEVICE_KEY)) || {}; } catch { return {}; } })();
  const saveDevice = () => localStorage.setItem(DEVICE_KEY, JSON.stringify(device));

  const txs = () => state.transactions.filter((t) => !t.deleted);
  const stmt = (key) => { const s = state.statements[key]; return s && !s.deleted ? s : null; };

  // ---------- Helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
  const fmt = (n) => peso.format(Math.round((n + Number.EPSILON) * 100) / 100);
  const fmtShort = (n) => n >= 1000 ? "₱" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : "₱" + Math.round(n);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const round2 = (n) => Math.round(n * 100) / 100;

  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => toISO(new Date());
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m is 1-12
  const fmtDate = (dt, opts = { month: "short", day: "numeric", year: "numeric" }) => dt.toLocaleDateString("en-PH", opts);
  const daysBetween = (a, b) => Math.round((b - a) / 86400000);

  // ---------- Billing cycles ----------
  // A cycle is identified by its statement (cut-off) month: "YYYY-MM".
  function cutoffDate(y, m) {
    return new Date(y, m - 1, Math.min(state.settings.cutoffDay, daysInMonth(y, m)));
  }
  function keyFrom(y, m) { return `${y}-${pad(m)}`; }
  function splitKey(key) { const [y, m] = key.split("-").map(Number); return { y, m }; }
  function addMonths(key, n) {
    const { y, m } = splitKey(key);
    const idx = y * 12 + (m - 1) + n;
    return keyFrom(Math.floor(idx / 12), (idx % 12) + 1);
  }
  function monthDiff(a, b) { // b - a in months
    const A = splitKey(a), B = splitKey(b);
    return (B.y * 12 + B.m) - (A.y * 12 + A.m);
  }
  function cycleOf(iso) {
    const dt = parseISO(iso);
    const y = dt.getFullYear(), m = dt.getMonth() + 1;
    return dt <= cutoffDate(y, m) ? keyFrom(y, m) : addMonths(keyFrom(y, m), 1);
  }
  function cycleInfo(key) {
    const { y, m } = splitKey(key);
    const end = cutoffDate(y, m);
    const prev = splitKey(addMonths(key, -1));
    const start = cutoffDate(prev.y, prev.m);
    start.setDate(start.getDate() + 1);
    const due = new Date(end);
    due.setDate(due.getDate() + Number(state.settings.dueDays));
    return { key, start, end, due };
  }
  const cycleName = (key) => {
    const { y, m } = splitKey(key);
    return new Date(y, m - 1, 1).toLocaleDateString("en-PH", { month: "long", year: "numeric" }) + " statement";
  };

  // ---------- Money math ----------
  const isCharge = (t) => t.type === "purchase" || t.type === "fee";
  const isCredit = (t) => t.type === "payment" || t.type === "refund";

  function installmentTotal(t) {
    const months = Number(t.installment.months);
    const rate = Number(t.installment.rate || 0) / 100;
    return Number(t.amount) * (1 + rate * months);
  }
  function installmentMonthly(t) { return installmentTotal(t) / Number(t.installment.months); }
  function installmentBilled(t, asOfKey) {
    const n = monthDiff(cycleOf(t.date), asOfKey) + 1;
    return Math.max(0, Math.min(Number(t.installment.months), n));
  }

  /** Amount a transaction contributes to a given statement cycle (positive = charge). */
  function amountInCycle(t, key) {
    if (t.installment && t.type === "purchase") {
      const n = monthDiff(cycleOf(t.date), key);
      return n >= 0 && n < Number(t.installment.months) ? installmentMonthly(t) : 0;
    }
    if (cycleOf(t.date) !== key) return 0;
    return isCharge(t) ? Number(t.amount) : -Number(t.amount);
  }

  function cycleTotals(key) {
    let charges = 0, credits = 0;
    for (const t of txs()) {
      const a = amountInCycle(t, key);
      if (a > 0) charges += a; else credits += -a;
    }
    return { charges, credits };
  }

  /** Balance BPI should show on the statement for `key`, based on what was recorded. */
  function statementBalance(key) {
    let bal = 0;
    for (const t of txs()) {
      if (t.installment && t.type === "purchase") bal += installmentMonthly(t) * installmentBilled(t, key);
      else if (cycleOf(t.date) <= key) bal += isCharge(t) ? Number(t.amount) : -Number(t.amount);
    }
    return bal;
  }

  function outstanding() {
    let bal = 0;
    for (const t of txs()) {
      if (isCredit(t)) bal -= Number(t.amount);
      else if (t.installment) bal += installmentTotal(t);
      else bal += Number(t.amount);
    }
    return bal;
  }

  function spendByCategory(key) {
    const out = {};
    for (const t of txs()) {
      const a = amountInCycle(t, key);
      if (a <= 0) continue;
      const cat = t.type === "fee" ? "Fees & Interest" : (t.category || "Others");
      out[cat] = (out[cat] || 0) + a;
    }
    return out;
  }

  /** The statement that is currently waiting to be paid (latest closed one). */
  function billToPay() {
    const key = addMonths(cycleOf(todayISO()), -1);
    const info = cycleInfo(key);
    const s = stmt(key);
    const amountDue = s && s.totalDue != null && s.totalDue !== "" ? Number(s.totalDue) : statementBalance(key);
    const end = toISO(info.end);
    const paid = txs().filter((t) => t.type === "payment" && t.date > end).reduce((sum, t) => sum + Number(t.amount), 0);
    return { key, info, amountDue, paid, remaining: Math.max(0, amountDue - paid), minDue: s?.minDue };
  }

  // ---------- UI state ----------
  let currentCycle = cycleOf(todayISO());
  let editingId = null;

  // ---------- Rendering ----------
  function renderHeader() {
    const s = state.settings;
    const parts = [s.cardName || "BPI Credit Card"];
    if (s.last4) parts.push("•••• " + s.last4);
    parts.push(`Cut-off every ${ordinal(s.cutoffDay)}`);
    $("#card-sub").textContent = parts.join(" · ");
  }
  function ordinal(n) {
    n = Number(n);
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function renderReminder() {
    const el = $("#reminder");
    const bill = billToPay();
    const today = parseISO(todayISO());
    const days = daysBetween(today, bill.info.due);
    const hasActivity = txs().length > 0;
    el.hidden = !hasActivity || bill.amountDue <= 0.5 || days < -45;
    if (el.hidden) return;
    const dueStr = fmtDate(bill.info.due, { weekday: "short", month: "short", day: "numeric" });
    el.className = "banner";
    if (bill.remaining <= 0.5) {
      el.innerHTML = `<strong>✓ ${esc(cycleName(bill.key))} is paid</strong><span class="muted small">${fmt(bill.paid)} paid · was due ${esc(dueStr)}</span>`;
      return;
    }
    const when = days > 1 ? `in ${days} days` : days === 1 ? "tomorrow" : days === 0 ? "TODAY" : `${-days} day(s) ago`;
    if (days < 0) el.classList.add("bad");
    else if (days <= Number(state.settings.reminderDays)) el.classList.add("warn");
    const min = bill.minDue ? ` · Minimum ${fmt(Number(bill.minDue))}` : "";
    const partial = bill.paid > 0 ? ` · ${fmt(bill.paid)} already paid` : "";
    el.innerHTML = `<strong>${days < 0 ? "Overdue: " : ""}Pay ${fmt(bill.remaining)} ${days < 0 ? "— was due" : "due"} ${esc(dueStr)} (${when})</strong>
      <span class="muted small">${esc(cycleName(bill.key))}${min}${partial}</span>`;
  }

  function renderDashboard() {
    renderReminder();
    const info = cycleInfo(currentCycle);
    const thisCycle = cycleOf(todayISO());
    $("#cycle-title").textContent = cycleName(currentCycle) + (currentCycle === thisCycle ? " (current)" : "");
    $("#cycle-range").textContent = `${fmtDate(info.start, { month: "short", day: "numeric" })} – ${fmtDate(info.end)}`;

    const { charges, credits } = cycleTotals(currentCycle);
    $("#stat-cycle").textContent = fmt(charges);
    $("#stat-cycle-note").textContent = credits > 0 ? `${fmt(credits)} in payments/refunds posted` : "Includes installment amortizations";

    const s = stmt(currentCycle);
    const due = s && s.totalDue != null && s.totalDue !== "" ? Number(s.totalDue) : statementBalance(currentCycle);
    $("#stat-due").textContent = fmt(Math.max(0, due));
    const today = parseISO(todayISO());
    const days = daysBetween(today, info.due);
    const dueNote = $("#stat-due-note");
    dueNote.className = "stat-note";
    const dueStr = fmtDate(info.due, { month: "short", day: "numeric" });
    if (today <= info.end) {
      dueNote.textContent = `Estimate · due ${dueStr} · statement closes in ${daysBetween(today, info.end)} day(s)`;
    } else if (days > 0) {
      dueNote.textContent = `Due ${dueStr} · ${days} day(s) left` + (s?.totalDue ? "" : " · estimate");
      if (days <= Number(state.settings.reminderDays)) dueNote.classList.add("warn");
    } else if (days === 0) {
      dueNote.textContent = "Due today!"; dueNote.classList.add("bad");
    } else {
      dueNote.textContent = `Was due ${dueStr}`;
    }

    const bal = outstanding();
    $("#stat-outstanding").textContent = fmt(bal);
    const limit = Number(state.settings.creditLimit) || 0;
    const meter = $("#limit-meter");
    if (limit > 0) {
      const used = Math.max(0, bal) / limit;
      $("#stat-available").textContent = fmt(limit - Math.max(0, bal));
      $("#stat-limit-note").textContent = `${Math.round(used * 100)}% of ${fmt(limit)} limit used`;
      meter.style.width = Math.min(100, used * 100) + "%";
      meter.className = "meter-fill" + (used >= 0.9 ? " bad" : used >= 0.7 ? " warn" : "");
    } else {
      $("#stat-available").textContent = "—";
      $("#stat-limit-note").textContent = "Set your credit limit in Settings";
      meter.style.width = "0";
    }

    const byCat = spendByCategory(currentCycle), byHolder = {};
    for (const t of txs()) {
      const a = amountInCycle(t, currentCycle);
      if (a <= 0) continue;
      const h = t.type === "fee" ? "Bank charges" : (t.cardholder || "—");
      byHolder[h] = (byHolder[h] || 0) + a;
    }
    renderBars("#by-category", byCat);
    renderBars("#by-holder", byHolder);
    renderBudgets(byCat);
    renderRecon();
    renderTrend();
  }

  function renderBudgets(byCat) {
    const budgets = state.settings.budgets || {};
    const cats = Object.keys(budgets).filter((c) => Number(budgets[c]) > 0);
    const el = $("#budgets");
    const alert = $("#budget-alert");
    if (!cats.length) {
      el.innerHTML = `<div class="empty">No budgets yet. Set them in Settings → Monthly budgets.</div>`;
      alert.hidden = true;
      return;
    }
    const over = [], near = [];
    el.innerHTML = cats.map((c) => {
      const spent = byCat[c] || 0, budget = Number(budgets[c]);
      const pct = spent / budget;
      if (pct >= 1) over.push(c); else if (pct >= 0.8) near.push(c);
      const cls = pct >= 1 ? "bad" : pct >= 0.8 ? "warn" : "good";
      const left = budget - spent;
      return `<div class="bar-row">
        <span>${esc(c)} <span class="muted small">${left >= 0 ? fmt(left) + " left" : fmt(-left) + " over"}</span></span>
        <span class="bar-amt">${fmt(spent)} / ${fmt(budget)}</span>
        <div class="bar-track"><div class="bar-fill ${cls}" style="width:${Math.min(100, pct * 100)}%"></div></div>
      </div>`;
    }).join("");
    const msgs = [];
    if (over.length) msgs.push(`Over budget: ${over.join(", ")}`);
    if (near.length) msgs.push(`Almost at budget (80%+): ${near.join(", ")}`);
    alert.hidden = !msgs.length;
    alert.className = "banner " + (over.length ? "bad" : "warn");
    alert.innerHTML = `<strong>${esc(msgs[0] || "")}</strong>${msgs[1] ? `<span class="muted small">${esc(msgs[1])}</span>` : ""}`;
  }

  function renderRecon() {
    const f = $("#recon-form");
    const s = stmt(currentCycle);
    if (document.activeElement?.form !== f) {
      f.totalDue.value = s?.totalDue ?? "";
      f.minDue.value = s?.minDue ?? "";
    }
    const tracked = statementBalance(currentCycle);
    const prev = statementBalance(addMonths(currentCycle, -1));
    const { charges, credits } = cycleTotals(currentCycle);
    let rows = `<table>
      <tr><td>Previous balance (recorded)</td><td>${fmt(prev)}</td></tr>
      <tr><td>+ Charges &amp; installments</td><td>${fmt(charges)}</td></tr>
      <tr><td>− Payments &amp; refunds</td><td>${fmt(credits)}</td></tr>
      <tr class="total"><td>Your recorded balance</td><td>${fmt(tracked)}</td></tr>`;
    if (s?.totalDue != null && s.totalDue !== "") {
      const diff = round2(Number(s.totalDue) - tracked);
      rows += `<tr><td>BPI Total Amount Due</td><td>${fmt(Number(s.totalDue))}</td></tr></table>`;
      rows += Math.abs(diff) < 1
        ? `<p class="ok">✓ Matches your BPI statement.</p>`
        : `<p class="error"><strong>Difference: ${fmt(Math.abs(diff))}</strong> — BPI shows ${diff > 0 ? "more" : "less"} than you recorded. ${diff > 0
            ? "Look for missing purchases, fees, interest or late charges."
            : "Look for a duplicate entry, or a payment/refund you haven't recorded."}</p>`;
    } else {
      rows += `</table>`;
    }
    $("#recon-result").innerHTML = rows;
  }

  function renderBars(sel, obj) {
    const el = $(sel);
    const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { el.innerHTML = `<div class="empty">No charges on this statement yet.</div>`; return; }
    const total = entries.reduce((s, [, v]) => s + v, 0);
    const max = entries[0][1];
    el.innerHTML = entries.map(([k, v]) => `
      <div class="bar-row">
        <span>${esc(k)} <span class="muted small">${Math.round((v / total) * 100)}%</span></span>
        <span class="bar-amt">${fmt(v)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%"></div></div>
      </div>`).join("");
  }

  function renderTrend() {
    const keys = [];
    for (let i = 5; i >= 0; i--) keys.push(addMonths(currentCycle, -i));
    const vals = keys.map((k) => cycleTotals(k).charges);
    const max = Math.max(...vals, 1);
    $("#trend").innerHTML = keys.map((k, i) => {
      const { y, m } = splitKey(k);
      const label = new Date(y, m - 1, 1).toLocaleDateString("en-PH", { month: "short" });
      return `<div class="trend-col ${k === currentCycle ? "current" : ""}" title="${esc(cycleName(k))}: ${fmt(vals[i])}">
        <span class="trend-val">${vals[i] ? fmtShort(vals[i]) : ""}</span>
        <div class="trend-bar" style="height:${(vals[i] / max) * 100}%"></div>
        <span>${label}</span>
      </div>`;
    }).join("");
  }

  function txRow(t) {
    const credit = isCredit(t);
    const typeLabel = { payment: "Payment", refund: "Refund", fee: "Fee/Interest" }[t.type];
    const meta = [fmtDate(parseISO(t.date), { month: "short", day: "numeric" })];
    if (t.type === "purchase") meta.push(t.category || "Others");
    if (t.cardholder && t.type === "purchase") meta.push(t.cardholder);
    if (t.notes) meta.push(t.notes);
    let tags = "";
    if (typeLabel) tags += `<span class="tag">${typeLabel}</span>`;
    if (t.installment) tags += `<span class="tag">${t.installment.months} mos · ${fmt(installmentMonthly(t))}/mo</span>`;
    if (t.scanned) tags += `<span class="tag">📷</span>`;
    return `<button class="tx" data-id="${t.id}">
      <span class="tx-desc">${esc(t.description)}${tags}</span>
      <span class="tx-amt ${credit ? "credit" : ""}">${credit ? "−" : ""}${fmt(Number(t.amount))}</span>
      <span class="tx-meta">${esc(meta.join(" · "))}</span>
    </button>`;
  }

  function renderTransactions() {
    const q = $("#search").value.trim().toLowerCase();
    const cyc = $("#filter-cycle").value;
    const cat = $("#filter-category").value;
    const holder = $("#filter-holder").value;

    const list = txs()
      .filter((t) => !cyc || cycleOf(t.date) === cyc)
      .filter((t) => !cat || t.category === cat)
      .filter((t) => !holder || t.cardholder === holder)
      .filter((t) => !q || (t.description + " " + (t.notes || "")).toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

    const charges = list.filter(isCharge).reduce((s, t) => s + Number(t.amount), 0);
    const credits = list.filter(isCredit).reduce((s, t) => s + Number(t.amount), 0);
    $("#tx-summary").textContent = `${list.length} transaction(s) · Charges ${fmt(charges)} · Payments/refunds ${fmt(credits)}`;

    if (!list.length) {
      $("#tx-list").innerHTML = `<div class="empty">No transactions yet. Tap “+ Add” to record your first one.</div>`;
      return;
    }
    let html = "", lastCycle = null;
    for (const t of list) {
      const c = cycleOf(t.date);
      if (!cyc && c !== lastCycle) { html += `<div class="tx-group">${esc(cycleName(c))}</div>`; lastCycle = c; }
      html += txRow(t);
    }
    $("#tx-list").innerHTML = html;
  }

  function renderInstallments() {
    // Count only statements that have already closed (cut-off date passed).
    const now = addMonths(cycleOf(todayISO()), -1);
    const list = txs().filter((t) => t.installment && t.type === "purchase")
      .sort((a, b) => b.date.localeCompare(a.date));
    if (!list.length) {
      $("#inst-list").innerHTML = `<div class="empty">No installment purchases. Tick “Installment purchase” when adding a transaction.</div>`;
      return;
    }
    const active = list.filter((t) => installmentBilled(t, now) < t.installment.months);
    const done = list.filter((t) => installmentBilled(t, now) >= t.installment.months);
    const monthlyTotal = active.reduce((s, t) => s + installmentMonthly(t), 0);
    const row = (t) => {
      const months = Number(t.installment.months);
      const billed = installmentBilled(t, now);
      const remaining = installmentMonthly(t) * (months - billed);
      const lastKey = addMonths(cycleOf(t.date), months - 1);
      return `<button class="tx" data-id="${t.id}">
        <span class="tx-desc">${esc(t.description)}</span>
        <span class="tx-amt">${fmt(installmentMonthly(t))}/mo</span>
        <span class="tx-meta">${billed}/${months} billed · ${fmt(remaining)} remaining · last on ${esc(cycleName(lastKey))}</span>
        <span class="tx-meta" style="text-align:right">${fmt(installmentTotal(t))} total</span>
        <div class="progress"><div style="width:${(billed / months) * 100}%"></div></div>
      </button>`;
    };
    let html = `<div class="panel"><strong>${fmt(monthlyTotal)}</strong> <span class="muted">billed monthly across ${active.length} active installment(s)</span></div>`;
    if (active.length) html += `<div class="tx-group">Active</div>` + active.map(row).join("");
    if (done.length) html += `<div class="tx-group">Completed</div>` + done.map(row).join("");
    $("#inst-list").innerHTML = html;
  }

  function fillSelect(sel, values) {
    const el = $(sel);
    const prev = el.value;
    el.innerHTML = el.options[0].outerHTML + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    if ([...el.options].some((o) => o.value === prev)) el.value = prev;
  }

  function renderFilters() {
    const s = state.settings;
    fillSelect("#filter-category", s.categories);
    fillSelect("#filter-holder", s.cardholders);
    const keys = new Set(txs().map((t) => cycleOf(t.date)));
    keys.add(cycleOf(todayISO()));
    const sorted = [...keys].sort().reverse();
    const el = $("#filter-cycle");
    const prev = el.value;
    el.innerHTML = `<option value="">All statements</option>` +
      sorted.map((k) => `<option value="${k}">${esc(cycleName(k))}</option>`).join("");
    el.value = sorted.includes(prev) ? prev : "";
  }

  function renderBudgetInputs(categories) {
    const budgets = state.settings.budgets || {};
    $("#budget-inputs").innerHTML = categories.map((c) => `
      <label>${esc(c)}
        <input type="number" min="0" step="100" inputmode="decimal" data-budget="${esc(c)}" value="${budgets[c] ? esc(budgets[c]) : ""}" placeholder="—" />
      </label>`).join("");
  }

  function renderSettings() {
    const f = $("#settings-form");
    const s = state.settings;
    f.cardName.value = s.cardName;
    f.last4.value = s.last4;
    f.creditLimit.value = s.creditLimit || "";
    f.cutoffDay.value = s.cutoffDay;
    f.dueDays.value = s.dueDays;
    f.reminderDays.value = s.reminderDays;
    f.cardholders.value = s.cardholders.join(", ");
    f.categories.value = s.categories.join(", ");
    renderBudgetInputs(s.categories);
    renderSyncPanel();
  }

  function renderAll() {
    renderHeader();
    renderFilters();
    renderDashboard();
    renderTransactions();
    renderInstallments();
    if ($("#view-settings").classList.contains("active") && !$("#view-settings").contains(document.activeElement)) renderSettings();
  }

  // ---------- Household sync ----------
  let syncTimer = null, syncing = false, syncAgain = false;
  const syncState = { status: "", error: "" };

  function scheduleSync() {
    if (!device.passcode) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 800);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { "Content-Type": "application/json", "x-passcode": device.passcode || "", ...(opts.headers || {}) },
    });
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      const err = new Error(body?.error || `Server error (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  async function syncNow() {
    if (!device.passcode) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    setSyncPill("Syncing…");
    try {
      const sent = JSON.stringify(state);
      const merged = normalize(await api("/api/data", { method: "POST", body: sent }));
      const changed = JSON.stringify(merged) !== sent;
      // Keep any edits made while the request was in flight.
      state = changed ? normalize(CCMerge.mergeState(merged, state)) : state;
      saveLocal();
      device.lastSyncAt = Date.now();
      saveDevice();
      syncState.error = "";
      setSyncPill("✓ Synced");
      if (changed) renderAll();
    } catch (err) {
      syncState.error = err.status === 401 ? "Wrong passcode" : err.status ? err.message : "Offline — will sync later";
      setSyncPill("⚠ " + (err.status === 401 ? "Wrong passcode" : err.status ? "Sync error" : "Offline"), true);
    } finally {
      syncing = false;
      renderSyncPanel();
      if (syncAgain) { syncAgain = false; scheduleSync(); }
    }
  }

  function setSyncPill(text, bad = false) {
    const pill = $("#sync-pill");
    pill.hidden = !device.passcode;
    pill.textContent = text;
    pill.classList.toggle("bad", bad);
  }

  function renderSyncPanel() {
    const on = !!device.passcode;
    $("#sync-connected").hidden = !on;
    $("#sync-form").hidden = on;
    if (on) {
      const last = device.lastSyncAt ? new Date(device.lastSyncAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "never";
      $("#sync-status").textContent = syncState.error ? `· ${syncState.error}` : `· Last synced ${last}`;
    }
  }

  $("#sync-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const passcode = e.target.passcode.value.trim();
    $("#sync-error").textContent = "Connecting…";
    const prev = device.passcode;
    device.passcode = passcode;
    try {
      await api("/api/data");       // verify passcode & storage
      saveDevice();
      e.target.reset();
      $("#sync-error").textContent = "";
      await syncNow();
      renderAll();
      renderSettings();
    } catch (err) {
      device.passcode = prev;
      $("#sync-error").textContent = err.status ? err.message : "Can't reach the server. Sync only works on the Vercel site.";
    }
  });
  $("#sync-now").addEventListener("click", syncNow);
  $("#sync-disconnect").addEventListener("click", () => {
    if (!confirm("Disconnect this device? Your data stays on this phone but will stop syncing.")) return;
    device = {};
    saveDevice();
    setSyncPill("");
    renderSyncPanel();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNow(); });
  window.addEventListener("online", syncNow);
  setInterval(() => { if (!document.hidden) syncNow(); }, 60000);

  // ---------- Tabs ----------
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + tab.dataset.view));
    if (tab.dataset.view === "settings") renderSettings();
  }));

  $("#cycle-prev").addEventListener("click", () => { currentCycle = addMonths(currentCycle, -1); renderDashboard(); });
  $("#cycle-next").addEventListener("click", () => { currentCycle = addMonths(currentCycle, 1); renderDashboard(); });
  ["#search", "#filter-cycle", "#filter-category", "#filter-holder"].forEach((s) =>
    $(s).addEventListener("input", renderTransactions));

  // ---------- Statement reconciliation ----------
  $("#recon-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const totalDue = f.totalDue.value === "" ? null : round2(Number(f.totalDue.value));
    const minDue = f.minDue.value === "" ? null : round2(Number(f.minDue.value));
    state.statements[currentCycle] = totalDue == null && minDue == null
      ? { deleted: true, updatedAt: Date.now() }
      : { totalDue, minDue, updatedAt: Date.now() };
    save();
    f.querySelector("button").blur();
    renderDashboard();
  });

  // ---------- Add / edit dialog ----------
  const dialog = $("#tx-dialog");
  const form = $("#tx-form");

  function syncFormMode() {
    const type = form.type.value;
    form.classList.toggle("hide-purchase", type !== "purchase");
    $(".installment-box").classList.toggle("on", form.isInstallment.checked);
    const amt = Number(form.amount.value) || 0;
    const months = Number(form.months.value);
    const rate = Number(form.rate.value) || 0;
    const total = amt * (1 + (rate / 100) * months);
    $("#installment-preview").textContent = amt
      ? `${fmt(total / months)} per month × ${months} = ${fmt(total)} total`
      : "";
  }
  form.addEventListener("input", syncFormMode);

  let scannedThisEntry = false;

  function openDialog(t = null) {
    editingId = t ? t.id : null;
    scannedThisEntry = false;
    const s = state.settings;
    form.category.innerHTML = s.categories.map((c) => `<option>${esc(c)}</option>`).join("");
    form.cardholder.innerHTML = s.cardholders.map((c) => `<option>${esc(c)}</option>`).join("");
    const descs = [...new Set(txs().map((x) => x.description))].slice(0, 200);
    $("#desc-suggestions").innerHTML = descs.map((d) => `<option value="${esc(d)}">`).join("");

    $("#tx-dialog-title").textContent = t ? "Edit transaction" : "Add transaction";
    $("#tx-delete").hidden = !t;
    $("#scan-box").hidden = !!t;
    $("#scan-status").textContent = "Or fill in the details yourself below.";
    $("#scan-status").className = "muted small";
    form.reset();
    form.type.value = t ? t.type : "purchase";
    form.date.value = t ? t.date : todayISO();
    form.amount.value = t ? t.amount : "";
    form.description.value = t ? t.description : "";
    if (t?.category) form.category.value = t.category;
    if (t?.cardholder) form.cardholder.value = t.cardholder;
    if (!t && device.cardholder && s.cardholders.includes(device.cardholder)) form.cardholder.value = device.cardholder;
    form.notes.value = t?.notes || "";
    form.isInstallment.checked = !!t?.installment;
    form.months.value = String(t?.installment?.months || 12);
    form.rate.value = t?.installment?.rate ?? 0;
    syncFormMode();
    dialog.showModal();
  }

  // Auto-pick category when a known description is typed.
  form.description.addEventListener("change", () => {
    if (editingId) return;
    const match = txs().find((x) => x.description.toLowerCase() === form.description.value.trim().toLowerCase());
    if (match?.category) form.category.value = match.category;
  });

  $("#add-btn").addEventListener("click", () => openDialog());
  $("#tx-cancel").addEventListener("click", () => dialog.close());
  $("#tx-list").addEventListener("click", onRowClick);
  $("#inst-list").addEventListener("click", onRowClick);
  function onRowClick(e) {
    const row = e.target.closest(".tx");
    if (!row) return;
    const t = txs().find((x) => x.id === row.dataset.id);
    if (t) openDialog(t);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const type = form.type.value;
    const existing = editingId ? state.transactions.find((x) => x.id === editingId) : null;
    const tx = {
      id: editingId || uid(),
      type,
      date: form.date.value,
      amount: round2(Number(form.amount.value)),
      description: form.description.value.trim(),
      category: type === "purchase" ? form.category.value : "",
      cardholder: type === "purchase" ? form.cardholder.value : "",
      notes: form.notes.value.trim(),
      installment: type === "purchase" && form.isInstallment.checked
        ? { months: Number(form.months.value), rate: Number(form.rate.value) || 0 }
        : null,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    if (existing?.scanned || scannedThisEntry) tx.scanned = true;
    if (type === "purchase") { device.cardholder = tx.cardholder; saveDevice(); }
    if (existing) state.transactions[state.transactions.indexOf(existing)] = tx;
    else state.transactions.push(tx);
    save();
    dialog.close();
    renderAll();
  });

  $("#tx-delete").addEventListener("click", () => {
    if (!editingId || !confirm("Delete this transaction?")) return;
    const i = state.transactions.findIndex((x) => x.id === editingId);
    state.transactions[i] = { id: editingId, deleted: true, updatedAt: Date.now() };
    save();
    dialog.close();
    renderAll();
  });

  // ---------- Receipt scanning ----------
  function resizeImage(file, maxSide = 1600) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't open that photo.")); };
      img.src = url;
    });
  }

  async function onReceipt(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const status = $("#scan-status");
    const box = $("#scan-box");
    if (!device.passcode) {
      status.className = "error small";
      status.textContent = "Receipt scanning needs the household passcode. Connect in Settings → Household sync.";
      return;
    }
    box.classList.add("busy");
    status.className = "muted small";
    status.textContent = "Reading receipt… (takes a few seconds)";
    try {
      const image = await resizeImage(file);
      const r = await api("/api/scan", {
        method: "POST",
        body: JSON.stringify({ image, categories: state.settings.categories, today: todayISO() }),
      });
      form.type.value = "purchase";
      if (r.date) form.date.value = r.date;
      if (r.amount > 0) form.amount.value = round2(r.amount);
      if (r.merchant) form.description.value = r.merchant;
      if (r.category && state.settings.categories.includes(r.category)) form.category.value = r.category;
      if (r.notes) form.notes.value = r.notes;
      scannedThisEntry = true;
      syncFormMode();
      const missing = [!r.date && "date", !(r.amount > 0) && "amount"].filter(Boolean);
      status.className = missing.length ? "error small" : "ok small";
      status.textContent = missing.length
        ? `Filled what I could — please add the ${missing.join(" and ")}.`
        : "✓ Filled in from the receipt. Please double-check, then Save.";
    } catch (err) {
      status.className = "error small";
      status.textContent = err.status ? err.message : "Couldn't reach the scanner. Check your connection.";
    } finally {
      box.classList.remove("busy");
    }
  }
  $("#scan-camera").addEventListener("change", onReceipt);
  $("#scan-file").addEventListener("change", onReceipt);

  // ---------- Settings ----------
  const splitList = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);

  $("#settings-form").categories.addEventListener("change", (e) => {
    // Keep typed budgets while the category list is edited.
    const typed = {};
    $$("#budget-inputs [data-budget]").forEach((i) => { if (i.value) typed[i.dataset.budget] = i.value; });
    state.settings.budgets = { ...state.settings.budgets, ...typed };
    renderBudgetInputs(splitList(e.target.value));
  });

  $("#settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const categories = splitList(f.categories.value).length ? splitList(f.categories.value) : DEFAULT_CATEGORIES.slice();
    const budgets = {};
    $$("#budget-inputs [data-budget]").forEach((i) => {
      if (Number(i.value) > 0 && categories.includes(i.dataset.budget)) budgets[i.dataset.budget] = round2(Number(i.value));
    });
    state.settings = {
      cardName: f.cardName.value.trim() || "BPI Credit Card",
      last4: f.last4.value.trim(),
      creditLimit: Number(f.creditLimit.value) || 0,
      cutoffDay: Math.min(31, Math.max(1, Number(f.cutoffDay.value) || 15)),
      dueDays: Math.max(1, Number(f.dueDays.value) || 20),
      reminderDays: Math.max(0, Number(f.reminderDays.value) || 0),
      cardholders: splitList(f.cardholders.value).length ? splitList(f.cardholders.value) : ["Principal"],
      categories,
      budgets,
      updatedAt: Date.now(),
    };
    save();
    currentCycle = cycleOf(todayISO());
    renderAll();
    renderSettings();
    $("#settings-saved").textContent = "Saved ✓";
    setTimeout(() => ($("#settings-saved").textContent = ""), 2000);
  });

  function download(name, text, mime) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Calendar (.ics) with the next 12 due dates and alerts.
  $("#calendar-btn").addEventListener("click", () => {
    const icsDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const remind = Math.max(0, Number(state.settings.reminderDays) || 0);
    const name = state.settings.cardName + (state.settings.last4 ? ` ••${state.settings.last4}` : "");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pineda CC Tracker//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    let key = addMonths(cycleOf(todayISO()), -1);
    for (let i = 0; i < 12; i++, key = addMonths(key, 1)) {
      const { due } = cycleInfo(key);
      if (due < parseISO(todayISO())) continue;
      const next = new Date(due); next.setDate(next.getDate() + 1);
      lines.push("BEGIN:VEVENT", `UID:bpi-due-${key}@pineda-cc-tracker`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(due)}`, `DTEND;VALUE=DATE:${icsDate(next)}`,
        `SUMMARY:Pay ${name} (${cycleName(key)})`,
        "DESCRIPTION:Open The Pineda's Blessed CC Tracker to see the amount due.");
      for (const d of [...new Set([remind, 1])].filter((d) => d > 0)) {
        lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:BPI payment due in ${d} day(s)`, `TRIGGER:-P${d - 1}DT15H`, "END:VALARM");
      }
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:BPI payment due today", "TRIGGER:PT9H", "END:VALARM", "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    download("bpi-due-dates.ics", lines.join("\r\n"), "text/calendar");
  });

  $("#export-json").addEventListener("click", () =>
    download(`pineda-cc-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), "application/json"));

  const csvCell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  $("#export-csv").addEventListener("click", () => {
    const head = ["date", "statement", "description", "amount", "category", "cardholder", "type", "installment_months", "monthly_amortization", "notes"];
    const rows = [...txs()].sort((a, b) => a.date.localeCompare(b.date)).map((t) => [
      t.date, cycleOf(t.date), t.description, t.amount, t.category, t.cardholder, t.type,
      t.installment ? t.installment.months : "", t.installment ? installmentMonthly(t).toFixed(2) : "", t.notes,
    ]);
    download(`bpi-transactions-${todayISO()}.csv`, [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n"), "text/csv");
  });

  /** Replace everything with `data`, recording deletions so other devices follow. */
  function replaceAll(data) {
    const now = Date.now();
    const incoming = normalize(data);
    const keep = new Set(incoming.transactions.map((t) => t.id));
    const tombstones = state.transactions.filter((t) => !keep.has(t.id)).map((t) => ({ id: t.id, deleted: true, updatedAt: now }));
    const statements = {};
    for (const k of Object.keys(state.statements)) statements[k] = { deleted: true, updatedAt: now };
    for (const [k, v] of Object.entries(incoming.statements)) statements[k] = { ...v, updatedAt: now };
    state = {
      settings: { ...incoming.settings, updatedAt: now },
      transactions: [...incoming.transactions.map((t) => ({ ...t, updatedAt: now })), ...tombstones],
      statements,
    };
  }

  $("#import-json").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.transactions)) throw new Error("No transactions found in file");
      const count = data.transactions.filter((t) => !t.deleted).length;
      if (!confirm(`Replace current data with ${count} transaction(s) from this backup?`)) return;
      replaceAll(data);
      save();
      renderAll();
      renderSettings();
    } catch (err) {
      alert("Import failed: " + err.message);
    } finally {
      e.target.value = "";
    }
  });

  function parseCSV(text) {
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }

  $("#import-csv").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const rows = parseCSV(await file.text());
      const head = rows.shift().map((h) => h.trim().toLowerCase());
      const col = (r, name) => { const i = head.indexOf(name); return i >= 0 ? (r[i] || "").trim() : ""; };
      if (!head.includes("date") || !head.includes("amount")) throw new Error("CSV needs at least 'date' and 'amount' columns");
      const added = [];
      for (const r of rows) {
        const date = normalizeDate(col(r, "date"));
        const amount = Number(col(r, "amount").replace(/[₱,\s]/g, ""));
        if (!date || !amount) continue;
        let type = col(r, "type").toLowerCase();
        if (!["purchase", "payment", "refund", "fee"].includes(type)) type = amount < 0 ? "payment" : "purchase";
        const months = Number(col(r, "installment_months"));
        added.push({
          id: uid(), createdAt: Date.now(), updatedAt: Date.now(), type, date,
          amount: Math.abs(amount),
          description: col(r, "description") || "(no description)",
          category: type === "purchase" ? (col(r, "category") || "Others") : "",
          cardholder: type === "purchase" ? (col(r, "cardholder") || state.settings.cardholders[0]) : "",
          notes: col(r, "notes"),
          installment: type === "purchase" && months > 1 ? { months, rate: 0 } : null,
        });
      }
      if (!confirm(`Add ${added.length} transaction(s) from this CSV?`)) return;
      state.transactions.push(...added);
      save();
      renderAll();
    } catch (err) {
      alert("Import failed: " + err.message);
    } finally {
      e.target.value = "";
    }
  });

  function normalizeDate(s) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // MM/DD/YYYY
    if (m) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return `${y}-${pad(m[1])}-${pad(m[2])}`;
    }
    const d = new Date(s);
    return isNaN(d) ? "" : toISO(d);
  }

  $("#clear-all").addEventListener("click", () => {
    const msg = device.passcode
      ? "Delete ALL transactions and settings on every synced phone? Export a backup first if unsure."
      : "Delete ALL transactions and settings? Export a backup first if unsure.";
    if (!confirm(msg)) return;
    replaceAll(defaultState());
    save();
    currentCycle = cycleOf(todayISO());
    renderAll();
    renderSettings();
  });

  renderAll();
  setSyncPill(device.passcode ? "" : "");
  syncNow();
})();
