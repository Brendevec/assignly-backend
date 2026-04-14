# AssignLee Backend

## Deploy to Vercel

1. Upload these files to GitHub
2. Go to vercel.com → Add New Project → select this repo
3. Add Environment Variable:
   - Name: ANTHROPIC_KEY
   - Value: your Anthropic API key (sk-ant-...)
4. Click Deploy

## Add new license codes

Open api/index.js and add to VALID_CODES:
"AL-PRO-MONTH-XXX": { tier: "pro", expiry: "YYYY-MM-DD" }

Then redeploy on Vercel (automatic if connected to GitHub).
