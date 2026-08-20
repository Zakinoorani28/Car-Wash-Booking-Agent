const fs = require("fs");
const path = require("path");
const { Groq } = require("groq-sdk");
const bookingService = require("./bookingService");

// Conversation history map per phone number
const conversationHistory = new Map();

/**
 * Production Conversation AI Manager for WhatsApp Agent (Washy 🚗)
 */
class ConversationAI {
  constructor() {
    this.groqClient = null;
    this.systemPrompt = null;
    this.modelName = "llama-3.1-8b-instant";
  }

  init() {
    const apiKey = process.env.GROQ_API_KEY;
    if (apiKey && apiKey !== "your_groq_api_key") {
      this.groqClient = new Groq({ apiKey });
    }

    try {
      const promptPath = path.join(
        __dirname,
        "../../prompts/whatsapp_system_prompt.md",
      );
      if (fs.existsSync(promptPath)) {
        this.systemPrompt = fs.readFileSync(promptPath, "utf8");
      }
    } catch (err) {
      console.warn(
        "Could not read whatsapp_system_prompt.md, using fallback prompt.",
      );
    }
  }

  /**
   * Process incoming WhatsApp user message and return Washy's assistant message
   */
  async processUserMessage(phone, userText) {
    this.init();

    // 1. Get or create active booking session
    let booking = await bookingService.getOrCreateSession(phone, "whatsapp");

    // 2. Perform direct Regex pre-extraction
    const preExtractions = bookingService.extractBookingInfo(userText, booking);
    booking = await bookingService.updateBookingFromExtraction(
      booking._id,
      preExtractions,
    );

    // 3. Maintain conversational turns history
    if (!conversationHistory.has(phone)) {
      conversationHistory.set(phone, []);
    }
    const history = conversationHistory.get(phone);
    history.push({ role: "user", content: userText });
    if (history.length > 16) history.splice(0, history.length - 16);

    let messageToSend = "";

    // 4. Invoke Groq LLM if API key is configured
    if (this.groqClient) {
      try {
        const todayStr = new Date().toISOString().split("T")[0];
        const stateContext = `\nCurrent Session State:
- Booking ID: ${booking.bookingId}
- Current Progress: ${JSON.stringify(booking.collectionProgress)}
- Uncollected Fields: ${booking.getMissingFields().join(", ") || "NONE (COMPLETE)"}
- Extracted Info: ${JSON.stringify({
          name: booking.customerInfo?.name || null,
          vehicle_type: booking.vehicleInfo?.type || null,
          date: booking.appointment?.date || null,
          time: booking.appointment?.time || null,
          service_type: booking.appointment?.serviceType || null,
        })}
- Today's Date: ${todayStr}
- Customer Phone: ${phone}`;

        const messages = [
          { role: "system", content: `${this.systemPrompt}\n${stateContext}` },
          ...history,
        ];

        const completion = await this.groqClient.chat.completions.create({
          messages: messages,
          model: this.modelName,
          temperature: 0.3,
          max_tokens: 500,
          response_format: { type: "json_object" },
        });

        const rawContent = completion.choices[0]?.message?.content?.trim();
        let parsed = null;

        try {
          parsed = JSON.parse(rawContent);
        } catch (parseErr) {
          // Attempt JSON extraction if wrapped in code blocks
          const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        }

        if (parsed && parsed.message) {
          messageToSend = parsed.message;

          // Apply LLM extracted fields if available
          if (parsed.extracted) {
            const llmExtractions = {
              name: parsed.extracted.name,
              vehicleType: parsed.extracted.vehicle_type,
              date: parsed.extracted.date,
              time: parsed.extracted.time,
              serviceType: parsed.extracted.service_type,
            };
            booking = await bookingService.updateBookingFromExtraction(
              booking._id,
              llmExtractions,
            );
          }
        }
      } catch (error) {
        console.warn(
          "[Groq LLM Warning, using rule-based question fallback]:",
          error.message,
        );
      }
    }

    // 5. Fallback to progressive question generator if LLM did not return message
    if (!messageToSend) {
      messageToSend = bookingService.getNextQuestion(booking);
    }

    // Add Washy's reply to history
    history.push({ role: "assistant", content: messageToSend });

    return messageToSend;
  }
}

module.exports = new ConversationAI();
