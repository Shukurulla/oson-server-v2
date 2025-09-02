import axios from "axios";
import Remains from "../models/Remains.js";
import Sales from "../models/Sales.js";
import PageState from "../models/PageState.js";
import { checkLowStockAndNotify } from "./telegramBot.js";
import cron from "node-cron";
import { Worker } from "worker_threads";

let token = null;
let refreshQueue = [];
let isProcessingQueue = false;
let refreshStatus = {
  isRunning: false,
  currentTask: null,
  progress: 0,
  lastUpdate: null,
  errors: [],
};

// Background refresh statusini olish
const getRefreshStatus = () => refreshStatus;

const login = async () => {
  try {
    console.log("🔐 Background login...");
    const loginUrl = "http://osonkassa.uz/api/auth/login";
    const response = await axios.post(
      loginUrl,
      {
        userName: "apteka",
        password: "00000",
      },
      {
        timeout: 15000,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          tenantId: "biofarms",
        },
      }
    );

    token = response.data.token;
    console.log("✅ Background login muvaffaqiyatli");
    return token;
  } catch (error) {
    console.error("❌ Background login xatosi:", error.message);
    refreshStatus.errors.push(`Login error: ${error.message}`);
    return null;
  }
};

// Page state ni olish
const getPageState = async (type) => {
  let pageState = await PageState.findOne({ type });
  if (!pageState) {
    pageState = new PageState({ type });
    await pageState.save();
  }
  return pageState;
};

// Bugungi sana
const getTodayString = () => {
  return new Date().toISOString().split("T")[0];
};

// Sale items olish (background)
const fetchSaleItems = async (saleId) => {
  try {
    const { data } = await axios.post(
      "http://osonkassa.uz/api/pos/sales/items/get",
      { saleId: saleId },
      {
        headers: { authorization: `Bearer ${token}` },
        timeout: 8000, // Qisqartirdim
      }
    );
    return data?.page?.items || [];
  } catch (error) {
    if (error.code !== "ECONNABORTED") {
      console.error(`❌ Sale items xato ${saleId}:`, error.message);
    }
    return [];
  }
};

// Background task wrapper
const runBackgroundTask = async (taskName, taskFunction) => {
  return new Promise((resolve) => {
    setImmediate(async () => {
      try {
        refreshStatus.currentTask = taskName;
        const result = await taskFunction();
        resolve(result);
      } catch (error) {
        console.error(`❌ Background task xato ${taskName}:`, error.message);
        refreshStatus.errors.push(`${taskName}: ${error.message}`);
        resolve(null);
      }
    });
  });
};

// Remains yangilash (background)
const updateRemainsBackground = async () => {
  try {
    const pageState = await getPageState("remains");
    let currentPage = pageState.lastPage;
    let totalUpdated = 0;
    let processedPages = 0;
    let maxPagesPerRun = 10; // Bir martada maksimum 10 sahifa

    console.log(`📦 Remains: sahifa ${currentPage} dan boshlash...`);

    while (processedPages < maxPagesPerRun) {
      // Non-blocking API call
      const result = await Promise.race([
        axios.post(
          "http://osonkassa.uz/api/report/inventory/remains",
          {
            manufacturerIds: [],
            onlyActiveItems: true,
            pageNumber: currentPage,
            pageSize: 150, // Kamroq qildim
            searchText: "",
            sortOrders: [{ property: "product", direction: "asc" }],
            source: 0,
          },
          {
            headers: { authorization: `Bearer ${token}` },
            timeout: 10000,
          }
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 12000)
        ),
      ]);

      if (result.data?.page?.items?.length > 0) {
        const items = result.data.page.items;

        // Background da batch update
        const updates = items.map((item) => ({
          updateOne: {
            filter: { id: item.id },
            update: {
              $set: {
                ...item,
                dataHash: Remains.generateHash(item),
                lastUpdated: new Date(),
              },
            },
            upsert: true,
          },
        }));

        await Remains.bulkWrite(updates, { ordered: false });
        totalUpdated += items.length;

        // Page state yangilash
        pageState.lastPage = currentPage;
        pageState.totalPages = result.data.page.totalPages;

        if (currentPage >= result.data.page.totalPages) {
          pageState.isComplete = true;
          pageState.lastPage = 1;
          console.log("✅ Remains to'liq tugadi, reset qilindi");
          break;
        } else {
          pageState.lastPage = currentPage + 1;
        }

        pageState.lastUpdateTime = new Date();
        await pageState.save();

        console.log(
          `✅ Remains sahifa ${currentPage}: ${items.length} ta yangilandi`
        );
      } else {
        console.log(`📄 Sahifa ${currentPage} bo'sh`);
        pageState.lastPage = 1;
        pageState.isComplete = true;
        await pageState.save();
        break;
      }

      currentPage++;
      processedPages++;

      // CPU ga nafas berish
      await new Promise((resolve) => setImmediate(resolve));
    }

    refreshStatus.progress = Math.round(
      (processedPages / maxPagesPerRun) * 100
    );
    console.log(
      `📦 Remains: ${totalUpdated} yangilandi (${processedPages} sahifa)`
    );

    return { updated: totalUpdated, pages: processedPages };
  } catch (error) {
    console.error("❌ Background remains xatosi:", error.message);
    if (error.response?.status === 401) {
      token = null;
    }
    return null;
  }
};

