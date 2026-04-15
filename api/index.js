const Anthropic = require("@anthropic-ai/sdk");

const { Resend } = require("resend");

const Stripe = require("stripe");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

const resend = new Resend(process.env.RESEND_KEY);

const stripe = new Stripe(process.env.STRIPE_KEY);

const CODE_POOLS = {

    monthly: ["AL-PM-LQNSLS-0T3YEB","AL-PM-96GY9M-BPKJS9","AL-PM-FAE2Q4-5H6SX5","AL-PM-OOQ4DA-Y1QXHW","AL-PM-IJUFKE-K0DR5J","AL-PM-1AZ67A-O4JMXN","AL-PM-9QRBR5-SB56BZ","AL-PM-DNUV61-NWLS0X","AL-PM-87E7IU-0R6NO8","AL-PM-F471ZN-JWBU08"],

    yearly: ["AL-PY-1VGIRR-F334OV","AL-PY-3NHMLH-R5NNSU","AL-PY-JNM49R-SVMSYX","AL-PY-843K1E-3W7TO2","AL-PY-9NMBH6-EH5U2K"],

    lifetime: ["AL-LT-KCEOW5-HNPYZ5","AL-LT-YXBPJ0-MIKU8M","AL-LT-C2TIB0-9CLOYM","AL-LT-CT11BW-DAW7LI","AL-LT-KKXMHP-5KSESO"]

};

const usedCodes = new Set();

const deviceRegistry = {};

const codeToEmail = {};

function buildValidCodes() {

  const codes = { "AL-FREE": { tier: "free", expiry: "lifetime" } };

  const now = new Date();

  CODE_POOLS.monthly.forEach(c => { const exp = new Date(now); exp.setDate(exp.getDate()+30); codes[c] = { tier:"pro", expiry:exp.toISOString().split("T")[0] }; });

  CODE_POOLS.yearly.forEach(c => { const exp = new Date(now); exp.setFullYear(exp.getFullYear()+1); codes[c] = { tier:"pro", expiry:exp.toISOString().split("T")[0] }; });

  CODE_POOLS.lifetime.forEach(c => { codes[c] = { tier:"pro", expiry:"lifetime" }; });

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

            else if (registered !== deviceId) return res.status(401).json({ error: "Code already used on another device. Email support@assignlyai.com to transfer.", ok: false });

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

      else if (metadata.plan === "yearly") pool = "yearly";

      const available = CODE_POOLS[pool].filter(c => !usedCodes.has(c));

      if (available.length === 0) {

          await resend.emails.send({ from:"Assignly <noreply@assignlyai.com>", to:"brenhj15@gmail.com", subject:"⚠️ OUT OF CODES - " + pool, html:`<p>Customer ${customerEmail} bought ${pool} but no codes left!</p>` });

          return res.status(200).json({ received: true });

      }

      const code = available[0];

      usedCodes.add(code);

      codeToEmail[code] = customerEmail;

      const planNames = { monthly:"Pro Monthly", yearly:"Pro Yearly", lifetime:"Lifetime" };

      await resend.emails.send({

                                     from: "Assignly <noreply@assignlyai.com>",

              to: customerEmail,

              subject: "🎓 Your Assignly License Code",

              html: `

                      <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;">

                                <h1 style="color:#0071e3">Welcome to Assignly ${planNames[pool]}! 🎉</h1>

                                          <p>Thank you for your purchase. Here is your license code:</p>

                                                    <div style="background:#f0f7ff;border:2px solid #0071e3;border-radius:10px;padding:20px;text-align:center;margin:20px 0;">

                                                                <p style="font-size:11px;color:#666;margin-bottom:5px;text-transform:uppercase;letter-spacing:1px;">Your License Code</p>

                                                                            <p style="font-size:22px;font-weight:bold;font-family:monospace;color:#0071e3;letter-spacing:2px;">${code}</p>

                                                                                      </div>

                                                                                                <h3>How to get started:</h3>

                                                                                                          <ol>
                                                                                                          
                                                                                                                      <li><strong>Download:</strong> <a href="https://github.com/Brendevec/assignly-backend/releases/download/v1.5/AssignLee-v15.zip">Click here to download Assignly</a></li>
                                                                                                                      
                                                                                                                                  <li><strong>Install:</strong> Unzip the file, go to chrome://extensions in Chrome, turn on Developer Mode, click Load unpacked, select the unzipped folder</li>
                                                                                                                                  
                                                                                                                                              <li><strong>Activate:</strong> Open the extension, paste your code in the License Code field, click Activate</li>
                                                                                                                                              
                                                                                                                                                          <li><strong>Use it:</strong> Go to IXL, Khan Academy, Canvas etc and click Solve current question</li>
                                                                                                                                                          
                                                                                                                                                                    </ol>
                                                                                                                                                                    
                                                                                                                                                                              <p style="color:#ff3b30"><strong>⚠️ Important:</strong> This code only works on ONE device. Do not share it.</p>
                                                                                                                                                                              
                                                                                                                                                                                        <p>Need help? Email <a href="mailto:support@assignlyai.com">support@assignlyai.com</a></p>
                                                                                                                                                                                        
                                                                                                                                                                                                  <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
                                                                                                                                                                                                  
                                                                                                                                                                                                            <p style="font-size:11px;color:#999">Assignly · assignlyai.com</p>
                                                                                                                                                                                                            
                                                                                                                                                                                                                    </div>`

      });

      await resend.emails.send({ from:"Assignly <noreply@assignlyai.com>", to:"brenhj15@gmail.com", subject:"💰 New Sale - " + planNames[pool], html:`<p>New ${planNames[pool]} sale!</p><p>Customer: ${customerEmail}</p><p>Code: ${code}</p>` });

  }

  return res.status(200).json({ received: true });

}
