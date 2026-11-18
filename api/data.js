/*
 * Household sync endpoint.
 *   GET  /api/data        -> stored data
 *   POST /api/data {data} -> merges the sent data with the stored data, saves, returns the result
 * Storage: Upstash Redis (Vercel Marketplace), via its REST API.
 */
const { checkPasscode } = require("./_auth");
const { mergeState } = require("../shared/merge");

const KEY = "cc-tracker:data";
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(command) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = await r.json();
  if (!r.ok || body.error) throw new Error(body.error || `Redis error ${r.status}`);
  return body.result;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!checkPasscode(req, res)) return;
  if (!URL_ || !TOKEN) {
    return res.status(503).json({ error: "Storage is not connected. Add an Upstash Redis database to this Vercel project." });
  }
  try {
    const raw = await redis(["GET", KEY]);
    const stored = raw ? JSON.parse(raw) : null;

    if (req.method === "GET") return res.status(200).json(stored || {});

    if (req.method === "POST") {
      const incoming = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!incoming || !Array.isArray(incoming.transactions)) {
        return res.status(400).json({ error: "Invalid data." });
      }
      const merged = mergeState(stored, incoming);
      await redis(["SET", KEY, JSON.stringify(merged)]);
      return res.status(200).json(merged);
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Sync failed: " + err.message });
  }
};
