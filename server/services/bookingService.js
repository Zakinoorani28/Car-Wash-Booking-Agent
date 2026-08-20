const Booking = require("../models/Booking");

// Service Specifications: PKR Pricing and Estimated Duration
const SERVICE_SPECS = {
  basic: { name: "Basic Wash", price: 500, duration: 30 },
  premium: { name: "Premium Wash", price: 1000, duration: 60 },
  full_detail: { name: "Full Detail", price: 2000, duration: 120 },
};

// In-memory fallback session store if MongoDB Atlas is disconnected
const memoryBookings = [];

class BookingService {
  /**
   * Helper to attach methods to plain memory objects if DB is offline
   */
  _attachMethods(booking) {
    if (!booking) return booking;

    if (typeof booking.isComplete !== "function") {
      booking.isComplete = function () {
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
    }

    if (typeof booking.getMissingFields !== "function") {
      booking.getMissingFields = function () {
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
    }

    if (typeof booking.generateBookingId !== "function") {
      booking.generateBookingId = function () {
        const dateStr = new Date()
          .toISOString()
          .split("T")[0]
          .replace(/-/g, "");
        const randomChars = Math.random()
          .toString(36)
          .substring(2, 6)
          .toUpperCase();
        return `CW-${dateStr}-${randomChars}`;
      };
    }

    return booking;
  }

  /**
   * FUNCTION 1: getOrCreateSession(phoneNumber, channel)
   * Reuse existing "collecting" session for same phone + channel (Indexed query)
   */
  async getOrCreateSession(phoneNumber, channel = "whatsapp") {
    const cleanPhone = String(phoneNumber).replace(/\D/g, "").trim();
    const formattedPhone = cleanPhone ? `+${cleanPhone}` : phoneNumber;

    try {
      // Indexed fast lookup for active collecting session
      let booking = await Booking.findOne({
        "customerInfo.phone": formattedPhone,
        channel: channel,
        status: "collecting",
      });

      if (!booking) {
        booking = new Booking({
          channel: channel,
          status: "collecting",
          customerInfo: {
            phone: formattedPhone,
            whatsappNumber: formattedPhone,
          },
          collectionProgress: {
            phoneCollected: true,
          },
        });
        await booking.save();
      }
      return this._attachMethods(booking);
    } catch (err) {
      console.warn(
        "[BookingService Mongo Warning] Using memory fallback session:",
        err.message,
      );
      let mem = memoryBookings.find(
        (b) =>
          b.customerInfo?.phone === formattedPhone &&
          b.channel === channel &&
          b.status === "collecting",
      );

      if (!mem) {
        const dateStr = new Date()
          .toISOString()
          .split("T")[0]
          .replace(/-/g, "");
        const randomChars = Math.random()
          .toString(36)
          .substring(2, 6)
          .toUpperCase();
        mem = {
          _id: "mem_" + Date.now(),
          bookingId: `CW-${dateStr}-${randomChars}`,
          channel: channel,
          status: "collecting",
          customerInfo: {
            name: "",
            phone: formattedPhone,
            whatsappNumber: formattedPhone,
          },
          vehicleInfo: { type: undefined, make: "", color: "" },
          appointment: {
            date: "",
            time: "",
            serviceType: undefined,
            estimatedDuration: 0,
            estimatedPrice: 0,
          },
          conversationHistory: [],
          collectionProgress: {
            nameCollected: false,
            phoneCollected: true,
            vehicleCollected: false,
            dateCollected: false,
            timeCollected: false,
            serviceCollected: false,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
        };
        memoryBookings.push(mem);
      }
      return this._attachMethods(mem);
    }
  }

  /**
   * FUNCTION 2: extractBookingInfo(textInput, booking)
   * Extract fields from text using Regex and Urdu/Pakistani colloquial terms
   */
  extractBookingInfo(textInput = "", booking = {}) {
    const text = String(textInput).toLowerCase().trim();
    const extractions = {};
    const missing =
      typeof booking.getMissingFields === "function"
        ? booking.getMissingFields()
        : [];

    // Vehicle Type Detection
    if (
      text.includes("sedan") ||
      text.includes("car") ||
      text.includes("gaadi") ||
      text.includes("corolla") ||
      text.includes("civic")
    ) {
      extractions.vehicleType = "sedan";
    } else if (
      text.includes("suv") ||
      text.includes("fortuner") ||
      text.includes("prado") ||
      text.includes("crossover")
    ) {
      extractions.vehicleType = "suv";
    } else if (
      text.includes("truck") ||
      text.includes("pickup") ||
      text.includes("hilux") ||
      text.includes("revo")
    ) {
      extractions.vehicleType = "truck";
    } else if (
      text.includes("motorcycle") ||
      text.includes("bike") ||
      text.includes("70") ||
      text.includes("125")
    ) {
      extractions.vehicleType = "motorcycle";
    } else if (
      text.includes("van") ||
      text.includes("hiace") ||
      text.includes("bolan")
    ) {
      extractions.vehicleType = "van";
    }

    // Service Type Detection
    if (
      text.includes("full detail") ||
      text.includes("full_detail") ||
      text.includes("detail") ||
      text.includes("2000")
    ) {
      extractions.serviceType = "full_detail";
    } else if (text.includes("premium") || text.includes("1000")) {
      extractions.serviceType = "premium";
    } else if (text.includes("basic") || text.includes("500")) {
      extractions.serviceType = "basic";
    }

    // Date Detection (kal = tomorrow, parso = day after)
    const dateRegex = /\b(\d{4}-\d{2}-\d{2})\b/;
    if (dateRegex.test(textInput)) {
      extractions.date = textInput.match(dateRegex)[1];
    } else if (text.includes("today") || text.includes("aaj")) {
      extractions.date = new Date().toISOString().split("T")[0];
    } else if (text.includes("kal") || text.includes("tomorrow")) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      extractions.date = tomorrow.toISOString().split("T")[0];
    } else if (text.includes("parso")) {
      const parso = new Date();
      parso.setDate(parso.getDate() + 2);
      extractions.date = parso.toISOString().split("T")[0];
    }

    // Time Detection (subah = 09:00, dopahar = 14:00, shaam = 17:00)
    const time12Regex = /\b(1[0-2]|0?[1-9]):?([0-5][0-9])?\s*(am|pm)\b/i;
    const time24Regex = /\b([01]?[0-9]|2[0-3]):([0-5][0-9])\b/;
    if (time12Regex.test(textInput)) {
      const match = textInput.match(time12Regex);
      let hours = parseInt(match[1], 10);
      const minutes = match[2] ? match[2] : "00";
      const period = match[3].toLowerCase();
      if (period === "pm" && hours < 12) hours += 12;
      if (period === "am" && hours === 12) hours = 0;
      extractions.time = `${String(hours).padStart(2, "0")}:${minutes}`;
    } else if (time24Regex.test(textInput)) {
      const match = textInput.match(time24Regex);
      extractions.time = `${match[1].padStart(2, "0")}:${match[2]}`;
    } else if (text.includes("subah") || text.includes("morning")) {
      extractions.time = "09:00";
    } else if (text.includes("dopahar") || text.includes("afternoon")) {
      extractions.time = "14:00";
    } else if (
      text.includes("shaam") ||
      text.includes("evening") ||
      text.includes("raat")
    ) {
      extractions.time = "17:00";
    }

    // Name Detection
    const nameMatch = textInput.match(
      /(?:my name is|i am|this is|call me|name:?|name is)\s+([A-Za-z\s]{2,30})/i,
    );
    if (nameMatch) {
      extractions.name = nameMatch[1].trim();
    } else if (
      missing.includes("name") &&
      !extractions.vehicleType &&
      !extractions.serviceType &&
      !extractions.date &&
      !extractions.time
    ) {
      const cleanText = textInput.trim();
      if (
        cleanText.length >= 2 &&
        cleanText.length <= 30 &&
        !/\d/.test(cleanText)
      ) {
        extractions.name = cleanText;
      }
    }

    return extractions;
  }

  /**
   * FUNCTION 3: updateBookingFromExtraction(bookingId, extractions)
   */
  async updateBookingFromExtraction(bookingId, extractions = {}) {
    let booking = null;

    try {
      booking =
        (await Booking.findOne({ _id: bookingId })) ||
        (await Booking.findOne({ bookingId: bookingId }));
    } catch (err) {
      booking = memoryBookings.find(
        (b) => b._id === bookingId || b.bookingId === bookingId,
      );
    }

    if (!booking) {
      booking = memoryBookings.find(
        (b) => b._id === bookingId || b.bookingId === bookingId,
      );
    }

    if (!booking) throw new Error(`Booking ${bookingId} not found`);
    this._attachMethods(booking);

    if (extractions.name) {
      booking.customerInfo.name = extractions.name;
      booking.collectionProgress.nameCollected = true;
    }
    if (extractions.phone) {
      booking.customerInfo.phone = extractions.phone;
      booking.collectionProgress.phoneCollected = true;
    }
    if (extractions.vehicleType || extractions.vehicle_type) {
      booking.vehicleInfo.type =
        extractions.vehicleType || extractions.vehicle_type;
      booking.collectionProgress.vehicleCollected = true;
    }
    if (extractions.date) {
      booking.appointment.date = extractions.date;
      booking.collectionProgress.dateCollected = true;
    }
    if (extractions.time) {
      booking.appointment.time = extractions.time;
      booking.collectionProgress.timeCollected = true;
    }
    if (extractions.serviceType || extractions.service_type) {
      const sType = extractions.serviceType || extractions.service_type;
      booking.appointment.serviceType = sType;
      booking.collectionProgress.serviceCollected = true;
      const spec = SERVICE_SPECS[sType];
      if (spec) {
        booking.appointment.estimatedPrice = spec.price;
        booking.appointment.estimatedDuration = spec.duration;
      }
    }

    if (booking.isComplete()) {
      booking.status = "confirmed";
      booking.completedAt = new Date();
    }

    if (typeof booking.save === "function") {
      await booking.save();
    }

    return booking;
  }

  /**
   * FUNCTION 4: getNextQuestion(booking)
   */
  getNextQuestion(booking) {
    this._attachMethods(booking);
    const missing = booking.getMissingFields();

    if (missing.length === 0 || booking.isComplete()) {
      return this.formatConfirmation(booking);
    }

    const nextField = missing[0];

    switch (nextField) {
      case "name":
        return "What is your name?";
      case "vehicle":
        return "What type of vehicle do you have? (Sedan, SUV, Truck, Motorcycle, or Van)";
      case "date":
        return "What date would you like? (e.g. tomorrow or YYYY-MM-DD)";
      case "time":
        return "What time works for you? (morning/afternoon/evening or e.g. 10:00)";
      case "service":
        return "Which service? Basic (PKR 500) / Premium (PKR 1000) / Full Detail (PKR 2000)";
      default:
        return "Could you please confirm your booking details?";
    }
  }

  /**
   * FUNCTION 5: formatConfirmation(booking)
   */
  formatConfirmation(booking) {
    const bId = booking.bookingId || "CW-PENDING";
    const name = booking.customerInfo?.name || "Valued Customer";
    const vehicle = (booking.vehicleInfo?.type || "Vehicle").toUpperCase();
    const serviceKey = booking.appointment?.serviceType || "basic";
    const serviceName = SERVICE_SPECS[serviceKey]?.name || "Basic Wash";
    const price =
      booking.appointment?.estimatedPrice ||
      SERVICE_SPECS[serviceKey]?.price ||
      500;
    const duration =
      booking.appointment?.estimatedDuration ||
      SERVICE_SPECS[serviceKey]?.duration ||
      30;
    const date = booking.appointment?.date || "Today";
    const time = booking.appointment?.time || "10:00";

    return (
      `🎉 *Booking Confirmed!* 🎉\n\n` +
      `📋 *Booking ID*: ${bId}\n` +
      `👤 *Customer*: ${name}\n` +
      `🚗 *Vehicle*: ${vehicle}\n` +
      `🧽 *Service*: ${serviceName}\n` +
      `📅 *Date*: ${date}\n` +
      `⏰ *Time*: ${time}\n` +
      `⏱️ *Duration*: ~${duration} mins\n` +
      `💰 *Estimated Price*: PKR ${price}\n\n` +
      `Thank you for choosing Sparkle Car Wash! We look forward to servicing your vehicle. ✨`
    );
  }

  /**
   * List all bookings for Dashboard (supports limit and sort)
   */
  async listBookings(query = {}) {
    const filter = {};
    if (query.channel) filter.channel = query.channel;
    if (query.status) filter.status = query.status;

    const limit = parseInt(query.limit, 10) || 50;

    try {
      let bookings = await Booking.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit);
      return bookings.map((b) => this._attachMethods(b));
    } catch (err) {
      let results = [...memoryBookings];
      if (query.channel)
        results = results.filter((b) => b.channel === query.channel);
      if (query.status)
        results = results.filter((b) => b.status === query.status);
      return results.slice(0, limit).map((b) => this._attachMethods(b));
    }
  }

  /**
   * Create Booking Manually
   */
  async createBooking(data) {
    const spec =
      SERVICE_SPECS[data.serviceType || "basic"] || SERVICE_SPECS.basic;
    const newDoc = new Booking({
      channel: data.channel || "whatsapp",
      status: "confirmed",
      customerInfo: {
        name: data.customerName || data.name || "Customer",
        phone: data.customerPhone || data.phone || "+923000000000",
        whatsappNumber: data.customerPhone || data.phone || "+923000000000",
      },
      vehicleInfo: {
        type: data.carType?.toLowerCase() || data.vehicleType || "sedan",
      },
      appointment: {
        date: data.date || new Date().toISOString().split("T")[0],
        time: data.timeSlot || data.time || "10:00",
        serviceType: data.serviceType || "basic",
        estimatedDuration: spec.duration,
        estimatedPrice: spec.price,
      },
      collectionProgress: {
        nameCollected: true,
        phoneCollected: true,
        vehicleCollected: true,
        dateCollected: true,
        timeCollected: true,
        serviceCollected: true,
      },
      completedAt: new Date(),
    });

    try {
      await newDoc.save();
      return this._attachMethods(newDoc);
    } catch (err) {
      memoryBookings.push(newDoc);
      return this._attachMethods(newDoc);
    }
  }

  async updateBooking(id, updateData) {
    try {
      const doc = await Booking.findByIdAndUpdate(id, updateData, {
        new: true,
      });
      if (doc) return this._attachMethods(doc);
    } catch (err) {}
    const idx = memoryBookings.findIndex(
      (b) => b._id === id || b.bookingId === id,
    );
    if (idx !== -1) {
      memoryBookings[idx] = { ...memoryBookings[idx], ...updateData };
      return this._attachMethods(memoryBookings[idx]);
    }
    throw new Error("Booking not found");
  }

  async deleteBooking(id) {
    try {
      await Booking.findByIdAndDelete(id);
    } catch (err) {}
    const idx = memoryBookings.findIndex(
      (b) => b._id === id || b.bookingId === id,
    );
    if (idx !== -1) memoryBookings.splice(idx, 1);
    return { success: true, id };
  }
}

module.exports = new BookingService();
