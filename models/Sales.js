import mongoose from "mongoose";
import crypto from "crypto";

const salesSchema = new mongoose.Schema(
  {
    // Sale asosiy ma'lumotlari (sales/get dan)
    id: {
      type: String,
      required: true,
      unique: true,
    },
    branch: String,
    saleType: Number,
    saleTypeString: String,
    number: Number,
    date: Date,
    status: Number,
    shiftNumber: Number,
    customerName: String,
    hasFiscalReceipt: Boolean,
    notes: String,
    itemsCount: Number,
    buyAmount: Number,
    discountAmount: Number,
    discountPercentage: Number,
    saleAmount: Number,
    soldAmount: Number,
    vatAmount: Number,
    marketingScoreAmount: Number,
    installmentDate: Date,
    paymentCredit: Number,
    paymentCash: Number,
    paymentBankCard: Number,
    paymentUzcard: Number,
    paymentHumo: Number,
    paymentOnline: Number,
    paymentPayme: Number,
    paymentClick: Number,
    paymentUzum: Number,
    paymentUDS: Number,
    paymentInsuranceCompany: Number,
    createdBy: String,
    modifiedAt: Date,
    modifiedBy: String,
    isDeleted: Boolean,
  },
  {
    timestamps: true,
  }
);

salesSchema.index({ createdAt: -1 });
salesSchema.index({ date: -1 });

export default mongoose.model("Sales", salesSchema);
