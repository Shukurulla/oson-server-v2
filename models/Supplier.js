// models/Supplier.js - обновленная версия с временной активацией
import mongoose from "mongoose";

const supplierSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  username: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Новое поле для временной активации
  activeUntil: {
    type: Date,
    default: null
  },
  activationHistory: [{
    activatedAt: Date,
    activeUntil: Date,
    months: Number,
    activatedBy: String
  }]
}, {
  timestamps: true,
});

// Метод для проверки активности с учетом срока
supplierSchema.methods.checkActiveStatus = function() {
  if (!this.isActive) return false;
  if (!this.activeUntil) return true;
  return new Date() < new Date(this.activeUntil);
};

export default mongoose.model("Supplier", supplierSchema);