/*
 * Merge two copies of the tracker data (used by the browser and the sync API).
 * Every record carries `updatedAt`; the newer copy of each record wins.
 * Deleted records are kept as `{ id, deleted: true, updatedAt }` so deletions sync too.
 */
(function (root) {
  "use strict";

  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  }

  function mergeState(a, b) {
    a = a || {};
    b = b || {};
    const byId = new Map();
    for (const t of a.transactions || []) byId.set(t.id, t);
    for (const t of b.transactions || []) byId.set(t.id, newer(byId.get(t.id), t));

    const statements = { ...(a.statements || {}) };
    for (const [k, v] of Object.entries(b.statements || {})) statements[k] = newer(statements[k], v);

    return {
      settings: newer(a.settings, b.settings) || {},
      transactions: [...byId.values()],
      statements,
    };
  }

  const api = { mergeState };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CCMerge = api;
})(typeof window !== "undefined" ? window : globalThis);
