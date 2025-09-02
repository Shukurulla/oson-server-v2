import express from "express";
import {
  getSystemStatus,
  getRefreshStatus,
  manualFullUpdate,
  stopRefresh,
} from "../utils/refreshData.js";

const router = express.Router();

// Background status olish
router.get("/status", async (req, res) => {
  try {
    const status = await getSystemStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Refresh status (quick)
router.get("/refresh-status", (req, res) => {
  const status = getRefreshStatus();
  res.json({
    success: true,
    data: status,
  });
});

// Manual refresh trigger
router.post("/manual-refresh", (req, res) => {
  try {
    manualFullUpdate();
    res.json({
      success: true,
      message: "Background refresh queuega qo'shildi",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Stop refresh
router.post("/stop-refresh", (req, res) => {
  try {
    stopRefresh();
    res.json({
      success: true,
      message: "Background refresh to'xtatildi",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
