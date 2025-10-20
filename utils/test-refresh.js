// utils/refreshData.js - Professional aniqlik bilan tuzatilgan versiya
import axios from "axios";
import Remains from "../models/Remains.js";
import Sales from "../models/Sales.js";
import PageState from "../models/PageState.js";
import { checkLowStockAndNotify } from "./telegramBot.js";
import cron from "node-cron";

let token = null;
let refreshStatus = {
  isRunning: false,
  currentTask: null,
  progress: 0,
  lastUpdate: null,
  errors: [],
  stats: {
    remainsUpdated: 0,
    remainsDeleted: 0,
    salesUpdated: 0,
    itemsFetched: 0,
  },
};

// Login
const login = async () => {
  try {
    console.log("🔐 Login qilinmoqda...");
    const response = await axios.post(
      "http://osonkassa.uz/api/auth/login",
      {
        userName: "apteka",
        password: "00000",
      },
      {
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          tenantId: "biofarms",
        },
      }
    );

    token = response.data.token;
    console.log("✅ Login muvaffaqiyatli");
    return token;
  } catch (error) {
    console.error("❌ Login xatosi:", error.message);
    refreshStatus.errors.push(`Login error: ${error.message}`);
    return null;
  }
};

const refreshSales = async () => {
    try {
        const {data} = await axios.post('https://osonkassa.uz/api/pos/sales/get', {})
    } catch (error) {
        
    }
}

// CRON JOBS - Optimizatsiyalangan
// Har 10 daqiqada yangilanish (bugungi sana bilan)
cron.schedule("*/10 * * * *", () => {
  console.log("\n⏰ Muntazam yangilanish (har 10 daqiqa)");
});

// Har soat boshida to'liq yangilanish (yangi token bilan)
cron.schedule("0 * * * *", () => {
  console.log("\n⏰ Soatlik to'liq yangilanish");
});

// Har kuni ertalab 6:00 da to'liq tozalash va yangilash
cron.schedule("0 6 * * *", async () => {
  console.log("\n🧹 Kunlik to'liq tozalash va yangilash...");
});



// Export
export { login };
