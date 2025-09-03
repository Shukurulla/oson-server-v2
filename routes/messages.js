import express from "express";
import Message from "../models/Message.js";
import Doctor from "../models/Doctor.js";
import TelegramUser from "../models/TelegramUser.js";
import { sendMessageToDoctor } from "../utils/telegramBot.js";

const router = express.Router();

// Barcha habarlarni olish
router.get("/", async (req, res) => {
  try {
    const messages = await Message.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("sentTo.doctorId", "name profession code");

    res.json({ success: true, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Doctorlar ro'yxatini olish (habar jo'natish uchun)
router.get("/doctors", async (req, res) => {
  try {
    const doctors = await Doctor.find({ isActive: true })
      .select("name profession code")
      .sort({ name: 1 });

    // Har bir doctor uchun telegram status tekshirish
    const doctorsWithTelegram = await Promise.all(
      doctors.map(async (doctor) => {
        const telegramUser = await TelegramUser.findOne({
          userId: doctor._id,
          userType: "doctor",
        });

        return {
          ...doctor.toObject(),
          hasTelegram: !!telegramUser,
          telegramChatId: telegramUser?.chatId || null,
        };
      })
    );

    res.json({ success: true, data: doctorsWithTelegram });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Habar jo'natish
router.post("/send", async (req, res) => {
  try {
    const { content, doctorIds } = req.body;

    if (!content || !doctorIds || doctorIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Xabar matni va kamida bitta doctor tanlanishi kerak",
      });
    }

    // Doctorlar ma'lumotlarini olish
    const doctors = await Doctor.find({
      _id: { $in: doctorIds },
      isActive: true,
    });

    if (doctors.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Faol doctorlar topilmadi",
      });
    }

    // Message yaratish
    const message = new Message({
      content,
      totalRecipients: doctors.length,
      sentTo: doctors.map((doctor) => ({
        doctorId: doctor._id,
        doctorName: doctor.name,
        doctorCode: doctor.code,
      })),
    });

    await message.save();

    // Har bir doctorga telegram orqali habar jo'natish
    let deliveredCount = 0;

    for (const doctor of doctors) {
      try {
        const telegramUser = await TelegramUser.findOne({
          userId: doctor._id,
          userType: "doctor",
        });

        if (telegramUser) {
          await sendMessageToDoctor(telegramUser.chatId, content, doctor.name);

          // Delivered statusni yangilash
          await Message.findOneAndUpdate(
            { _id: message._id, "sentTo.doctorId": doctor._id },
            {
              $set: {
                "sentTo.$.delivered": true,
                "sentTo.$.deliveredAt": new Date(),
                "sentTo.$.chatId": telegramUser.chatId,
              },
            }
          );

          deliveredCount++;
        }
      } catch (telegramError) {
        console.error(
          `Telegram xato doctor ${doctor.name}:`,
          telegramError.message
        );
      }
    }

    // Umumiy delivered count yangilash
    await Message.findByIdAndUpdate(message._id, {
      $set: { deliveredCount },
    });

    res.json({
      success: true,
      data: {
        messageId: message._id,
        totalRecipients: doctors.length,
        deliveredCount,
        message: `Habar ${deliveredCount}/${doctors.length} doctorga yuborildi`,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Bitta doctorning barcha habarlarini olish
router.get("/doctor/:doctorId", async (req, res) => {
  try {
    const { doctorId } = req.params;

    const messages = await Message.find({
      "sentTo.doctorId": doctorId,
    })
      .sort({ createdAt: -1 })
      .limit(100);

    // Faqat shu doctorga tegishli ma'lumotlarni filterlash
    const doctorMessages = messages.map((message) => ({
      _id: message._id,
      content: message.content,
      createdAt: message.createdAt,
      sentBy: message.sentBy,
      deliveryInfo: message.sentTo.find(
        (recipient) => recipient.doctorId.toString() === doctorId
      ),
    }));

    res.json({ success: true, data: doctorMessages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
