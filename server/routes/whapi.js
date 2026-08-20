const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const whapiService = require('../services/whapiService');
const bookingService = require('../services/bookingService');

// Compact WhatsApp System Prompt Wrapper for Groq Rate Limit Safety
const COMPACT_SYSTEM_PROMPT = `You are Washy 🚗, AI car wash receptionist for Sparkle Car Wash, Karachi.
Tones: Friendly, short WhatsApp style (max 2-3 lines, light emojis).
Packages (PKR): Basic (500, 30m), Premium (1000, 60m), Full Detail (2000, 120m).
Vehicles: sedan, suv, truck, motorcycle, van.
Urdu terms: kal=tomorrow, parso=day after, subah=09:00, dopahar=14:00, shaam=17:00.

Extract fields & respond ALWAYS in STRICT JSON:
{
  "message": "Short reply to send to user",
  "extracted": {
    "name": string or null,
    "vehicle_type": "sedan/suv/truck/motorcycle/van" or null,
    "date": "YYYY-MM-DD" or null,
    "time": "HH:MM" or null,
    "service_type": "basic/premium/full_detail" or null
  },
  "booking_complete": boolean,
  "next_action": "collect_name/collect_vehicle/collect_date/collect_time/collect_service/confirm/completed"
}`;

/**
 * GET /api/whapi/webhook
 */
router.get('/webhook', (req, res) => {
  res.status(200).json({ status: 'online', channel: 'Whapi.Cloud WhatsApp Webhook' });
});

/**
 * POST /api/whapi/webhook
 */
router.post('/webhook', (req, res) => {
  // STEP 1 — Security Verification
  if (!whapiService.verifyWebhookToken(req)) {
    console.warn('[Whapi Security Warning] Webhook token mismatch or missing. Proceeding for Whapi sandbox compatibility.');
  }

  // STEP 2 — Respond 200 OK immediately
  res.status(200).json({ status: 'received' });

  // Async processing
  setImmediate(async () => {
    try {
      // STEP 3 — Parse incoming message
      const parsed = whapiService.parseIncomingMessage(req.body);
      if (!parsed) return;

      // Ignore group chats or broadcasts (chatId containing @g.us)
      if (parsed.chatId && parsed.chatId.includes('@g.us')) {
        console.log('[Whapi] Group message ignored.');
        return;
      }

      // STEP 4 — Get or create session
      let booking = await bookingService.getOrCreateSession(parsed.phone, 'whatsapp');

      // STEP 5 — Build Groq context (compact system prompt + last 6 turns)
      const historyTurns = (booking.conversationHistory || []).slice(-6).map((h) => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content,
      }));

      const messages = [
        { role: 'system', content: `${COMPACT_SYSTEM_PROMPT}\nToday's Date: ${new Date().toISOString().split('T')[0]}` },
        ...historyTurns,
        { role: 'user', content: parsed.messageText },
      ];

      // STEP 6 — Call Groq with groq/compound-mini
      const { groq } = require('../index');
      let groqResponse = null;

      const callGroqWithRetry = async (attempt = 1) => {
        try {
          const response = await groq.chat.completions.create({
            model: 'groq/compound-mini',
            messages: messages,
            temperature: 0.3,
            max_tokens: 400,
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
        await whapiService.sendTextMessage(parsed.phone, 'Sorry, please try again in a moment!');
        return;
      }

      // STEP 7 — Validate parsed JSON
      if (!groqResponse || !groqResponse.message) {
        await whapiService.sendTextMessage(parsed.phone, 'Sorry, please try again!');
        return;
      }

      // STEP 8 — Update booking from extractions
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

      // STEP 10 — Save conversation turn
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
