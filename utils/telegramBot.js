import TelegramBot from "node-telegram-bot-api";
import Doctor from "../models/Doctor.js";
import Supplier from "../models/Supplier.js";
import TelegramUser from "../models/TelegramUser.js";
import Sales from "../models/Sales.js";
import Remains from "../models/Remains.js";
import { config } from "dotenv";
config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

const userStates = new Map();
const userPaginationData = new Map();

// Главное меню
const mainMenu = {
  reply_markup: {
    keyboard: [["👨‍⚕️ Войти как врач"], ["🏭 Войти как поставщик"]],
    resize_keyboard: true,
    one_time_keyboard: true,
  },
};

// Меню врача
const doctorMenu = {
  reply_markup: {
    keyboard: [["📊 Мои продажи"], ["🚪 Выйти"]],
    resize_keyboard: true,
  },
};

// Меню поставщика
const supplierMenu = {
  reply_markup: {
    keyboard: [["📦 Остатки"], ["📈 Статистика"], ["🚪 Выйти"]],
    resize_keyboard: true,
  },
};

// Pagination buttonlarini yaratish
const createPaginationButtons = (currentPage, totalPages, prefix) => {
  const buttons = [];
  const maxButtons = 5;

  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);

  if (endPage - startPage + 1 < maxButtons) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  const row1 = [];
  const row2 = [];

  if (currentPage > 1) {
    row1.push({
      text: "⬅️ Oldingi",
      callback_data: `${prefix}_page_${currentPage - 1}`,
    });
  }

  if (currentPage < totalPages) {
    row1.push({
      text: "Keyingi ➡️",
      callback_data: `${prefix}_page_${currentPage + 1}`,
    });
  }

  for (let i = startPage; i <= endPage; i++) {
    const text = i === currentPage ? `• ${i} •` : i.toString();
    row2.push({ text, callback_data: `${prefix}_page_${i}` });
  }

  if (row1.length > 0) buttons.push(row1);
  if (row2.length > 0) buttons.push(row2);

  buttons.push([
    { text: `📄 ${currentPage}/${totalPages}`, callback_data: "info" },
    { text: "❌ Yopish", callback_data: `${prefix}_close` },
  ]);

  return {
    reply_markup: {
      inline_keyboard: buttons,
    },
  };
};

