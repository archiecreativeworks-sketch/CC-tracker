const crypto = require("crypto");

/** Returns true if the request carries the household passcode; otherwise sends an error. */
function checkPasscode(req, res) {
  const expected = process.env.APP_PASSCODE;
  if (!expected) {
    res.status(503).json({ error: "APP_PASSCODE is not set in Vercel environment variables." });
    return false;
  }
  const given = String(req.headers["x-passcode"] || "");
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: "Wrong passcode." });
    return false;
  }
  return true;
}

module.exports = { checkPasscode };
