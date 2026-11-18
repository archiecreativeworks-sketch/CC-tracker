/* BPI Credit Card Tracker — all data lives in localStorage. */
(() => {
  "use strict";

  const STORAGE_KEY = "bpi-tracker-v1";

  const DEFAULT_CATEGORIES = [
    "Groceries", "Dining", "Transportation & Gas", "Utilities & Bills",
    "Shopping", "Health & Pharmacy", "Travel", "Entertainment",
    "Subscriptions", "Education", "Home", "Others",
  ];

  const defaultState = () => ({
    settings: {
      cardName: "BPI Credit Card",
      last4: "",
      creditLimit: 0,
      cutoffDay: 15,
      dueDays: 20,
      cardholders: ["Principal", "Supplementary"],
      categories: DEFAULT_CATEGORIES.slice(),
    },
    transactions: [],
  });

  // ---------- Storage ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const data = JSON.parse(raw);
      const base = defaultState();
      return {
        settings: { ...base.settings, ...(data.settings || {}) },
        transactions: Array.isArray(data.transactions) ? data.transactions : [],
      };
    } catch (e) {
      console.error("Could not load saved data", e);
      return defaultState();
    }
  }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  let state = load();

  // ---------- Helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
  const fmt = (n) => peso.format(Math.round((n + Number.EPSILON) * 100) / 100);
  const fmtShort = (n) => n >= 1000 ? "₱" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : "₱" + Math.round(n);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => toISO(new Date());
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m is 1-12
  const fmtDate = (dt, opts = { month: "short", day: "numeric", year: "numeric" }) => dt.toLocaleDateString("en-PH", opts);

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
    for (const t of state.transactions) {
      const a = amountInCycle(t, key);
      if (a > 0) charges += a; else credits += -a;
    }
    return { charges, credits };
  }

  function outstanding() {
    let bal = 0;
    for (const t of state.transactions) {
      if (isCredit(t)) bal -= Number(t.amount);
      else if (t.installment) bal += installmentTotal(t);
      else bal += Number(t.amount);
    }
    return bal;
  }

  // ---------- UI state ----------
  let currentCycle = cycleOf(todayISO());
  let editingId = null;

  // ---------- Rendering ----------
  function renderHeader() {
    const s = state.settings;
    $("#card-title").textContent = s.cardName || "BPI Credit Card";
    const parts = [];
    if (s.last4) parts.push("•••• " + s.last4);
    parts.push(`Cut-off every ${ordinal(s.cutoffDay)}`);
    $("#card-sub").textContent = parts.join(" · ");
  }
  function ordinal(n) {
    n = Number(n);
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function renderDashboard() {
    const info = cycleInfo(currentCycle);
    const thisCycle = cycleOf(todayISO());
    $("#cycle-title").textContent = cycleName(currentCycle) + (currentCycle === thisCycle ? " (current)" : "");
    $("#cycle-range").textContent = `${fmtDate(info.start, { month: "short", day: "numeric" })} – ${fmtDate(info.end)}`;

    const { charges, credits } = cycleTotals(currentCycle);
    $("#stat-cycle").textContent = fmt(charges);
    $("#stat-cycle-note").textContent = credits > 0 ? `${fmt(credits)} in payments/refunds posted` : "Includes installment amortizations";

    $("#stat-due").textContent = fmtDate(info.due, { month: "short", day: "numeric" });
    const today = parseISO(todayISO());
    const days = Math.round((info.due - today) / 86400000);
    const dueNote = $("#stat-due-note");
    dueNote.className = "stat-note";
    if (today <= info.end) {
      dueNote.textContent = `Statement closes in ${Math.round((info.end - today) / 86400000)} day(s)`;
    } else if (days > 0) {
      dueNote.textContent = `${days} day(s) left to pay`;
      if (days <= 5) dueNote.classList.add("warn");
    } else if (days === 0) {
      dueNote.textContent = "Due today!"; dueNote.classList.add("bad");
    } else {
      dueNote.textContent = `Was due ${-days} day(s) ago`;
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

    // Breakdown by category / cardholder (charges only)
    const byCat = {}, byHolder = {};
    for (const t of state.transactions) {
      const a = amountInCycle(t, currentCycle);
      if (a <= 0) continue;
      const cat = t.type === "fee" ? "Fees & Interest" : (t.category || "Others");
      byCat[cat] = (byCat[cat] || 0) + a;
      const h = t.cardholder || "—";
      byHolder[h] = (byHolder[h] || 0) + a;
    }
    renderBars("#by-category", byCat);
    renderBars("#by-holder", byHolder);
    renderTrend();
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

    const list = state.transactions
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
    const list = state.transactions.filter((t) => t.installment && t.type === "purchase")
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

  function fillSelect(sel, values, keepFirst = true) {
    const el = $(sel);
    const prev = el.value;
    const first = keepFirst ? el.options[0].outerHTML : "";
    el.innerHTML = first + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    if ([...el.options].some((o) => o.value === prev)) el.value = prev;
  }

  function renderFilters() {
    const s = state.settings;
    fillSelect("#filter-category", s.categories);
    fillSelect("#filter-holder", s.cardholders);
    const keys = new Set(state.transactions.map((t) => cycleOf(t.date)));
    keys.add(cycleOf(todayISO()));
    const sorted = [...keys].sort().reverse();
    const el = $("#filter-cycle");
    const prev = el.value;
    el.innerHTML = `<option value="">All statements</option>` +
      sorted.map((k) => `<option value="${k}">${esc(cycleName(k))}</option>`).join("");
    el.value = sorted.includes(prev) ? prev : "";
  }

  function renderSettings() {
    const f = $("#settings-form");
    const s = state.settings;
    f.cardName.value = s.cardName;
    f.last4.value = s.last4;
    f.creditLimit.value = s.creditLimit || "";
    f.cutoffDay.value = s.cutoffDay;
    f.dueDays.value = s.dueDays;
    f.cardholders.value = s.cardholders.join(", ");
    f.categories.value = s.categories.join(", ");
  }

  function renderAll() {
    renderHeader();
    renderFilters();
    renderDashboard();
    renderTransactions();
    renderInstallments();
  }

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

  function openDialog(t = null) {
    editingId = t ? t.id : null;
    const s = state.settings;
    form.category.innerHTML = s.categories.map((c) => `<option>${esc(c)}</option>`).join("");
    form.cardholder.innerHTML = s.cardholders.map((c) => `<option>${esc(c)}</option>`).join("");
    const descs = [...new Set(state.transactions.map((x) => x.description))].slice(0, 200);
    $("#desc-suggestions").innerHTML = descs.map((d) => `<option value="${esc(d)}">`).join("");

    $("#tx-dialog-title").textContent = t ? "Edit transaction" : "Add transaction";
    $("#tx-delete").hidden = !t;
    form.reset();
    form.type.value = t ? t.type : "purchase";
    form.date.value = t ? t.date : todayISO();
    form.amount.value = t ? t.amount : "";
    form.description.value = t ? t.description : "";
    if (t?.category) form.category.value = t.category;
    if (t?.cardholder) form.cardholder.value = t.cardholder;
    form.notes.value = t?.notes || "";
    form.isInstallment.checked = !!t?.installment;
    form.months.value = String(t?.installment?.months || 12);
    form.rate.value = t?.installment?.rate ?? 0;
    syncFormMode();
    dialog.showModal();
    if (!t) form.amount.focus();
  }

  // Auto-pick category when a known description is typed.
  form.description.addEventListener("change", () => {
    if (editingId) return;
    const match = state.transactions.find((x) => x.description.toLowerCase() === form.description.value.trim().toLowerCase());
    if (match?.category) form.category.value = match.category;
  });

  $("#add-btn").addEventListener("click", () => openDialog());
  $("#tx-cancel").addEventListener("click", () => dialog.close());
  $("#tx-list").addEventListener("click", onRowClick);
  $("#inst-list").addEventListener("click", onRowClick);
  function onRowClick(e) {
    const row = e.target.closest(".tx");
    if (!row) return;
    const t = state.transactions.find((x) => x.id === row.dataset.id);
    if (t) openDialog(t);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const type = form.type.value;
    const tx = {
      id: editingId || uid(),
      type,
      date: form.date.value,
      amount: Math.round(Number(form.amount.value) * 100) / 100,
      description: form.description.value.trim(),
      category: type === "purchase" ? form.category.value : "",
      cardholder: type === "purchase" ? form.cardholder.value : "",
      notes: form.notes.value.trim(),
      installment: type === "purchase" && form.isInstallment.checked
        ? { months: Number(form.months.value), rate: Number(form.rate.value) || 0 }
        : null,
    };
    if (editingId) {
      const i = state.transactions.findIndex((x) => x.id === editingId);
      tx.createdAt = state.transactions[i].createdAt;
      state.transactions[i] = tx;
    } else {
      tx.createdAt = Date.now();
      state.transactions.push(tx);
    }
    save();
    dialog.close();
    renderAll();
  });

  $("#tx-delete").addEventListener("click", () => {
    if (!editingId || !confirm("Delete this transaction?")) return;
    state.transactions = state.transactions.filter((x) => x.id !== editingId);
    save();
    dialog.close();
    renderAll();
  });

  // ---------- Settings ----------
  const splitList = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);

  $("#settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    state.settings = {
      cardName: f.cardName.value.trim() || "BPI Credit Card",
      last4: f.last4.value.trim(),
      creditLimit: Number(f.creditLimit.value) || 0,
      cutoffDay: Math.min(31, Math.max(1, Number(f.cutoffDay.value) || 15)),
      dueDays: Math.max(1, Number(f.dueDays.value) || 20),
      cardholders: splitList(f.cardholders.value).length ? splitList(f.cardholders.value) : ["Principal"],
      categories: splitList(f.categories.value).length ? splitList(f.categories.value) : DEFAULT_CATEGORIES.slice(),
    };
    save();
    currentCycle = cycleOf(todayISO());
    renderAll();
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

  $("#export-json").addEventListener("click", () =>
    download(`bpi-tracker-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), "application/json"));

  const csvCell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  $("#export-csv").addEventListener("click", () => {
    const head = ["date", "statement", "description", "amount", "category", "cardholder", "type", "installment_months", "monthly_amortization", "notes"];
    const rows = [...state.transactions].sort((a, b) => a.date.localeCompare(b.date)).map((t) => [
      t.date, cycleOf(t.date), t.description, t.amount, t.category, t.cardholder, t.type,
      t.installment ? t.installment.months : "", t.installment ? installmentMonthly(t).toFixed(2) : "", t.notes,
    ]);
    download(`bpi-transactions-${todayISO()}.csv`, [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n"), "text/csv");
  });

  $("#import-json").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.transactions)) throw new Error("No transactions found in file");
      if (!confirm(`Replace current data with ${data.transactions.length} transaction(s) from this backup?`)) return;
      state = { settings: { ...defaultState().settings, ...data.settings }, transactions: data.transactions };
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
          id: uid(), createdAt: Date.now(), type, date,
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
    if (!confirm("Delete ALL transactions and settings? Export a backup first if unsure.")) return;
    state = defaultState();
    save();
    currentCycle = cycleOf(todayISO());
    renderAll();
    renderSettings();
  });

  renderAll();
})();
