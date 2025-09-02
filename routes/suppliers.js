import express from 'express';
import Supplier from '../models/Supplier.js';
import Remains from '../models/Remains.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const suppliers = await Supplier.find().sort({ createdAt: -1 });
    res.json({ success: true, data: suppliers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/available', async (req, res) => {
  try {
    const availableSuppliers = await Remains.distinct('manufacturer');
    res.json({ success: true, data: availableSuppliers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/:name/remains', async (req, res) => {
  try {
    const remains = await Remains.find({ manufacturer: req.params.name })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ success: true, data: remains });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const supplier = new Supplier(req.body);
    await supplier.save();
    res.json({ success: true, data: supplier });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Supplier.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Поставщик удален' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
