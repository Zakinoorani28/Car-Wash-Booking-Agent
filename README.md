# Sparkle Car Wash — AI Booking Agent

Two channels: WhatsApp (Whapi.Cloud) + Voice (VAPI.ai)

---

## Account Setup — All Free

### 1. Whapi.Cloud (WhatsApp)

- Go to [whapi.cloud](https://whapi.cloud) → Sign up free
- Dashboard → Channels → Create Channel
- Scan QR code with your WhatsApp (use spare number!)
- Channel Settings → copy API Token → paste to `WHAPI_API_TOKEN` in `.env`
- Webhooks → add `{ngrok_url}/api/whapi/webhook`
- Enable events: `messages`
- Set webhook token → paste to `WHAPI_WEBHOOK_SECRET` in `.env`
- Sandbox limits: 150 messages/day, 5 conversations/month

### 2. VAPI.ai (Voice)

- Go to [vapi.ai](https://vapi.ai) → Sign up → get $10 free credits
- Dashboard → Assistants → Create Assistant
- Name: "Washy - Sparkle Car Wash"
- Paste `prompts/voice_agent_prompt.md` as system prompt
- Settings → copy from `prompts/vapi_config.json`
- Phone Numbers → Buy a number (uses free credits ~$1-2)
- Assistants → assign phone number to Washy
- Serverless → Webhook URL: `{ngrok_url}/api/voice/webhook`
- Copy API Key → `VAPI_API_KEY` in `.env`
- Copy Assistant ID → `VAPI_ASSISTANT_ID` in `.env`

### 3. MongoDB Atlas

- [cloud.mongodb.com](https://cloud.mongodb.com) → Sign up free
- Create M0 free cluster → choose any region
- Database Access → Add user with password
- Network Access → Add IP: `0.0.0.0/0`
- Connect → Drivers → copy connection string
- Replace `<password>` → paste to `MONGODB_URI` in `.env`

### 4. Groq

- [console.groq.com](https://console.groq.com) → Sign up free
- API Keys → Create new key
- Copy → paste to `GROQ_API_KEY` in `.env`

### 5. ngrok

- [ngrok.com](https://ngrok.com) → sign up → download
- `ngrok http 5000`
- Copy the `https://xxxx.ngrok.io` URL
- Paste to `BASE_URL` in `.env`
- Also update webhook URLs in Whapi.Cloud and VAPI dashboards

---

## Run

```bash
npm install
cp server/.env.example server/.env
# Fill all values in .env
node server/index.js
```

---

## Open Dashboard

Open `client/index.html` in browser or visit `http://localhost:5000`

---

## Test WhatsApp

Send "Hi" to your Whapi.Cloud connected number

---

## Test Voice

Call the VAPI.ai assigned phone number

---

## Submit

- `server/` folder
- `prompts/` folder
- `client/index.html`
- `package.json`
- `README.md`

Do NOT submit: `.env`, `node_modules/`
