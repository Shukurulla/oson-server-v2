import express from "express";
import Sales from "../models/Sales.js";
import Remains from "../models/Remains.js";
import Doctor from "../models/Doctor.js";
import Supplier from "../models/Supplier.js";
import { login } from "../utils/refreshData.js";
import axios from "axios";

const router = express.Router();

// getStats funksiyasi - OsonKassa API'dan total ma'lumotlarini olish
const getStats = async (startDate, endDate) => {
  try {
    // 1. Avval login qilish
    const token = await login();
    if (!token) {
      console.error("❌ Login amalga oshmadi");
      return { buyAmount: 0 };
    }

    // 2. Sana formatini to'g'rilash
    const dateFrom = new Date(startDate).toISOString().split("T")[0];
    const dateTo = new Date(endDate).toISOString().split("T")[0] + "T23:59:59.9999999";

    console.log(`📊 Stats so'ralmoqda: ${dateFrom} dan ${dateTo} gacha`);

    // 3. API'ga so'rov yuborish
    const response = await axios.post(
      "https://osonkassa.uz/api/pos/sales/get",
      {
        dateFrom: dateFrom,
        dateTo: dateTo,
        deletedFilter: 1,
        pageNumber: 1,
        pageSize: 100,
        searchText: "",
        sortOrders: [],
      },
      {
        headers: {
          authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    // 4. Total ma'lumotlarini qaytarish
    const totalData = response.data?.page?.total || {};

    console.log(`✅ Stats olindi: buyAmount = ${totalData.buyAmount || 0}`);

    return {
      buyAmount: totalData.buyAmount || 0,
      saleAmount: totalData.saleAmount || 0,
      discountAmount: totalData.discountAmount || 0,
      soldAmount: totalData.soldAmount || 0,
      vatAmount: totalData.vatAmount || 0,
      paymentCredit: totalData.paymentCredit || 0,
      paymentCash: totalData.paymentCash || 0,
      paymentBankCard: totalData.paymentBankCard || 0,
      paymentUzcard: totalData.paymentUzcard || 0,
      paymentHumo: totalData.paymentHumo || 0,
      paymentOnline: totalData.paymentOnline || 0,
      paymentPayme: totalData.paymentPayme || 0,
      paymentClick: totalData.paymentClick || 0,
      paymentUzum: totalData.paymentUzum || 0,
      paymentUDS: totalData.paymentUDS || 0,
      paymentInsuranceCompany: totalData.paymentInsuranceCompany || 0,
      count: totalData.count || 0,
    };
  } catch (error) {
    console.error("❌ getStats xatosi:", error.message);
    // Xatolik bo'lsa, 0'larni qaytarish
    return {
      buyAmount: 0,
      saleAmount: 0,
      discountAmount: 0,
      soldAmount: 0,
      vatAmount: 0,
      paymentCredit: 0,
      paymentCash: 0,
      paymentBankCard: 0,
      paymentUzcard: 0,
      paymentHumo: 0,
      paymentOnline: 0,
      paymentPayme: 0,
      paymentClick: 0,
      paymentUzum: 0,
      paymentUDS: 0,
      paymentInsuranceCompany: 0,
      count: 0,
    };
  }
};

router.get("/stats", async (req, res) => {
  try {
    console.log("📊 Dashboard stats so'ralmoqda...");

    const today = new Date();
    const todayStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

    // 1-sentyabr 2025
    const septemberFirst = new Date("2025-09-01");

    // Parallel queries для performance + OsonKassa API'dan ma'lumotlar
    const [
      totalSales,
      totalRemains,
      totalDoctors,
      totalSuppliers,
      todaySales,
      todayRevenueResult,
      totalRevenueResult,
      salesWithItems,
      topSellingProducts,
      recentSales,
      todayStats,
      totalStatsFromSeptember,
    ] = await Promise.all([
      // Asosiy hisoblar
      Sales.countDocuments().catch(() => 0),
      Remains.countDocuments().catch(() => 0),
      Doctor.countDocuments({ isActive: true }).catch(() => 0),
      Supplier.countDocuments({ isActive: true }).catch(() => 0),

      // Bugungi sales
      Sales.countDocuments({
        createdAt: { $gte: todayStart },
      }).catch(() => 0),

      // Bugungi revenue (MongoDB'dan)
      Sales.aggregate([
        { $match: { createdAt: { $gte: todayStart } } },
        { $group: { _id: null, total: { $sum: "$buyAmount" } } },
      ]).catch(() => []),

      // Umumiy revenue (barcha savdolar - MongoDB'dan)
      Sales.aggregate([
        { $group: { _id: null, total: { $sum: "$buyAmount" } } },
      ]).catch(() => []),

      // Sales with items
      Sales.countDocuments({ hasItems: true }).catch(() => 0),

      // Top selling products
      Sales.aggregate([
        { $match: { hasItems: true } },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.product",
            totalSold: { $sum: "$items.quantity" },
            totalRevenue: { $sum: "$items.buyAmount" },
          },
        },
        { $sort: { totalSold: -1 } },
        { $limit: 5 },
      ]).catch(() => []),

      // Recent sales
      Sales.find({ hasItems: true })
        .sort({ createdAt: -1 })
        .limit(10)
        .select("number soldAmount createdAt items")
        .lean()
        .catch(() => []),

      // OsonKassa API'dan bugungi ma'lumotlar
      getStats(today, today).catch((err) => {
        console.error("❌ Bugungi stats olishda xato:", err.message);
        return { buyAmount: 0 };
      }),

      // OsonKassa API'dan 1-sentyabrdan bugungi kungacha ma'lumotlar
      getStats(septemberFirst, today).catch((err) => {
        console.error("❌ Umumiy stats olishda xato:", err.message);
        return { buyAmount: 0 };
      }),
    ]);

    const todayRevenue = todayRevenueResult[0]?.total || 0;
    const totalRevenue = totalRevenueResult[0]?.total || 0;

    // OsonKassa'dan olingan ma'lumotlar
    const todayRevenueFromAPI = todayStats.buyAmount || 0;
    const totalRevenueFromAPI = totalStatsFromSeptember.buyAmount || 0;

    // O'zgarishlar hisoblanishi - faqat umumiy ma'lumotlar asosida
    const salesChange = 0; // O'zgarishlarni ko'rsatmaslik uchun
    const revenueChange = 0; // O'zgarishlarni ko'rsatmaslik uchun

    const responseData = {
      // Asosiy statistikalar
      totalSales,
      totalRemains,
      totalDoctors,
      totalSuppliers,

      // Bugungi ma'lumotlar (MongoDB'dan)
      todaySales,
      todayRevenue,
      totalRevenue,

      // OsonKassa API'dan ma'lumotlar
      todayRevenueFromAPI, // Bugungi kun uchun buyAmount
      totalRevenueFromAPI, // 1-sentyabrdan bugungi kungacha buyAmount

      // Qo'shimcha to'liq ma'lumotlar
      todayStatsComplete: todayStats, // Bugungi kunning to'liq statistikasi
      totalStatsComplete: totalStatsFromSeptember, // 1-sentyabrdan bugungi kungacha to'liq statistika

      // Qo'shimcha ma'lumotlar
      salesWithItems,
      salesWithoutItems: Math.max(0, totalSales - salesWithItems),
      topSellingProducts,
      recentSales,

      // O'zgarishlar
      salesChange,
      revenueChange,

      // Metadata
      lastUpdated: new Date(),
      dataQuality: {
        salesCoverage:
          totalSales > 0 ? Math.round((salesWithItems / totalSales) * 100) : 0,
      },
    };

    console.log("✅ Dashboard stats muvaffaqiyatli yuborildi");

    res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error("❌ Dashboard stats xatosi:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
      fallbackData: {
        totalSales: 0,
        totalRemains: 0,
        totalDoctors: 0,
        totalSuppliers: 0,
        todaySales: 0,
        todayRevenue: 0,
        criticalStock: 0,
        salesChange: 0,
        revenueChange: 0,
        lastUpdated: new Date(),
      },
    });
  }
});

// Qo'shimcha endpoint - real-time small stats
router.get("/quick-stats", async (req, res) => {
  try {
    const today = new Date();
    const todayStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

    const [todaySales, todayRevenue] = await Promise.all([
      Sales.countDocuments({
        createdAt: { $gte: todayStart },
      }),
      Sales.aggregate([
        { $match: { createdAt: { $gte: todayStart } } },
        { $group: { _id: null, total: { $sum: "$soldAmount" } } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        todaySales,
        todayRevenue: todayRevenue[0]?.total || 0,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
