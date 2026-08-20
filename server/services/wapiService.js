const axios = require("axios");
const crypto = require("crypto");

/**
 * WAPI Service Wrapper (https://api.wapi.chat)
 * Outbound WhatsApp messaging & HMAC Signature Verification
 */
class WapiService {
  constructor() {
    this.apiKey = process.env.WAPI_API_KEY;
    this.instanceId = process.env.WAPI_INSTANCE_ID;
    this.secret = process.env.WAPI_WEBHOOK_SECRET;
    this.baseUrl = "https://api.wapi.chat";
  }

  init() {
    this.apiKey = process.env.WAPI_API_KEY;
    this.instanceId = process.env.WAPI_INSTANCE_ID;
    this.secret = process.env.WAPI_WEBHOOK_SECRET;
  }

  /**
   * Verify HMAC-SHA256 Signature of incoming webhook request
   * @param {string|object} body - Request body
   * @param {string} signatureHeader - Value of x-wapi-signature header
   */
  verifySignature(body, signatureHeader) {
    this.init();
    if (!this.secret || this.secret === "your_webhook_secret") {
      return true; // Bypass verification if secret not configured in dev
    }

    if (!signatureHeader) return false;

    const rawBody = typeof body === "string" ? body : JSON.stringify(body);
    const hmac = crypto
      .createHmac("sha256", this.secret)
      .update(rawBody)
      .digest("hex");

    return hmac.toLowerCase() === signatureHeader.toLowerCase();
  }

  /**
   * Send WhatsApp text message via WAPI API with 1 retry after 2 seconds on failure
   */
  async sendMessage(phoneNumber, text, retryCount = 0) {
    this.init();

    const cleanPhone = String(phoneNumber).replace(/\D/g, "");
    const chatId = cleanPhone.endsWith("@c.us")
      ? cleanPhone
      : `${cleanPhone}@c.us`;

    console.log(
      `[WAPI Outbound] Sending message to ${chatId}: "${text.substring(0, 50)}..."`,
    );

    if (
      !this.apiKey ||
      this.apiKey === "your_wapi_api_key" ||
      this.apiKey === "your_whapi_token"
    ) {
      console.warn(
        "[WAPI Warning] WAPI_API_KEY is not configured in .env. Logged outbound message above.",
      );
      return { success: true, simulated: true, chatId, text };
    }

    const url = `${this.baseUrl}/instances/${this.instanceId}/client/action/send-message`;
    const payload = {
      chatId: chatId,
      message: text,
    };

    try {
      const response = await axios.post(url, payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        timeout: 8000,
      });

      return response.data;
    } catch (error) {
      console.error(
        `[WAPI Send Error] Attempt ${retryCount + 1} failed:`,
        error.response?.data || error.message,
      );

      // Retry once after 2 seconds
      if (retryCount === 0) {
        console.log("[WAPI Retrying] Retrying send-message after 2s delay...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return this.sendMessage(phoneNumber, text, 1);
      }

      return {
        success: false,
        error: error.response?.data || error.message,
        simulated: true,
      };
    }
  }
}

module.exports = new WapiService();
