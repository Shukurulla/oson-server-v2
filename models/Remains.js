import mongoose from "mongoose";
import crypto from "crypto";

const remainSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
    },
    branchId: String,
    productId: String,
    branch: String,
    batchId: String,
    code: Number,
    product: String,
    isGlobal: Boolean,
    source: String,
    manufacturer: String,
    country: String,
    internationalName: String,
    pharmGroup: String,
    category: String,
    unit: String,
    pieceCount: Number,
    referentDate: String,
    referentPrice: String,
    referentAllWholeSalePrice: String,
    referentAllRetailSalePrice: String,
    barcode: String,
    mxik: String,
    isMXIKTemporary: Boolean,
    ofdPackage: String,
    quantity: Number,
    quantities: {
      units: Number,
      pieces: Number,
    },
    bookedQuantity: Number,
    bookedQuantities: {
      units: Number,
      pieces: Number,
    },
    buyPrice: Number,
    salePrice: Number,
    vat: Number,
    markup: Number,
    buyAmount: Number,
    saleAmount: Number,
    series: String,
    shelfLife: String,
    supplyQuantity: Number,
    supplyDate: String,
    supplier: String,
    supplyType: String,
    supplyTypeString: String,
    point: String,
    pointType: String,
    pointTypeString: String,
    pointPerSaleType: String,
    pointPerSaleTypeString: String,
    productMinimum: String,
    location: String,
    minSalePieceQuantity: String,
    storageCondition: String,
    temperature: String,
    // Hash maydon qo'shildi
    dataHash: {
      type: String,
      index: true,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Hash yaratish middleware
remainSchema.pre("save", function () {
  if (this.isModified() && !this.isNew) {
    const dataForHash = { ...this.toObject() };
    delete dataForHash._id;
    delete dataForHash.__v;
    delete dataForHash.createdAt;
    delete dataForHash.updatedAt;
    delete dataForHash.dataHash;
    delete dataForHash.lastUpdated;

    this.dataHash = crypto
      .createHash("md5")
      .update(JSON.stringify(dataForHash))
      .digest("hex");
    this.lastUpdated = new Date();
  }
});

// Static method hash yaratish uchun
remainSchema.statics.generateHash = function (data) {
  const cleanData = { ...data };
  delete cleanData._id;
  delete cleanData.__v;
  delete cleanData.createdAt;
  delete cleanData.updatedAt;
  delete cleanData.dataHash;
  delete cleanData.lastUpdated;

  return crypto
    .createHash("md5")
    .update(JSON.stringify(cleanData))
    .digest("hex");
};

remainSchema.index({ manufacturer: 1, product: 1 });
remainSchema.index({ productId: 1, branchId: 1 });

export default mongoose.model("Remains", remainSchema);
