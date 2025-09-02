import express from 'express';
import Doctor from '../models/Doctor.js';
import Sales from '../models/Sales.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const doctors = await Doctor.find().sort({ createdAt: -1 });
    res.json({ success: true, data: doctors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const doctor = new Doctor(req.body);
    await doctor.save();
    res.json({ success: true, data: doctor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/:id/sales', async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.params.id);
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Врач не найден' });
    }

    // Sales ma'lumotlarini items bilan olish
    const sales = await Sales.find({ 
      doctorCode: doctor.code,
      hasItems: true 
    })
    .sort({ createdAt: -1 })
    .limit(100);

    // Har bir sale dan items ni chiqarish
    const salesWithProducts = [];
    
    for (const sale of sales) {
      if (sale.items && sale.items.length > 0) {
        // Har bir item uchun alohida entry
        sale.items.forEach(item => {
          salesWithProducts.push({
            _id: `${sale._id}_${item.id}`,
            saleNumber: sale.number,
            saleDate: sale.date,
            product: item.product,
            manufacturer: item.manufacturer,
            quantity: item.quantity,
            soldAmount: item.soldAmount,
            series: item.series,
            createdAt: sale.createdAt
          });
        });
      }
    }

    res.json({ success: true, data: salesWithProducts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Doctor.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Врач удален' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;