import express from "express";
import Sales from "../models/Sales.js";
import Remains from "../models/Remains.js";
import Doctor from "../models/Doctor.js";
import Supplier from "../models/Supplier.js";

const router = express.Router();

router.get("/stats", async (req, res) => {
  try {
    console.log("📊 Dashboard stats so'ralmoqda...");

    const today = new Date();
    const todayStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

    // Parallel queries для performance
    const [
      totalSales,
      totalRemains,
      totalDoctors,
      totalSuppliers,
      todaySales,
      yesterdaySales,
      todayRevenueResult,
      yesterdayRevenueResult,
      criticalStockResult,
      salesWithItems,
      topSellingProducts,
      recentSales,
    ] = await Promise.all([
      // Asosiy hisoblar
      Sales.countDocuments().catch(() => 0),
      Remains.countDocuments().catch(() => 0),
      Doctor.countDocuments({ isActive: true }).catch(() => 0),
      Supplier.countDocuments({ isActive: true }).catch(() => 0),

      // Bugungi va kechagi sales
      Sales.countDocuments({
        createdAt: { $gte: todayStart },
      }).catch(() => 0),

      Sales.countDocuments({
        createdAt: {
          $gte: yesterdayStart,
          $lt: todayStart,
        },
      }).catch(() => 0),

      // Bugungi va kechagi revenue
      Sales.aggregate([
        { $match: { createdAt: { $gte: todayStart } } },
        { $group: { _id: null, total: { $sum: "$soldAmount" } } },
      ]).catch(() => []),

      Sales.aggregate([
        {
          $match: {
            createdAt: {
              $gte: yesterdayStart,
              $lt: todayStart,
            },
          },
        },
        { $group: { _id: null, total: { $sum: "$soldAmount" } } },
      ]).catch(() => []),

      // Kritik qoldiqlar
      Remains.aggregate([
        {
          $match: {
            $or: [
              { unit: "шт" },
              { unit: "штук" },
              { unit: "шт." },
              { unit: null },
              { unit: "" },
            ],
          },
        },
        {
          $group: {
            _id: { product: "$product", branch: "$branch" },
            totalQuantity: { $sum: "$quantity" },
          },
        },
        { $match: { totalQuantity: { $lt: 10 } } },
        { $count: "total" },
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
            totalRevenue: { $sum: "$items.soldAmount" },
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
    ]);

    const todayRevenue = todayRevenueResult[0]?.total || 0;
    const yesterdayRevenue = yesterdayRevenueResult[0]?.total || 0;
    const criticalStock = criticalStockResult[0]?.total || 0;

    // O'zgarishlar hisoblanishi
    const salesChange =
      yesterdaySales > 0
        ? Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100)
        : todaySales > 0
        ? 100
        : 0;

    const revenueChange =
      yesterdayRevenue > 0
        ? Math.round(
            ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100
          )
        : todayRevenue > 0
        ? 100
        : 0;

    const responseData = {
      // Asosiy statistikalar
      totalSales,
      totalRemains,
      totalDoctors,
      totalSuppliers,

      // Bugungi ma'lumotlar
      todaySales,
      yesterdaySales,
      todayRevenue,
      yesterdayRevenue,
      criticalStock,

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
        criticalStockPercentage:
          totalRemains > 0
            ? Math.round((criticalStock / totalRemains) * 100)
            : 0,
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
