import mongoose from "mongoose";

const telegramUserSchema = new mongoose.Schema({
  chatId: {
    type: String,
    required: true,
    unique: true
  },
  userType: {
    type: String,
    enum: ['doctor', 'supplier'],
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  lastNotifiedSales: [{
    type: String
  }]
}, {
  timestamps: true,
});

export default mongoose.model("TelegramUser", telegramUserSchema);
