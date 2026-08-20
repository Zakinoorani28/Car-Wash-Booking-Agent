const express = require('express');
const router = express.Router();
const bookingService = require('../services/bookingService');
const whapiService = require('../services/whapiService');

/**
 * GET /api/voice/health
 * Health check endpoint for VAPI.ai Voice Agent
 */
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'online', agent: 'VAPI.ai Voice Booking Service' });
});

/**
 * POST /api/voice/webhook
 * VAPI.ai Event Webhook Handler
 */
router.post('/webhook', async (req, res) => {
  // Always return 200 OK immediately to VAPI.ai to prevent retries
  res.status(200).json({ status: 'received' });

  try {
    const vapiSecret = process.env.VAPI_WEBHOOK_SECRET;
    const incomingSecret = req.headers['x-vapi-secret'] || req.headers['x-vapi-signature'];

    if (vapiSecret && vapiSecret !== 'your_vapi_webhook_secret' && incomingSecret !== vapiSecret) {
      console.warn('[VAPI Security Warning] x-vapi-secret header mismatch.');
    }

    const payload = req.body || {};
    const messageType = payload.message?.type || payload.type || 'unknown';

    // EVENT 1 — "call-started"
    if (messageType === 'call-started' || payload.event === 'call-started') {
      const callId = payload.message?.call?.id || payload.call?.id || 'VAPI_CALL';
      const phone = payload.message?.call?.customer?.number || payload.call?.phoneNumber || '+923000000000';
      console.log(`VAPI call started: ${callId} from ${phone}`);

      await bookingService.getOrCreateSession(phone, 'voice');
      return;
    }

    // EVENT 2 — "transcript"
    if (messageType === 'transcript' || payload.event === 'transcript') {
      const transcriptText = payload.message?.transcript || payload.transcript;
      if (transcriptText) {
        console.log(`[VAPI Transcript]: "${transcriptText.substring(0, 60)}..."`);
      }
      return;
    }

    // EVENT 3 — "function-call" or "tool-calls"
    if (messageType === 'function-call' || messageType === 'tool-calls') {
      const functionName = payload.message?.functionCall?.name || payload.toolCalls?.[0]?.function?.name;
      console.log(`[VAPI Function Call]: ${functionName}`);
      return;
    }

    // EVENT 4 — "end-of-call-report" (MAIN EVENT)
    if (messageType === 'end-of-call-report' || payload.event === 'end-of-call-report' || payload.status === 'completed') {
      const msg = payload.message || payload;
      const callId = msg.call?.id || 'VAPI_CALL';
      const phone = msg.call?.customer?.number || msg.call?.phoneNumber || msg.customer_phone || '+923000000000';
      const structuredData = msg.analysis?.structuredData || msg.structuredData || {};

      console.log(`[VAPI End of Call Report] Call ID: ${callId}, Phone: ${phone}`);
      console.log('Structured Data extracted by VAPI:', JSON.stringify(structuredData, null, 2));

      // Extract variables from structuredData
      const customerName = structuredData.customer_name || structuredData.name || 'Voice Customer';
      const vehicleType = structuredData.vehicle_type || structuredData.carType || 'sedan';
      const bookingDate = structuredData.booking_date || structuredData.date || new Date().toISOString().split('T')[0];
      const bookingTime = structuredData.booking_time || structuredData.time || '10:00';
      const serviceType = structuredData.service_type || structuredData.serviceType || 'basic';

      let booking = await bookingService.getOrCreateSession(phone, 'voice');

      booking = await bookingService.updateBookingFromExtraction(booking._id || booking.bookingId, {
        name: customerName,
        phone: phone,
        vehicleType: vehicleType,
        date: bookingDate,
        time: bookingTime,
        serviceType: serviceType,
      });

      booking.status = 'confirmed';
      booking.completedAt = new Date();
      if (typeof booking.save === 'function') await booking.save();

      console.log(`Voice booking confirmed: ${booking.bookingId}`);

      // Send cross-channel WhatsApp confirmation via Whapi.Cloud if phone number available
      if (phone && phone !== '+923000000000') {
        const confirmationText = bookingService.formatConfirmation(booking);
        console.log(`[Cross-Channel Confirmation] Sending WhatsApp via Whapi.Cloud to ${phone}...`);
        await whapiService.sendTextMessage(phone, confirmationText);
      }
    }
  } catch (error) {
    console.error('[VAPI Webhook Error]:', error.message);
  }
});

module.exports = router;
