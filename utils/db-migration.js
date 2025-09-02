import mongoose from "mongoose";
import Remains from "./models/Remains.js";
import Sales from "./models/Sales.js";

const createIndexes = async () => {
  try {
    await mongoose.connect(
      "mongodb+srv://shukurullatursinbayev978_db_user:ZGwldl1LKYzwZBmO@cluster0.lwgrk1d.mongodb.net/oson-apteka"
    );

    console.log("Создание индексов для остатков...");
    await Remains.createIndexes();

    console.log("Создание индексов для продаж...");
    await Sales.createIndexes();

    console.log("✅ Все индексы созданы успешно");

    // Очистка дубликатов
    console.log("Очистка существующих дубликатов...");

    const { cleanupDuplicates } = await import("./utils/refreshData.js");
    await cleanupDuplicates();

    process.exit(0);
  } catch (error) {
    console.error("❌ Ошибка создания индексов:", error);
    process.exit(1);
  }
};

createIndexes();
