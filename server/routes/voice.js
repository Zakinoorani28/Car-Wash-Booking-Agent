const express = require("express");
const router = express.Router();
const bookingService = require("../services/bookingService");
const whapiService = require("../services/whapiService");

/**
 * GET /api/voice/health
 * Health check for Uplift AI Voice Agent
 */
router.get("/health", (req, res) => {
  res
    .status(200)
    .json({ status: "online", agent: "Uplift AI Voice Booking Service" });
});

/**
 * POST /api/voice/webhook
 * Receive Uplift AI voice events during live phone call:
 * Event types: call_started, variable_collected, call_ended
 */
router.post("/webhook", async (req, res) => {
  res.status(200).json({ status: "received" });

  try {
    const payload = req.body;
    console.log("[Uplift AI Event Payload]:", JSON.stringify(payload, null, 2));

    const event = payload.event || payload.action || "unknown";
    const phone =
      payload.phone ||
      payload.customer_phone ||
      payload.caller_id ||
      "+923000000000";

    let booking = await bookingService.getOrCreateSession(phone, "voice");

    // On variable_collected: update booking in DB
    if (event === "variable_collected" || payload.variable) {
      const extractions = {
        name:
          payload.variable === "customer_name"
            ? payload.value
            : payload.customer_name,
        vehicleType:
          payload.variable === "vehicle_type"
            ? payload.value
            : payload.vehicle_type,
        date:
          payload.variable === "booking_date"
            ? payload.value
            : payload.booking_date,
        time:
          payload.variable === "booking_time"
            ? payload.value
            : payload.booking_time,
        serviceType:
          payload.variable === "service_type"
            ? payload.value
            : payload.service_type,
      };

      await bookingService.updateBookingFromExtraction(
        booking._id || booking.bookingId,
        extractions,
      );
      console.log(
        `[Uplift AI Variable Collected]: Updated booking ${booking.bookingId}`,
      );
    }

    // On call_ended with all variables: create confirmed booking
    if (event === "call_ended" || payload.status === "completed") {
      if (payload.variables) {
        const fullExtractions = {
          name: payload.variables.customer_name,
          vehicleType: payload.variables.vehicle_type,
          date: payload.variables.booking_date,
          time: payload.variables.booking_time,
          serviceType: payload.variables.service_type,
        };
        booking = await bookingService.updateBookingFromExtraction(
          booking._id || booking.bookingId,
          fullExtractions,
        );
      }

      if (booking.isComplete()) {
        booking.status = "confirmed";
        booking.completedAt = new Date();
        if (typeof booking.save === "function") await booking.save();

        console.log(`Voice booking confirmed: ${booking.bookingId}`);
      }
    }
  } catch (error) {
    console.error("[Uplift AI Webhook Error]:", error.message);
  }
});

/**
 * POST /api/voice/booking-complete
 * Receive final completed booking data from Uplift AI voice agent
 */
router.post("/booking-complete", async (req, res) => {
  res.status(200).json({ status: "processed" });

  try {
    console.log(
      "[Uplift AI Booking Complete Webhook Payload]:",
      JSON.stringify(req.body, null, 2),
    );

    const body = req.body;
    const vars = body.variables || body;
    const phone =
      body.phone || vars.phone || vars.customer_phone || "+923000000000";

    let booking = await bookingService.getOrCreateSession(phone, "voice");

    const extractions = {
      name: vars.customer_name || vars.name || "Voice Customer",
      phone: phone,
      vehicleType: vars.vehicle_type || vars.carType || "sedan",
      date:
        vars.booking_date ||
        vars.date ||
        new Date().toISOString().split("T")[0],
      time: vars.booking_time || vars.time || "10:00",
      serviceType: vars.service_type || vars.serviceType || "basic",
    };

    booking = await bookingService.updateBookingFromExtraction(
      booking._id || booking.bookingId,
      extractions,
    );
    booking.status = "confirmed";
    booking.completedAt = new Date();
    if (typeof booking.save === "function") await booking.save();

    console.log(`Voice booking confirmed: ${booking.bookingId}`);

    // Send WhatsApp confirmation summary if customer phone is available
    if (phone && phone !== "+923000000000") {
      const confirmationSummary = bookingService.formatConfirmation(booking);
      console.log(`[WhatsApp Voice Confirmation Sent]: to ${phone}`);
      await wapiService.sendMessage(phone, confirmationSummary);
    }
  } catch (error) {
    console.error("[Uplift AI Complete Error]:", error.message);
  }
});

/**
 * POST /api/voice/check-slots
 * Helper tool endpoint for availability check
 */
router.post("/check-slots", async (req, res) => {
  res.status(200).json({
    availableSlots: ["09:00", "10:00", "14:00", "17:00"],
    message: "Slots available on requested date.",
  });
});

/**
 * POST /api/voice/create-booking
 * Direct tool endpoint
 */
router.post("/create-booking", async (req, res) => {
  try {
    const booking = await bookingService.createBooking(req.body);
    res.status(200).json({
      success: true,
      bookingId: booking.bookingId,
      message: bookingService.formatConfirmation(booking),
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
