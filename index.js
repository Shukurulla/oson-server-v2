import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import doctorsRoutes from "./routes/doctors.js";
import suppliersRoutes from "./routes/suppliers.js";
import backgroundRoutes from "./routes/background.js";
import messageRoutes from "./routes/messages.js";

import "./utils/refreshData.js";
import "./utils/telegramBot.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5009;

app.use(cors());
app.use(express.json());

// Increase payload limits for better performance
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

mongoose.connect(
  process.env.MONGODB_URI || "mongodb://localhost:27017/pharmacy",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  }
);

mongoose.connection.on("connected", () => {
  console.log("✅ MongoDB ga ulandi");
});

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB xato:", err);
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/doctors", doctorsRoutes);
app.use("/api/suppliers", suppliersRoutes);
app.use("/api/background", backgroundRoutes);
app.use("/api/messages", messageRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "Pharmacy Management System API",
    status: "Background refresh system active",
    time: new Date().toISOString(),
    routes: [
      "GET /api/dashboard/stats",
      "GET /api/doctors",
      "GET /api/suppliers",
      "GET /api/messages",
      "GET /api/background/status",
    ],
  });
});

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    const { getRefreshStatus } = await import("./utils/refreshData.js");
    const refreshStatus = getRefreshStatus();

    res.json({
      status: "OK",
      database:
        mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
      refresh: {
        isRunning: refreshStatus.isRunning,
        currentTask: refreshStatus.currentTask,
        lastUpdate: refreshStatus.lastUpdate,
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  } catch (error) {
    res.status(500).json({
      status: "ERROR",
      message: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server ${PORT} portda ishlamoqda`);
  console.log(`🔄 Background refresh system faol`);
  console.log(`📊 Dashboard API: http://localhost:${PORT}/api/dashboard/stats`);
  console.log(`💬 Messages API: http://localhost:${PORT}/api/messages`);
});
