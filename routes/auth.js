import express from 'express';
import jwt from 'jsonwebtoken';

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    if (username === 'admin' && password === 'admin123') {
      const token = jwt.sign(
        { userId: 'admin', role: 'admin' },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: '24h' }
      );

      res.json({
        success: true,
        token,
        user: { username: 'admin', role: 'admin' }
      });
    } else {
      res.status(401).json({ success: false, message: 'Неверные данные' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

export default router;
