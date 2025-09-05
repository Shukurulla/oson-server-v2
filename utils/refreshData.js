// utils/refreshData.js - To'liq tozalash va qayta qo'shish versiyasi
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

// TO'LIQ TOZALASH VA QAYTA QO'SHISH - Remains sinxronizatsiya
const syncRemainsComplete = async () => {
  try {
    console.log("🔄 Remains to'liq sinxronizatsiya boshlandi...");
    const startTime = Date.now();

    // 1. Birinchi so'rovda totalCount ni aniqlash
    const firstResponse = await axios.post(
      "http://osonkassa.uz/api/report/inventory/remains",
      {
        manufacturerIds: [],
        onlyActiveItems: true,
        pageNumber: 1,
        pageSize: 1,
        searchText: "",
        sortOrders: [{ property: "product", direction: "asc" }],
        source: 0,
      },
      {
        headers: { authorization: `Bearer ${token}` },
        timeout: 10000,
      }
    );

    const totalCount = firstResponse.data.page.totalCount || 0;

    console.log(`📦 Oson Kassa'da jami ${totalCount} ta remains topildi`);

    // 2. AVVAL BARCHA ESKI MA'LUMOTLARNI O'CHIRISH
    console.log("🗑️ Eski ma'lumotlarni tozalash...");
    const deleteResult = await Remains.deleteMany({});
    console.log(`✅ ${deleteResult.deletedCount} ta eski remains o'chirildi`);

    refreshStatus.stats.remainsDeleted = deleteResult.deletedCount;

    if (totalCount === 0) {
      console.log("📦 Oson Kassa'da remains topilmadi");
      return {
        updated: 0,
        deleted: deleteResult.deletedCount,
        total: 0,
      };
    }

    // 3. Barcha remains'larni olish
    const pageSize = 1000;
    const totalPages = Math.ceil(totalCount / pageSize);
    const allRemains = [];
    const PARALLEL_PAGES = 3;

    for (let i = 0; i < totalPages; i += PARALLEL_PAGES) {
      const pagePromises = [];

      for (let j = i; j < Math.min(i + PARALLEL_PAGES, totalPages); j++) {
        pagePromises.push(
          axios.post(
            "http://osonkassa.uz/api/report/inventory/remains",
            {
              manufacturerIds: [],
              onlyActiveItems: true,
              pageNumber: j + 1,
              pageSize: pageSize,
              searchText: "",
              sortOrders: [{ property: "product", direction: "asc" }],
              source: 0,
            },
            {
              headers: { authorization: `Bearer ${token}` },
              timeout: 20000,
            }
          )
        );
      }

      const responses = await Promise.allSettled(pagePromises);

      for (const response of responses) {
        if (
          response.status === "fulfilled" &&
          response.value.data?.page?.items
        ) {
          const items = response.value.data.page.items;
          allRemains.push(...items);
        }
      }

      console.log(
        `✅ Remains: ${Math.min(
          i + PARALLEL_PAGES,
          totalPages
        )}/${totalPages} sahifa olindi (${allRemains.length}/${totalCount})`
      );
    }

    console.log(`📊 Jami ${allRemains.length} ta remains olindi`);

    // 4. ID bo'yicha unikal qilish (ehtiyot uchun)
    const uniqueRemainsMap = new Map();
    for (const item of allRemains) {
      uniqueRemainsMap.set(item.id, item);
    }

    const uniqueRemains = Array.from(uniqueRemainsMap.values());
    console.log(`🔍 ${uniqueRemains.length} ta unikal remains aniqlandi`);

    // 5. Yangi ma'lumotlarni qo'shish (BulkWrite)
    const bulkOps = uniqueRemains.map((item) => ({
      insertOne: {
        document: {
          ...item,
          lastUpdated: new Date(),
        },
      },
    }));

    // 6. Batch bo'lib saqlash (5000 tadan)
    const BATCH_SIZE = 5000;
    let totalSaved = 0;

    for (let i = 0; i < bulkOps.length; i += BATCH_SIZE) {
      const batch = bulkOps.slice(i, i + BATCH_SIZE);

      try {
        const result = await Remains.bulkWrite(batch, {
          ordered: false,
        });

        totalSaved += result.insertedCount;

        console.log(
          `💾 Remains: ${Math.min(i + BATCH_SIZE, bulkOps.length)}/${
            bulkOps.length
          } saqlandi`
        );
      } catch (error) {
        console.error(`⚠️ Batch saqlashda xato:`, error.message);
      }
    }

    // 7. Yakuniy tekshiruv
    const finalCount = await Remains.countDocuments();
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    console.log(`\n🎉 Remains sinxronizatsiya tugadi!`);
    console.log(`   ⏱️ Vaqt: ${duration} sekund`);
    console.log(`   📦 Oson Kassa: ${totalCount} ta`);
    console.log(`   🔍 Unikal: ${uniqueRemains.length} ta`);
    console.log(`   💾 MongoDB'ga saqlandi: ${totalSaved} ta`);
    console.log(`   ✅ Hozirgi holat: ${finalCount} ta`);

    // Agar farq bo'lsa, ogohlantirish
    if (finalCount !== uniqueRemains.length) {
      console.error(
        `❌ OGOHLANTIRISH: Kutilgan ${uniqueRemains.length}, lekin ${finalCount} ta saqlandi!`
      );
    } else {
      console.log(`   ✅ MA'LUMOTLAR TO'LIQ MOS KELADI! ✅`);
    }

    refreshStatus.stats.remainsUpdated = totalSaved;

    return {
      updated: totalSaved,
      deleted: deleteResult.deletedCount,
      total: finalCount,
      expected: uniqueRemains.length,
      duration: duration,
    };
  } catch (error) {
    console.error("❌ Remains sinxronizatsiyada xato:", error.message);
    if (error.response?.status === 401) {
      token = null;
    }
    return { updated: 0, deleted: 0 };
  }
};

