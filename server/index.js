const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const dotenv = require("dotenv");
const { Groq } = require("groq-sdk");

// Load Environment Variables
dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, ".env") });

// Setup Groq Client
const groqApiKey = process.env.GROQ_API_KEY;
const groq = new Groq({
  apiKey:
    groqApiKey && groqApiKey !== "your_groq_api_key" ? groqApiKey : "dummy_key",
});

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// Static Client Dashboard Hosting
app.use(express.static(path.join(__dirname, "../client")));

// MongoDB Connection with 3 Retry Attempts
async function connectMongoDB(attempts = 3) {
  if (
    !MONGODB_URI ||
    MONGODB_URI.includes("your_mongodb_atlas_connection_string")
  ) {
    console.warn(
      "⚠️ MONGODB_URI not configured. Operating in memory-fallback mode.",
    );
    return false;
  }

  for (let i = 1; i <= attempts; i++) {
    try {
      await mongoose.connect(MONGODB_URI);
      console.log("✅ MongoDB connected");
      return true;
    } catch (err) {
      console.error(
        `❌ MongoDB connection attempt ${i} failed: ${err.message}`,
      );
      if (i < attempts) {
        console.log("Retrying MongoDB connection in 2 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }
  console.warn(
    "⚠️ MongoDB connection retries exhausted. Operating in memory-fallback mode.",
  );
  return false;
}

// Import Route Handlers
const whapiRoutes = require("./routes/whapi");
const voiceRoutes = require("./routes/voice");
const bookingsRoutes = require("./routes/bookings");

// Mount Routes
app.use("/api/whapi", whapiRoutes);
app.use("/api/wapi", whapiRoutes); // Legacy alias route
app.use("/api/voice", voiceRoutes);
app.use("/api/bookings", bookingsRoutes);

// Health Check Endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "online",
    service: "Car Wash Booking Agent",
    channels: {
      whatsapp: "Whapi.Cloud (whapi.cloud)",
      voice: "VAPI.ai (vapi.ai)",
    },
    mongodb:
      mongoose.connection.readyState === 1 ? "Connected" : "Memory Fallback",
    timestamp: new Date().toISOString(),
  });
});

// Fallback to Dashboard index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

// Start Server
connectMongoDB(3).then(() => {
  app.listen(PORT, () => {
    const mongoStatus =
      mongoose.connection.readyState === 1
        ? "MongoDB connected"
        : "Memory Fallback Active";
    console.log(
      `Server running on port ${PORT} | ${mongoStatus} | Webhook ready at /api/whapi/webhook`,
    );
  });
});

module.exports = { app, groq };
