import mongoose from "mongoose";
import crypto from 'crypto';

const salesSchema = new mongoose.Schema({
  // Sale asosiy ma'lumotlari (sales/get dan)
  id: {
    type: String,
    required: true,
    unique: true
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

  // Sale items ma'lumotlari (sales/items/get dan)
  items: [{
    id: String,
    insertedIndex: Number,
    product: String,
    manufacturer: String,
    country: String,
    batchId: String,
    series: String,
    shelfLife: Date,
    pieceCount: Number,
    quantity: Number,
    buyPrice: Number,
    salePrice: Number,
    discount: Number,
    discountPercentage: Number,
    soldPrice: Number,
    vat: Number,
    marketingScore: Number,
    buyAmount: Number,
    saleAmount: Number,
    discountAmount: Number,
    soldAmount: Number,
    vatAmount: Number,
    notes: String,
    isDeleted: Boolean
  }],

  // Qo'shimcha ma'lumotlar
  doctorCode: String, // notes dan olinadi
  hasItems: {
    type: Boolean,
    default: false
  },
  itemsLastUpdated: Date,
  
  // Hash va tracking
  dataHash: {
    type: String,
    index: true
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  isNotified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
});

// Hash yaratish middleware
salesSchema.pre('save', function() {
  if (this.isModified() && !this.isNew) {
    const dataForHash = { ...this.toObject() };
    delete dataForHash._id;
    delete dataForHash.__v;
    delete dataForHash.createdAt;
    delete dataForHash.updatedAt;
    delete dataForHash.dataHash;
    delete dataForHash.lastUpdated;
    delete dataForHash.isNotified;
    delete dataForHash.itemsLastUpdated;
    
    this.dataHash = crypto.createHash('md5').update(JSON.stringify(dataForHash)).digest('hex');
    this.lastUpdated = new Date();
  }
});

// Static method hash yaratish uchun
salesSchema.statics.generateHash = function(data) {
  const cleanData = { ...data };
  delete cleanData._id;
  delete cleanData.__v;
  delete cleanData.createdAt;
  delete cleanData.updatedAt;
  delete cleanData.dataHash;
  delete cleanData.lastUpdated;
  delete cleanData.isNotified;
  delete cleanData.itemsLastUpdated;
  
  return crypto.createHash('md5').update(JSON.stringify(cleanData)).digest('hex');
};

salesSchema.index({ doctorCode: 1, createdAt: -1 });
salesSchema.index({ date: -1 });
salesSchema.index({ 'items.product': 1 });

export default mongoose.model("Sales", salesSchema);