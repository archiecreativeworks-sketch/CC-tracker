/*
 * Receipt scanner: POST /api/scan { image: <base64 JPEG>, categories: [..], today: "YYYY-MM-DD" }
 * Sends the photo to Claude and returns { merchant, date, amount, category, notes }.
 * Needs ANTHROPIC_API_KEY in the Vercel environment variables.
 */
const Anthropic = require("@anthropic-ai/sdk");
const { checkPasscode } = require("./_auth");

const client = new Anthropic();

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_receipt", "merchant", "date", "amount", "category", "notes"],
  properties: {
    is_receipt: { type: "boolean", description: "False if the photo is not a receipt or is unreadable." },
    merchant: { type: "string", description: "Store or merchant name, short and clean (e.g. 'SM Supermarket Megamall')." },
    date: { type: "string", description: "Transaction date as YYYY-MM-DD, or empty string if not visible." },
    amount: { type: "number", description: "Final total actually charged, in pesos (after discounts, including VAT/service charge). 0 if not visible." },
    category: { type: "string", description: "Best matching category from the provided list." },
    notes: { type: "string", description: "Very short summary of what was bought (max ~8 words), or empty string." },
  },
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!checkPasscode(req, res)) return;
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "ANTHROPIC_API_KEY is not set in Vercel environment variables." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const image = String(body.image || "").replace(/^data:image\/\w+;base64,/, "");
  const categories = Array.isArray(body.categories) && body.categories.length ? body.categories : ["Others"];
  if (!image) return res.status(400).json({ error: "No image received." });

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      system:
        "You read photos of receipts from the Philippines and extract the expense details. " +
        "Amounts are in Philippine pesos. Dates on PH receipts are usually MM/DD/YYYY. " +
        "Use the grand total / amount due, not subtotals or the cash tendered or change.",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
            {
              type: "text",
              text:
                `Today is ${body.today || new Date().toISOString().slice(0, 10)}. ` +
                `Pick the category from exactly one of: ${categories.join(", ")}.`,
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return res.status(422).json({ error: "The receipt could not be read. Please enter the details manually." });
    }
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const data = JSON.parse(text);
    if (!data.is_receipt) {
      return res.status(422).json({ error: "That doesn't look like a readable receipt. Try a clearer photo." });
    }
    if (!categories.includes(data.category)) data.category = categories.includes("Others") ? "Others" : categories[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) data.date = "";
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    const status = err instanceof Anthropic.APIError && err.status ? err.status : 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: "Scan failed: " + err.message });
  }
};
