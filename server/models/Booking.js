const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    bookingId: {
      type: String,
      unique: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ["whatsapp", "voice"],
      required: true,
    },
    status: {
      type: String,
      enum: ["collecting", "confirmed", "cancelled"],
      default: "collecting",
    },
    customerInfo: {
      name: { type: String, default: "" },
      phone: { type: String, default: "" },
      whatsappNumber: { type: String, default: "" },
    },
    vehicleInfo: {
      type: {
        type: String,
        enum: ["sedan", "suv", "truck", "motorcycle", "van"],
        default: undefined,
      },
      make: { type: String, default: "" },
      color: { type: String, default: "" },
    },
    appointment: {
      date: { type: String, default: "" }, // YYYY-MM-DD
      time: { type: String, default: "" }, // HH:MM
      serviceType: {
        type: String,
        enum: ["basic", "premium", "full_detail"],
        default: undefined,
      },
      estimatedDuration: { type: Number, default: 0 }, // minutes
      estimatedPrice: { type: Number, default: 0 }, // PKR
    },
    conversationHistory: [
      {
        role: { type: String, enum: ["user", "assistant", "system"] },
        content: { type: String },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    collectionProgress: {
      nameCollected: { type: Boolean, default: false },
      phoneCollected: { type: Boolean, default: false },
      vehicleCollected: { type: Boolean, default: false },
      dateCollected: { type: Boolean, default: false },
      timeCollected: { type: Boolean, default: false },
      serviceCollected: { type: Boolean, default: false },
    },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

// MongoDB Indexing for fast active session lookup
bookingSchema.index({ "customerInfo.phone": 1, channel: 1, status: 1 });

// Pre-save hook: generate bookingId & trim conversation history to 50 max
bookingSchema.pre("save", function (next) {
  if (!this.bookingId) {
    this.bookingId = this.generateBookingId();
  }
  if (this.conversationHistory && this.conversationHistory.length > 50) {
    this.conversationHistory = this.conversationHistory.slice(-50);
  }
  next();
});

/**
 * Generate unique human-readable booking ID: CW-YYYYMMDD-XXXX
 */
bookingSchema.methods.generateBookingId = function () {
  const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const randomChars = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `CW-${dateStr}-${randomChars}`;
};

/**
 * Returns true when all 6 required fields are collected
 */
bookingSchema.methods.isComplete = function () {
  const p = this.collectionProgress || {};
  return Boolean(
    p.nameCollected &&
    p.phoneCollected &&
    p.vehicleCollected &&
    p.dateCollected &&
    p.timeCollected &&
    p.serviceCollected,
  );
};

/**
 * Returns array of uncollected field names
 */
bookingSchema.methods.getMissingFields = function () {
  const p = this.collectionProgress || {};
  const missing = [];

  if (!p.nameCollected) missing.push("name");
  if (!p.phoneCollected) missing.push("phone");
  if (!p.vehicleCollected) missing.push("vehicle");
  if (!p.dateCollected) missing.push("date");
  if (!p.timeCollected) missing.push("time");
  if (!p.serviceCollected) missing.push("service");

  return missing;
};

module.exports = mongoose.model("Booking", bookingSchema);
