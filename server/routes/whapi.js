const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const whapiService = require('../services/whapiService');
const bookingService = require('../services/bookingService');

// Load WhatsApp System Prompt
let systemPrompt = '';
try {
  const promptPath = path.join(__dirname, '../../prompts/whatsapp_system_prompt.md');
  if (fs.existsSync(promptPath)) {
    systemPrompt = fs.readFileSync(promptPath, 'utf8');
  }
} catch (err) {
  console.warn('Could not read whatsapp_system_prompt.md, using default fallback.');
}

/**
 * GET /api/whapi/webhook
 * Whapi Verification Endpoint
 */
router.get('/webhook', (req, res) => {
  res.status(200).json({ status: 'online', channel: 'Whapi.Cloud WhatsApp Webhook' });
});

/**
 * POST /api/whapi/webhook
 * Whapi.Cloud Webhook Handler
 */
router.post('/webhook', (req, res) => {
  // STEP 1 — Security Token Verification
  if (!whapiService.verifyWebhookToken(req)) {
    console.warn('[Whapi Security Warning] Webhook token mismatch or missing. Proceeding for Whapi sandbox compatibility.');
  }

  // STEP 2 — Respond 200 OK immediately to Whapi.Cloud before async processing
  res.status(200).json({ status: 'received' });

  // Process message asynchronously
  setImmediate(async () => {
    try {
      // STEP 3 — Parse incoming Whapi message
      const parsed = whapiService.parseIncomingMessage(req.body);
      if (!parsed) return; // Not a text message or sent by bot, ignore

      // STEP 4 — Get or create active session
      let booking = await bookingService.getOrCreateSession(parsed.phone, 'whatsapp');

      // STEP 5 — Build Groq messages array (System + last 10 history turns + user message)
      const historyTurns = (booking.conversationHistory || []).slice(-10).map((h) => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content,
      }));

      const messages = [
        { role: 'system', content: `${systemPrompt}\n\nToday's Date: ${new Date().toISOString().split('T')[0]}` },
        ...historyTurns,
        { role: 'user', content: parsed.messageText },
      ];

      // STEP 6 — Call Groq with 1 retry on error
      const { groq } = require('../index');
      let groqResponse = null;

      const callGroqWithRetry = async (attempt = 1) => {
        try {
          const response = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: messages,
            temperature: 0.3,
            max_tokens: 500,
            response_format: { type: 'json_object' },
          });
          const content = response.choices[0]?.message?.content;
          return JSON.parse(content);
        } catch (err) {
          if (attempt === 1) {
            console.warn('[Groq Retrying] Groq call failed, retrying in 1s...');
            await new Promise((resolve) => setTimeout(resolve, 1000));
            return callGroqWithRetry(2);
          }
          throw err;
        }
      };

      try {
        groqResponse = await callGroqWithRetry(1);
      } catch (err) {
        console.error('[Groq Error]:', err.message);
        await whapiService.sendTextMessage(parsed.phone, 'Sorry, please try again!');
        return;
      }

      // STEP 7 — Validate parsed JSON from Groq
      if (!groqResponse || !groqResponse.message) {
        await whapiService.sendTextMessage(parsed.phone, 'Sorry, please try again!');
        return;
      }

      // STEP 8 — Update booking from extracted fields
      if (groqResponse.extracted) {
        const extractions = {
          name: groqResponse.extracted.name,
          vehicleType: groqResponse.extracted.vehicle_type,
          date: groqResponse.extracted.date,
          time: groqResponse.extracted.time,
          serviceType: groqResponse.extracted.service_type,
        };
        booking = await bookingService.updateBookingFromExtraction(booking._id || booking.bookingId, extractions);
      } else {
        const extractions = bookingService.extractBookingInfo(parsed.messageText, booking);
        booking = await bookingService.updateBookingFromExtraction(booking._id || booking.bookingId, extractions);
      }

      // STEP 9 — Send WhatsApp reply via Whapi.Cloud
      await whapiService.sendTextMessage(parsed.phone, groqResponse.message);

      // STEP 10 — Save conversation turn & trim history to 50 max
      if (!booking.conversationHistory) booking.conversationHistory = [];
      booking.conversationHistory.push({ role: 'user', content: parsed.messageText, timestamp: new Date() });
      booking.conversationHistory.push({ role: 'assistant', content: groqResponse.message, timestamp: new Date() });

      if (booking.conversationHistory.length > 50) {
        booking.conversationHistory = booking.conversationHistory.slice(-50);
      }

      if (typeof booking.save === 'function') {
        await booking.save();
      }

      // STEP 11 — If booking complete: send confirmation summary
      if (groqResponse.booking_complete || booking.isComplete()) {
        booking.status = 'confirmed';
        booking.completedAt = new Date();
        if (typeof booking.save === 'function') await booking.save();

        const confirmationSummary = bookingService.formatConfirmation(booking);
        console.log(`[Whapi Booking Confirmed]: ${booking.bookingId}`);
        await whapiService.sendTextMessage(parsed.phone, confirmationSummary);
      }
    } catch (error) {
      console.error('[Whapi Webhook Async Processing Error]:', error.message);
    }
  });
});

module.exports = router;
