const Anthropic = require("@anthropic-ai/sdk");

const { Resend } = require("resend");

const Stripe = require("stripe");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

const resend = new Resend(process.env.RESEND_KEY);

const stripe = new Stripe(process.env.STRIPE_KEY);

const USED_CUSTOMER_CODES = new Set(["AL-PM-TAG3Q6-YEYW0L","AL-PM-JXDPR4-9M0QRP","AL-PM-HUC40O-V32WZ8"]);

const OWNER_CODES = {

  pro: ["AL-PM-9CG9TO-GZ5JFI","AL-PM-G56FTU-N8ITGC"],

  premium: ["AL-PP-C99YS9-7D78K2","AL-PP-9I4HNK-9GPXLL"],

  lifetime: ["AL-LT-KI93DC-E6W0ZW","AL-LT-WITLO5-YGNM19","AL-LT-DR2AXS-466QRR","AL-LT-HT3HL7-TIGWSX","AL-LT-SF1UI1-8WBF91"]

};

const CODE_POOLS = {

  monthly: ["AL-PM-C66DE0-VVH3G8","AL-PM-40RW76-JZFKYN","AL-PM-JGA8JZ-AZFIVZ","AL-PM-U3MYJ4-5BTZZG","AL-PM-ZY4HIJ-06RMPZ","AL-PM-8UZWLT-D4DPLP","AL-PM-PZKM5J-JWNPRJ","AL-PM-A71CUE-L49JKW","AL-PM-C8UWMN-T47IZ9","AL-PM-N4CPJ5-O5RXDB","AL-PM-VK7ZB5-025W51","AL-PM-ULAUI3-T5YS1H","AL-PM-7WKNFF-EGHVAB","AL-PM-RAO0X2-57NDG3","AL-PM-7IOQKC-U0B9YO","AL-PM-2PGXY4-SZEBF5","AL-PM-EG2112-IKN0YF","AL-PM-AL1LQB-GBVDP3","AL-PM-SZHTBR-31O38M","AL-PM-YEOGVA-9982OM"],

  premium: ["AL-PP-8934MV-PJL9TV","AL-PP-DIFD68-3XY0GF","AL-PP-JKFB23-HU120M","AL-PP-MJZE6H-736G0U","AL-PP-EBQEIT-NYY0LR","AL-PP-W6L5ZC-GGUWYN","AL-PP-0BC2NE-8O7IOK","AL-PP-IKTAR3-MKPEEG","AL-PP-LO4HB6-GV4GMN","AL-PP-QO9JRI-NN8SZ1","AL-PP-W7THHW-J6RBI2","AL-PP-QOYDB4-JLF0RV","AL-PP-7TI9AC-185YDZ","AL-PP-MI86YH-1U57QC","AL-PP-8YKIS8-IFLO2N","AL-PP-C2OD3T-X9JRT5","AL-PP-PVY3S9-O5OG0F","AL-PP-TXFRWT-V6YEMZ","AL-PP-KV8DHN-4INPNH","AL-PP-VYDNYW-3XLXGO"],

  lifetime: ["AL-LT-F7AAWG-WLBMPY","AL-LT-VZ3N2I-H0LINL","AL-LT-4YC8L9-YBNN1T","AL-LT-6S3FR9-3TG70J","AL-LT-SRYCZN-Y57PUW","AL-LT-R4GJR6-0HAW4D","AL-LT-B969JV-5V856M","AL-LT-E9DDET-JQR95I","AL-LT-NK2KA6-2KT0CD","AL-LT-PZ61FG-L88DTJ","AL-LT-59W0H4-K7SE5J","AL-LT-DC57O1-LD322H","AL-LT-DHSEMA-77DYEZ","AL-LT-TOVTU2-XPKPZU","AL-LT-DWE0TY-72A7TD","AL-LT-AHBSEO-L0RZA2","AL-LT-3SYEAC-SDUPRB","AL-LT-5XYK1I-515LHS","AL-LT-UP2TRS-X78CVY","AL-LT-5EX9OZ-JT8VF3"]

};

const usedCodes = new Set([...USED_CUSTOMER_CODES]);

const deviceRegistry = {};

const codeToEmail = {};