// Sales yangilash (background)
const updateSalesBackground = async () => {
  try {
    const pageState = await getPageState("sales");
    const dateToSync = getTodayString();

    if (pageState.currentDate !== dateToSync) {
      pageState.currentDate = dateToSync;
      pageState.dailyPageState = {
        currentPage: 1,
        totalPages: 1,
        isComplete: false,
      };
      await pageState.save();
    }

    let currentPage = pageState.dailyPageState.currentPage;
    let totalUpdated = 0;
    let processedPages = 0;
    let maxPagesPerRun = 5; // Bir martada maksimum 5 sahifa (chunki items ham olish kerak)

    console.log(`💰 Sales: ${dateToSync} - sahifa ${currentPage}`);

    while (processedPages < maxPagesPerRun) {
      // Non-blocking sales API call
      const result = await Promise.race([
        axios.post(
          "http://osonkassa.uz/api/pos/sales/get",
          {
            dateFrom: dateToSync,
            deletedFilter: 1,
            pageNumber: currentPage,
            pageSize: 30, // Kamroq qildim
            searchText: "",
            sortOrders: [],
          },
          {
            headers: { authorization: `Bearer ${token}` },
            timeout: 10000,
          }
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Sales timeout")), 12000)
        ),
      ]);

      if (result.data?.page?.items?.length > 0) {
        const salesList = result.data.page.items;

        // Background da har bir sale uchun items olish
        for (const sale of salesList) {
          try {
            // Non-blocking items call
            const items = await Promise.race([
              fetchSaleItems(sale.id),
              new Promise((resolve) => setTimeout(() => resolve([]), 5000)),
            ]);

            const completeStaleData = {
              ...sale,
              items: items,
              hasItems: items.length > 0,
              itemsLastUpdated: new Date(),
              doctorCode: sale.notes || null,
              date: new Date(sale.date),
            };

            const newHash = Sales.generateHash(completeStaleData);
            const saleWithHash = { ...completeStaleData, dataHash: newHash };

            // Background da database yangilash
            await Sales.findOneAndUpdate(
              { id: sale.id },
              { $set: saleWithHash },
              { upsert: true, new: false }
            );

            totalUpdated++;

            // CPU ga nafas berish
            await new Promise((resolve) => setImmediate(resolve));
          } catch (saleError) {
            // Xatolarni log qilamiz lekin davom etamiz
            console.log(`⚠️ Sale ${sale.id} skip: ${saleError.message}`);
          }
        }

        // Page state yangilash
        pageState.dailyPageState.currentPage = currentPage;
        pageState.dailyPageState.totalPages = result.data.page.totalPages;

        if (currentPage >= result.data.page.totalPages) {
          pageState.dailyPageState.isComplete = true;
          pageState.lastSyncDate = dateToSync;
          console.log(`✅ ${dateToSync} tugadi`);
          break;
        } else {
          pageState.dailyPageState.currentPage = currentPage + 1;
        }

        pageState.lastUpdateTime = new Date();
        await pageState.save();

        console.log(
          `✅ Sales sahifa ${currentPage}: ${salesList.length} sales, ${totalUpdated} yangilandi`
        );
      } else {
        console.log(`📄 Sales sahifa ${currentPage} bo'sh`);
        pageState.dailyPageState.isComplete = true;
        pageState.lastSyncDate = dateToSync;
        await pageState.save();
        break;
      }

      currentPage++;
      processedPages++;
    }

    console.log(
      `💰 Sales: ${totalUpdated} yangilandi (${processedPages} sahifa)`
    );
    return { updated: totalUpdated, pages: processedPages };
  } catch (error) {
    console.error("❌ Background sales xatosi:", error.message);
    if (error.response?.status === 401) {
      token = null;
    }
    return null;
  }
};

