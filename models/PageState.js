import mongoose from "mongoose";

const pageStateSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["remains", "sales"],
      required: true,
      unique: true,
    },
    // Remains uchun page-based ma'lumotlar
    lastPage: {
      type: Number,
      default: 1,
    },
    totalPages: {
      type: Number,
      default: 1,
    },
    isComplete: {
      type: Boolean,
      default: false,
    },

    // Sales uchun date-based ma'lumotlar
    lastSyncDate: {
      type: String, // "2025-08-30" format
      default: null,
    },
    currentDate: {
      type: String, // Hozirgi sync qilinayotgan sana
      default: null,
    },
    dailyPageState: {
      currentPage: { type: Number, default: 1 },
      totalPages: { type: Number, default: 1 },
      isComplete: { type: Boolean, default: false },
    },

    // Umumiy ma'lumotlar
    lastUpdateTime: {
      type: Date,
      default: Date.now,
    },
    lastItemId: String,
    metadata: {
      totalItems: Number,
      lastFullSync: Date,
      averagePageSize: Number,
      totalDaysProcessed: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("PageState", pageStateSchema);