function buildValidCodes() {

  const codes = { "AL-FREE": { tier: "free", expiry: "lifetime" } };

  const now = new Date();

  CODE_POOLS.monthly.forEach(c => { const exp = new Date(now); exp.setDate(exp.getDate()+30); codes[c] = { tier:"pro", expiry:exp.toISOString().split("T")[0] }; });

  CODE_POOLS.premium.forEach(c => { const exp = new Date(now); exp.setDate(exp.getDate()+30); codes[c] = { tier:"pro", expiry:exp.toISOString().split("T")[0] }; });

  CODE_POOLS.lifetime.forEach(c => { codes[c] = { tier:"pro", expiry:"lifetime" }; });

  USED_CUSTOMER_CODES.forEach(c => { if (c.startsWith("AL-LT")) codes[c] = { tier:"pro", expiry:"lifetime" }; else { const exp = new Date(now); exp.setDate(exp.getDate()+30); codes[c] = { tier:"pro", expiry:exp.toISOString().split("T")[0] }; } });

  OWNER_CODES.pro.forEach(c => { codes[c] = { tier:"pro", expiry:"lifetime" }; });

  OWNER_CODES.premium.forEach(c => { codes[c] = { tier:"pro", expiry:"lifetime" }; });

  OWNER_CODES.lifetime.forEach(c => { codes[c] = { tier:"pro", expiry:"lifetime" }; });

  return codes;

}

const VALID_CODES = buildValidCodes();

const SYSTEM = `You are Assignly - an AI that helps students answer school questions. Look at the screenshot and respond ONLY with valid JSON:

{"question":"exact question text","answer":"exact answer to type","explanation":"brief working (1-2 sentences)","submit_hint":"press Enter or click Next","has_more":false}

Rules: Math=final number only. Multiple choice=letter AND full text. ALWAYS return valid JSON.`;

const TUTOR_PROMPT = `You are an expert AI tutor. Look at this screenshot and:

1. Identify the concept/topic

2. Explain it clearly in simple terms

3. Walk through the solution step by step

4. Give 1-2 memory tips

5. End with encouragement

Be friendly and educational.`;

module.exports = async (req, res) => {

  res.setHeader("Access-Control-Allow-Origin", "*");

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  res.setHeader("Access-Control-Allow-Headers", "Content-Type, stripe-signature");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { image, prompt, code, type, deviceId, action } = req.body || {};

  if (req.headers["stripe-signature"]) return handleStripeWebhook(req, res);

  if (code) {

    const entry = VALID_CODES[code];

    if (!entry) return res.status(401).json({ error: "Invalid code. Purchase at assignlyai.com/pricing", ok: false });

    if (entry.expiry !== "lifetime" && new Date() > new Date(entry.expiry)) return res.status(401).json({ error: "Code expired. Renew at assignlyai.com/pricing", ok: false });

    if (code !== "AL-FREE" && deviceId) {

      const registered = deviceRegistry[code];

      if (!registered) { deviceRegistry[code] = deviceId; }

      else if (registered !== deviceId) return res.status(401).json({ error: "Code already used on another device. Email brenhj15@gmail.com to transfer.", ok: false });

    }

    if (action === "register") return res.status(200).json({ ok: true, tier: entry.tier });

  }

  if (!image) return res.status(400).json({ error: "No image provided" });

  if (!process.env.ANTHROPIC_KEY) return res.status(500).json({ error: "Server error." });

  try {

    const systemPrompt = (type === "tutor" || type === "review") ? TUTOR_PROMPT : SYSTEM;

    const message = await anthropic.messages.create({

      model: "claude-opus-4-5", max_tokens: 1024, system: systemPrompt,

      messages: [{ role: "user", content: [

        { type: "image", source: { type: "base64", media_type: "image/png", data: image } },

        { type: "text", text: prompt || "Solve the question on screen." }

      ]}]

    });

    const text = message.content?.[0]?.text || "{}";

    if (type === "tutor" || type === "review") return res.status(200).json({ review: text });

    try { return res.status(200).json(JSON.parse(text.replace(/```json|```/g,"").trim())); }

    catch { return res.status(200).json({ question:"On screen", answer:text, explanation:"", submit_hint:"Press Enter", has_more:false }); }

  } catch(e) { return res.status(500).json({ error: "Error: " + e.message }); }

};