// Sales yangilash (oldingi kod saqlanadi)
const syncSalesComplete = async () => {
  try {
    console.log("🔄 Sales to'liq sinxronizatsiya boshlandi...");
    const startTime = Date.now();
    const today = new Date().toISOString().split("T")[0];

    // 1. Birinchi so'rovda totalCount ni olish
    const firstResponse = await axios.post(
      "http://osonkassa.uz/api/pos/sales/get",
      {
        dateFrom: today,
        deletedFilter: 1,
        pageNumber: 1,
        pageSize: 1,
        searchText: "",
        sortOrders: [],
      },
      {
        headers: { authorization: `Bearer ${token}` },
        timeout: 10000,
      }
    );

    const totalCount = firstResponse.data.page.totalCount || 0;

    if (totalCount === 0) {
      console.log("📊 Bugun hech qanday savdo yo'q");
      return { updated: 0, itemsFetched: 0 };
    }

    console.log(`📊 Bugun jami ${totalCount} ta savdo topildi`);

    // 2. Barcha sales'larni olish
    const pageSize = 500;
    const totalPages = Math.ceil(totalCount / pageSize);
    const allSales = [];
    const salesIds = new Set();

    // Parallel ravishda barcha sahifalarni olish
    const PARALLEL_PAGES = 3;

    for (let i = 0; i < totalPages; i += PARALLEL_PAGES) {
      const pagePromises = [];

      for (let j = i; j < Math.min(i + PARALLEL_PAGES, totalPages); j++) {
        pagePromises.push(
          axios.post(
            "http://osonkassa.uz/api/pos/sales/get",
            {
              dateFrom: today,
              deletedFilter: 1,
              pageNumber: j + 1,
              pageSize: pageSize,
              searchText: "",
              sortOrders: [],
            },
            {
              headers: { authorization: `Bearer ${token}` },
              timeout: 15000,
            }
          )
        );
      }

      const responses = await Promise.allSettled(pagePromises);

      for (const response of responses) {
        if (
          response.status === "fulfilled" &&
          response.value.data?.page?.items
        ) {
          const items = response.value.data.page.items;
          items.forEach((sale) => {
            allSales.push(sale);
            salesIds.add(sale.id);
          });
        }
      }

      console.log(
        `✅ Sales: ${Math.min(
          i + PARALLEL_PAGES,
          totalPages
        )}/${totalPages} sahifa olindi (${allSales.length}/${totalCount})`
      );
    }

    // 3. Bazada mavjud sales'larni tekshirish
    const existingSales = await Sales.find(
      { id: { $in: Array.from(salesIds) } },
      { id: 1, hasItems: 1 }
    );

    const existingSalesMap = new Map(existingSales.map((s) => [s.id, s]));

    // 4. Items kerak bo'lgan sales'larni aniqlash
    const salesToFetchItems = [];

    for (const sale of allSales) {
      const existing = existingSalesMap.get(sale.id);

      if (!existing || !existing.hasItems) {
        salesToFetchItems.push(sale);
      }
    }

    console.log(
      `📋 ${salesToFetchItems.length} ta sale uchun items olish kerak`
    );

    // 5. Items'larni parallel olish
    let itemsFetched = 0;
    const BATCH_SIZE = 10;

    for (let i = 0; i < salesToFetchItems.length; i += BATCH_SIZE) {
      const batch = salesToFetchItems.slice(i, i + BATCH_SIZE);

      const itemsPromises = batch.map((sale) =>
        axios
          .post(
            "http://osonkassa.uz/api/pos/sales/items/get",
            { saleId: sale.id },
            {
              headers: { authorization: `Bearer ${token}` },
              timeout: 5000,
            }
          )
          .then((response) => ({
            sale: sale,
            items: response.data?.page?.items || [],
          }))
          .catch(() => ({
            sale: sale,
            items: [],
          }))
      );

      const itemsResults = await Promise.allSettled(itemsPromises);

      for (const result of itemsResults) {
        if (result.status === "fulfilled") {
          const { sale, items } = result.value;

          // Sale'ni items bilan saqlash
          await Sales.findOneAndUpdate(
            { id: sale.id },
            {
              $set: {
                ...sale,
                items: items,
                hasItems: items.length > 0,
                itemsLastUpdated: new Date(),
                doctorCode: sale.notes || null,
                date: new Date(sale.date),
              },
            },
            { upsert: true }
          );

          if (items.length > 0) {
            itemsFetched++;
          }
        }
      }

      console.log(
        `✅ Items: ${Math.min(i + BATCH_SIZE, salesToFetchItems.length)}/${
          salesToFetchItems.length
        } sale uchun olindi`
      );
    }

    // 6. Qolgan sales'larni yangilash (items'siz)
    const bulkOps = [];

    for (const sale of allSales) {
      if (!salesToFetchItems.find((s) => s.id === sale.id)) {
        bulkOps.push({
          updateOne: {
            filter: { id: sale.id },
            update: {
              $set: {
                ...sale,
                date: new Date(sale.date),
                doctorCode: sale.notes || null,
              },
            },
            upsert: true,
          },
        });
      }
    }

    if (bulkOps.length > 0) {
      await Sales.bulkWrite(bulkOps, { ordered: false });
    }

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    console.log(`🎉 Sales sinxronizatsiya tugadi!`);
    console.log(`   ⏱️ Vaqt: ${duration} sekund`);
    console.log(`   📊 Jami: ${allSales.length} sales`);
    console.log(`   ✅ Items olindi: ${itemsFetched}`);

    refreshStatus.stats.salesUpdated = allSales.length;
    refreshStatus.stats.itemsFetched = itemsFetched;

    return {
      updated: allSales.length,
      itemsFetched: itemsFetched,
      duration: duration,
    };
  } catch (error) {
    console.error("❌ Sales sinxronizatsiyada xato:", error.message);
    return { updated: 0, itemsFetched: 0 };
  }
};

