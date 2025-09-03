// utils/telegramBot.js - enhanced version with full Russian language

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

// Pagination кнопок создание
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
      text: "⬅️ Предыдущая",
      callback_data: `${prefix}_page_${currentPage - 1}`,
    });
  }

  if (currentPage < totalPages) {
    row1.push({
      text: "Следующая ➡️",
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
    { text: "❌ Закрыть", callback_data: `${prefix}_close` },
  ]);

  return {
    reply_markup: {
      inline_keyboard: buttons,
    },
  };
};

// Время форматирование
const formatDateTime = (date) => {
  const d = new Date(date);
  const dateStr = d.toLocaleDateString("ru-RU");
  const timeStr = d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dateStr} ${timeStr}`;
};

// Числа форматирование
const formatNumber = (num) => {
  return new Intl.NumberFormat("ru-RU").format(num);
};

// Процентов форматирование
const formatPercentage = (value, total) => {
  if (total === 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
};

// Профессиональная статистика сообщение создание
const createProfessionalStatisticsMessage = (supplier, stats) => {
  const {
    totalProducts,
    totalQuantity,
    lowStock,
    criticalStock,
    topProducts,
    branchesCount,
    totalValue,
    averageQuantityPerProduct,
    stockHealth,
  } = stats;

  let message = `📊 *АНАЛИТИЧЕСКИЙ ОТЧЁТ*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Header with supplier info
  message += `🏭 *${supplier.name}*\n`;
  message += `📅 ${formatDateTime(new Date())}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Key Performance Indicators
  message += `📈 *КЛЮЧЕВЫЕ ПОКАЗАТЕЛИ*\n\n`;

  message += `📦 *Товарная линейка:* ${formatNumber(totalProducts)} позиций\n`;
  message += `📊 *Общий объём:* ${formatNumber(totalQuantity)} единиц\n`;
  message += `🏢 *Филиалы:* ${branchesCount} точек\n`;
  if (totalValue > 0) {
    message += `💰 *Стоимость остатков:* ${formatNumber(totalValue)} сум\n`;
  }
  message += `📋 *Средний остаток:* ${formatNumber(
    averageQuantityPerProduct
  )} ед/товар\n\n`;

  // Stock Health Analysis
  message += `🎯 *АНАЛИЗ ОСТАТКОВ*\n\n`;

  const healthEmoji =
    stockHealth >= 80 ? "🟢" : stockHealth >= 60 ? "🟡" : "🔴";
  message += `${healthEmoji} *Здоровье склада:* ${stockHealth}%\n`;

  if (lowStock > 0) {
    message += `⚠️ *Низкий остаток:* ${lowStock} позиций (${formatPercentage(
      lowStock,
      totalProducts
    )})\n`;
  }

  if (criticalStock > 0) {
    message += `🔥 *Критический уровень:* ${criticalStock} позиций (${formatPercentage(
      criticalStock,
      totalProducts
    )})\n`;
  }

  if (lowStock === 0 && criticalStock === 0) {
    message += `✅ *Все позиции в норме*\n`;
  }

  message += `\n`;

  // Distribution Analysis
  const highStockItems = totalProducts - lowStock - criticalStock;
  message += `📊 *РАСПРЕДЕЛЕНИЕ ОСТАТКОВ*\n\n`;
  message += `🟢 Достаточно: ${highStockItems} (${formatPercentage(
    highStockItems,
    totalProducts
  )})\n`;
  message += `🟡 Мало: ${lowStock} (${formatPercentage(
    lowStock,
    totalProducts
  )})\n`;
  message += `🔴 Критично: ${criticalStock} (${formatPercentage(
    criticalStock,
    totalProducts
  )})\n\n`;

  // Top Products
  if (topProducts && topProducts.length > 0) {
    message += `🏆 *ТОП ПОЗИЦИИ ПО ОСТАТКАМ*\n\n`;
    topProducts.slice(0, 5).forEach((product, index) => {
      const medal =
        index === 0
          ? "🥇"
          : index === 1
          ? "🥈"
          : index === 2
          ? "🥉"
          : `${index + 1}.`;
      message += `${medal} *${product.name}*\n`;
      message += `   📊 ${formatNumber(product.quantity)} ${
        product.unit || "шт"
      }\n`;
      if (product.branches > 1) {
        message += `   🏢 ${product.branches} филиалов\n`;
      }
      message += `\n`;
    });
  }

  // Recommendations
  message += `💡 *РЕКОМЕНДАЦИИ*\n\n`;

  if (criticalStock > 0) {
    message += `🔥 *Срочно:* Пополните ${criticalStock} позиций\n`;
  }

  if (lowStock > 0) {
    message += `⚠️ *В ближайшее время:* Закажите ${lowStock} позиций\n`;
  }

  if (stockHealth >= 80) {
    message += `✅ *Отлично:* Уровень остатков оптимальный\n`;
  } else if (stockHealth >= 60) {
    message += `📋 *Хорошо:* Мониторьте ключевые позиции\n`;
  } else {
    message += `📈 *Требует внимания:* Необходимо пополнение\n`;
  }

  message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `🤖 _Автоматический отчёт системы_\n`;
  message += `⏰ _Обновлено: ${formatDateTime(new Date())}_`;

  return message;
};

// Поставщик статистики рассчет
const calculateSupplierStatistics = async (supplierName) => {
  try {
    // Основной aggregation
    const pipeline = [
      { $match: { manufacturer: supplierName } },
      {
        $group: {
          _id: {
            product: "$product",
            branch: "$branch",
          },
          totalQuantity: { $sum: "$quantity" },
          unit: { $first: "$unit" },
          buyPrice: { $first: "$buyPrice" },
          salePrice: { $first: "$salePrice" },
          location: { $first: "$location" },
          series: { $first: "$series" },
        },
      },
    ];

    const groupedData = await Remains.aggregate(pipeline);

    // Products по группировка
    const productStats = new Map();
    let totalQuantity = 0;
    let totalValue = 0;
    const branches = new Set();

    groupedData.forEach((item) => {
      const productName = item._id.product;
      const branchName = item._id.branch;

      branches.add(branchName);
      totalQuantity += item.totalQuantity;

      if (item.buyPrice) {
        totalValue += item.totalQuantity * item.buyPrice;
      }

      if (!productStats.has(productName)) {
        productStats.set(productName, {
          name: productName,
          totalQuantity: 0,
          unit: item.unit,
          branches: new Set(),
          locations: new Set(),
        });
      }

      const product = productStats.get(productName);
      product.totalQuantity += item.totalQuantity;
      product.branches.add(branchName);
      if (item.location) product.locations.add(item.location);
    });

    // Статистика рассчет
    const products = Array.from(productStats.values());
    const totalProducts = products.length;

    // Low stock ва critical stock рассчет
    let lowStock = 0;
    let criticalStock = 0;

    products.forEach((product) => {
      if (product.unit === "шт" || product.unit === "штук" || !product.unit) {
        if (product.totalQuantity < 5) {
          criticalStock++;
        } else if (product.totalQuantity < 20) {
          lowStock++;
        }
      }
    });

    // Top products
    const topProducts = products
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 10)
      .map((product) => ({
        name: product.name,
        quantity: product.totalQuantity,
        unit: product.unit,
        branches: product.branches.size,
      }));

    // Stock health рассчет
    const healthyStock = totalProducts - lowStock - criticalStock;
    const stockHealth = Math.round((healthyStock / totalProducts) * 100);

    return {
      totalProducts,
      totalQuantity,
      lowStock,
      criticalStock,
      topProducts,
      branchesCount: branches.size,
      totalValue,
      averageQuantityPerProduct: Math.round(totalQuantity / totalProducts),
      stockHealth: isNaN(stockHealth) ? 100 : stockHealth,
    };
  } catch (error) {
    console.error("Statistics calculation error:", error);
    return {
      totalProducts: 0,
      totalQuantity: 0,
      lowStock: 0,
      criticalStock: 0,
      topProducts: [],
      branchesCount: 0,
      totalValue: 0,
      averageQuantityPerProduct: 0,
      stockHealth: 0,
    };
  }
};

// Sales информацию чек номер по группировка (время с)
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
            createdAt: sale.createdAt,
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
    console.error("Grouped sales страница получения ошибка:", error);
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

// Филиал по группированные остатки
const getBranchGroupedRemainsPage = async (
  supplierName,
  page = 1,
  productsPerPage = 4
) => {
  try {
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
    console.error("Branch grouped remains страница получения ошибка:", error);
    return {
      products: [],
      currentPage: 1,
      totalPages: 1,
      totalProducts: 0,
      hasMore: false,
    };
  }
};

// Grouped sales страница форматирование (время с)
const formatGroupedSalesPage = (pageData) => {
  if (pageData.checks.length === 0) {
    return "📊 *Продажи не найдены*";
  }

  let message = `📊 *ОТЧЁТ ПО ПРОДАЖАМ*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  message += `🧾 *Всего чеков:* ${formatNumber(pageData.totalChecks)}\n`;
  message += `📦 *Всего товаров:* ${formatNumber(pageData.totalItems)}\n\n`;

  pageData.checks.forEach((checkData, checkIndex) => {
    const globalCheckIndex = (pageData.currentPage - 1) * 3 + checkIndex + 1;
    message += `${globalCheckIndex}. 🧾 *Чек №${checkData.checkNumber}*\n`;
    message += `📅 ${formatDateTime(checkData.createdAt)}\n`;
    message += `💰 *${formatNumber(checkData.totalAmount)} сум*\n`;

    if (checkData.paymentCash > 0) {
      message += `💵 Наличные: ${formatNumber(checkData.paymentCash)}\n`;
    }
    if (checkData.paymentBankCard > 0) {
      message += `💳 Карта: ${formatNumber(checkData.paymentBankCard)}\n`;
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

  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `🤖 _Автоматический отчёт системы_\n`;
  message += `⏰ _${formatDateTime(new Date())}_`;

  return message;
};

// Branch grouped remains страница форматирование
const formatBranchGroupedRemainsPage = (pageData) => {
  if (pageData.products.length === 0) {
    return "📦 *Остатки не найдены*";
  }

  let message = `📦 *СКЛАДСКИЕ ОСТАТКИ*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  message += `📊 *Всего позиций:* ${formatNumber(pageData.totalProducts)}\n\n`;

  pageData.products.forEach((product, index) => {
    const globalIndex = (pageData.currentPage - 1) * 4 + index + 1;
    message += `${globalIndex}. 💊 *${product._id}*\n`;
    message += `📊 *Общий остаток:* ${formatNumber(product.totalQuantity)} ${
      product.unit || "шт"
    }\n\n`;

    // Филиалы по группировка
    const branchGroups = new Map();
    product.branches.forEach((branch) => {
      const branchName = branch.branch || "Неизвестный филиал";
      if (!branchGroups.has(branchName)) {
        branchGroups.set(branchName, []);
      }
      branchGroups.get(branchName).push(branch);
    });

    message += `🏪 *Филиалы:*\n`;
    let branchIndex = 1;
    for (const [branchName, branchItems] of branchGroups) {
      const branchTotal = branchItems.reduce(
        (sum, item) => sum + item.quantity,
        0
      );
      message += `   ${branchIndex}. 🏢 ${branchName}\n`;
      message += `      📊 ${formatNumber(branchTotal)} ${
        product.unit || "шт"
      }\n`;

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

  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `🤖 _Автоматический отчёт системы_\n`;
  message += `⏰ _${formatDateTime(new Date())}_`;

  return message;
};

// Низкие остатки проверка и уведомление отправка
const checkLowStockAndNotify = async () => {
  try {
    console.log("🔍 Низкие остатки проверяются...");

    const suppliers = await Supplier.find({ isActive: true });

    for (const supplier of suppliers) {
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
          `⚠️ ${supplier.name}: ${lowStockItems.length} низких остатков найдено`
        );
        await notifySupplierLowStock(supplier._id, lowStockItems);
      }
    }
  } catch (error) {
    console.error("❌ Низкие остатки проверка ошибка:", error);
  }
};

// Поставщику низкие остатки уведомление отправка
const notifySupplierLowStock = async (supplierId, lowStockItems) => {
  try {
    const telegramUser = await TelegramUser.findOne({
      userId: supplierId,
      userType: "supplier",
    });

    if (!telegramUser) return;

    const supplier = await Supplier.findById(supplierId);
    if (!supplier) return;

    let message = `🚨 *КРИТИЧЕСКОЕ УВЕДОМЛЕНИЕ*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `🏭 *${supplier.name}*\n`;
    message += `📅 ${formatDateTime(new Date())}\n\n`;
    message += `⚠️ *Обнаружены критически низкие остатки*\n`;
    message += `📊 Найдено *${lowStockItems.length} позиций* с остатком менее 10 шт\n\n`;

    const itemsToShow = lowStockItems.slice(0, 8);

    itemsToShow.forEach((item, index) => {
      const urgencyEmoji =
        item.totalQuantity < 3 ? "🔥" : item.totalQuantity < 5 ? "⚠️" : "📦";
      message += `${urgencyEmoji} ${index + 1}. *${item._id.product}*\n`;
      message += `   🏢 ${item._id.branch || "Неизвестный филиал"}\n`;
      message += `   📊 Остаток: *${item.totalQuantity} шт*\n`;
      if (item.series && item.series !== "-") {
        message += `   📋 ${item.series}\n`;
      }
      if (item.location && item.location !== "-") {
        message += `   📍 ${item.location}\n`;
      }
      message += "\n";
    });

    if (lowStockItems.length > 8) {
      message += `📋 ... и ещё *${lowStockItems.length - 8} позиций*\n\n`;
    }

    message += `🎯 *РЕКОМЕНДАЦИИ:*\n`;
    message += `• Срочно пополните критичные позиции (< 5 шт)\n`;
    message += `• Запланируйте закупку товаров с низким остатком\n`;
    message += `• Проверьте прогнозы продаж по данным позициям\n\n`;

    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `🤖 _Система управления аптекой_\n`;
    message += `⚠️ _Критический уровень: < 10 шт_`;

    await bot.sendMessage(telegramUser.chatId, message, {
      parse_mode: "Markdown",
    });

    console.log(
      `✅ Профессиональное уведомление о низких остатках отправлено ${supplier.name}`
    );
  } catch (error) {
    console.error("❌ Поставщик уведомление ошибка:", error);
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
    console.error("Callback query ошибка:", error);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: "Произошла ошибка",
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
        });

        if (supplier) {
          // Деактивация проверка
          if (!supplier.isActive) {
            userStates.delete(chatId);
            bot.sendMessage(
              chatId,
              "❌ Ваш аккаунт деактивирован. Обратитесь к администратору для активации.",
              mainMenu
            );
            return;
          }

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
      // Поставщик активности проверка
      const supplier = await Supplier.findById(telegramUser.userId);
      if (!supplier || !supplier.isActive) {
        await TelegramUser.deleteOne({ chatId });
        userStates.delete(chatId);
        userPaginationData.delete(chatId);
        bot.sendMessage(
          chatId,
          "❌ Ваш аккаунт был деактивирован. Обратитесь к администратору.",
          mainMenu
        );
        return;
      }

      if (text === "📦 Остатки") {
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
        // Loading message
        const loadingMessage = await bot.sendMessage(
          chatId,
          "📊 Подготавливаю детальную аналитику...\n⏰ Пожалуйста, подождите несколько секунд",
          { parse_mode: "Markdown" }
        );

        try {
          // Comprehensive statistics рассчет
          const stats = await calculateSupplierStatistics(supplier.name);

          // Professional message создание
          const statisticsMessage = createProfessionalStatisticsMessage(
            supplier,
            stats
          );

          // Loading message удаление и statistics отправка
          await bot.deleteMessage(chatId, loadingMessage.message_id);
          await bot.sendMessage(chatId, statisticsMessage, {
            parse_mode: "Markdown",
          });
        } catch (error) {
          await bot.deleteMessage(chatId, loadingMessage.message_id);
          await bot.sendMessage(
            chatId,
            "❌ Произошла ошибка при создании отчёта. Попробуйте позже."
          );
          console.error("Statistics generation error:", error);
        }
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
    console.error("❌ Бот ошибка:", error);
    bot.sendMessage(chatId, "⚠️ Произошла ошибка. Попробуйте позже.");
  }
});

