import express from "express";
import Supplier from "../models/Supplier.js";
import Remains from "../models/Remains.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const suppliers = await Supplier.find().sort({ createdAt: -1 });
    res.json({ success: true, data: suppliers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/available", async (req, res) => {
  try {
    const availableSuppliers = await Remains.distinct("manufacturer");
    res.json({ success: true, data: availableSuppliers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/:name/remains", async (req, res) => {
  try {
    const remains = await Remains.find({ manufacturer: req.params.name })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ success: true, data: remains });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const supplier = new Supplier(req.body);
    await supplier.save();
    res.json({ success: true, data: supplier });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Yangi PUT route - supplier ni update qilish uchun
router.put("/:id", async (req, res) => {
  try {
    const { name, username, password } = req.body;

    // Validation
    if (!name || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "Все поля обязательны",
      });
    }

    // Username uniqueness check (boshqa suppliers uchun)
    const existingUsernameSupplier = await Supplier.findOne({
      username,
      _id: { $ne: req.params.id },
    });

    if (existingUsernameSupplier) {
      return res.status(400).json({
        success: false,
        message: "Логин уже используется другим поставщиком",
      });
    }

    const updatedSupplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      { name, username, password },
      { new: true, runValidators: true }
    );

    if (!updatedSupplier) {
      return res.status(404).json({
        success: false,
        message: "Поставщик не найден",
      });
    }

    res.json({ success: true, data: updatedSupplier });
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({
        success: false,
        message: "Логин уже используется",
      });
    } else {
      res.status(500).json({ success: false, message: error.message });
    }
  }
});

// Deactivate supplier
router.put("/:id/deactivate", async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: "Поставщик не найден",
      });
    }

    res.json({
      success: true,
      data: supplier,
      message: "Поставщик деактивирован",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Activate supplier
router.put("/:id/activate", async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      { isActive: true },
      { new: true }
    );

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: "Поставщик не найден",
      });
    }

    res.json({
      success: true,
      data: supplier,
      message: "Поставщик активирован",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await Supplier.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Поставщик удален" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
