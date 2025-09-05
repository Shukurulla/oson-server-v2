// models/Doctor.js - обновленная версия с деактивацией и временной активацией
import mongoose from "mongoose";

const doctorSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  profession: {
    type: String,
    required: true
  },
  login: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  code: {
    type: String,
    required: true,
    unique: true
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
doctorSchema.methods.checkActiveStatus = function() {
  if (!this.isActive) return false;
  if (!this.activeUntil) return true;
  return new Date() < new Date(this.activeUntil);
};

export default mongoose.model("Doctor", doctorSchema);