// Missing items to'ldirish (background)
const fillMissingItemsBackground = async () => {
  try {
    const salesWithoutItems = await Sales.find({
      $or: [
        { hasItems: false },
        { hasItems: { $exists: false } },
        { items: { $size: 0 } },
      ],
    }).limit(10); // Kamroq qildim

    if (salesWithoutItems.length === 0) {
      return { filled: 0 };
    }

    let filled = 0;
    console.log(
      `🔄 ${salesWithoutItems.length} ta missing item to'ldirilmoqda...`
    );

    for (const sale of salesWithoutItems) {
      try {
        // Background da items olish
        const items = await Promise.race([
          fetchSaleItems(sale.id),
          new Promise((resolve) => setTimeout(() => resolve([]), 3000)),
        ]);

        await Sales.findOneAndUpdate(
          { _id: sale._id },
          {
            $set: {
              items: items,
              hasItems: items.length > 0,
              itemsLastUpdated: new Date(),
            },
          }
        );

        filled++;

        // CPU ga nafas berish
        await new Promise((resolve) => setImmediate(resolve));
      } catch (error) {
        console.log(`⚠️ Missing item skip ${sale.id}: ${error.message}`);
      }
    }

    console.log(`✅ Missing items: ${filled} ta to'ldirildi`);
    return { filled };
  } catch (error) {
    console.error("❌ Background missing items xato:", error.message);
    return null;
  }
};

// BACKGROUND YANGILANISH - Asosiy funksiya
const updateAllDataBackground = async () => {
  if (refreshStatus.isRunning) {
    console.log("⏳ Background refresh allaqachon ishlamoqda...");
    return;
  }

  refreshStatus.isRunning = true;
  refreshStatus.currentTask = "Boshlash";
  refreshStatus.progress = 0;
  refreshStatus.errors = [];

  const startTime = Date.now();

  try {
    console.log("🔄 Background refresh boshlandi...");

    // 1. Login (agar kerak bo'lsa)
    if (!token) {
      refreshStatus.currentTask = "Login";
      await login();
      if (!token) {
        throw new Error("Login amalga oshmadi");
      }
    }
    refreshStatus.progress = 10;

    // 2. Background tasklar parallel ishlatish
    refreshStatus.currentTask = "Ma'lumotlarni yangilash";

    const tasks = [
      runBackgroundTask("Remains", updateRemainsBackground),
      runBackgroundTask("Sales", updateSalesBackground),
      runBackgroundTask("Missing Items", fillMissingItemsBackground),
    ];

    // Parallel ishlatish lekin CPU ga ko'p yuklamaslik uchun
    const results = await Promise.allSettled(tasks);

    refreshStatus.progress = 80;

    // 3. Low stock check (har 4 marta)
    const now = new Date();
    const shouldCheckLowStock = now.getMinutes() % 60 === 0; // Har soat

    if (shouldCheckLowStock) {
      refreshStatus.currentTask = "Kam qoldiqlar tekshiruvi";
      await runBackgroundTask("Low Stock Check", checkLowStockAndNotify);
    }

    refreshStatus.progress = 100;
    refreshStatus.currentTask = "Tugaldi";

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    console.log(`🎉 Background refresh tugadi! Vaqt: ${duration}s`);

    // Natijalarni log qilish
    results.forEach((result, index) => {
      const taskNames = ["Remains", "Sales", "Missing Items"];
      if (result.status === "fulfilled" && result.value) {
        console.log(`✅ ${taskNames[index]}: muvaffaqiyatli`);
      } else {
        console.log(`❌ ${taskNames[index]}: xato yuz berdi`);
      }
    });

    refreshStatus.lastUpdate = new Date();
  } catch (error) {
    console.error("❌ Background refresh umumiy xato:", error.message);
    refreshStatus.errors.push(`General error: ${error.message}`);
  } finally {
    refreshStatus.isRunning = false;
    refreshStatus.currentTask = null;
    refreshStatus.progress = 0;

    // Xotira tozalash
    if (global.gc) {
      global.gc();
    }
  }
};