// ASOSIY YANGILANISH FUNKSIYASI
const updateAllDataComplete = async () => {
  if (refreshStatus.isRunning) {
    console.log("⏳ Yangilanish allaqachon ishlamoqda...");
    return;
  }

  refreshStatus.isRunning = true;
  refreshStatus.currentTask = "Boshlash";
  refreshStatus.progress = 0;
  refreshStatus.errors = [];
  refreshStatus.stats = {
    remainsUpdated: 0,
    remainsDeleted: 0,
    salesUpdated: 0,
    itemsFetched: 0,
  };

  const totalStartTime = Date.now();

  try {
    console.log("\n🔥 TO'LIQ SINXRONIZATSIYA BOSHLANDI!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // 1. Login
    if (!token) {
      refreshStatus.currentTask = "Login";
      await login();
      if (!token) {
        throw new Error("Login amalga oshmadi");
      }
    }
    refreshStatus.progress = 10;

    // 2. PARALLEL sinxronizatsiya - Sales va Remains bir vaqtda
    refreshStatus.currentTask = "To'liq sinxronizatsiya";
    console.log("\n📊 Sales va Remains parallel sinxronlanmoqda...\n");

    const [salesResult, remainsResult] = await Promise.allSettled([
      syncSalesComplete(),
      syncRemainsComplete(),
    ]);

    refreshStatus.progress = 90;

    // 3. Natijalar
    const totalEndTime = Date.now();
    const totalDuration = Math.round((totalEndTime - totalStartTime) / 1000);

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🎉 SINXRONIZATSIYA MUVAFFAQIYATLI TUGADI!");
    console.log(`⏱️  Umumiy vaqt: ${totalDuration} sekund`);

    if (salesResult.status === "fulfilled") {
      console.log(
        `📊 Sales: ${salesResult.value.updated} ta (${salesResult.value.itemsFetched} items)`
      );
    }

    if (remainsResult.status === "fulfilled") {
      console.log(`📦 Remains o'chirildi: ${remainsResult.value.deleted} ta`);
      console.log(`📦 Remains qo'shildi: ${remainsResult.value.updated} ta`);
      console.log(`📦 MongoDB'da hozir: ${remainsResult.value.total} ta`);

      // Moslik tekshiruvi
      if (remainsResult.value.total === remainsResult.value.expected) {
        console.log(`✅ MA'LUMOTLAR TO'LIQ MOS KELADI!`);
      } else {
        console.error(
          `⚠️ FARQ BOR: Kutilgan ${remainsResult.value.expected}, Hozir ${remainsResult.value.total}`
        );
      }
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    refreshStatus.lastUpdate = new Date();
    refreshStatus.progress = 100;

    // 4. Low stock tekshiruvi (har soatda)
    const now = new Date();
    if (now.getMinutes() === 0) {
      refreshStatus.currentTask = "Low stock tekshiruvi";
      await checkLowStockAndNotify();
    }

    return {
      success: true,
      duration: totalDuration,
      stats: refreshStatus.stats,
    };
  } catch (error) {
    console.error("❌ Sinxronizatsiya xatosi:", error.message);
    refreshStatus.errors.push(`General error: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
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

// Database statistics
const getDatabaseStats = async () => {
  try {
    const [totalSales, salesWithItems, totalRemains, todaySales] =
      await Promise.all([
        Sales.countDocuments(),
        Sales.countDocuments({ hasItems: true }),
        Remains.countDocuments(),
        Sales.countDocuments({
          createdAt: {
            $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        }),
      ]);

    // Unique manufacturers
    const manufacturers = await Remains.distinct("manufacturer");

    return {
      sales: {
        total: totalSales,
        withItems: salesWithItems,
        withoutItems: totalSales - salesWithItems,
        today: todaySales,
      },
      remains: {
        total: totalRemains,
        manufacturers: manufacturers.length,
      },
    };
  } catch (error) {
    console.error("Database stats xato:", error);
    return null;
  }
};

// Manual triggers
const manualFullUpdate = () => {
  console.log("📌 Manual to'liq yangilanish so'raldi");
  updateAllDataComplete();
};

const stopRefresh = () => {
  refreshStatus.isRunning = false;
  console.log("🛑 Yangilanish to'xtatildi");
};

const getRefreshStatus = () => refreshStatus;

const getSystemStatus = async () => {
  const stats = await getDatabaseStats();

  return {
    refresh: refreshStatus,
    data: stats,
    lastUpdate: refreshStatus.lastUpdate,
  };
};

// CRON JOBS - Optimizatsiyalangan
// Har 10 daqiqada yangilanish
cron.schedule("*/10 * * * *", () => {
  console.log("\n⏰ Muntazam yangilanish (har 10 daqiqa)");
  updateAllDataComplete();
});

// Har soat boshida to'liq yangilanish (yangi token bilan)
cron.schedule("0 * * * *", () => {
  console.log("\n⏰ Soatlik to'liq yangilanish");
  token = null; // Yangi token olish
  updateAllDataComplete();
});

// Har kuni ertalab 6:00 da to'liq tozalash va yangilash
cron.schedule("0 6 * * *", async () => {
  console.log("\n🧹 Kunlik to'liq tozalash va yangilash...");

  try {
    // 30 kundan eski sales'larni o'chirish
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await Sales.deleteMany({
      createdAt: { $lt: thirtyDaysAgo },
    });

    console.log(`✅ ${result.deletedCount} ta eski sales o'chirildi`);

    // To'liq yangilash
    token = null;
    await updateAllDataComplete();
  } catch (error) {
    console.error("❌ Kunlik tozalashda xato:", error.message);
  }
});

// Real-time monitoring
setInterval(async () => {
  if (!refreshStatus.isRunning) {
    const stats = await getDatabaseStats();
    if (stats) {
      const time = new Date().toLocaleTimeString("uz-UZ");
      console.log(`\n📊 [${time}] TIZIM MONITORINGI:`);
      console.log(
        `   💊 Remains: ${stats.remains.total} ta (${stats.remains.manufacturers} ishlab chiqaruvchi)`
      );
      console.log(
        `   💰 Sales: ${stats.sales.total} ta (${stats.sales.withItems} items bilan)`
      );
      console.log(`   📅 Bugun: ${stats.sales.today} ta savdo`);

      // Xatolik bo'lsa ogohlantirish
      if (refreshStatus.errors.length > 0) {
        console.log(`   ⚠️ Xatolar: ${refreshStatus.errors.length} ta`);
      }
    }
  }
}, 300000); // Har 5 daqiqada

// Boshlang'ich ishga tushirish
setTimeout(() => {
  console.log("\n🚀 TIZIM ISHGA TUSHMOQDA...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 Oson Apteka Sync System v3.0");
  console.log("🔄 5 sekunddan keyin birinchi sinxronizatsiya...\n");

  setTimeout(async () => {
    console.log("🔥 Birinchi to'liq sinxronizatsiya boshlandi!");

    // Database statistikasi
    const stats = await getDatabaseStats();
    if (stats) {
      console.log(`\n📊 Joriy holat:`);
      console.log(`   Remains: ${stats.remains.total} ta`);
      console.log(`   Sales: ${stats.sales.total} ta\n`);
    }

    await updateAllDataComplete();
  }, 5000);
}, 3000);

// Export
export {
  updateAllDataComplete,
  syncRemainsComplete,
  syncSalesComplete,
  manualFullUpdate,
  stopRefresh,
  getRefreshStatus,
  getSystemStatus,
  getDatabaseStats,
  login,
};
