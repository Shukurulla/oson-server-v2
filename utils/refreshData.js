// utils/refreshData.js - Professional aniqlik bilan tuzatilgan versiya (items fetching olib tashlandi + backfill funksiyasi qo'shildi + boshlang'ich backfill)
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
  },
};

// Login
const login = async () => {
  try {
    console.log("🔐 Login qilinmoqda...");
    const response = await axios.post(
      "http://osonkassa.uz/api/auth/login",
      {
        userName: "Admin",
        password: "0000",
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

export const getSalesItems = async (saleId) => {
  try {
    // Login qilish agar token yo'q bo'lsa
    if (!token) {
      await login();
      if (!token) {
        console.error("❌ Token olish imkoni bo'lmadi");
        return [];
      }
    }

    const response = await axios.post(
      "https://osonkassa.uz/api/pos/sales/items/get",
      { saleId: saleId, pageNumber: 1, pageSize: 1000 },
      {
        headers: { authorization: `Bearer ${token}` },
        timeout: 20000,
      }
    );

    return response.data.page.items;
  } catch (error) {
    console.error(`❌ Sale items olishda xato (ID: ${saleId}):`, error.message);

    // Agar 401 xato bo'lsa, tokenni tozalash
    if (error.response?.status === 401) {
      token = null;
    }

    return [];
  }
};

export const getSuppliers = async () => {
  try {
    await login();
    const { data } = await axios.get(
      "https://osonkassa.uz/api/purchase/suppliers",
      {
        headers: { authorization: `Bearer ${token}` },
        timeout: 20000,
      }
    );
    return data.items;
  } catch (error) {
    console.error(`❌ Suppliers olishda xato:`, error.message);
    return [];
  }
};

export const getRemainsBySupplier = async (supplierId) => {
  try {
    await login();
    const { data } = await axios.post(
      "https://osonkassa.uz/api/report/inventory/remains",
      {
        pageNumber: 1,
        pageSize: 1000,
        supplierIds: [supplierId],
        searchText: "",
        manufacturerIds: [],
        onlyActiveItems: true,
        sortOrders: [{ property: "product", direction: "asc" }],
        supplyDateFrom: "",
      },
      {
        headers: { authorization: `Bearer ${token}` },
        timeout: 20000,
      }
    );

    return data.page.items;
  } catch (error) {
    console.error(
      `❌ Remains olishda xato (Supplier ID: ${supplierId}):`,
      error.message
    );
    return [];
  }
};

const fetchSalesIds = async (dateFrom, dateTo) => {
  try {
    // Birinchi sahifani olib jami count ni aniqlash
    const firstResponse = await axios.post(
      "http://osonkassa.uz/api/pos/sales/get",
      {
        dateFrom: dateFrom,
        dateTo: dateTo,
        deletedFilter: 1, // Faqat o'chirilmagan sales'lar
        pageNumber: 1,
        pageSize: 1,
        searchText: "",
        sortOrders: [{ property: "date", direction: "desc" }],
      },
      {
        headers: { authorization: `Bearer ${token}` },
        timeout: 10000,
      }
    );

    const totalCount = firstResponse.data.page.totalCount || 0;

    if (totalCount === 0) {
      console.log(
        `📊 ${dateFrom} dan ${dateTo} gacha gacha hech qanday savdo yo'q`
      );
      return [];
    }

    console.log(
      `📊 ${dateFrom} dan ${dateTo} gacha jami ${totalCount} ta savdo topildi`
    );

    // Barcha sales'larni olish - optimized (katta pageSize uchun tezlik)
    const pageSize = 1000; // Optimal tezlik uchun kattaroq
    const totalPages = Math.ceil(totalCount / pageSize);
    const allSales = [];
    const PARALLEL_PAGES = 5; // Parallel so'rovlarni ko'paytirish tezlik uchun

    for (let i = 0; i < totalPages; i += PARALLEL_PAGES) {
      const pagePromises = [];

      for (let j = i; j < Math.min(i + PARALLEL_PAGES, totalPages); j++) {
        pagePromises.push(
          axios.post(
            "http://osonkassa.uz/api/pos/sales/get",
            {
              dateFrom: dateFrom,
              dateTo: dateTo,
              deletedFilter: 1,
              pageNumber: j + 1,
              pageSize: pageSize,
              searchText: "",
              sortOrders: [{ property: "date", direction: "desc" }],
            },
            {
              headers: { authorization: `Bearer ${token}` },
              timeout: 20000, // Timeoutni ko'paytirish
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

          // Sales ma'lumotlarini tozalash va tekshirish
          const cleanedItems = items.filter((item) => {
            if (!item || !item.id) {
              console.warn("⚠️ ID'siz sale topildi:", item);
              return false;
            }
            return true;
          });

          allSales.push(...cleanedItems);
        } else if (response.status === "rejected") {
          console.error(
            `❌ Sales sahifasini olishda xato:`,
            response.reason.message
          );
        }
      }

      console.log(
        `✅ Sales pages: ${Math.min(
          i + PARALLEL_PAGES,
          totalPages
        )}/${totalPages} olindi (${allSales.length}/${totalCount})`
      );

      // Sahifalar orasida qisqa kutish (rate limit uchun)
      if (i + PARALLEL_PAGES < totalPages) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // DUPLICATE CHECK: ID bo'yicha unikal qilish
    const uniqueSalesMap = new Map();
    for (const sale of allSales) {
      if (sale.id && !uniqueSalesMap.has(sale.id)) {
        uniqueSalesMap.set(sale.id, sale);
      }
    }

    const uniqueSales = Array.from(uniqueSalesMap.values());

    console.log(
      `📊 ${dateFrom} dan ${dateTo} gacha jami ${allSales.length} ta sales olindi`
    );
    console.log(`🔍 ${uniqueSales.length} ta unikal sales aniqlandi`);

    if (allSales.length !== uniqueSales.length) {
      console.warn(
        `⚠️ ${
          allSales.length - uniqueSales.length
        } ta duplicate sales o'chirildi`
      );
    }

    return uniqueSales;
  } catch (error) {
    console.error("❌ Sales ma'lumotlarini olishda xato:", error.message);
    if (error.response?.status === 401) {
      console.log("🔑 Token eskirgan, qayta login kerak");
      token = null;
    }
    return [];
  }
};

// YANGILANGAN: Sales ma'lumotlarini to'g'ridan-to'g'ri bazaga saqlash (items'siz, optimal batch)
const saveSalesDirectly = async (sales) => {
  try {
    if (!sales || sales.length === 0) {
      console.log("📊 Saqlash uchun sales yo'q");
      return { updated: 0 };
    }

    console.log(`💾 ${sales.length} ta sale to'g'ridan-to'g'ri saqlanmoqda`);

    // Barcha sales'larni bulk update/insert (optimal uchun katta batch)
    const BATCH_SIZE = 10000; // Katta batch tezlik uchun
    let totalUpdated = 0;

    for (let i = 0; i < sales.length; i += BATCH_SIZE) {
      const batchSales = sales.slice(i, i + BATCH_SIZE);
      const bulkOps = batchSales.map((sale) => ({
        updateOne: {
          filter: { id: sale.id },
          update: {
            $set: {
              ...sale,
              date: new Date(sale.date),
              doctorCode: sale.notes || null,
              lastUpdated: new Date(),
              isNotified: false,
            },
          },
          upsert: true,
        },
      }));

      const result = await Sales.bulkWrite(bulkOps, {
        ordered: false,
      });

      totalUpdated += result.upsertedCount + result.modifiedCount;

      console.log(
        `💾 Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${
          result.upsertedCount
        } yangi + ${result.modifiedCount} yangilandi`
      );
    }

    // Yakuniy tekshiruv
    const finalCount = await Sales.countDocuments({
      id: { $in: sales.map((s) => s.id) },
    });
    console.log(`🔍 Saqlangan: ${finalCount} ta (kutilgan: ${sales.length})`);

    return { updated: totalUpdated };
  } catch (error) {
    console.error("❌ Sales saqlashda xato:", error.message);
    return { updated: 0 };
  }
};

// YANGI: Sana parametri bilan Sales sinxronizatsiya (items'siz, dateTo qo'shildi, null handling tuzatildi)
const syncSalesWithDate = async (customDate = null) => {
  try {
    // Sana aniqlash
    let dateFrom;
    if (customDate && customDate.trim() !== "") {
      // Custom sana formatini tekshirish va to'g'rilash
      const dateRegex = /^\d{4}[-\.]\d{2}[-\.]\d{2}$/;
      if (dateRegex.test(customDate)) {
        dateFrom = customDate.replace(/\./g, "-"); // Nuqtalarni tire bilan almashtirish
        console.log(`📅 Tanlangan sana: ${dateFrom}`);
      } else {
        console.error(
          `❌ Noto'g'ri sana formati: ${customDate}. YYYY-MM-DD formatini ishlating`
        );
        return { updated: 0, error: "Invalid date format" };
      }
    } else {
      // Bugungi sana
      dateFrom = new Date().toISOString().split("T")[0];
      console.log(`📅 Bugungi sana: ${dateFrom}`);
    }

    // dateTo ni kun oxiri qilish
    let finalDateTo = new Date(dateFrom);
    finalDateTo.setHours(23, 59, 59, 999);
    finalDateTo = finalDateTo.toISOString().slice(0, -1); // Millisekundlarni olib tashlash

    const startTime = Date.now();

    console.log(
      `\n🔄 Sales sinxronizatsiya boshlandi - ${dateFrom} dan ${finalDateTo} gacha`
    );
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // 1. Sales ma'lumotlarini olish
    const sales = await fetchSalesIds(dateFrom, finalDateTo);

    if (sales.length === 0) {
      console.log(`📊 ${dateFrom} dan ${finalDateTo} gacha sales topilmadi`);
      return { updated: 0, dateFrom, dateTo: finalDateTo };
    }

    // 2. To'g'ridan-to'g'ri saqlash
    const result = await saveSalesDirectly(sales);

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    console.log(
      `\n🎉 Sales sinxronizatsiya tugadi! (${dateFrom} - ${finalDateTo})`
    );
    console.log(`   ⏱️ Vaqt: ${duration} sekund`);
    console.log(`   📊 Jami sales: ${sales.length}`);
    console.log(`   ✅ Yangilangan: ${result.updated}`);

    refreshStatus.stats.salesUpdated = result.updated;

    return {
      updated: result.updated,
      totalSales: sales.length,
      duration: duration,
      dateFrom,
      dateTo: finalDateTo,
    };
  } catch (error) {
    console.error("❌ Sales sinxronizatsiyada xato:", error.message);
    return { updated: 0, error: error.message };
  }
};

// YANGI: Backfill funksiyasi - 01.09.2025 dan hozirgi kungacha kunlik yuklash
// const backfillSalesFromDateRange = async (
//   startDate = "2025-09-01",
//   endDate = null
// ) => {
//   if (refreshStatus.isRunning) {
//     console.log("⏳ Backfill allaqachon ishlamoqda...");
//     return;
//   }

//   refreshStatus.isRunning = true;
//   refreshStatus.currentTask = "Backfill boshlandi";
//   refreshStatus.progress = 0;
//   refreshStatus.errors = [];

//   const startTime = Date.now();

//   try {
//     console.log("\n🔥 OLINGI MALUMOTLAR BACKFILL BOSHLANDI!");
//     console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

//     // End date ni aniqlash (agar berilmagan bo'lsa, bugungi kun)
//     let finalEndDate = endDate;
//     if (!finalEndDate) {
//       finalEndDate = new Date().toISOString().split("T")[0];
//     }

//     // Kunlarni hisoblash
//     const start = new Date(startDate);
//     const end = new Date(finalEndDate);
//     const dates = [];
//     for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
//       dates.push(new Date(d).toISOString().split("T")[0]);
//     }

//     console.log(
//       `📅 Backfill kunlari: ${startDate} dan ${finalEndDate} gacha (${dates.length} kun)`
//     );

//     let totalUpdated = 0;
//     let processedDays = 0;

//     // Sequential yuklash (rate limit uchun), lekin har kun ichida parallel
//     for (const date of dates) {
//       refreshStatus.currentTask = `Backfill: ${date}`;
//       refreshStatus.progress = Math.round((processedDays / dates.length) * 100);

//       // Token tekshirish
//       if (!token) {
//         await login();
//         if (!token) {
//           throw new Error("Login amalga oshmadi");
//         }
//       }

//       const result = await syncSalesWithDate(date);

//       if (result.updated > 0) {
//         totalUpdated += result.updated;
//         console.log(`✅ ${date}: ${result.updated} ta yangilandi`);
//       } else {
//         console.log(`📭 ${date}: Yangi ma'lumot yo'q`);
//       }

//       processedDays++;

//       // Kunlar orasida qisqa kutish (optimal)
//       if (processedDays < dates.length) {
//         await new Promise((resolve) => setTimeout(resolve, 500));
//       }
//     }

//     const endTime = Date.now();
//     const duration = Math.round((endTime - startTime) / 1000);

//     console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
//     console.log("🎉 BACKFILL MUVAFFAQIYATLI TUGADI!");
//     console.log(`⏱️  Umumiy vaqt: ${duration} sekund`);
//     console.log(`📊 Jami yangilangan sales: ${totalUpdated} ta`);
//     console.log(`📅 Qamrab olingan kunlar: ${dates.length} ta`);

//     refreshStatus.lastUpdate = new Date();
//     refreshStatus.progress = 100;

//     return {
//       success: true,
//       duration: duration,
//       totalUpdated: totalUpdated,
//       daysProcessed: dates.length,
//     };
//   } catch (error) {
//     console.error("❌ Backfill xatosi:", error.message);
//     refreshStatus.errors.push(`Backfill error: ${error.message}`);
//     return {
//       success: false,
//       error: error.message,
//     };
//   } finally {
//     refreshStatus.isRunning = false;
//     refreshStatus.currentTask = null;
//     refreshStatus.progress = 0;
//   }
// };

// ASOSIY YANGILANUSH FUNKSIYASI - sana parametri bilan
const updateAllDataComplete = async (customDate = null) => {
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
      syncSalesWithDate(customDate), // YANGI: sana parametri bilan
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
        `📊 Sales (${salesResult.value.dateFrom}): ${salesResult.value.updated} ta`
      );
    } else {
      console.error(`❌ Sales xatosi: ${salesResult.reason}`);
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
    } else {
      console.error(`❌ Remains xatosi: ${remainsResult.reason}`);
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
      salesDate:
        salesResult.status === "fulfilled" ? salesResult.value.dateFrom : null,
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

// Database statistics (items'siz yangilangan)
const getDatabaseStats = async () => {
  try {
    const [totalSales, totalRemains, todaySales] = await Promise.all([
      Sales.countDocuments(),
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

// YANGI: Manual triggers sana parametri bilan
const manualFullUpdate = (customDate = null) => {
  console.log(
    `📌 Manual to'liq yangilanish so'raldi${
      customDate ? ` - sana: ${customDate}` : ""
    }`
  );
  updateAllDataComplete(customDate);
};

// YANGI: Faqat sales yangilash funktsiyasi (items'siz)
const manualSalesUpdate = (customDate = null) => {
  console.log(
    `📌 Manual sales yangilanish so'raldi${
      customDate ? ` - sana: ${customDate}` : ""
    }`
  );

  if (refreshStatus.isRunning) {
    console.log("⏳ Boshqa yangilanish ishlamoqda...");
    return;
  }

  // Login qilish va sales yangilash
  (async () => {
    try {
      if (!token) {
        await login();
        if (!token) {
          console.error("❌ Login amalga oshmadi");
          return;
        }
      }

      refreshStatus.isRunning = true;
      refreshStatus.currentTask = "Sales yangilanishi";

      const result = await syncSalesWithDate(customDate);

      console.log(
        `✅ Sales yangilanishi tugadi: ${result.updated} ta yangilandi`
      );
    } catch (error) {
      console.error("❌ Manual sales yangilanishida xato:", error.message);
    } finally {
      refreshStatus.isRunning = false;
      refreshStatus.currentTask = null;
    }
  })();
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

// CRON JOB - Har kuni 00:00 da yangilanish
cron.schedule("0 0 * * *", async () => {
  console.log("\n🌙 TUNGI YANGILANISH BOSHLANDI (00:00)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    // Token yangilash
    token = null;

    // To'liq sinxronizatsiya
    await updateAllDataComplete();

    console.log("✅ Tungi yangilanish muvaffaqiyatli yakunlandi");
  } catch (error) {
    console.error("❌ Tungi yangilanishda xato:", error.message);
  }
});

// Real-time monitoring (items'siz yangilangan)
setInterval(async () => {
  if (!refreshStatus.isRunning) {
    const stats = await getDatabaseStats();
    if (stats) {
      const time = new Date().toLocaleTimeString("uz-UZ");
      console.log(`\n📊 [${time}] TIZIM MONITORINGI:`);
      console.log(
        `   💊 Remains: ${stats.remains.total} ta (${stats.remains.manufacturers} ishlab chiqaruvchi)`
      );
      console.log(`   💰 Sales: ${stats.sales.total} ta`);
      console.log(`   📅 Bugun: ${stats.sales.today} ta savdo`);

      // Xatolik bo'lsa ogohlantirish
      if (refreshStatus.errors.length > 0) {
        console.log(`   ⚠️ Xatolar: ${refreshStatus.errors.length} ta`);
      }
    }
  }
}, 300000); // Har 5 daqiqada

// Boshlang'ich ishga tushirish - Backfill bilan
setTimeout(() => {
  console.log("\n🚀 TIZIM ISHGA TUSHMOQDA...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 Oson Apteka Sync System v4.0 - PROFESSIONAL");
  console.log("🔄 5 sekunddan keyin backfill va sinxronizatsiya...\n");

  setTimeout(async () => {
    console.log("🔥 Birinchi backfill va to'liq sinxronizatsiya boshlandi!");

    // Database statistikasi
    const stats = await getDatabaseStats();
    if (stats) {
      console.log(`\n📊 Joriy holat:`);
      console.log(`   Remains: ${stats.remains.total} ta`);
      console.log(`   Sales: ${stats.sales.total} ta\n`);
    }

    // Keyin bugungi sinxronizatsiya
    await updateAllDataComplete();
  }, 5000);
}, 3000);

// Export
export {
  updateAllDataComplete,
  syncRemainsComplete,
  syncSalesWithDate, // YANGI: Backfill funksiyasi
  manualFullUpdate,
  manualSalesUpdate, // YANGI
  stopRefresh,
  getRefreshStatus,
  getSystemStatus,
  getDatabaseStats,
  login,
};
