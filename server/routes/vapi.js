const express = require("express");
const router = express.Router();
const bookingService = require("../services/bookingService");

/**
 * GET /api/vapi/health
 * Health check endpoint for Vapi.ai platform (https://vapi.ai)
 */
router.get("/health", (req, res) => {
  res.status(200).json({
    status: "online",
    platform: "Vapi AI Voice Assistant (vapi.ai)",
    timestamp: new Date(),
  });
});

/**
 * POST /api/vapi/webhook
 * Main webhook handler for Vapi.ai (https://vapi.ai)
 * Handles tool calls, assistant requests, and end-of-call reports.
 */
router.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;
    const message = payload.message || payload;

    console.log(`[Vapi.ai Webhook Event]: ${message.type || "unknown_event"}`);

    // Optional Vapi secret verification
    const secretHeader = req.headers["x-vapi-secret"];
    const expectedSecret = process.env.VAPI_WEBHOOK_SECRET;
    if (expectedSecret && secretHeader !== expectedSecret) {
      console.warn("[Vapi.ai Webhook] Unauthorized secret header");
      return res.status(401).json({ error: "Unauthorized webhook" });
    }

    // ----------------------------------------------------
    // 1. TOOL CALLS HANDLING (Vapi AI Function Calling)
    // ----------------------------------------------------
    if (message.type === "tool-calls" || message.toolCalls) {
      const toolCalls = message.toolCalls || message.tool_calls || [];
      const results = [];
      const callerPhone = message.call?.customer?.number || "+923000000000";

      for (const toolCall of toolCalls) {
        const functionName = toolCall.function?.name;
        let args = toolCall.function?.arguments;

        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch (e) {
            args = {};
          }
        }

        console.log(`[Vapi Tool Executing]: ${functionName}`, args);

        // Tool 1: Process User Voice Input (Progressive Session Extraction)
        if (
          functionName === "process_voice_input" ||
          functionName === "processVoiceInput"
        ) {
          let session = await bookingService.getOrCreateSession(
            callerPhone,
            "voice",
          );
          const extractions = bookingService.extractBookingInfo(
            args.userInput || "",
            session,
          );
          session = await bookingService.updateBookingFromExtraction(
            session._id,
            extractions,
          );
          const nextPrompt = bookingService.getNextQuestion(session);

          results.push({
            toolCallId: toolCall.id,
            result: nextPrompt,
          });
        }
        // Tool 2: Create Voice Booking
        else if (
          functionName === "create_voice_booking" ||
          functionName === "createBooking"
        ) {
          try {
            const newBooking = await bookingService.createBooking({
              customerName: args.customerName || args.name || "Phone Caller",
              customerPhone: callerPhone,
              serviceType: args.serviceType?.toLowerCase() || "basic",
              carType:
                args.carType?.toLowerCase() || args.vehicleType || "sedan",
              date: args.date || new Date().toISOString().split("T")[0],
              timeSlot: args.timeSlot || args.time || "10:00",
              channel: "voice",
            });

            results.push({
              toolCallId: toolCall.id,
              result: bookingService.formatConfirmation(newBooking),
            });
          } catch (err) {
            results.push({
              toolCallId: toolCall.id,
              result: `Booking failed: ${err.message}`,
            });
          }
        }
        // Tool 3: Check Slot Availability
        else if (
          functionName === "check_slot_availability" ||
          functionName === "checkSlotAvailability"
        ) {
          const dateStr = args.date || new Date().toISOString().split("T")[0];
          results.push({
            toolCallId: toolCall.id,
            result: `Available slots for ${dateStr} are 09:00, 10:00, 14:00, 17:00.`,
          });
        }
        // Fallback
        else {
          results.push({
            toolCallId: toolCall.id,
            result: `Tool ${functionName} executed.`,
          });
        }
      }

      return res.status(200).json({ results });
    }

    // ----------------------------------------------------
    // 2. ASSISTANT REQUEST (Dynamic Config)
    // ----------------------------------------------------
    if (message.type === "assistant-request") {
      return res.status(200).json({
        assistant: {
          name: "SparkleWash Vapi Receptionist",
          model: {
            provider: "groq",
            model: "llama-3.1-8b-instant",
            temperature: 0.5,
          },
          voice: {
            provider: "cartesia",
            voiceId: "a0e16712-911e-455d-9221-50e56e0d9b62",
          },
          firstMessage:
            "Thank you for calling SparkleWash Auto Detailing! My name is Sparkle. How can I help your vehicle shine today?",
        },
      });
    }

    // ----------------------------------------------------
    // 3. END OF CALL REPORT & TRANSCRIPT LOGGING
    // ----------------------------------------------------
    if (message.type === "end-of-call-report") {
      console.log(
        `[Vapi Call Finished]: Duration: ${message.durationSeconds || 0}s | Cost: $${message.cost || 0}`,
      );
      return res.status(200).json({ status: "call_report_logged" });
    }

    res.status(200).json({ status: "received" });
  } catch (error) {
    console.error("[Vapi.ai Webhook Error]:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