// Vaqtni formatlash
const formatDateTime = (date) => {
  const d = new Date(date);
  const dateStr = d.toLocaleDateString("ru-RU");
  const timeStr = d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dateStr} ${timeStr}`;
};

// Sales ma'lumotlarini check number bo'yicha guruhlash (vaqt bilan)
const getGroupedSalesPage = async (doctorCode, page = 1, checksPerPage = 3) => {
  try {
    const sales = await Sales.find({
      doctorCode: doctorCode,
      hasItems: true,
      itemsCount: { $gt: 0 },
    }).sort({ createdAt: -1 });

    const checkGroups = new Map();
    let totalItems = 0;

    for (const sale of sales) {
      if (sale.items && sale.items.length > 0) {
        const checkKey = `${sale.number}_${
          sale.date.toISOString().split("T")[0]
        }`;

        if (!checkGroups.has(checkKey)) {
          checkGroups.set(checkKey, {
            checkNumber: sale.number,
            checkDate: sale.date,
            createdAt: sale.createdAt, // Vaqt qo'shildi
            items: [],
            totalAmount: sale.soldAmount || 0,
            paymentCash: sale.paymentCash || 0,
            paymentBankCard: sale.paymentBankCard || 0,
          });
        }

        const checkData = checkGroups.get(checkKey);
        checkData.items.push(...sale.items);
        totalItems += sale.items.length;
      }
    }

    const checksArray = Array.from(checkGroups.values()).sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    const totalChecks = checksArray.length;
    const totalPages = Math.ceil(totalChecks / checksPerPage);
    const startIndex = (page - 1) * checksPerPage;
    const endIndex = startIndex + checksPerPage;
    const pageChecks = checksArray.slice(startIndex, endIndex);

    return {
      checks: pageChecks,
      currentPage: page,
      totalPages: totalPages,
      totalChecks: totalChecks,
      totalItems: totalItems,
      hasMore: page < totalPages,
    };
  } catch (error) {
    console.error("Grouped sales sahifa olishda xato:", error);
    return {
      checks: [],
      currentPage: 1,
      totalPages: 1,
      totalChecks: 0,
      totalItems: 0,
      hasMore: false,
    };
  }
};

// Filial bo'yicha guruhlangan remains
const getBranchGroupedRemainsPage = async (
  supplierName,
  page = 1,
  productsPerPage = 4
) => {
  try {
    // Mahsulot bo'yicha guruhlash va har bir filial ma'lumotini olish
    const productGroups = await Remains.aggregate([
      { $match: { manufacturer: supplierName } },
      {
        $group: {
          _id: "$product",
          branches: {
            $push: {
              branch: "$branch",
              quantity: "$quantity",
              unit: "$unit",
              location: "$location",
              series: "$series",
              shelfLife: "$shelfLife",
            },
          },
          totalQuantity: { $sum: "$quantity" },
          unit: { $first: "$unit" },
        },
      },
      { $sort: { totalQuantity: -1 } },
    ]);

    const totalProducts = productGroups.length;
    const totalPages = Math.ceil(totalProducts / productsPerPage);
    const startIndex = (page - 1) * productsPerPage;
    const endIndex = startIndex + productsPerPage;
    const pageProducts = productGroups.slice(startIndex, endIndex);

    return {
      products: pageProducts,
      currentPage: page,
      totalPages: totalPages,
      totalProducts: totalProducts,
      hasMore: page < totalPages,
    };
  } catch (error) {
    console.error("Branch grouped remains sahifa olishda xato:", error);
    return {
      products: [],
      currentPage: 1,
      totalPages: 1,
      totalProducts: 0,
      hasMore: false,
    };
  }
};

// Grouped sales sahifasini formatlash (vaqt bilan)
const formatGroupedSalesPage = (pageData) => {
  if (pageData.checks.length === 0) {
    return "📊 *Продажи не найдены*";
  }

  let message = `📊 *Ваши продажи*\n`;
  message += `🧾 ${pageData.totalChecks} чеков, ${pageData.totalItems} товаров\n\n`;

  pageData.checks.forEach((checkData, checkIndex) => {
    const globalCheckIndex = (pageData.currentPage - 1) * 3 + checkIndex + 1;
    message += `${globalCheckIndex}. 🧾 *Чек №${checkData.checkNumber}*\n`;
    message += `📅 ${formatDateTime(checkData.createdAt)}\n`; // Vaqt qo'shildi
    message += `💰 ${checkData.totalAmount.toLocaleString()} сум\n`;

    if (checkData.paymentCash > 0) {
      message += `💵 Наличные: ${checkData.paymentCash.toLocaleString()}\n`;
    }
    if (checkData.paymentBankCard > 0) {
      message += `💳 Карта: ${checkData.paymentBankCard.toLocaleString()}\n`;
    }

    message += `\n📦 *Товары в чеке:*\n`;

    checkData.items.forEach((item, itemIndex) => {
      message += `   ${itemIndex + 1}. 💊 ${item.product}\n`;
      message += `      📊 ${item.quantity} шт\n`;

      if (item.manufacturer) {
        message += `      🏭 ${item.manufacturer}\n`;
      }
    });
    message += "\n";
  });

  return message;
};

// Branch grouped remains sahifasini formatlash
const formatBranchGroupedRemainsPage = (pageData) => {
  if (pageData.products.length === 0) {
    return "📦 *Остатки не найдены*";
  }

  let message = `📦 *Ваши остатки (${pageData.totalProducts} товаров)*\n\n`;

  pageData.products.forEach((product, index) => {
    const globalIndex = (pageData.currentPage - 1) * 4 + index + 1;
    message += `${globalIndex}. 💊 *${product._id}*\n`;
    message += `📊 Общее количество: ${product.totalQuantity.toFixed(0)} ${
      product.unit || "шт"
    }\n\n`;

    // Filiallar bo'yicha guruhlash
    const branchGroups = new Map();
    product.branches.forEach((branch) => {
      const branchName = branch.branch || "Неизвестный филиал";
      if (!branchGroups.has(branchName)) {
        branchGroups.set(branchName, []);
      }
      branchGroups.get(branchName).push(branch);
    });

    message += `🏪 *По филиалам:*\n`;
    let branchIndex = 1;
    for (const [branchName, branchItems] of branchGroups) {
      const branchTotal = branchItems.reduce(
        (sum, item) => sum + item.quantity,
        0
      );
      message += `   ${branchIndex}. 🏢 ${branchName}\n`;
      message += `      📊 ${branchTotal.toFixed(0)} ${product.unit || "шт"}\n`;

      // Seriya va lokatsiya ma'lumotlari
      const uniqueSeries = [
        ...new Set(
          branchItems.map((item) => item.series).filter((s) => s && s !== "-")
        ),
      ];
      const uniqueLocations = [
        ...new Set(
          branchItems.map((item) => item.location).filter((l) => l && l !== "-")
        ),
      ];

      if (uniqueSeries.length > 0) {
        message += `      📋 ${uniqueSeries.slice(0, 2).join(", ")}\n`;
      }
      if (uniqueLocations.length > 0) {
        message += `      📍 ${uniqueLocations.slice(0, 2).join(", ")}\n`;
      }

      branchIndex++;
    }
    message += "\n";
  });

  return message;
};

// Kam qoldiq tekshirish va notification jo'natish
const checkLowStockAndNotify = async () => {
  try {
    console.log("🔍 Kam qoldiqlar tekshirilmoqda...");

    // Har bir supplier uchun kam qoldiqlarni topish
    const suppliers = await Supplier.find({ isActive: true });

    for (const supplier of suppliers) {
      // Unit 'шт' bo'lgan va 10 dan kam qoldiq bor mahsulotlarni topish
      const lowStockItems = await Remains.aggregate([
        {
          $match: {
            manufacturer: supplier.name,
            $or: [
              { unit: "шт" },
              { unit: "штук" },
              { unit: "шт." },
              { unit: null },
              { unit: "" },
            ],
          },
        },
        {
          $group: {
            _id: {
              product: "$product",
              branch: "$branch",
            },
            totalQuantity: { $sum: "$quantity" },
            unit: { $first: "$unit" },
            location: { $first: "$location" },
            series: { $first: "$series" },
          },
        },
        {
          $match: {
            totalQuantity: { $lt: 10 },
          },
        },
        { $sort: { totalQuantity: 1 } },
      ]);

      if (lowStockItems.length > 0) {
        console.log(
          `⚠️ ${supplier.name}: ${lowStockItems.length} ta kam qoldiq topildi`
        );
        await notifySupplierLowStock(supplier._id, lowStockItems);
      }
    }
  } catch (error) {
    console.error("❌ Kam qoldiq tekshirishda xato:", error);
  }
};

// Supplier ga kam qoldiq haqida xabar jo'natish
const notifySupplierLowStock = async (supplierId, lowStockItems) => {
  try {
    const telegramUser = await TelegramUser.findOne({
      userId: supplierId,
      userType: "supplier",
    });

    if (!telegramUser) return;

    const supplier = await Supplier.findById(supplierId);
    if (!supplier) return;

    // Notification message yaratish
    let message = `⚠️ *Критически низкие остатки!*\n\n`;
    message += `🏭 ${supplier.name}\n`;
    message += `📊 Найдено ${lowStockItems.length} позиций с остатком менее 10 шт\n\n`;

    // Eng past qoldiqlarni ko'rsatish (maksimum 8 ta)
    const itemsToShow = lowStockItems.slice(0, 8);

    itemsToShow.forEach((item, index) => {
      message += `${index + 1}. 💊 *${item._id.product}*\n`;
      message += `   🏢 ${item._id.branch || "Неизвестный филиал"}\n`;
      message += `   📊 Остаток: ${item.totalQuantity} шт\n`;
      if (item.series && item.series !== "-") {
        message += `   📋 ${item.series}\n`;
      }
      if (item.location && item.location !== "-") {
        message += `   📍 ${item.location}\n`;
      }
      message += "\n";
    });

    if (lowStockItems.length > 8) {
      message += `... и еще ${lowStockItems.length - 8} позиций\n\n`;
    }

    message += `💡 *Рекомендуется пополнить остатки*`;

    await bot.sendMessage(telegramUser.chatId, message, {
      parse_mode: "Markdown",
    });

    console.log(`✅ Notification sent to ${supplier.name}`);
  } catch (error) {
    console.error("❌ Supplier notification xatosi:", error);
  }
};

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userStates.delete(chatId);
  userPaginationData.delete(chatId);
  bot.sendMessage(chatId, "👋 Добро пожаловать! Выберите тип входа:", mainMenu);
});

// Callback query handler
bot.on("callback_query", async (callbackQuery) => {
  const message = callbackQuery.message;
  const data = callbackQuery.data;
  const chatId = message.chat.id;

  try {
    // Sales pagination
    if (data.startsWith("sales_page_")) {
      const page = parseInt(data.split("_")[2]);
      const paginationData = userPaginationData.get(chatId);

      if (paginationData && paginationData.type === "sales") {
        const pageData = await getGroupedSalesPage(
          paginationData.doctorCode,
          page
        );
        const messageText = formatGroupedSalesPage(pageData);
        const buttons = createPaginationButtons(
          page,
          pageData.totalPages,
          "sales"
        );

        await bot.editMessageText(messageText, {
          chat_id: chatId,
          message_id: message.message_id,
          parse_mode: "Markdown",
          ...buttons,
        });
      }
    }

    // Remains pagination
    else if (data.startsWith("remains_page_")) {
      const page = parseInt(data.split("_")[2]);
      const paginationData = userPaginationData.get(chatId);

      if (paginationData && paginationData.type === "remains") {
        const pageData = await getBranchGroupedRemainsPage(
          paginationData.supplierName,
          page
        );
        const messageText = formatBranchGroupedRemainsPage(pageData);
        const buttons = createPaginationButtons(
          page,
          pageData.totalPages,
          "remains"
        );

        await bot.editMessageText(messageText, {
          chat_id: chatId,
          message_id: message.message_id,
          parse_mode: "Markdown",
          ...buttons,
        });
      }
    }

    // Close buttons
    else if (data === "sales_close" || data === "remains_close") {
      userPaginationData.delete(chatId);
      await bot.deleteMessage(chatId, message.message_id);
    } else if (data === "info") {
      // Do nothing
    }

    await bot.answerCallbackQuery(callbackQuery.id);
  } catch (error) {
    console.error("Callback query xatosi:", error);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: "Xatolik yuz berdi",
    });
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === "/start") return;

  const userState = userStates.get(chatId) || {};

  try {
    // Основные команды
    if (text === "👨‍⚕️ Войти как врач") {
      userStates.set(chatId, { type: "doctor_login", step: "username" });
      bot.sendMessage(chatId, "👤 Введите логин:");
      return;
    }

    if (text === "🏭 Войти как поставщик") {
      userStates.set(chatId, { type: "supplier_login", step: "username" });
      bot.sendMessage(chatId, "👤 Введите логин:");
      return;
    }

    if (text === "🚪 Выйти") {
      await TelegramUser.deleteOne({ chatId });
      userStates.delete(chatId);
      userPaginationData.delete(chatId);
      bot.sendMessage(chatId, "👋 Вы вышли из системы", mainMenu);
      return;
    }

    // Авторизация врача
    if (userState.type === "doctor_login") {
      if (userState.step === "username") {
        userState.username = text;
        userState.step = "password";
        userStates.set(chatId, userState);
        bot.sendMessage(chatId, "🔐 Введите пароль:");
        return;
      }

      if (userState.step === "password") {
        const doctor = await Doctor.findOne({
          login: userState.username,
          password: text,
          isActive: true,
        });

        if (doctor) {
          await TelegramUser.findOneAndUpdate(
            { chatId },
            { chatId, userType: "doctor", userId: doctor._id },
            { upsert: true }
          );

          userStates.delete(chatId);
          bot.sendMessage(
            chatId,
            `✅ Добро пожаловать, ${doctor.name}!`,
            doctorMenu
          );
        } else {
          userStates.delete(chatId);
          bot.sendMessage(chatId, "❌ Неверные данные для входа", mainMenu);
        }
        return;
      }
    }

    // Авторизация поставщика
    if (userState.type === "supplier_login") {
      if (userState.step === "username") {
        userState.username = text;
        userState.step = "password";
        userStates.set(chatId, userState);
        bot.sendMessage(chatId, "🔐 Введите пароль:");
        return;
      }

      if (userState.step === "password") {
        const supplier = await Supplier.findOne({
          username: userState.username,
          password: text,
          isActive: true,
        });

        if (supplier) {
          await TelegramUser.findOneAndUpdate(
            { chatId },
            { chatId, userType: "supplier", userId: supplier._id },
            { upsert: true }
          );

          userStates.delete(chatId);
          bot.sendMessage(
            chatId,
            `✅ Добро пожаловать, ${supplier.name}!`,
            supplierMenu
          );
        } else {
          userStates.delete(chatId);
          bot.sendMessage(chatId, "❌ Неверные данные для входа", mainMenu);
        }
        return;
      }
    }

    // Команды для авторизованных пользователей
    const telegramUser = await TelegramUser.findOne({ chatId });
    if (!telegramUser) {
      bot.sendMessage(chatId, "🔐 Пожалуйста, войдите в систему", mainMenu);
      return;
    }

    // Команды врача
    if (telegramUser.userType === "doctor") {
      if (text === "📊 Мои продажи") {
        const doctor = await Doctor.findById(telegramUser.userId);
        const pageData = await getGroupedSalesPage(doctor.code, 1);

        if (pageData.totalChecks === 0) {
          bot.sendMessage(chatId, "📊 У вас пока нет продаж");
          return;
        }

        userPaginationData.set(chatId, {
          type: "sales",
          doctorCode: doctor.code,
        });

        const messageText = formatGroupedSalesPage(pageData);
        const buttons = createPaginationButtons(
          1,
          pageData.totalPages,
          "sales"
        );

        bot.sendMessage(chatId, messageText, {
          parse_mode: "Markdown",
          ...buttons,
        });
        return;
      }
    }

    // Команды поставщика
    if (telegramUser.userType === "supplier") {
      if (text === "📦 Остатки") {
        const supplier = await Supplier.findById(telegramUser.userId);
        const pageData = await getBranchGroupedRemainsPage(supplier.name, 1);

        if (pageData.totalProducts === 0) {
          bot.sendMessage(chatId, "📦 Остатки не найдены");
          return;
        }

        userPaginationData.set(chatId, {
          type: "remains",
          supplierName: supplier.name,
        });

        const messageText = formatBranchGroupedRemainsPage(pageData);
        const buttons = createPaginationButtons(
          1,
          pageData.totalPages,
          "remains"
        );

        bot.sendMessage(chatId, messageText, {
          parse_mode: "Markdown",
          ...buttons,
        });
        return;
      }

      if (text === "📈 Статистика") {
        const supplier = await Supplier.findById(telegramUser.userId);

        // Jami mahsulotlar
        const totalProducts = await Remains.aggregate([
          { $match: { manufacturer: supplier.name } },
          { $group: { _id: "$product" } },
          { $count: "total" },
        ]);

        // Umumiy miqdor
        const totalQuantityResult = await Remains.aggregate([
          { $match: { manufacturer: supplier.name } },
          { $group: { _id: null, total: { $sum: "$quantity" } } },
        ]);

        // Kam qoldiq (shт uchun)
        const lowStockResult = await Remains.aggregate([
          {
            $match: {
              manufacturer: supplier.name,
              $or: [
                { unit: "шт" },
                { unit: "штук" },
                { unit: "шт." },
                { unit: null },
                { unit: "" },
              ],
            },
          },
          {
            $group: {
              _id: { product: "$product", branch: "$branch" },
              totalQuantity: { $sum: "$quantity" },
            },
          },
          {
            $match: { totalQuantity: { $lt: 10 } },
          },
          { $count: "total" },
        ]);

        const totalQuantity = totalQuantityResult[0]?.total || 0;
        const productCount = totalProducts[0]?.total || 0;
        const lowStock = lowStockResult[0]?.total || 0;

        let message = `📈 *Статистика - ${supplier.name}*\n\n`;
        message += `📊 Всего товаров: ${productCount}\n`;
        message += `📦 Общее количество: ${totalQuantity.toLocaleString(
          "ru-RU"
        )}\n`;
        message += `⚠️ Низкий остаток: ${lowStock} позиций\n`;

        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
        return;
      }
    }

    // Неизвестная команда
    if (telegramUser.userType === "doctor") {
      bot.sendMessage(
        chatId,
        "❓ Команда не распознана. Используйте меню.",
        doctorMenu
      );
    } else if (telegramUser.userType === "supplier") {
      bot.sendMessage(
        chatId,
        "❓ Команда не распознана. Используйте меню.",
        supplierMenu
      );
    } else {
      bot.sendMessage(chatId, "❓ Команда не распознана", mainMenu);
    }
  } catch (error) {
    console.error("❌ Ошибка в боте:", error);
    bot.sendMessage(chatId, "⚠️ Произошла ошибка. Попробуйте позже.");
  }
});

// Функция отправки уведомлений о новых продажах
export const notifyDoctorAboutSale = async (saleId, doctorCode) => {
  try {
    const doctor = await Doctor.findOne({ code: doctorCode });
    if (!doctor) return;

    const telegramUser = await TelegramUser.findOne({
      userId: doctor._id,
      userType: "doctor",
    });
    if (!telegramUser) return;

    if (telegramUser.lastNotifiedSales?.includes(saleId)) return;

    const sale = await Sales.findOne({ id: saleId });
    if (!sale || !sale.items || sale.items.length === 0) return;

    let message = `🔔 *Новая продажа!*\n\n`;
    message += `🧾 Чек №${sale.number}\n`;
    message += `💰 ${sale.soldAmount.toLocaleString()} сум\n`;
    message += `📅 ${formatDateTime(sale.createdAt)}\n\n`; // Vaqt qo'shildi
    message += `📦 *Товары:*\n`;

    sale.items.forEach((item, index) => {
      message += `${index + 1}. 💊 ${item.product}\n`;
      message += `   📊 ${item.quantity} шт\n`;
      if (item.series && item.series !== "-") {
        message += `   📋 ${item.series}\n`;
      }
    });

    await bot.sendMessage(telegramUser.chatId, message, {
      parse_mode: "Markdown",
    });

    await TelegramUser.findByIdAndUpdate(telegramUser._id, {
      $push: { lastNotifiedSales: saleId },
    });
  } catch (error) {
    console.error("❌ Ошибка отправки уведомления:", error);
  }
};

export { checkLowStockAndNotify, notifySupplierLowStock };
export default bot;
