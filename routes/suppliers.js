// routes/suppliers.js - обновленная версия с временной активацией
import express from "express";
import Supplier from "../models/Supplier.js";
import Remains from "../models/Remains.js";
import { getRemainsBySupplier, getSuppliers } from "../utils/refreshData.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const suppliers = await Supplier.find().sort({ createdAt: -1 });

    // Aktivlik statusini qo'shish
    const suppliersWithStatus = suppliers.map((supplier) => {
      const supplierObj = supplier.toObject();
      // checkActiveStatus metodi bo'lmasa, oddiy tekshirish
      if (supplier.activeUntil) {
        supplierObj.isCurrentlyActive =
          supplier.isActive && new Date(supplier.activeUntil) > new Date();
      } else {
        supplierObj.isCurrentlyActive = supplier.isActive;
      }
      return supplierObj;
    });

    res.json({ success: true, data: suppliersWithStatus });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/available", async (req, res) => {
  try {
    const availableSuppliers = await getSuppliers();
    res.json({ success: true, data: availableSuppliers.map((s) => s.name) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ОБНОВЛЕНО: Остатки без группировки по сериям
router.get("/:name/remains", async (req, res) => {
  try {
    // Группируем остатки без учета серий
    const suppliers = await getSuppliers();
    const supplier = suppliers.find((s) => s.name === req.params.name);
    const remains = await getRemainsBySupplier(supplier.id);

    const filteredRemains = remains.map((r) => {
      return {
        id: r.id,
        product: r.product,
        branch: r.branch,
        unit: r.unit,
        pieceCount: r.pieceCount,
        quantity: r.quantity,
        manufacturer: r.manufacturer,
        category: r.category,
        location: r.location,
        buyPrice: r.buyPrice,
        salePrice: r.salePrice,
        barcode: r.barcode,
        shelfLife: r.shelfLife,
        quantities: r.quantities,
      };
    });

    res.json({ success: true, data: filteredRemains });
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

router.put("/:id", async (req, res) => {
  try {
    const { name, username, password } = req.body;

    if (!name || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "Все поля обязательны",
      });
    }

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

// Деактивация поставщика
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

// ОБНОВЛЕНО: Активация поставщика с временным периодом
router.put("/:id/activate", async (req, res) => {
  try {
    const { months } = req.body;
    let activeUntil = null;

    if (months && months > 0) {
      activeUntil = new Date();
      activeUntil.setMonth(activeUntil.getMonth() + months);
    }

    const updateData = { isActive: true };
    if (activeUntil) {
      updateData.activeUntil = activeUntil;
      updateData.$push = {
        activationHistory: {
          activatedAt: new Date(),
          activeUntil: activeUntil,
          months: months,
          activatedBy: "admin",
        },
      };
    }

    const supplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      updateData,
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
      message: months
        ? `Поставщик активирован на ${months} месяцев`
        : "Поставщик активирован",
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
