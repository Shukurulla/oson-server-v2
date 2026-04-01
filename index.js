import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import doctorsRoutes from "./routes/doctors.js";
import suppliersRoutes from "./routes/suppliers.js";
import backgroundRoutes from "./routes/background.js";
import messageRoutes from "./routes/messages.js";

const app = express();
const PORT = process.env.PORT || 5009;

app.use(cors());
app.use(express.json());

// Increase payload limits for better performance
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// MongoDB ga avval ulanamiz, keyin server ishga tushadi
try {
  await mongoose.connect(
    process.env.MONGODB_URI || "mongodb://localhost:27017/pharmacy",
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    }
  );
  console.log("✅ MongoDB ga ulandi");
} catch (err) {
  console.error("❌ MongoDB ga ulanib bo'lmadi:", err.message);
  process.exit(1);
}

// MongoDB ulangandan keyin import qilamiz
await import("./utils/refreshData.js");
await import("./utils/telegramBot.js");

// Routes - middleware tekshiruvi bilan
const useRoute = (path, route) => {
  if (typeof route === "function") {
    app.use(path, route);
    console.log(`✅ Route yuklandi: ${path}`);
  } else {
    console.error(`❌ Route xatosi: ${path} - middleware emas`);
  }
};

useRoute("/api/auth", authRoutes);
useRoute("/api/dashboard", dashboardRoutes);
useRoute("/api/doctors", doctorsRoutes);
useRoute("/api/suppliers", suppliersRoutes);
useRoute("/api/background", backgroundRoutes);
useRoute("/api/messages", messageRoutes);

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
      "POST /api/background/products/search",
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
