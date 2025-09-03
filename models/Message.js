// models/Message.js
import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      required: true,
    },
    sentTo: [
      {
        doctorId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Doctor",
          required: true,
        },
        doctorName: String,
        doctorCode: String,
        sentAt: {
          type: Date,
          default: Date.now,
        },
        delivered: {
          type: Boolean,
          default: false,
        },
        deliveredAt: Date,
        chatId: String,
      },
    ],
    sentBy: {
      type: String,
      default: "admin",
    },
    totalRecipients: {
      type: Number,
      default: 0,
    },
    deliveredCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

messageSchema.index({ createdAt: -1 });
messageSchema.index({ "sentTo.doctorId": 1 });

export default mongoose.model("Message", messageSchema);
