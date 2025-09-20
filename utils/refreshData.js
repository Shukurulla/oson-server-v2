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

const fetchSalesIds = async (dateFrom) => {
  try {
    console.log(`📊 Sales ID'larni olish boshlandi - ${dateFrom} dan boshlab`);

    // Birinchi sahifani olib jami count ni aniqlash
    const firstResponse = await axios.post(
      "http://osonkassa.uz/api/pos/sales/get",
      {
        dateFrom: dateFrom,
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
      console.log(`📊 ${dateFrom} dan boshlab hech qanday savdo yo'q`);
      return [];
    }

    console.log(
      `📊 ${dateFrom} dan boshlab jami ${totalCount} ta savdo topildi`
    );

    // Barcha sales'larni olish - optimized
    const pageSize = 200; // Kichikroq sahifa o'lchami - barqarorlik uchun
    const totalPages = Math.ceil(totalCount / pageSize);
    const allSales = [];
    const PARALLEL_PAGES = 2; // Kamroq parallel so'rov

    for (let i = 0; i < totalPages; i += PARALLEL_PAGES) {
      const pagePromises = [];

      for (let j = i; j < Math.min(i + PARALLEL_PAGES, totalPages); j++) {
        pagePromises.push(
          axios.post(
            "http://osonkassa.uz/api/pos/sales/get",
            {
              dateFrom: dateFrom,
              deletedFilter: 1,
              pageNumber: j + 1,
              pageSize: pageSize,
              searchText: "",
              sortOrders: [{ property: "date", direction: "desc" }],
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

      // Sahifalar orasida biroz kutish
      if (i + PARALLEL_PAGES < totalPages) {
        await new Promise((resolve) => setTimeout(resolve, 300));
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
      `📊 ${dateFrom} dan boshlab jami ${allSales.length} ta sales olindi`
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
    console.error("❌ Sales ID'larni olishda xato:", error.message);
    if (error.response?.status === 401) {
      console.log("🔑 Token eskirgan, qayta login kerak");
      token = null;
    }
    return [];
  }
};

// PROFESSIONAL: Items olish va to'g'ri bog'lash
const fetchSalesItemsAccurately = async (sales) => {
  try {
    if (!sales || sales.length === 0) {
      console.log("📊 Items olish uchun sales yo'q");
      return { updated: 0, itemsFetched: 0 };
    }

    console.log(`📋 ${sales.length} ta sale uchun items olish boshlandi`);

    // Bazadagi mavjud sales'larni tekshirish
    const salesIds = sales.map((sale) => sale.id);
    const existingSales = await Sales.find(
      { id: { $in: salesIds } },
      { id: 1, hasItems: 1, itemsLastUpdated: 1, itemsCount: 1 }
    );

    const existingSalesMap = new Map(existingSales.map((s) => [s.id, s]));

    // Items kerak bo'lgan sales'larni aniqlash
    const salesToFetchItems = [];
    const salesToUpdateWithoutItems = [];

    for (const sale of sales) {
      const existing = existingSalesMap.get(sale.id);

      // ANIQ SHART: Items yo'q yoki 2 soatdan eski bo'lsa
      const needsItems =
        !existing ||
        !existing.hasItems ||
        (existing.itemsLastUpdated &&
          Date.now() - new Date(existing.itemsLastUpdated).getTime() >
            2 * 60 * 60 * 1000);

      if (needsItems) {
        salesToFetchItems.push(sale);
      } else {
        salesToUpdateWithoutItems.push(sale);
      }
    }

    console.log(`🔍 Items olish kerak: ${salesToFetchItems.length} ta`);
    console.log(
      `📝 Faqat yangilash kerak: ${salesToUpdateWithoutItems.length} ta`
    );

    let itemsFetched = 0;
    let totalUpdated = 0;

    // 1. ASOSIY MA'LUMOTLARNI YANGILASH (items'siz)
    if (salesToUpdateWithoutItems.length > 0) {
      const bulkOpsBasic = salesToUpdateWithoutItems.map((sale) => ({
        updateOne: {
          filter: { id: sale.id },
          update: {
            $set: {
              ...sale,
              date: new Date(sale.date),
              doctorCode: sale.notes || null,
              lastUpdated: new Date(),
            },
          },
          upsert: true,
        },
      }));

      try {
        const basicResult = await Sales.bulkWrite(bulkOpsBasic, {
          ordered: false,
        });
        totalUpdated += basicResult.upsertedCount + basicResult.modifiedCount;
        console.log(
          `✅ ${salesToUpdateWithoutItems.length} ta sale asosiy ma'lumotlari yangilandi`
        );
      } catch (error) {
        console.error(
          "⚠️ Asosiy ma'lumotlar yangilanishida xato:",
          error.message
        );
      }
    }

    // 2. ITEMS BILAN YANGILASH - ANIQ VA XAVFSIZ
    if (salesToFetchItems.length > 0) {
      const BATCH_SIZE = 3; // Kichikroq batch - aniqlik uchun

      for (let i = 0; i < salesToFetchItems.length; i += BATCH_SIZE) {
        const batch = salesToFetchItems.slice(i, i + BATCH_SIZE);

        console.log(
          `📋 Items batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
            salesToFetchItems.length / BATCH_SIZE
          )} ishlanmoqda...`
        );

        // HAR BIR SALE NI ALOHIDA VA ANIQ ISHLAB CHIQISH
        for (const sale of batch) {
          try {
            console.log(
              `🔍 Sale ${sale.number} (ID: ${sale.id}) uchun items olinyapdi...`
            );

            // ANIQ SALE UCHUN ITEMS SO'ROVI
            const itemsResponse = await axios.post(
              "http://osonkassa.uz/api/pos/sales/items/get",
              {
                saleId: sale.id, // FAQAT ANIQ SALE ID
              },
              {
                headers: { authorization: `Bearer ${token}` },
                timeout: 10000,
              }
            );

            const responseItems = itemsResponse.data?.page?.items || [];

            // CRITICAL: Items ning sale bilan bog'liqligini ANIQ tekshirish
            const validItems = responseItems.filter((item) => {
              // Item mavjudligini va asosiy maydonlarini tekshirish
              if (!item || typeof item !== "object") {
                return false;
              }

              // Item ning asosiy maydonlari mavjudligini tekshirish
              const hasRequiredFields =
                item.id && (item.productId || item.productName || item.product);

              if (!hasRequiredFields) {
                console.warn(
                  `⚠️ Sale ${sale.number}: Item'da yetarli ma'lumot yo'q`,
                  item
                );
                return false;
              }

              return true;
            });

            console.log(
              `📦 Sale ${sale.number}: ${responseItems.length} ta raw item, ${validItems.length} ta valid item`
            );

            // DETAILED LOGGING
            if (validItems.length > 0) {
              console.log(
                `✅ Sale ${sale.number} uchun ${validItems.length} ta item aniqlandi`
              );
              // Birinchi item'ning strukturasini ko'rsatish
              const firstItem = validItems[0];
              console.log(
                `📝 Birinchi item: Product=${
                  firstItem.productName || firstItem.product || "N/A"
                }, Qty=${firstItem.quantity || "N/A"}`
              );
            } else {
              console.log(
                `📭 Sale ${sale.number} uchun hech qanday valid item topilmadi`
              );
            }

            // MA'LUMOTLARNI BAZAGA ANIQ SAQLASH
            const updateData = {
              // Sale asosiy ma'lumotlari
              ...sale,
              date: new Date(sale.date),
              doctorCode: sale.notes || null,

              // Items ma'lumotlari - ANIQ
              items: validItems,
              hasItems: validItems.length > 0,
              itemsCount: validItems.length,
              itemsLastUpdated: new Date(),

              // Metadata
              lastUpdated: new Date(),
              isNotified: false,
            };

            const savedSale = await Sales.findOneAndUpdate(
              { id: sale.id },
              { $set: updateData },
              {
                upsert: true,
                new: true,
              }
            );

            // VERIFICATION: Saqlangan ma'lumotni tekshirish
            if (savedSale) {
              console.log(
                `💾 Sale ${sale.number} saqlandi: ${
                  savedSale.items?.length || 0
                } ta item`
              );

              if (savedSale.items?.length !== validItems.length) {
                console.error(
                  `❌ XATO! Sale ${sale.number}: Kutilgan ${validItems.length}, Saqlangan ${savedSale.items?.length}`
                );
              }
            }

            if (validItems.length > 0) {
              itemsFetched++;
            }

            totalUpdated++;

            // API ni yuklamamaslik uchun biroz kutish
            await new Promise((resolve) => setTimeout(resolve, 200));
          } catch (saleError) {
            console.error(
              `❌ Sale ${sale.number} (ID: ${sale.id}) ishlab chiqishda xato:`,
              saleError.message
            );

            // Sale'ni items'siz saqlash (xato bo'lsa ham asosiy ma'lumot saqlansin)
            try {
              await Sales.findOneAndUpdate(
                { id: sale.id },
                {
                  $set: {
                    ...sale,
                    date: new Date(sale.date),
                    doctorCode: sale.notes || null,
                    items: [],
                    hasItems: false,
                    itemsCount: 0,
                    itemsLastUpdated: new Date(),
                    lastUpdated: new Date(),
                    errorMessage: saleError.message,
                  },
                },
                { upsert: true }
              );

              totalUpdated++;
              console.log(`📝 Sale ${sale.number} items'siz saqlandi`);
            } catch (fallbackError) {
              console.error(
                `❌ Sale ${sale.number} fallback saqlashda ham xato:`,
                fallbackError.message
              );
            }
          }
        }

        // Batch orasida biroz uzunroq kutish
        if (i + BATCH_SIZE < salesToFetchItems.length) {
          console.log("⏳ Keyingi batch uchun kutilmoqda...");
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    // 3. FINAL VERIFICATION
    console.log("\n🔍 Yakuniy tekshiruv...");

    const finalStats = await Sales.aggregate([
      { $match: { id: { $in: salesIds } } },
      {
        $group: {
          _id: null,
          totalSales: { $sum: 1 },
          salesWithItems: {
            $sum: { $cond: [{ $gt: ["$itemsCount", 0] }, 1, 0] },
          },
          totalItems: { $sum: "$itemsCount" },
        },
      },
    ]);

    const stats = finalStats[0] || {
      totalSales: 0,
      salesWithItems: 0,
      totalItems: 0,
    };

    console.log(`\n✅ Sales Items sinxronizatsiya tugadi!`);
    console.log(`   📊 Jami yangilangan: ${totalUpdated} ta sale`);
    console.log(`   📦 Items bilan: ${stats.salesWithItems} ta sale`);
    console.log(`   🛍️ Jami items: ${stats.totalItems} ta`);
    console.log(
      `   📝 Items'siz: ${stats.totalSales - stats.salesWithItems} ta sale`
    );

    return {
      updated: totalUpdated,
      itemsFetched: stats.salesWithItems,
      totalItems: stats.totalItems,
    };
  } catch (error) {
    console.error("❌ Sales Items sinxronizatsiyasida xato:", error.message);
    return { updated: 0, itemsFetched: 0 };
  }
};

// YANGI: Sana parametri bilan Sales sinxronizatsiya
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
        return { updated: 0, itemsFetched: 0, error: "Invalid date format" };
      }
    } else {
      // Bugungi sana
      dateFrom = new Date().toISOString().split("T")[0];
      console.log(`📅 Bugungi sana: ${dateFrom}`);
    }

    const startTime = Date.now();

    console.log(`\n🔄 Sales sinxronizatsiya boshlandi - ${dateFrom}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // 1. Sales ID'larini olish
    const sales = await fetchSalesIds(dateFrom);

    if (sales.length === 0) {
      console.log(`📊 ${dateFrom} sanasida sales topilmadi`);
      return { updated: 0, itemsFetched: 0, date: dateFrom };
    }

    // 2. Items bilan professional sinxronizatsiya
    const result = await fetchSalesItemsAccurately(sales);

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    console.log(`\n🎉 Sales sinxronizatsiya tugadi! (${dateFrom})`);
    console.log(`   ⏱️ Vaqt: ${duration} sekund`);
    console.log(`   📊 Jami sales: ${sales.length}`);
    console.log(`   ✅ Yangilangan: ${result.updated}`);
    console.log(`   📦 Items olindi: ${result.itemsFetched}`);

    refreshStatus.stats.salesUpdated = result.updated;
    refreshStatus.stats.itemsFetched = result.itemsFetched;

    return {
      updated: result.updated,
      itemsFetched: result.itemsFetched,
      totalSales: sales.length,
      duration: duration,
      date: dateFrom,
    };
  } catch (error) {
    console.error("❌ Sales sinxronizatsiyada xato:", error.message);
    return { updated: 0, itemsFetched: 0, error: error.message };
  }
};

// ASOSIY YANGILANISH FUNKSIYASI - sana parametri bilan
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
        `📊 Sales (${salesResult.value.date}): ${salesResult.value.updated} ta (${salesResult.value.itemsFetched} items)`
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
        salesResult.status === "fulfilled" ? salesResult.value.date : null,
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

// YANGI: Manual triggers sana parametri bilan
const manualFullUpdate = (customDate = null) => {
  console.log(
    `📌 Manual to'liq yangilanish so'raldi${
      customDate ? ` - sana: ${customDate}` : ""
    }`
  );
  updateAllDataComplete(customDate);
};

// YANGI: Faqat sales yangilash funktsiyasi
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

// CRON JOBS - Optimizatsiyalangan
// Har 10 daqiqada yangilanish (bugungi sana bilan)
cron.schedule("*/10 * * * *", () => {
  console.log("\n⏰ Muntazam yangilanish (har 10 daqiqa)");
  updateAllDataComplete(); // Bugungi sana bilan
});

// Har soat boshida to'liq yangilanish (yangi token bilan)
cron.schedule("0 * * * *", () => {
  console.log("\n⏰ Soatlik to'liq yangilanish");
  token = null; // Yangi token olish
  updateAllDataComplete(); // Bugungi sana bilan
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
    await updateAllDataComplete(); // Bugungi sana bilan
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
  console.log("📊 Oson Apteka Sync System v4.0 - PROFESSIONAL");
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

    await updateAllDataComplete(); // Bugungi sana bilan
  }, 5000);
}, 3000);

// Export
export {
  updateAllDataComplete,
  syncRemainsComplete,
  syncSalesWithDate,
  manualFullUpdate,
  manualSalesUpdate, // YANGI
  stopRefresh,
  getRefreshStatus,
  getSystemStatus,
  getDatabaseStats,
  login,
};
