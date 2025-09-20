// routes/doctors.js - to'liq va to'g'irlangan versiya
import express from "express";
import Doctor from "../models/Doctor.js";
import Sales from "../models/Sales.js";
import TelegramUser from "../models/TelegramUser.js";
import { clearDoctorChat, clearAllDoctorChats } from "../utils/telegramBot.js";

const router = express.Router();

// Barcha doktorlarni olish
router.get("/", async (req, res) => {
  try {
    const doctors = await Doctor.find().sort({ createdAt: -1 });

    // Aktivlik statusini qo'shish
    const doctorsWithStatus = doctors.map((doc) => {
      const docObj = doc.toObject();
      // checkActiveStatus metodi bo'lmasa, oddiy tekshirish
      if (doc.activeUntil) {
        docObj.isCurrentlyActive =
          doc.isActive && new Date(doc.activeUntil) > new Date();
      } else {
        docObj.isCurrentlyActive = doc.isActive;
      }
      return docObj;
    });

    res.json({ success: true, data: doctorsWithStatus });
  } catch (error) {
    console.error("Doctors fetch error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Yangi doktor yaratish
router.post("/", async (req, res) => {
  try {
    const doctor = new Doctor(req.body);
    await doctor.save();
    res.json({ success: true, data: doctor });
  } catch (error) {
    console.error("Doctor create error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Doktorni yangilash
router.put("/:id", async (req, res) => {
  try {
    const { name, profession, login, password, code } = req.body;

    if (!name || !profession || !login || !password || !code) {
      return res.status(400).json({
        success: false,
        message: "Все поля обязательны",
      });
    }

    // Login tekshirish
    const existingLoginDoctor = await Doctor.findOne({
      login,
      _id: { $ne: req.params.id },
    });

    if (existingLoginDoctor) {
      return res.status(400).json({
        success: false,
        message: "Логин уже используется другим врачом",
      });
    }

    // Kod tekshirish
    const existingCodeDoctor = await Doctor.findOne({
      code,
      _id: { $ne: req.params.id },
    });

    if (existingCodeDoctor) {
      return res.status(400).json({
        success: false,
        message: "Код уже используется другим врачом",
      });
    }

    const updatedDoctor = await Doctor.findByIdAndUpdate(
      req.params.id,
      { name, profession, login, password, code },
      { new: true, runValidators: true }
    );

    if (!updatedDoctor) {
      return res.status(404).json({
        success: false,
        message: "Врач не найден",
      });
    }

    res.json({ success: true, data: updatedDoctor });
  } catch (error) {
    console.error("Doctor update error:", error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      const message =
        field === "login" ? "Логин уже используется" : "Код уже используется";
      res.status(400).json({ success: false, message });
    } else {
      res.status(500).json({ success: false, message: error.message });
    }
  }
});

// Doktorni deaktivatsiya qilish
router.put("/:id/deactivate", async (req, res) => {
  try {
    const doctor = await Doctor.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Врач не найден",
      });
    }

    // Telegram chatini tozalash
    await clearDoctorChat(req.params.id);

    res.json({
      success: true,
      data: doctor,
      message: "Врач деактивирован",
    });
  } catch (error) {
    console.error("Doctor deactivate error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Doktorni aktivatsiya qilish (vaqtli)
router.put("/:id/activate", async (req, res) => {
  try {
    const { months } = req.body;
    let activeUntil = null;

    if (months && months > 0) {
      activeUntil = new Date();
      activeUntil.setMonth(activeUntil.getMonth() + parseInt(months));
    }

    const updateData = { isActive: true };
    if (activeUntil) {
      updateData.activeUntil = activeUntil;
      updateData.$push = {
        activationHistory: {
          activatedAt: new Date(),
          activeUntil: activeUntil,
          months: parseInt(months),
          activatedBy: "admin",
        },
      };
    } else {
      updateData.activeUntil = null; // Cheksiz aktivatsiya
    }

    const doctor = await Doctor.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    });

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Врач не найден",
      });
    }

    res.json({
      success: true,
      data: doctor,
      message: months
        ? `Врач активирован на ${months} месяцев`
        : "Врач активирован",
    });
  } catch (error) {
    console.error("Doctor activate error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Doktor chatini tozalash
router.delete("/:id/clear-chat", async (req, res) => {
  try {
    const cleared = await clearDoctorChat(req.params.id);

    res.json({
      success: true,
      message: cleared ? "Чат врача очищен" : "Чат не найден",
    });
  } catch (error) {
    console.error("Clear chat error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Barcha doktor chatlarini tozalash
router.post("/clear-all-chats", async (req, res) => {
  try {
    const count = await clearAllDoctorChats();

    res.json({
      success: true,
      message: `Очищено ${count} чатов врачей`,
    });
  } catch (error) {
    console.error("Clear all chats error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/:id/sales", async (req, res) => {
  console.log("🔍 DEBUG: Sales endpoint ishga tushdi");
  console.log("🔍 DEBUG: Request params:", req.params);
  console.log("🔍 DEBUG: Request query:", req.query);

  try {
    const doctorId = req.params.id;
    console.log("🔍 DEBUG: Doctor ID:", doctorId);

    // 1. Doctor ID formatini tekshirish
    if (!doctorId || doctorId.length !== 24) {
      console.log("❌ DEBUG: Invalid doctor ID format");
      return res.status(400).json({
        success: false,
        message: "Invalid doctor ID format",
        receivedId: doctorId,
      });
    }

    // 2. Doktorni topish
    console.log("🔍 DEBUG: Searching for doctor...");
    const doctor = await Doctor.findById(doctorId);
    console.log(
      "🔍 DEBUG: Doctor found:",
      doctor ? `${doctor.name} (${doctor.code})` : "NOT FOUND"
    );

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
        searchedId: doctorId,
      });
    }

    // 3. Asosiy ma'lumotlarni tekshirish
    console.log("🔍 DEBUG: Doctor details:");
    console.log("  - Name:", doctor.name);
    console.log("  - Code:", doctor.code);
    console.log("  - Active:", doctor.isActive);

    // 4. Sales collection'ni tekshirish
    console.log("🔍 DEBUG: Checking Sales collection...");

    // Avval umumiy sales count
    const totalSales = await Sales.countDocuments();
    console.log("🔍 DEBUG: Total sales in database:", totalSales);

    // Doctor code'ni notes va doctorCode maydonlaridan qidirish
    const searchFilter = {
      $or: [
        { doctorCode: doctor.code },
        { notes: doctor.code },
        { notes: String(doctor.code) },
      ],
    };

    const doctorSalesCount = await Sales.countDocuments(searchFilter);
    console.log(
      "🔍 DEBUG: Sales for this doctor code (both fields):",
      doctorSalesCount
    );

    // Items bilan sales
    const salesWithItems = await Sales.countDocuments({
      ...searchFilter,
      hasItems: true,
    });
    console.log("🔍 DEBUG: Sales with items for this doctor:", salesWithItems);

    // 5. Bitta namuna sales olish
    const sampleSale = await Sales.findOne(searchFilter).lean();
    console.log(
      "🔍 DEBUG: Sample sale structure:",
      sampleSale
        ? {
            id: sampleSale.id,
            number: sampleSale.number,
            doctorCode: sampleSale.doctorCode,
            notes: sampleSale.notes,
            hasItems: sampleSale.hasItems,
            itemsCount: sampleSale.items ? sampleSale.items.length : 0,
            createdAt: sampleSale.createdAt,
          }
        : "NO SAMPLE FOUND"
    );

    // 6. Barcha sales'larni olish (limit bilan)
    console.log("🔍 DEBUG: Fetching sales...");
    const sales = await Sales.find({
      ...searchFilter,
      hasItems: true,
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    console.log("🔍 DEBUG: Retrieved sales count:", sales.length);

    // 7. Har bir sale'ning tuzilishini tekshirish
    if (sales.length > 0) {
      console.log("🔍 DEBUG: First sale detailed structure:");
      const firstSale = sales[0];
      console.log("  - Sale ID:", firstSale.id);
      console.log("  - Sale Number:", firstSale.number);
      console.log("  - Doctor Code:", firstSale.doctorCode);
      console.log("  - Has Items:", firstSale.hasItems);
      console.log("  - Items Array:", Array.isArray(firstSale.items));
      console.log(
        "  - Items Count:",
        firstSale.items ? firstSale.items.length : 0
      );

      if (firstSale.items && firstSale.items.length > 0) {
        console.log("  - First Item:", {
          id: firstSale.items[0].id,
          product: firstSale.items[0].product,
          quantity: firstSale.items[0].quantity,
          soldAmount: firstSale.items[0].soldAmount,
        });
      }
    }

    // 8. Response yaratish
    const responseData = [];

    for (const sale of sales) {
      if (sale.items && sale.items.length > 0) {
        sale.items.forEach((item, index) => {
          responseData.push({
            _id: `${sale._id}_${index}`,
            saleNumber: sale.number,
            saleDate: sale.date || sale.createdAt,
            product: item.product || "Unknown",
            manufacturer: item.manufacturer || "Unknown",
            quantity: item.quantity || 0,
            pieceCount: item.pieceCount || 1,
            soldAmount: item.soldAmount || 0,
            series: item.series || "",
            createdAt: sale.createdAt,
          });
        });
      }
    }

    console.log("🔍 DEBUG: Final response data count:", responseData.length);

    // 9. Response
    return res.json({
      success: true,
      debug: {
        doctorFound: !!doctor,
        doctorCode: doctor.code,
        searchFilter: searchFilter,
        totalSalesInDb: totalSales,
        doctorSalesCount: doctorSalesCount,
        salesWithItems: salesWithItems,
        retrievedSales: sales.length,
        finalItems: responseData.length,
      },
      data: responseData,
      metadata: {
        doctorName: doctor.name,
        doctorCode: doctor.code,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error("❌ DEBUG: Error occurred:", error);
    console.error("❌ DEBUG: Error stack:", error.stack);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});
// MUHIM: Savdolar statistikasi
router.get("/:id/sales-stats", async (req, res) => {
  try {
    const { dateFrom, dateTo, searchProduct } = req.query;

    console.log("Sales stats request:", {
      doctorId: req.params.id,
      dateFrom,
      dateTo,
      searchProduct,
    });

    const doctor = await Doctor.findById(req.params.id);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Врач не найден",
      });
    }

    let filter = {
      doctorCode: doctor.code,
      hasItems: true,
    };

    // Sana filterlari
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) {
        const fromDate = new Date(dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = fromDate;
      }
      if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = toDate;
      }
    }

    console.log("Stats filter:", filter);

    const sales = await Sales.find(filter);

    console.log(`Found ${sales.length} sales for stats`);

    let totalChecks = sales.length;
    let totalAmount = 0;
    let totalProducts = 0;
    const productMap = new Map();
    const dailyStats = new Map();

    for (const sale of sales) {
      totalAmount += sale.soldAmount || 0;

      // Kunlik statistika
      const dateKey = sale.date
        ? sale.date.toISOString().split("T")[0]
        : "unknown";
      if (!dailyStats.has(dateKey)) {
        dailyStats.set(dateKey, {
          date: dateKey,
          checks: 0,
          amount: 0,
          products: 0,
        });
      }
      const dayStats = dailyStats.get(dateKey);
      dayStats.checks++;
      dayStats.amount += sale.soldAmount || 0;

      if (sale.items && sale.items.length > 0) {
        for (const item of sale.items) {
          // Mahsulot filtri
          if (
            searchProduct &&
            !item.product.toLowerCase().includes(searchProduct.toLowerCase())
          ) {
            continue;
          }

          totalProducts += item.quantity || 0;
          dayStats.products += item.quantity || 0;

          if (!productMap.has(item.product)) {
            productMap.set(item.product, {
              product: item.product,
              quantity: 0,
              amount: 0,
              checks: new Set(),
            });
          }

          const prod = productMap.get(item.product);
          prod.quantity += item.quantity || 0;
          prod.amount += item.soldAmount || 0;
          prod.checks.add(sale.number);
        }
      }
    }

    // Top mahsulotlar
    const topProducts = Array.from(productMap.values())
      .map((p) => ({
        product: p.product,
        quantity: p.quantity,
        amount: p.amount,
        checksCount: p.checks.size,
      }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    // Kunlik statistika
    const dailyStatsList = Array.from(dailyStats.values())
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 30);

    const response = {
      success: true,
      data: {
        dateRange: {
          from: dateFrom || "начало",
          to: dateTo || "сегодня",
        },
        searchProduct: searchProduct || null,
        summary: {
          totalChecks,
          totalAmount,
          totalProducts,
          uniqueProducts: productMap.size,
          averageCheck:
            totalChecks > 0 ? Math.round(totalAmount / totalChecks) : 0,
          averageProductsPerCheck:
            totalChecks > 0 ? Math.round(totalProducts / totalChecks) : 0,
        },
        topProducts,
        dailyStats: dailyStatsList,
      },
    };

    console.log("Sending stats response");
    res.json(response);
  } catch (error) {
    console.error("Sales stats error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Export savdolar
router.get("/:id/export-sales", async (req, res) => {
  try {
    const { dateFrom, dateTo, searchProduct, format = "json" } = req.query;

    const doctor = await Doctor.findById(req.params.id);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Врач не найден",
      });
    }

    // Filter yaratish
    let filter = {
      doctorCode: doctor.code,
      hasItems: true,
    };

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) {
        const fromDate = new Date(dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = fromDate;
      }
      if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = toDate;
      }
    }

    const sales = await Sales.find(filter).sort({ createdAt: -1 });

    // Export ma'lumotlarini tayyorlash
    const exportData = {
      doctor: {
        name: doctor.name,
        profession: doctor.profession,
        code: doctor.code,
      },
      period: {
        from: dateFrom || "начало",
        to: dateTo || "сегодня",
      },
      filter: searchProduct || "все продукты",
      generatedAt: new Date(),
      sales: [],
    };

    for (const sale of sales) {
      if (sale.items && sale.items.length > 0) {
        for (const item of sale.items) {
          if (
            searchProduct &&
            !item.product.toLowerCase().includes(searchProduct.toLowerCase())
          ) {
            continue;
          }

          exportData.sales.push({
            checkNumber: sale.number,
            date: sale.date,
            product: item.product,
            manufacturer: item.manufacturer,
            quantity: item.quantity,
            amount: item.soldAmount,
            series: item.series,
          });
        }
      }
    }

    // Statistika
    exportData.statistics = {
      totalSales: exportData.sales.length,
      totalQuantity: exportData.sales.reduce(
        (sum, s) => sum + (s.quantity || 0),
        0
      ),
      totalAmount: exportData.sales.reduce(
        (sum, s) => sum + (s.amount || 0),
        0
      ),
    };

    if (format === "csv") {
      // CSV format
      const csv = [
        "Чек,Дата,Продукт,Производитель,Количество,Сумма,Серия",
        ...exportData.sales.map(
          (s) =>
            `${s.checkNumber},${s.date},${s.product},${s.manufacturer || ""},${
              s.quantity
            },${s.amount},${s.series || ""}`
        ),
      ].join("\n");

      res.header("Content-Type", "text/csv; charset=utf-8");
      res.attachment(`sales_${doctor.code}_${Date.now()}.csv`);
      return res.send("\uFEFF" + csv); // BOM qo'shish UTF-8 uchun
    }

    // JSON format
    res.json({
      success: true,
      data: exportData,
    });
  } catch (error) {
    console.error("Export sales error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Doktorni o'chirish
router.delete("/:id", async (req, res) => {
  try {
    // Chatni tozalash
    await clearDoctorChat(req.params.id);

    await Doctor.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Врач удален" });
  } catch (error) {
    console.error("Doctor delete error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