async function handleStripeWebhook(req, res) {

  let event;

  try {

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (webhookSecret) { event = stripe.webhooks.constructEvent(JSON.stringify(req.body), req.headers["stripe-signature"], webhookSecret); }

    else { event = req.body; }

  } catch(e) { return res.status(400).json({ error: "Webhook error: " + e.message }); }

  if (event.type === "checkout.session.completed") {

    const session = event.data.object;

    const customerEmail = session.customer_details?.email || session.receipt_email;

    const metadata = session.metadata || {};

    if (!customerEmail) return res.status(200).json({ received: true });

    let pool = "monthly";

    if (metadata.plan === "lifetime") pool = "lifetime";

    else if (metadata.plan === "premium") pool = "premium";

    const available = CODE_POOLS[pool].filter(c => !usedCodes.has(c));

    let code;

    if (available.length === 0) {

      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

      const rand = (n) => Array.from({length:n}, () => chars[Math.floor(Math.random()*chars.length)]).join("");

      const prefix = pool === "lifetime" ? "AL-LT" : pool === "premium" ? "AL-PP" : "AL-PM";

      code = `${prefix}-${rand(6)}-${rand(6)}`;

      const exp = pool === "lifetime" ? "lifetime" : new Date(Date.now()+30*24*60*60*1000).toISOString().split("T")[0];

      VALID_CODES[code] = { tier: "pro", expiry: exp };

      await resend.emails.send({ from:"Assignly <noreply@assignlyai.com>", to:"brenhj15@gmail.com", subject:"⚠️ Code pool empty - auto-generated", html:`<p>Pool ${pool} empty. Auto-generated ${code} for ${customerEmail}.</p>` });

    } else {

      code = available[0];

    }

    usedCodes.add(code);

    codeToEmail[code] = customerEmail;

    if (pool !== "lifetime") {

      VALID_CODES[code] = { tier: "pro", expiry: new Date(Date.now()+30*24*60*60*1000).toISOString().split("T")[0] };

    }

    const planNames = { monthly: "Pro", premium: "Premium", lifetime: "Lifetime" };

    const planDetails = { monthly: "AI Tutor, auto-submit, all platforms", premium: "10x more value than Pro, AI Tutor, priority support", lifetime: "25x more value than Pro, never expires" };

    await resend.emails.send({

      from: "Assignly <noreply@assignlyai.com>",

      to: customerEmail,

      subject: `🎓 Your Assignly ${planNames[pool]} License Code`,

      html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;">

        <h1 style="color:#0071e3">Welcome to Assignly ${planNames[pool]}! 🎉</h1>

        <p>Thank you for your purchase. Here is your license code:</p>

        <div style="background:#f0f7ff;border:2px solid #0071e3;border-radius:10px;padding:20px;text-align:center;margin:20px 0;">

          <p style="font-size:11px;color:#666;margin-bottom:5px;text-transform:uppercase;letter-spacing:1px;">Your License Code</p>

          <p style="font-size:22px;font-weight:bold;font-family:monospace;color:#0071e3;letter-spacing:2px;">${code}</p>

        </div>

        <p style="color:#666;">${planDetails[pool]}</p>

        <h3>How to get started:</h3>

        <ol>

          <li><strong>Download:</strong> <a href="https://github.com/Brendevec/assignly-backend/releases/download/v1.5/Assignly-AI.zip">Click here to download Assignly</a></li>

          <li><strong>Install:</strong> Extract/unzip, go to chrome://extensions, turn on Developer Mode, click Load unpacked, select the assignlee folder</li>

          <li><strong>Activate:</strong> Open extension, paste your code in License Code field, click Activate</li>

          <li><strong>Use it:</strong> Go to IXL, Khan Academy, Canvas etc and click Solve current question</li>

        </ol>

        <p style="color:#ff3b30"><strong>⚠️ Important:</strong> This code only works on ONE device. Do not share it.</p>

        <p>Need help? Email <a href="mailto:brenhj15@gmail.com">brenhj15@gmail.com</a></p>

        <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>

        <p style="font-size:11px;color:#999">Assignly · assignlyai.com</p>

      </div>`

    });

    await resend.emails.send({ from:"Assignly <noreply@assignlyai.com>", to:"brenhj15@gmail.com", subject:`💰 New Sale - Assignly ${planNames[pool]}`, html:`<p>New ${planNames[pool]} sale!</p><p>Customer: ${customerEmail}</p><p>Code: ${code}</p>` });

  }

  return res.status(200).json({ received: true });

}
