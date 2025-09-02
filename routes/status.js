import express from "express";
import PageState from "../models/PageState.js";
import {
  getStatus,
  fetchSales,
  fetchRecentSales,
  resetRemainsState,
  resetSalesState,
} from "../utils/refreshData.js";

const router = express.Router();

router.get("/sync-status", async (req, res) => {
  try {
    const remainsState = await PageState.findOne({ type: "remains" });
    const salesState = await PageState.findOne({ type: "sales" });

    res.json({
      success: true,
      data: {
        remains: {
          currentPage: remainsState?.lastPage || 1,
          totalPages: remainsState?.totalPages || 0,
          isComplete: remainsState?.isComplete || false,
          lastUpdate: remainsState?.lastUpdateTime,
        },
        sales: {
          currentDate: salesState?.currentDate,
          lastSyncDate: salesState?.lastSyncDate,
          dailyPageState: salesState?.dailyPageState || {
            currentPage: 1,
            totalPages: 1,
            isComplete: false,
          },
          lastUpdate: salesState?.lastUpdateTime,
          totalDaysProcessed: salesState?.metadata?.totalDaysProcessed || 0,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Manual triggers
router.post("/sync-today-sales", async (req, res) => {
  try {
    setTimeout(() => fetchSales(), 1000);
    res.json({
      success: true,
      message: "Bugungi sales yangilanishi boshlandi",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/sync-recent-sales", async (req, res) => {
  try {
    const days = req.body.days || 7;
    setTimeout(() => fetchRecentSales(days), 1000);
    res.json({
      success: true,
      message: `Oxirgi ${days} kunlik sales yangilanishi boshlandi`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/reset-remains", async (req, res) => {
  try {
    await resetRemainsState();
    res.json({ success: true, message: "Remains state reset qilindi" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/reset-sales", async (req, res) => {
  try {
    await resetSalesState();
    res.json({ success: true, message: "Sales state reset qilindi" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
