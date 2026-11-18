/* The Pineda's Blessed CC Tracker — BPI credit card expense tracker. */
(() => {
  "use strict";

  const STORAGE_KEY = "bpi-tracker-v1";
  const DEVICE_KEY = "bpi-tracker-device";   // per-device only (passcode, theme, sync time) — never synced

  const DEFAULT_CATEGORIES = [
    "Groceries", "Dining", "Transportation & Gas", "Utilities & Bills",
    "Shopping", "Health & Pharmacy", "Travel", "Entertainment",
    "Subscriptions", "Education", "Home", "Others",
  ];
  const CAT_EMOJI = {
    "Groceries": "🛒", "Dining": "🍽️", "Transportation & Gas": "⛽", "Utilities & Bills": "💡",
    "Shopping": "🛍️", "Health & Pharmacy": "💊", "Travel": "✈️", "Entertainment": "🎬",
    "Subscriptions": "📺", "Education": "🎓", "Home": "🏠", "Others": "📦", "Fees & Interest": "🏦",
  };
  const EMOJI_HINTS = [
    [/food|dine|resto|coffee|cafe/i, "☕"], [/grocer|market/i, "🛒"], [/gas|fuel|car|grab|transport/i, "🚗"],
    [/bill|util|electric|water|internet/i, "💡"], [/health|med|doctor|pharm/i, "💊"], [/kid|baby|school|tuition/i, "🎒"],
    [/pet|dog|cat/i, "🐾"], [/gift|church|tithe|give|donat/i, "🎁"], [/beauty|salon|spa/i, "💅"], [/travel|hotel|flight/i, "✈️"],
  ];

  const defaultSettings = () => ({
    cardName: "BPI Amore Cashback",
    nameOnCard: "",
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
  const haptic = () => { try { navigator.vibrate && navigator.vibrate(8); } catch { /* ignore */ } };

  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => toISO(new Date());
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m is 1-12
  const fmtDate = (dt, opts = { month: "short", day: "numeric", year: "numeric" }) => dt.toLocaleDateString("en-PH", opts);
  const daysBetween = (a, b) => Math.round((b - a) / 86400000);

  // ---------- Icons ----------
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="3"/>',
    plus: '<path d="M12 5v14M5 12h14" stroke-width="2.6"/>',
    chart: '<path d="M6 20v-8M12 20V5M18 20v-5M3 20h18"/>',
    gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  $$("[data-icon]").forEach((el) => (el.innerHTML = svg(el.dataset.icon)));
  ["#cycle-prev", "#stmt-prev"].forEach((s) => ($(s).innerHTML = svg("left")));
  ["#cycle-next", "#stmt-next"].forEach((s) => ($(s).innerHTML = svg("right")));
  $(".search-icon").innerHTML = svg("search");
  $("#cc-waves").innerHTML = Array.from({ length: 34 }, (_, i) => {
    const y = -20 + i * 9, k = i / 33;
    const swell = 38 * Math.sin(Math.PI * k);
    return `<path d="M-20 ${y} C 90 ${y + 10 - swell * 0.3}, 170 ${y - 6}, 250 ${y - swell * 0.9} S 360 ${y + 18 + swell * 0.4}, 420 ${y + 8}"/>`;
  }).join("");

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
  const monthName = (key, style = "long") => { const { y, m } = splitKey(key); return new Date(y, m - 1, 1).toLocaleDateString("en-PH", { month: style }); };
  const cycleName = (key) => {
    const { y, m } = splitKey(key);
    return new Date(y, m - 1, 1).toLocaleDateString("en-PH", { month: "long", year: "numeric" }) + " statement";
  };
  const shortCycle = (key) => monthName(key) + " statement";
  const rangeText = (key) => { const i = cycleInfo(key); return `${fmtDate(i.start, { month: "short", day: "numeric" })} – ${fmtDate(i.end, { month: "short", day: "numeric" })}`; };

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

  function amountDueFor(key) {
    const s = stmt(key);
    return s && s.totalDue != null && s.totalDue !== "" ? { amount: Number(s.totalDue), fromBpi: true } : { amount: statementBalance(key), fromBpi: false };
  }
  function paymentsAfter(key) {
    const end = toISO(cycleInfo(key).end);
    const nextEnd = toISO(cycleInfo(addMonths(key, 1)).end);
    return txs().filter((t) => t.type === "payment" && t.date > end && t.date <= nextEnd).reduce((s, t) => s + Number(t.amount), 0);
  }
  /** The statement that is currently waiting to be paid (latest closed one). */
  function billToPay() {
    const key = addMonths(cycleOf(todayISO()), -1);
    const info = cycleInfo(key);
    const { amount, fromBpi } = amountDueFor(key);
    const paid = paymentsAfter(key);
    return { key, info, amountDue: amount, fromBpi, paid, remaining: Math.max(0, amount - paid), minDue: stmt(key)?.minDue };
  }

  // ---------- Category look ----------
  function catEmoji(name) {
    if (CAT_EMOJI[name]) return CAT_EMOJI[name];
    const hint = EMOJI_HINTS.find(([re]) => re.test(name));
    return hint ? hint[1] : "🏷️";
  }
  /** Fixed slot per category (by its place in the list) — colour follows the category, never its rank. */
  function catColor(name) {
    const i = state.settings.categories.indexOf(name);
    return i >= 0 && i < 8 ? `var(--s${i + 1})` : "var(--s0)";
  }
  function txIcon(t) {
    if (t.type === "payment") return "💳";
    if (t.type === "refund") return "↩️";
    if (t.type === "fee") return "🏦";
    return catEmoji(t.category || "Others");
  }

  // ---------- Animated numbers ----------
  function countTo(el, value, format = fmt) {
    const from = Number(el.dataset.v || 0);
    el.dataset.v = value;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || Math.abs(value - from) < 0.01) { el.textContent = format(value); return; }
    const t0 = performance.now(), dur = 650;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = format(from + (value - from) * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(text, actionLabel, action) {
    const el = $("#toast");
    $("#toast-text").textContent = text;
    const btn = $("#toast-action");
    btn.textContent = actionLabel || "";
    btn.onclick = () => { el.classList.remove("show"); action && action(); };
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), actionLabel ? 5000 : 2200);
  }

  // ---------- Sheets ----------
  function openSheet(dlg) { if (!dlg.open) dlg.showModal(); }
  function closeSheet(dlg) {
    if (!dlg.open || dlg.classList.contains("closing")) return;
    dlg.classList.add("closing");
    dlg.addEventListener("animationend", () => { dlg.classList.remove("closing"); dlg.close(); }, { once: true });
  }
  $$("dialog.sheet").forEach((dlg) => {
    dlg.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) { closeSheet(dlg); return; }
      const r = dlg.getBoundingClientRect();
      if (e.target === dlg && (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right)) closeSheet(dlg);
    });
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); closeSheet(dlg); });
  });

  // ---------- UI state ----------
  const thisCycle = () => cycleOf(todayISO());
  let currentCycle = thisCycle();
  const filters = { cycle: "", category: "", holder: "" };
  let selectedTrend = null;

  // ---------- HOME ----------
  function renderHome() {
    const h = new Date().getHours();
    $("#greeting").textContent = (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening") + " ✨";

    const s = state.settings;
    $("#cc-holder").textContent = s.nameOnCard || "";
    $("#cc-number").textContent = s.last4 ? `••••  ${s.last4}` : `Cut-off ${ordinal(s.cutoffDay)}`;
    const bal = outstanding();
    const limit = Number(s.creditLimit) || 0;
    if (limit > 0) {
      const used = Math.max(0, bal) / limit;
      $("#cc-label").textContent = "Available credit";
      countTo($("#cc-amount"), limit - Math.max(0, bal));
      $("#cc-sub").textContent = `of ${fmt(limit)} · ${Math.round(used * 100)}% used`;
      $("#cc-meter-fill").style.width = Math.min(100, used * 100) + "%";
    } else {
      $("#cc-label").textContent = "Outstanding balance";
      countTo($("#cc-amount"), Math.max(0, bal));
      $("#cc-sub").textContent = "Add your credit limit in Settings";
      $("#cc-meter-fill").style.width = "0";
    }

    // next payment tile
    const bill = billToPay();
    const today = parseISO(todayISO());
    const days = daysBetween(today, bill.info.due);
    const badge = $("#due-badge");
    badge.className = "tile-badge";
    if (!txs().length || bill.amountDue <= 0.5) {
      const next = cycleInfo(thisCycle());
      $("#due-amount").textContent = "₱0.00";
      $("#due-sub").textContent = `Next due ${fmtDate(next.due, { month: "short", day: "numeric" })}`;
      badge.textContent = "";
    } else if (bill.remaining <= 0.5) {
      $("#due-amount").textContent = "Paid";
      $("#due-sub").textContent = `${monthName(bill.key)} bill · ${fmt(bill.paid)}`;
      badge.textContent = "✓"; badge.classList.add("good");
    } else {
      countTo($("#due-amount"), bill.remaining);
      $("#due-sub").textContent = `Due ${fmtDate(bill.info.due, { month: "short", day: "numeric" })}${bill.fromBpi ? "" : " · est."}`;
      badge.textContent = days < 0 ? "Overdue" : days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days} days`;
      if (days < 0) badge.classList.add("crit");
      else if (days <= Number(s.reminderDays)) badge.classList.add("warn");
    }
    countTo($("#out-amount"), bal);

    // alerts (budgets for the running statement)
    const spent = spendByCategory(thisCycle());
    const alerts = [];
    for (const [c, b] of Object.entries(s.budgets || {})) {
      if (!(Number(b) > 0)) continue;
      const pct = (spent[c] || 0) / Number(b);
      if (pct >= 1) alerts.push({ name: c, cls: "crit", text: `${c} is over budget by ${fmt((spent[c] || 0) - b)}` });
      else if (pct >= 0.8) alerts.push({ name: c, cls: "warn", text: `${c} has used ${Math.round(pct * 100)}% of its budget` });
    }
    const shown = alerts.length > 1
      ? [{ cls: alerts.some((a) => a.cls === "crit") ? "crit" : "warn", text: `${alerts.length} budgets need attention: ${alerts.map((a) => a.name).join(", ")}` }]
      : alerts;
    $("#alerts").innerHTML = shown.map((a) =>
      `<button class="alert ${a.cls}" data-goto="insights"><i>${svg("alert")}</i><span>${esc(a.text)}</span><i class="chev"></i></button>`).join("");

    renderSpending();
    renderRecent();
  }

  function ordinal(n) {
    n = Number(n);
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function renderSpending() {
    $("#cycle-name").textContent = shortCycle(currentCycle) + (currentCycle === thisCycle() ? "" : ` ${splitKey(currentCycle).y}`);
    $("#cycle-range").textContent = rangeText(currentCycle) + (currentCycle === thisCycle() ? " · in progress" : "");
    const byCat = spendByCategory(currentCycle);
    const total = Object.values(byCat).reduce((a, b) => a + b, 0);
    countTo($("#spend-total"), total);
    let entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    if (entries.length > 6) {
      const rest = entries.slice(5).reduce((s, [, v]) => s + v, 0);
      entries = [...entries.slice(0, 5), ["Other", rest]];
    }
    const color = (c) => (c === "Other" ? "var(--s0)" : catColor(c));
    $("#segbar").innerHTML = entries.map(([c, v], i) =>
      `<span style="flex:${v} 1 0;background:${color(c)};animation-delay:${i * 60}ms" title="${esc(c)}: ${fmt(v)}"></span>`).join("");
    $("#segbar").setAttribute("aria-label", entries.map(([c, v]) => `${c} ${fmt(v)}`).join(", ") || "No spending");
    $("#cat-list").innerHTML = entries.length
      ? entries.map(([c, v]) => `<li><button class="cat-row" data-cat="${esc(c)}">
          <span class="swatch" style="background:${color(c)}"></span>
          <span class="name">${c === "Other" ? "Other" : catEmoji(c) + " " + esc(c)}</span>
          <span class="pct">${Math.round((v / total) * 100)}%</span>
          <span class="amt">${fmt(v)}</span></button></li>`).join("")
      : `<li class="empty">No charges on this statement yet.</li>`;
  }

  function txRow(t) {
    const credit = isCredit(t);
    const meta = [fmtDate(parseISO(t.date), { month: "short", day: "numeric" })];
    if (t.type === "purchase") meta.push(t.category || "Others");
    else meta.push({ payment: "Payment", refund: "Refund", fee: "Fee / interest" }[t.type]);
    if (t.cardholder && t.type === "purchase" && state.settings.cardholders.length > 1) meta.push(t.cardholder);
    const sub = t.installment ? `<small>${fmt(installmentMonthly(t))}/mo × ${t.installment.months}</small>` : t.scanned ? "<small>📷 scanned</small>" : "";
    return `<li><button class="tx" data-id="${t.id}">
      <span class="tx-icon" style="${t.type === "purchase" ? `box-shadow: inset 0 0 0 1.5px ${catColor(t.category)}` : ""}">${txIcon(t)}</span>
      <span class="tx-main"><span class="tx-desc">${esc(t.description)}</span><span class="tx-meta">${esc(meta.join(" · "))}</span></span>
      <span class="tx-amt ${credit ? "credit" : ""}">${credit ? "+" : ""}${fmt(Number(t.amount))}${sub}</span>
    </button></li>`;
  }

  function sortTx(list) {
    return list.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  }

  function renderRecent() {
    const list = sortTx(txs()).slice(0, 4);
    $("#recent-list").innerHTML = list.length ? list.map(txRow).join("")
      : `<li class="empty-hero"><strong>No expenses yet</strong>Tap the red + below to scan a receipt or add one.</li>`;
  }

  // ---------- ACTIVITY ----------
  function renderActivity() {
    const s = state.settings;
    const cycles = [...new Set([thisCycle(), ...txs().map((t) => cycleOf(t.date))])].sort().reverse();
    if (filters.cycle && !cycles.includes(filters.cycle)) filters.cycle = "";
    const usedCats = s.categories.filter((c) => txs().some((t) => t.category === c));
    let chips = `<select class="chip ${filters.cycle ? "on" : ""}" id="cycle-filter" aria-label="Statement">
        <option value="">All statements</option>${cycles.map((k) => `<option value="${k}" ${k === filters.cycle ? "selected" : ""}>${esc(monthName(k, "short"))} ${splitKey(k).y} statement</option>`).join("")}
      </select>`;
    if (s.cardholders.length > 1) chips += s.cardholders.map((h) => `<button class="chip ${filters.holder === h ? "on" : ""}" data-holder="${esc(h)}">${esc(h)}</button>`).join("");
    chips += usedCats.map((c) => `<button class="chip ${filters.category === c ? "on" : ""}" data-fcat="${esc(c)}">${catEmoji(c)} ${esc(c)}</button>`).join("");
    $("#filter-chips").innerHTML = chips;

    const q = $("#search").value.trim().toLowerCase();
    const list = sortTx(txs()
      .filter((t) => !filters.cycle || cycleOf(t.date) === filters.cycle)
      .filter((t) => !filters.category || t.category === filters.category)
      .filter((t) => !filters.holder || t.cardholder === filters.holder)
      .filter((t) => !q || (t.description + " " + (t.notes || "") + " " + (t.category || "")).toLowerCase().includes(q)));

    const charges = list.filter(isCharge).reduce((a, t) => a + Number(t.amount), 0);
    $("#tx-summary").textContent = list.length ? `${list.length} transaction${list.length > 1 ? "s" : ""} · ${fmt(charges)} in charges` : "";
    if (!list.length) {
      $("#tx-groups").innerHTML = txs().length
        ? `<div class="empty-hero"><strong>Nothing found</strong>Try a different search or filter.</div>`
        : `<div class="empty-hero"><strong>No transactions yet</strong>Tap + to add your first one.</div>`;
      return;
    }
    const groups = new Map();
    for (const t of list) { const c = cycleOf(t.date); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(t); }
    $("#tx-groups").innerHTML = [...groups].map(([c, items]) => {
      const sum = items.filter(isCharge).reduce((a, t) => a + Number(t.amount), 0);
      return `<div class="group-head"><span>${esc(cycleName(c))}</span><span>${fmt(sum)}</span></div>
        <ul class="tx-group tx-list">${items.map(txRow).join("")}</ul>`;
    }).join("");
  }

  $("#filter-chips").addEventListener("click", (e) => {
    const h = e.target.closest("[data-holder]"), c = e.target.closest("[data-fcat]");
    if (h) filters.holder = filters.holder === h.dataset.holder ? "" : h.dataset.holder;
    else if (c) filters.category = filters.category === c.dataset.fcat ? "" : c.dataset.fcat;
    else return;
    haptic();
    renderActivity();
  });
  $("#filter-chips").addEventListener("change", (e) => { if (e.target.id === "cycle-filter") { filters.cycle = e.target.value; renderActivity(); } });
  $("#search").addEventListener("input", renderActivity);

  // ---------- INSIGHTS ----------
  function renderBudgets() {
    const key = currentCycle;
    $("#budget-cycle").textContent = cycleName(key);
    const budgets = state.settings.budgets || {};
    const cats = state.settings.categories.filter((c) => Number(budgets[c]) > 0);
    if (!cats.length) {
      $("#budget-summary").innerHTML = "";
      $("#budget-list").innerHTML = `<li class="empty-hero"><strong>No budgets yet</strong>Set a monthly limit per category.<br /><br /><button class="pill primary" data-goto="settings" data-scroll="budget-inputs">Set budgets</button></li>`;
      return;
    }
    const spent = spendByCategory(key);
    const totalB = cats.reduce((a, c) => a + Number(budgets[c]), 0);
    const totalS = cats.reduce((a, c) => a + (spent[c] || 0), 0);
    $("#budget-summary").innerHTML = `<div><b>${fmt(totalS)}</b><span>Spent</span></div><div><b>${fmt(Math.max(0, totalB - totalS))}</b><span>Left of ${fmt(totalB)}</span></div>`;
    $("#budget-list").innerHTML = cats.map((c, i) => {
      const b = Number(budgets[c]), sp = spent[c] || 0, pct = sp / b;
      const cls = pct >= 1 ? "crit" : pct >= 0.8 ? "warn" : "";
      const flag = pct >= 1 ? `<span class="flag crit">▲ Over by ${fmt(sp - b)}</span>` : pct >= 0.8 ? `<span class="flag warn">● ${Math.round(pct * 100)}% used</span>` : `<span>${fmt(b - sp)} left</span>`;
      return `<li class="meter-row">
        <div class="meter-top"><span class="name">${catEmoji(c)} ${esc(c)}</span><span class="fig">${fmt(sp)} <small>/ ${fmt(b)}</small></span></div>
        <div class="meter-track"><div class="${cls}" style="width:${Math.min(100, pct * 100)}%;animation-delay:${i * 50}ms"></div></div>
        <div class="meter-note">${flag}<span>${Math.round(pct * 100)}%</span></div>
      </li>`;
    }).join("");
  }

  function renderInstallments() {
    const now = addMonths(thisCycle(), -1); // statements already closed
    const list = txs().filter((t) => t.installment && t.type === "purchase").sort((a, b) => b.date.localeCompare(a.date));
    const active = list.filter((t) => installmentBilled(t, now) < t.installment.months);
    const done = list.filter((t) => installmentBilled(t, now) >= t.installment.months);
    countTo($("#inst-monthly"), active.reduce((s, t) => s + installmentMonthly(t), 0));
    $("#inst-count").textContent = active.length ? `${active.length} active installment${active.length > 1 ? "s" : ""}` : "No active installments";
    const row = (t, isDone) => {
      const months = Number(t.installment.months), billed = installmentBilled(t, now);
      const remaining = installmentMonthly(t) * (months - billed);
      const lastKey = addMonths(cycleOf(t.date), months - 1);
      return `<li><button class="inst ${isDone ? "done" : ""}" data-id="${t.id}">
        <div class="inst-top"><strong>${catEmoji(t.category)} ${esc(t.description)}</strong><span class="amt">${fmt(installmentMonthly(t))}<small class="muted">/mo</small></span></div>
        <div class="inst-sub"><span>${billed} of ${months} billed · ${fmt(remaining)} left</span><span>ends ${esc(monthName(lastKey, "short"))} ${splitKey(lastKey).y}</span></div>
        <div class="inst-track"><div style="width:${(billed / months) * 100}%"></div></div>
      </button></li>`;
    };
    $("#inst-list").innerHTML = list.length
      ? active.map((t) => row(t, false)).join("") + done.map((t) => row(t, true)).join("")
      : `<li class="empty-hero"><strong>No installments</strong>Turn on “Installment” when adding a purchase (e.g. BPI Real 0%).</li>`;
  }

  function renderTrends() {
    const end = thisCycle();
    const keys = [];
    for (let i = 5; i >= 0; i--) keys.push(addMonths(end, -i));
    const vals = keys.map((k) => cycleTotals(k).charges);
    const max = Math.max(...vals, 1);
    if (!keys.includes(selectedTrend)) selectedTrend = end;
    $("#trend").innerHTML = keys.map((k, i) => `
      <button class="col ${k === end ? "current" : ""} ${k === selectedTrend ? "sel" : ""}" data-key="${k}" aria-label="${esc(cycleName(k))}: ${fmt(vals[i])}">
        <span class="val">${fmtShort(vals[i])}</span>
        <span class="bar-wrap"><span class="bar" style="height:${Math.max(1, (vals[i] / max) * 100)}%;animation-delay:${i * 60}ms"></span></span>
        <span class="lbl">${esc(monthName(k, "short"))}</span>
      </button>`).join("");
    const closed = vals.slice(0, 5).filter((v) => v > 0);
    const avg = closed.length ? closed.reduce((a, b) => a + b, 0) / closed.length : 0;
    const selVal = vals[keys.indexOf(selectedTrend)];
    $("#trend-foot").innerHTML = `<span>${esc(shortCycle(selectedTrend))}: <b>${fmt(selVal)}</b></span><span>Avg ${fmt(avg)}</span>`;
  }
  $("#trend").addEventListener("click", (e) => {
    const col = e.target.closest(".col");
    if (!col) return;
    selectedTrend = col.dataset.key;
    haptic();
    renderTrends();
  });

  $("#insight-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    haptic();
    $$("#insight-tabs button").forEach((x) => x.classList.toggle("active", x === b));
    $$(".pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + b.dataset.pane));
  });

  // ---------- SETTINGS ----------
  function renderBudgetInputs(categories) {
    const budgets = state.settings.budgets || {};
    $("#budget-inputs").innerHTML = categories.map((c) => `
      <label class="row"><span>${catEmoji(c)} ${esc(c)}</span>
        <input type="number" min="0" step="100" inputmode="decimal" data-budget="${esc(c)}" value="${budgets[c] ? esc(budgets[c]) : ""}" placeholder="—" />
      </label>`).join("");
  }

  function renderSettings() {
    const f = $("#settings-form");
    const s = state.settings;
    f.cardName.value = s.cardName;
    f.nameOnCard.value = s.nameOnCard || "";
    f.last4.value = s.last4;
    f.creditLimit.value = s.creditLimit || "";
    f.cutoffDay.value = s.cutoffDay;
    f.dueDays.value = s.dueDays;
    f.reminderDays.value = s.reminderDays;
    f.cardholders.value = s.cardholders.join(", ");
    f.categories.value = s.categories.join(", ");
    renderBudgetInputs(s.categories);
    renderSyncPanel();
    $$("#theme-seg button").forEach((b) => b.classList.toggle("on", b.dataset.themeOpt === (device.theme || "system")));
  }

  const splitList = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);

  function saveSettingsFromForm() {
    const f = $("#settings-form");
    const categories = splitList(f.categories.value).length ? splitList(f.categories.value) : DEFAULT_CATEGORIES.slice();
    const budgets = {};
    $$("#budget-inputs [data-budget]").forEach((i) => {
      if (Number(i.value) > 0 && categories.includes(i.dataset.budget)) budgets[i.dataset.budget] = round2(Number(i.value));
    });
    state.settings = {
      cardName: f.cardName.value.trim() || "BPI Amore Cashback",
      nameOnCard: f.nameOnCard.value.trim().toUpperCase(),
      last4: f.last4.value.replace(/\D/g, "").slice(0, 4),
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
    renderAll();
    toast("Saved ✓");
  }
  $("#settings-form").addEventListener("change", (e) => {
    if (e.target.name === "categories") renderBudgetInputs(splitList(e.target.value));
    saveSettingsFromForm();
  });
  $("#settings-form").addEventListener("submit", (e) => e.preventDefault());

  function applyTheme() {
    const t = device.theme || "system";
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }
  $("#theme-seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme-opt]");
    if (!b) return;
    device.theme = b.dataset.themeOpt;
    saveDevice();
    applyTheme();
    renderSettings();
  });

  // ---------- Navigation ----------
  function goTo(view, opts = {}) {
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
    if (view === "settings") renderSettings();
    if (view === "activity") renderActivity();
    window.scrollTo({ top: 0 });
    if (opts.scroll) setTimeout(() => document.getElementById(opts.scroll)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => { haptic(); goTo(tab.dataset.view); }));
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-goto]");
    if (g) { goTo(g.dataset.goto, { scroll: g.dataset.scroll }); return; }
    const row = e.target.closest(".tx, .inst");
    if (row) { const t = txs().find((x) => x.id === row.dataset.id); if (t) openTx(t); return; }
    const cat = e.target.closest(".cat-row");
    if (cat) {
      filters.cycle = currentCycle;
      filters.category = cat.dataset.cat === "Other" ? "" : cat.dataset.cat;
      filters.holder = "";
      $("#search").value = cat.dataset.cat === "Fees & Interest" ? "fee" : "";
      goTo("activity");
    }
  });

  $("#cycle-prev").addEventListener("click", () => { currentCycle = addMonths(currentCycle, -1); haptic(); renderSpending(); renderBudgets(); });
  $("#cycle-next").addEventListener("click", () => { currentCycle = addMonths(currentCycle, 1); haptic(); renderSpending(); renderBudgets(); });
  $("#cycle-btn").addEventListener("click", () => openStatement(currentCycle));
  $("#tile-due").addEventListener("click", () => openStatement(txs().length ? billToPay().key : thisCycle()));
  $("#tile-outstanding").addEventListener("click", () => openStatement(thisCycle()));

  // ---------- Statement sheet ----------
  let stmtKey = null;
  function openStatement(key) {
    stmtKey = key;
    renderStatement();
    openSheet($("#stmt-sheet"));
  }
  function renderStatement() {
    const key = stmtKey, info = cycleInfo(key), s = stmt(key);
    const today = parseISO(todayISO());
    $("#stmt-title").textContent = cycleName(key);
    $("#stmt-period").textContent = `${rangeText(key)}, ${info.end.getFullYear()} · due ${fmtDate(info.due, { month: "short", day: "numeric" })}`;
    const { amount, fromBpi } = amountDueFor(key);
    const paid = paymentsAfter(key);
    $("#stmt-due-label").textContent = fromBpi ? "Amount due (from BPI)" : today <= info.end ? "Running total" : "Estimated amount due";
    countTo($("#stmt-due"), Math.max(0, amount));
    const chip = $("#stmt-status");
    chip.className = "status-chip";
    const days = daysBetween(today, info.due);
    if (today <= info.end) chip.textContent = `Open · closes in ${daysBetween(today, info.end)} days`;
    else if (amount <= 0.5 || paid >= amount - 0.5) { chip.textContent = "✓ Paid"; chip.classList.add("good"); }
    else if (days < 0) { chip.textContent = `▲ Overdue · ${fmt(amount - paid)} unpaid`; chip.classList.add("crit"); }
    else { chip.textContent = `${days === 0 ? "Due today" : `Due in ${days} days`}${paid > 0 ? ` · ${fmt(paid)} paid` : ""}`; if (days <= Number(state.settings.reminderDays)) chip.classList.add("warn"); }

    const { charges, credits } = cycleTotals(key);
    const recorded = statementBalance(key);
    $("#stmt-prev-bal").textContent = fmt(statementBalance(addMonths(key, -1)));
    $("#stmt-charges").textContent = "+" + fmt(charges);
    $("#stmt-credits").textContent = "−" + fmt(credits);
    $("#stmt-recorded").textContent = fmt(recorded);

    const f = $("#recon-form");
    if (!f.contains(document.activeElement)) {
      f.totalDue.value = s?.totalDue ?? "";
      f.minDue.value = s?.minDue ?? "";
    }
    const res = $("#recon-result");
    res.className = "recon-result";
    if (s?.totalDue != null && s.totalDue !== "") {
      const diff = round2(Number(s.totalDue) - recorded);
      if (Math.abs(diff) < 1) { res.classList.add("good"); res.innerHTML = `<i>${svg("check")}</i><span><b>Matches your BPI statement.</b> Everything is accounted for.</span>`; }
      else {
        res.classList.add("crit");
        res.innerHTML = `<i>${svg("alert")}</i><span><b>Off by ${fmt(Math.abs(diff))}.</b> BPI shows ${diff > 0 ? "more" : "less"} than you recorded — ${diff > 0
          ? "look for missing purchases, fees, interest or late charges." : "look for a duplicate entry or an unrecorded payment/refund."}</span>`;
      }
    } else res.innerHTML = "";
  }
  $("#stmt-prev").addEventListener("click", () => { stmtKey = addMonths(stmtKey, -1); haptic(); renderStatement(); });
  $("#stmt-next").addEventListener("click", () => { stmtKey = addMonths(stmtKey, 1); haptic(); renderStatement(); });
  $("#recon-form").addEventListener("change", (e) => {
    const f = e.currentTarget;
    const totalDue = f.totalDue.value === "" ? null : round2(Number(f.totalDue.value));
    const minDue = f.minDue.value === "" ? null : round2(Number(f.minDue.value));
    state.statements[stmtKey] = totalDue == null && minDue == null
      ? { deleted: true, updatedAt: Date.now() }
      : { totalDue, minDue, updatedAt: Date.now() };
    save();
    renderStatement();
    renderHome();
  });
  $("#recon-form").addEventListener("submit", (e) => { e.preventDefault(); document.activeElement.blur(); });

  // ---------- Add flow ----------
  const addSheet = $("#add-sheet");
  $("#fab").addEventListener("click", () => {
    haptic();
    if (addSheet.open) { closeSheet(addSheet); return; }
    openSheet(addSheet);
    $("#fab").classList.add("open");
  });
  addSheet.addEventListener("close", () => $("#fab").classList.remove("open"));
  addSheet.addEventListener("click", (e) => {
    const b = e.target.closest("[data-new]");
    if (!b) return;
    addSheet.close();
    openTx(null, b.dataset.new);
  });

  // ---------- Transaction sheet ----------
  const txSheet = $("#tx-sheet");
  const form = $("#tx-form");
  let editingId = null;
  let scannedThisEntry = false;

  function renderCatChips(selected) {
    form.category.value = selected;
    $("#cat-chips").innerHTML = state.settings.categories.map((c) =>
      `<button type="button" class="cat-chip ${c === selected ? "on" : ""}" data-c="${esc(c)}"><b>${catEmoji(c)}</b>${esc(c)}</button>`).join("");
    const on = $("#cat-chips .on");
    if (on) on.scrollIntoView({ block: "nearest", inline: "center" });
  }
  $("#cat-chips").addEventListener("click", (e) => {
    const b = e.target.closest(".cat-chip");
    if (!b) return;
    haptic();
    form.category.value = b.dataset.c;
    $$("#cat-chips .cat-chip").forEach((x) => x.classList.toggle("on", x === b));
  });
  function renderHolderSeg(selected) {
    form.cardholder.value = selected;
    $("#holder-seg").innerHTML = state.settings.cardholders.map((h) =>
      `<button type="button" class="${h === selected ? "on" : ""}" data-h="${esc(h)}">${esc(h)}</button>`).join("");
  }
  $("#holder-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    form.cardholder.value = b.dataset.h;
    $$("#holder-seg button").forEach((x) => x.classList.toggle("on", x === b));
  });

  function syncFormMode() {
    const type = form.type.value;
    form.classList.toggle("hide-purchase", type !== "purchase");
    $(".installment-fields").classList.toggle("on", form.isInstallment.checked);
    $("#tx-title").textContent = (editingId ? "Edit " : "New ") + { purchase: "expense", payment: "payment", refund: "refund", fee: "fee" }[type];
    const amt = Number(form.amount.value) || 0;
    const months = Number(form.months.value);
    const total = amt * (1 + ((Number(form.rate.value) || 0) / 100) * months);
    $("#installment-preview").textContent = amt && form.isInstallment.checked ? `${fmt(total / months)} a month for ${months} months · ${fmt(total)} total` : "";
  }
  function fitAmount() {
    const len = Math.max(4, (form.amount.value || "0.00").length);
    form.amount.style.width = `${len * 0.62 + 0.3}em`;
  }
  form.addEventListener("input", () => { syncFormMode(); fitAmount(); });
  form.addEventListener("change", syncFormMode);

  function openTx(t = null, type = "purchase") {
    editingId = t ? t.id : null;
    scannedThisEntry = false;
    const s = state.settings;
    form.reset();
    $("#tx-error").textContent = "";
    $("#scan-banner").hidden = true;
    txSheet.classList.remove("scanning");
    const descs = [...new Set(txs().map((x) => x.description))].slice(0, 200);
    $("#desc-suggestions").innerHTML = descs.map((d) => `<option value="${esc(d)}">`).join("");
    form.type.value = t ? t.type : type;
    form.date.value = t ? t.date : todayISO();
    form.amount.value = t ? t.amount : "";
    form.description.value = t ? t.description : type === "payment" ? "Payment – BPI" : "";
    renderCatChips(t?.category || (s.categories.includes(device.lastCategory) ? device.lastCategory : s.categories[0]));
    const holder = t?.cardholder || (s.cardholders.includes(device.cardholder) ? device.cardholder : s.cardholders[0]);
    renderHolderSeg(holder);
    form.notes.value = t?.notes || "";
    form.isInstallment.checked = !!t?.installment;
    form.months.value = String(t?.installment?.months || 12);
    form.rate.value = t?.installment?.rate ?? 0;
    $("#tx-delete").hidden = !t;
    syncFormMode();
    fitAmount();
    openSheet(txSheet);
  }

  // Auto-pick category when a known description is typed.
  form.description.addEventListener("change", () => {
    if (editingId) return;
    const match = txs().find((x) => x.description.toLowerCase() === form.description.value.trim().toLowerCase());
    if (match?.category) renderCatChips(match.category);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const amount = round2(Number(form.amount.value));
    const description = form.description.value.trim();
    const err = !(amount > 0) ? "Enter an amount." : !description ? "Add a short description." : !form.date.value ? "Pick a date." : "";
    if (err) { $("#tx-error").textContent = err; return; }
    const type = form.type.value;
    const existing = editingId ? state.transactions.find((x) => x.id === editingId) : null;
    const tx = {
      id: editingId || uid(),
      type,
      date: form.date.value,
      amount,
      description,
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
    if (type === "purchase") { device.cardholder = tx.cardholder; device.lastCategory = tx.category; saveDevice(); }
    if (existing) state.transactions[state.transactions.indexOf(existing)] = tx;
    else state.transactions.push(tx);
    save();
    haptic();
    closeSheet(txSheet);
    renderAll();
    toast(existing ? "Changes saved" : `${fmt(amount)} added ✓`);
  });

  $("#tx-delete").addEventListener("click", () => {
    if (!editingId) return;
    const i = state.transactions.findIndex((x) => x.id === editingId);
    const before = state.transactions[i];
    state.transactions[i] = { id: editingId, deleted: true, updatedAt: Date.now() };
    save();
    closeSheet(txSheet);
    renderAll();
    toast("Transaction deleted", "Undo", () => {
      const j = state.transactions.findIndex((x) => x.id === before.id);
      state.transactions[j] = { ...before, updatedAt: Date.now() };
      save();
      renderAll();
    });
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

  function scanBanner(text, cls = "") {
    const b = $("#scan-banner");
    b.hidden = false;
    b.className = "scan-banner " + cls;
    $("#scan-text").textContent = text;
  }

  async function onReceipt(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    addSheet.close();
    openTx(null, "purchase");
    if (!device.passcode) {
      scanBanner("Scanning needs the household passcode — connect in Settings. You can type it in for now.", "err");
      return;
    }
    scanBanner("Reading your receipt…");
    txSheet.classList.add("scanning");
    try {
      const image = await resizeImage(file);
      const r = await api("/api/scan", {
        method: "POST",
        body: JSON.stringify({ image, categories: state.settings.categories, today: todayISO() }),
      });
      if (r.date) form.date.value = r.date;
      if (r.amount > 0) { form.amount.value = round2(r.amount); fitAmount(); }
      if (r.merchant) form.description.value = r.merchant;
      if (r.category && state.settings.categories.includes(r.category)) renderCatChips(r.category);
      if (r.notes) form.notes.value = r.notes;
      scannedThisEntry = true;
      syncFormMode();
      haptic();
      const missing = [!r.date && "date", !(r.amount > 0) && "amount"].filter(Boolean);
      scanBanner(missing.length ? `Couldn't read the ${missing.join(" or ")} — please fill it in.` : "✓ Filled in from your receipt. Check, then Save.", missing.length ? "err" : "done");
    } catch (err) {
      scanBanner(err.status ? err.message : "Couldn't reach the scanner. Check your connection.", "err");
    } finally {
      txSheet.classList.remove("scanning");
    }
  }
  $("#scan-camera").addEventListener("change", onReceipt);
  $("#scan-file").addEventListener("change", onReceipt);

  // ---------- Household sync ----------
  let syncTimer = null, syncing = false, syncAgain = false;
  const syncState = { error: "" };

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

  function setSyncDot(cls) {
    const dot = $("#sync-dot");
    dot.hidden = !device.passcode;
    dot.className = "sync-dot " + (cls || "");
    dot.title = cls === "bad" ? syncState.error : cls === "busy" ? "Syncing…" : "Synced";
  }
  $("#sync-dot").addEventListener("click", () => goTo("settings"));

  async function syncNow() {
    if (!device.passcode) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    setSyncDot("busy");
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
      setSyncDot("");
      if (changed) renderAll();
    } catch (err) {
      syncState.error = err.status === 401 ? "Wrong passcode" : err.status ? err.message : "Offline — will sync later";
      setSyncDot("bad");
    } finally {
      syncing = false;
      renderSyncPanel();
      if (syncAgain) { syncAgain = false; scheduleSync(); }
    }
  }

  function renderSyncPanel() {
    const on = !!device.passcode;
    $("#sync-connected").hidden = !on;
    $("#sync-form").hidden = on;
    if (on) {
      const last = device.lastSyncAt ? new Date(device.lastSyncAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "never";
      $("#sync-status").textContent = syncState.error || `Last synced ${last}`;
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
      toast("Connected ✓");
    } catch (err) {
      device.passcode = prev;
      $("#sync-error").textContent = err.status ? err.message : "Can't reach the server. Sync only works on the Vercel site.";
    }
  });
  $("#sync-now").addEventListener("click", async () => { await syncNow(); toast(syncState.error || "Synced ✓"); });
  $("#sync-disconnect").addEventListener("click", () => {
    if (!confirm("Disconnect this phone? Your data stays here but stops syncing.")) return;
    device = { theme: device.theme };
    saveDevice();
    setSyncDot();
    renderSyncPanel();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { syncNow(); renderHome(); } });
  window.addEventListener("online", syncNow);
  setInterval(() => { if (!document.hidden) syncNow(); }, 60000);

  // ---------- Calendar & data ----------
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
    let key = addMonths(thisCycle(), -1);
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
      toast("Backup restored ✓");
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
      toast(`${added.length} imported ✓`);
    } catch (err) {
      alert("Import failed: " + err.message);
    } finally {
      e.target.value = "";
    }
  });

  $("#clear-all").addEventListener("click", () => {
    const msg = device.passcode
      ? "Delete ALL transactions and settings on every synced phone? Export a backup first if unsure."
      : "Delete ALL transactions and settings? Export a backup first if unsure.";
    if (!confirm(msg)) return;
    replaceAll(defaultState());
    save();
    currentCycle = thisCycle();
    renderAll();
    renderSettings();
  });

  // ---------- Render all ----------
  function renderAll() {
    renderHome();
    renderActivity();
    renderBudgets();
    renderInstallments();
    renderTrends();
    if ($("#stmt-sheet").open) renderStatement();
  }

  applyTheme();
  renderAll();
  setSyncDot();
  syncNow();
})();
