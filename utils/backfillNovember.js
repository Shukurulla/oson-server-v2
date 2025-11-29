// backfillNovember.js - Noyabr 1-dan bugungi kungacha salelarni yuklash
import axios from "axios";
import mongoose from "mongoose";
import Sales from "../models/Sales.js";
import dotenv from "dotenv";

dotenv.config();

let token = null;

// MongoDB ulanish
const connectDB = async () => {
  try {
    const mongoURI =
      process.env.MONGODB_URI || "mongodb://localhost:27017/oson-apteka";
    await mongoose.connect(mongoURI);
    console.log("✅ MongoDB'ga ulandi");
  } catch (error) {
    console.error("❌ MongoDB ulanish xatosi:", error.message);
    process.exit(1);
  }
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
    return null;
  }
};

// Bir kunlik sales olish
const fetchSalesForDate = async (dateFrom, dateTo) => {
  try {
    // Birinchi sahifa - jami sonini bilish uchun
    const firstResponse = await axios.post(
      "http://osonkassa.uz/api/pos/sales/get",
      {
        dateFrom: dateFrom,
        dateTo: dateTo,
        deletedFilter: 1,
        pageNumber: 1,
        pageSize: 1,
        searchText: "",
        sortOrders: [{ property: "date", direction: "desc" }],
      },
      {
        headers: { authorization: `Bearer ${token}` },
        timeout: 15000,
      }
    );

    const totalCount = firstResponse.data.page.totalCount || 0;

    if (totalCount === 0) {
      return [];
    }

    console.log(`   📊 ${dateFrom}: ${totalCount} ta sale topildi`);

    // Barcha saleslarni olish
    const pageSize = 500;
    const totalPages = Math.ceil(totalCount / pageSize);
    const allSales = [];
    const PARALLEL_PAGES = 3;

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
          allSales.push(...response.value.data.page.items);
        }
      }
    }

    return allSales;
  } catch (error) {
    console.error(`   ❌ ${dateFrom} uchun xato:`, error.message);
    if (error.response?.status === 401) {
      token = null;
    }
    return [];
  }
};

// Saleslarni saqlash
const saveSales = async (sales) => {
  if (!sales || sales.length === 0) return 0;

  const bulkOps = sales.map((sale) => ({
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

  try {
    const result = await Sales.bulkWrite(bulkOps, { ordered: false });
    return result.upsertedCount + result.modifiedCount;
  } catch (error) {
    console.error("   ❌ Saqlashda xato:", error.message);
    return 0;
  }
};

// Asosiy backfill funksiyasi
const backfillFromNovember = async () => {
  console.log("\n🚀 NOYABRDAN BUGUNGI KUNGACHA BACKFILL BOSHLANDI");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const startTime = Date.now();

  // 2025-yil 7-noyabrdan bugungi kungacha kunlar
  const startDate = new Date("2025-11-07");
  const endDate = new Date();
  const dates = [];

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d).toISOString().split("T")[0]);
  }

  console.log(`📅 ${dates.length} kun yuklanadi: ${dates[0]} dan ${dates[dates.length - 1]} gacha\n`);

  let totalSales = 0;
  let totalSaved = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const dateFrom = date;
    const dateTo = date + "T23:59:59.9999999";

    // Token tekshirish
    if (!token) {
      await login();
      if (!token) {
        console.error("❌ Login amalga oshmadi, 5 sekund kutilmoqda...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await login();
        if (!token) {
          console.error("❌ Login hali ham amalga oshmadi, o'tkazib yuborilmoqda");
          continue;
        }
      }
    }

    // Progress
    const progress = Math.round(((i + 1) / dates.length) * 100);
    process.stdout.write(`\r[${progress}%] ${date} yuklanmoqda...                    `);

    // Saleslarni olish
    const sales = await fetchSalesForDate(dateFrom, dateTo);
    totalSales += sales.length;

    // Saqlash
    if (sales.length > 0) {
      const saved = await saveSales(sales);
      totalSaved += saved;
      console.log(`\n   ✅ ${date}: ${sales.length} ta sale, ${saved} ta saqlandi`);
    }

    // Rate limit uchun kutish
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const endTime = Date.now();
  const duration = Math.round((endTime - startTime) / 1000);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎉 BACKFILL MUVAFFAQIYATLI TUGADI!");
  console.log(`⏱️  Umumiy vaqt: ${duration} sekund`);
  console.log(`📊 Jami olindi: ${totalSales} ta sale`);
  console.log(`💾 Jami saqlandi: ${totalSaved} ta`);
  console.log(`📅 Kunlar soni: ${dates.length} ta`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
};

// Scriptni ishga tushirish
const main = async () => {
  try {
    await connectDB();
    await login();

    if (!token) {
      console.error("❌ Login amalga oshmadi. Script to'xtatildi.");
      process.exit(1);
    }

    await backfillFromNovember();

    console.log("✅ Script muvaffaqiyatli yakunlandi");
    process.exit(0);
  } catch (error) {
    console.error("❌ Xatolik:", error.message);
    process.exit(1);
  }
};

main();