// Queue processor
const processQueue = async () => {
  if (isProcessingQueue || refreshQueue.length === 0) return;

  isProcessingQueue = true;

  while (refreshQueue.length > 0) {
    const task = refreshQueue.shift();

    try {
      console.log(`🔄 Queue task: ${task.name}`);
      await task.function();
    } catch (error) {
      console.error(`❌ Queue task xato: ${task.name}`, error.message);
    }

    // CPU ga nafas berish
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  isProcessingQueue = false;
};

// Task ni queuega qo'shish
const addToQueue = (name, taskFunction) => {
  refreshQueue.push({ name, function: taskFunction });
  setImmediate(processQueue);
};

// Manual triggers
const manualUpdateRemains = () => {
  addToQueue("Manual Remains", updateRemainsBackground);
};

const manualUpdateSales = () => {
  addToQueue("Manual Sales", updateSalesBackground);
};

const manualFullUpdate = () => {
  addToQueue("Manual Full Update", updateAllDataBackground);
};

// Status monitoring
const getSystemStatus = async () => {
  try {
    const remainsState = await PageState.findOne({ type: "remains" });
    const salesState = await PageState.findOne({ type: "sales" });

    const totalSales = await Sales.countDocuments();
    const salesWithItems = await Sales.countDocuments({ hasItems: true });

    return {
      refresh: refreshStatus,
      queue: {
        length: refreshQueue.length,
        isProcessing: isProcessingQueue,
      },
      data: {
        remains: {
          currentPage: remainsState?.lastPage || 1,
          totalPages: remainsState?.totalPages || 0,
          lastUpdate: remainsState?.lastUpdateTime,
        },
        sales: {
          currentDate: salesState?.currentDate,
          total: totalSales,
          withItems: salesWithItems,
          withoutItems: totalSales - salesWithItems,
          lastUpdate: salesState?.lastUpdateTime,
        },
      },
    };
  } catch (error) {
    console.error("Status olishda xato:", error);
    return null;
  }
};

// Tizimni to'xtatish (graceful shutdown)
const stopRefresh = () => {
  refreshStatus.isRunning = false;
  refreshQueue.length = 0;
  console.log("🛑 Background refresh to'xtatildi");
};

// YAGONA CRON JOB - Har 15 daqiqada, background da
cron.schedule("*/15 * * * *", () => {
  console.log("\n🕐 15-daqiqalik background yangilanish queuega qo'shildi...");
  addToQueue("Scheduled Update", updateAllDataBackground);
});

// Status har soatda
cron.schedule("0 * * * *", async () => {
  const status = await getSystemStatus();
  if (status) {
    console.log("\n📊 BACKGROUND TIZIM HOLATI:");
    console.log(`   Refresh running: ${status.refresh.isRunning}`);
    console.log(`   Current task: ${status.refresh.currentTask || "Yo'q"}`);
    console.log(`   Queue length: ${status.queue.length}`);
    console.log(
      `   Sales: ${status.data.sales.total} (${status.data.sales.withItems} items bilan)`
    );
    console.log(
      `   Remains page: ${status.data.remains.currentPage}/${status.data.remains.totalPages}`
    );
  }
});

// Boshlang'ich ishga tushirish
setTimeout(() => {
  console.log("🚀 Background tizim ishga tushmoqda...");

  // CPU intensive bo'lmagan boshlang'ich yangilanish
  setTimeout(() => {
    console.log("🔄 Dastlabki background yangilanish...");
    addToQueue("Initial Update", updateAllDataBackground);
  }, 10000); // 10 sekund kutish
}, 5000);

// Export functions
export {
  updateAllDataBackground,
  manualUpdateRemains,
  manualUpdateSales,
  manualFullUpdate,
  getSystemStatus,
  getRefreshStatus,
  stopRefresh,
  addToQueue,
  login,
};
