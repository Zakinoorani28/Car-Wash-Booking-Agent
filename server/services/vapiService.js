const axios = require("axios");

/**
 * Vapi AI Service Wrapper (https://vapi.ai)
 * Handles outbound voice calls and assistant management via Vapi.ai API
 */
class VapiService {
  constructor() {
    this.apiKey = process.env.VAPI_API_KEY;
    this.phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
    this.assistantId = process.env.VAPI_ASSISTANT_ID;
    this.baseUrl = "https://api.vapi.ai";
  }

  init() {
    this.apiKey = process.env.VAPI_API_KEY;
    this.phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
    this.assistantId = process.env.VAPI_ASSISTANT_ID;
  }

  /**
   * Initiate an outbound voice call to a customer via Vapi.ai
   * @param {string} customerPhoneNumber - Destination phone number (e.g. "+15551234567")
   * @param {object} customData - Extra parameters passed to the assistant
   */
  async placeOutboundCall(customerPhoneNumber, customData = {}) {
    this.init();

    console.log(`[Vapi.ai Outbound Call] Dialing ${customerPhoneNumber}...`);

    if (!this.apiKey || this.apiKey === "your_vapi_api_key") {
      console.warn(
        "[Vapi.ai Warning] VAPI_API_KEY is not configured in .env file.",
      );
      return { success: true, simulated: true, to: customerPhoneNumber };
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/call/phone`,
        {
          phoneNumberId: this.phoneNumberId,
          assistantId: this.assistantId,
          customer: {
            number: customerPhoneNumber,
          },
          assistantOverrides: {
            variableValues: customData,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: 10000,
        },
      );

      return response.data;
    } catch (error) {
      console.error(
        "[Vapi.ai Error] Outbound call request failed:",
        error.response?.data || error.message,
      );
      return {
        success: false,
        error: error.response?.data || error.message,
        simulated: true,
      };
    }
  }
}

module.exports = new VapiService();
