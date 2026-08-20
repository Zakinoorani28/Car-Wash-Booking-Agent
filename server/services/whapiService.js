const axios = require("axios");

/**
 * Whapi.Cloud API Wrapper (https://gate.whapi.cloud)
 * Handles outbound WhatsApp messaging, webhook token verification, and payload parsing
 */
class WhapiService {
  constructor() {
    this.apiUrl = process.env.WHAPI_API_URL || "https://gate.whapi.cloud";
    this.token = process.env.WHAPI_API_TOKEN;
    this.webhookSecret = process.env.WHAPI_WEBHOOK_SECRET;
  }

  init() {
    this.apiUrl = process.env.WHAPI_API_URL || "https://gate.whapi.cloud";
    this.token = process.env.WHAPI_API_TOKEN;
    this.webhookSecret = process.env.WHAPI_WEBHOOK_SECRET;
  }

  /**
   * Verify Whapi Webhook Token from request header
   * @param {object} req - Express request object
   */
  verifyWebhookToken(req) {
    this.init();
    if (
      !this.webhookSecret ||
      this.webhookSecret === "your_webhook_secret_token"
    ) {
      return true; // Skip verification in dev mode if secret not set
    }
    const tokenHeader =
      req.headers["x-whapi-token"] ||
      req.headers["x-whapi-secret"] ||
      req.headers["x-webhook-secret"];
    return tokenHeader === this.webhookSecret;
  }

  /**
   * Parse Whapi.Cloud incoming webhook payload
   * @param {object} webhookBody
   */
  parseIncomingMessage(webhookBody = {}) {
    if (
      !webhookBody.messages ||
      !Array.isArray(webhookBody.messages) ||
      webhookBody.messages.length === 0
    ) {
      return null;
    }

    const msg = webhookBody.messages[0];

    // Ignore non-text messages or messages sent by the bot itself
    if (msg.type !== "text" || msg.from_me === true) {
      return null;
    }

    const rawFrom = msg.from || msg.chat_id || "";
    const cleanPhone = String(rawFrom).replace(/\D/g, "");
    const messageText = msg.text?.body || msg.body || "";

    if (!cleanPhone || !messageText) return null;

    console.log(
      `Incoming from ${cleanPhone}: "${messageText.substring(0, 50)}"`,
    );

    return {
      phone: cleanPhone,
      messageText: messageText.trim(),
      messageId: msg.id,
      chatId: msg.chat_id || `${cleanPhone}@s.whatsapp.net`,
    };
  }

  /**
   * Send WhatsApp text message via Whapi.Cloud API with 1 retry attempt after 2s
   * POST {WHAPI_API_URL}/messages/text
   */
  async sendTextMessage(phoneNumber, text, retryCount = 0) {
    this.init();

    const cleanPhone = String(phoneNumber).replace(/\D/g, "");
    if (!cleanPhone) {
      console.error("Whapi send failed: Invalid phone number");
      return { success: false, error: "Invalid phone number" };
    }

    const preview = String(text).slice(0, 50);

    if (!this.token || this.token === "your_whapi_channel_token") {
      console.warn(
        `[Whapi Simulation] Token not configured. Whapi sent to ${cleanPhone}: "${preview}..."`,
      );
      return { success: true, simulated: true, to: cleanPhone, body: text };
    }

    const url = `${this.apiUrl}/messages/text`;
    const payload = {
      to: cleanPhone,
      body: text,
    };

    try {
      const response = await axios.post(url, payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        timeout: 8000,
      });

      console.log(`Whapi sent to ${cleanPhone}: "${preview}..."`);
      return response.data;
    } catch (error) {
      const errorMsg = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      console.error(
        `Whapi send failed (Attempt ${retryCount + 1}): ${errorMsg}`,
      );

      // Retry once on failure after 2 seconds
      if (retryCount === 0) {
        console.log("Retrying Whapi sendTextMessage in 2 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return this.sendTextMessage(phoneNumber, text, 1);
      }

      return { success: false, error: errorMsg, simulated: true };
    }
  }
}

module.exports = new WhapiService();