// Новые продажи уведомления функция
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

    let message = `🔔 *НОВАЯ ПРОДАЖА*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `👨‍⚕️ Dr. ${doctor.name}\n`;
    message += `🧾 Чек №${sale.number}\n`;
    message += `💰 ${formatNumber(sale.soldAmount)} сум\n`;
    message += `📅 ${formatDateTime(sale.createdAt)}\n\n`;
    message += `📦 *Товары:*\n`;

    sale.items.forEach((item, index) => {
      message += `${index + 1}. 💊 ${item.product}\n`;
      message += `   📊 ${item.quantity} шт\n`;
      if (item.series && item.series !== "-") {
        message += `   📋 ${item.series}\n`;
      }
    });

    message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `🤖 _Автоматическое уведомление_\n`;
    message += `⏰ _${formatDateTime(new Date())}_`;

    await bot.sendMessage(telegramUser.chatId, message, {
      parse_mode: "Markdown",
    });

    await TelegramUser.findByIdAndUpdate(telegramUser._id, {
      $push: { lastNotifiedSales: saleId },
    });
  } catch (error) {
    console.error("❌ Уведомление отправка ошибка:", error);
  }
};

// Врачу админ сообщение отправка
export const sendMessageToDoctor = async (chatId, message, doctorName) => {
  try {
    const formattedMessage =
      `📢 *СООБЩЕНИЕ ОТ АДМИНИСТРАТОРА*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👨‍⚕️ Dr. ${doctorName}\n\n` +
      `💬 ${message}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🏥 _Система управления аптекой_\n` +
      `⏰ _${formatDateTime(new Date())}_`;

    await bot.sendMessage(chatId, formattedMessage, {
      parse_mode: "Markdown",
    });

    console.log(
      `✅ Профессиональное админ сообщение отправлено Dr. ${doctorName}`
    );
    return true;
  } catch (error) {
    console.error(`❌ Админ сообщение ошибка для Dr. ${doctorName}:`, error);
    return false;
  }
};

export { checkLowStockAndNotify, notifySupplierLowStock };
export default bot;
