const Anthropic = require("@anthropic-ai/sdk");

const VALID_CODES = {
  "AL-FREE":            { tier: "free",  expiry: "lifetime" },
  "AL-PRO-MONTH-001":   { tier: "pro",   expiry: "2026-05-14" },
  "AL-PRO-MONTH-002":   { tier: "pro",   expiry: "2026-05-14" },
  "AL-PRO-MONTH-003":   { tier: "pro",   expiry: "2026-05-14" },
  "AL-PRO-YEAR-001":    { tier: "pro",   expiry: "2027-04-14" },
  "AL-LIFETIME-001":    { tier: "pro",   expiry: "lifetime" },
  "AL-LIFETIME-002":    { tier: "pro",   expiry: "lifetime" },
};

const SYSTEM = `You are AssignLee - an AI that helps students answer school questions. Look at the screenshot and respond ONLY with valid JSON:
{"question":"exact question text","answer":"exact answer to type","explanation":"brief working (1-2 sentences)","submit_hint":"press Enter or click Next","has_more":false}
Rules: Math=final number only. Multiple choice=letter AND full text. ALWAYS return valid JSON. NEVER return plain text.`;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { image, prompt, code, type, validateOnly } = req.body;

  // Validate code
  const entry = VALID_CODES[code];
  if (!entry) return res.status(401).json({ error: "Invalid license code. Purchase at assignlyai.com/pricing", valid: false });
  if (entry.expiry !== "lifetime" && new Date() > new Date(entry.expiry)) {
    return res.status(401).json({ error: "License expired. Renew at assignlyai.com/pricing", valid: false });
  }

  // If just validating code, return now
  if (validateOnly) return res.status(200).json({ valid: true, tier: entry.tier });

  if (!image) return res.status(400).json({ error: "No image provided" });

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) return res.status(500).json({ error: "Server error. Contact support." });

  try {
    const client = new Anthropic({ apiKey });
    const systemPrompt = type === "review"
      ? "You are a student tutor. Look at this screenshot and give a helpful lesson review with: TOPIC, KEY CONCEPTS (3-5 bullets), TIP TO REMEMBER, QUICK SUMMARY. Be concise and friendly."
      : SYSTEM;

    const message = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: image } },
        { type: "text", text: prompt || "Solve the question on screen." }
      ]}]
    });

    const text = message.content?.[0]?.text || "{}";

    if (type === "review") return res.status(200).json({ review: text });

    try {
      return res.status(200).json(JSON.parse(text.replace(/```json|```/g,"").trim()));
    } catch {
      return res.status(200).json({ question: "Seen on screen", answer: text, explanation: "", submit_hint: "Press Enter", has_more: false });
    }
  } catch(e) {
    return res.status(500).json({ error: "Claude error: " + e.message });
  }
};
