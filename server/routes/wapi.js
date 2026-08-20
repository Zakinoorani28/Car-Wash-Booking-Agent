const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const wapiService = require("../services/wapiService");
const bookingService = require("../services/bookingService");

// Load WhatsApp System Prompt
let systemPrompt = "";
try {
  const promptPath = path.join(
    __dirname,
    "../../prompts/whatsapp_system_prompt.md",
  );
  if (fs.existsSync(promptPath)) {
    systemPrompt = fs.readFileSync(promptPath, "utf8");
  }
} catch (err) {
  console.warn(
    "Could not read whatsapp_system_prompt.md, using default prompt.",
  );
}

/**
 * GET /api/wapi/webhook
 * Verification endpoint
 */
router.get("/webhook", (req, res) => {
  const challenge = req.query["hub.challenge"] || req.query["challenge"];
  if (challenge) return res.status(200).send(challenge);
  res.status(200).json({ status: "online", channel: "WAPI WhatsApp Webhook" });
});

/**
 * POST /api/wapi/webhook
 * Production WAPI Webhook Handler
 */
router.post("/webhook", async (req, res) => {
  const signatureHeader =
    req.headers["x-wapi-signature"] || req.headers["x-webhook-signature"];

  // 1. HMAC-SHA256 Signature Verification
  if (!wapiService.verifySignature(req.body, signatureHeader)) {
    console.warn("[WAPI Webhook 401] Invalid HMAC Signature");
    return res.status(401).json({ error: "Invalid HMAC signature" });
  }

  // 2. Respond 200 OK immediately to prevent webhook timeout / retry storms
  res.status(200).json({ status: "received" });

  // Asynchronous message processing pipeline
  try {
    const body = req.body;
    let phoneNumber =
      body.data?.from || body.message?.from || body.from || body.phone;

    let messageBody =
      body.data?.body || body.message?.body || body.body || body.text;

    let msgType = body.data?.type || body.message?.type || body.type || "text";

    // Ignore non-text messages (images, audio, etc) or missing payload
    if (msgType !== "text" || !phoneNumber || !messageBody) {
      return;
    }

    phoneNumber = String(phoneNumber).replace("@c.us", "").trim();

    // 3. Get or create conversation session (Indexed lookup)
    let booking = await bookingService.getOrCreateSession(
      phoneNumber,
      "whatsapp",
    );

    // 4. Build conversation context: System prompt + last 10 turns + new message (Cuts tokens ~70%)
    const conversationHistory = booking.conversationHistory || [];
    const historyTurns = conversationHistory.slice(-10).map((h) => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: h.content,
    }));

    const messages = [
      {
        role: "system",
        content: `${systemPrompt}\n\nToday's Date: ${new Date().toISOString().split("T")[0]}`,
      },
      ...historyTurns,
      { role: "user", content: messageBody },
    ];

    // Access exported Groq client
    const { groq } = require("../index");
    let parsed = null;
    let replyMessage = "";

    // 5. Call Groq with 1 retry attempt on timeout
    const callGroqWithRetry = async (attempt = 1) => {
      try {
        const response = await groq.chat.completions.create({
          model: "llama-3.1-8b-instant",
          messages: messages,
          temperature: 0.3,
          max_tokens: 500,
          response_format: { type: "json_object" },
        });
        const rawContent = response.choices[0]?.message?.content;
        return JSON.parse(rawContent);
      } catch (err) {
        if (attempt === 1) {
          console.warn(
            "[Groq Retrying] First Groq attempt failed, retrying in 1s...",
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return callGroqWithRetry(2);
        }
        throw err;
      }
    };

    try {
      parsed = await callGroqWithRetry(1);
      replyMessage = parsed.message;
    } catch (groqErr) {
      console.error("[Groq Error]:", groqErr.message);
      replyMessage = "Sorry, please try again in a moment!";
    }

    // 6. Extract booking info and update database
    if (parsed && parsed.extracted) {
      const extractions = {
        name: parsed.extracted.name,
        vehicleType: parsed.extracted.vehicle_type,
        date: parsed.extracted.date,
        time: parsed.extracted.time,
        serviceType: parsed.extracted.service_type,
      };
      booking = await bookingService.updateBookingFromExtraction(
        booking._id || booking.bookingId,
        extractions,
      );
    } else {
      const extractions = bookingService.extractBookingInfo(
        messageBody,
        booking,
      );
      booking = await bookingService.updateBookingFromExtraction(
        booking._id || booking.bookingId,
        extractions,
      );
    }

    // 7. Send reply via WAPI API (includes 1 retry after 2s on failure)
    await wapiService.sendMessage(phoneNumber, replyMessage);

    // 8. Save conversation turn to history (trimmed to 50 max in pre-save hook)
    if (!booking.conversationHistory) booking.conversationHistory = [];
    booking.conversationHistory.push({
      role: "user",
      content: messageBody,
      timestamp: new Date(),
    });
    booking.conversationHistory.push({
      role: "assistant",
      content: replyMessage,
      timestamp: new Date(),
    });

    if (typeof booking.save === "function") {
      await booking.save();
    }

    // 9. If complete: send final confirmation summary
    if ((parsed && parsed.booking_complete) || booking.isComplete()) {
      const finalSummary = bookingService.formatConfirmation(booking);
      console.log(`[WAPI Booking Complete]: ${booking.bookingId} confirmed!`);
      await wapiService.sendMessage(phoneNumber, finalSummary);
    }
  } catch (error) {
    console.error("[WAPI Webhook Async Error]:", error.message);
  }
});

module.exports = router;
