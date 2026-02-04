// utils/telegramBot.js - to'liq versiya
import TelegramBot from "node-telegram-bot-api";
import Doctor from "../models/Doctor.js";
import Supplier from "../models/Supplier.js";
import TelegramUser from "../models/TelegramUser.js";
import axios from "axios";
import { config } from "dotenv";
import Sales from "../models/Sales.js";
import {
  getRemainsBySupplier,
  getSalesItems,
  getSuppliers,
  getRefreshStatus,
} from "./refreshData.js";
config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

const API_BASE = process.env.API_BASE_URL || "http://localhost:5000/api";

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

// Doktor sotuvlari uchun pagination кнопок создание (raqamlar bilan)
const createSalesPaginationButtons = (
  currentPage,
  totalPages,
  totalSales,
  sales
) => {
  const buttons = [];

  // Har bir sale uchun raqamli tugmalar (1-10)
  const saleButtons = [];
  sales.forEach((sale, index) => {
    const saleNumber = (currentPage - 1) * 10 + index + 1;
    saleButtons.push({
      text: saleNumber.toString(),
      callback_data: `sale_detail_${index}`,
    });
  });

  // 5 tadan bo'lib qatorlarga ajratish
  for (let i = 0; i < saleButtons.length; i += 5) {
    buttons.push(saleButtons.slice(i, i + 5));
  }

  // Navigation buttons
  const navButtons = [];
  if (currentPage > 1) {
    navButtons.push({
      text: "⬅️ Предыдущая",
      callback_data: `sales_page_${currentPage - 1}`,
    });
  }

  if (currentPage < totalPages) {
    navButtons.push({
      text: "Следующая ➡️",
      callback_data: `sales_page_${currentPage + 1}`,
    });
  }

  if (navButtons.length > 0) {
    buttons.push(navButtons);
  }

  buttons.push([
    { text: `📄 ${currentPage}/${totalPages}`, callback_data: "info" },
    { text: "❌ Закрыть", callback_data: `sales_close` },
  ]);

  return {
    reply_markup: {
      inline_keyboard: buttons,
    },
  };
};

// Barcha remains uchun pagination кнопок создание
const createAllRemainsPaginationButtons = (
  currentPage,
  totalPages,
  totalRemains
) => {
  const buttons = [];

  // Navigation buttons
  const navButtons = [];
  if (currentPage > 1) {
    navButtons.push({
      text: "⬅️ Предыдущая",
      callback_data: `remains_page_${currentPage - 1}`,
    });
  }

  if (currentPage < totalPages) {
    navButtons.push({
      text: "Следующая ➡️",
      callback_data: `remains_page_${currentPage + 1}`,
    });
  }

  if (navButtons.length > 0) {
    buttons.push(navButtons);
  }

  buttons.push([
    { text: `📄 ${currentPage}/${totalPages}`, callback_data: "info" },
    { text: "❌ Закрыть", callback_data: `remains_close` },
  ]);

  return {
    reply_markup: {
      inline_keyboard: buttons,
    },
  };
};

// Sale tafsilotlari uchun кнопок создание
const createSaleDetailButtons = (saleId, backPage) => {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "⬅️ Назад к списку",
            callback_data: `sales_page_${backPage}`,
          },
          { text: "❌ Закрыть", callback_data: "sales_close" },
        ],
      ],
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

// ИСПРАВЛЕНО: Правильный расчет quantity для отображения
const calculatePackages = (quantities, unit, pieceCount) => {
  // Agar quantities obyekt bo'lsa (supplier format - remains)
  if (quantities && typeof quantities === "object") {
    const units = quantities.units || 0;
    const pieces = quantities.pieces || 0;

    let result = "";
    if (units > 0) result += `${units} упак.`;
    if (pieces > 0) {
      if (result) result += " ";
      result += `${pieces} шт`;
    }

    return result || "0 шт";
  }

  // ИСПРАВЛЕНО: Agar quantity raqam bo'lsa (sales items format)
  if (typeof quantities === "number") {
    const qty = quantities;
    const pc = pieceCount || 1;

    // Упаковка сони (butun qism)
    const packages = Math.floor(qty);

    // Штук сони (qoldiq qism * pieceCount)
    const remainder = qty - packages;
    let pieces = Math.round(remainder * pc);

    // Agar pieces 0.999999 kabi bo'lsa, uni 1 qilish
    if (pieces >= pc) {
      pieces = pieces - pc;
      packages += 1;
    }

    let result = "";
    if (packages > 0) result += `${packages} упак.`;
    if (pieces > 0) {
      if (result) result += " ";
      result += `${pieces} шт`;
    }

    return result || "0 шт";
  }

  // Default
  return "0 шт";
};

// YANGI: API orqali doktor sotuvlarini olish (items'siz)
const fetchDoctorSalesFromAPI = async (doctorCode, page = 1, limit = 10) => {
  try {
    let filter = {
      $or: [
        { doctorCode: doctorCode },
        { doctorCode: String(doctorCode) },
        { notes: doctorCode },
        { notes: String(doctorCode) },
      ],
    };

    // Jami soni va umumiy summa uchun
    const totalCount = await Sales.countDocuments(filter);
    const totalAmountResult = await Sales.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: "$saleAmount" } } },
    ]);
    const totalAmount =
      totalAmountResult.length > 0 ? totalAmountResult[0].total : 0;

    // Faqat kerakli sahifadagi ma'lumotlarni olish
    const skip = (page - 1) * limit;
    const sales = await Sales.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return {
      data: sales,
      total: totalCount,
      totalAmount: totalAmount,
      pages: Math.ceil(totalCount / limit),
      currentPage: page,
    };
  } catch (error) {
    console.error("API xatosi (doctor sales):", error.message);
    throw new Error("Sotuvlarni yuklashda xato yuz berdi");
  }
};

// YANGI: API orqali supplier remainslarini olish
const fetchSupplierRemainsFromAPI = async (supplierName, page = 1) => {
  try {
    const suppliers = await getSuppliers();

    // 🔹 Tirnoq orasidagi textni olish uchun yordamchi funksiya
    const getCleanName = (name) => {
      if (!name) return "";
      const match = name.match(/"(.*?)"/); // " " orasidagi textni topish
      return match ? match[1].trim() : name.trim(); // agar yo‘q bo‘lsa, aslini qaytaradi
    };

    // 🔹 Kiruvchi supplier nomini tozalaymiz
    const cleanSupplierName = getCleanName(supplierName);

    // 🔹 Ro‘yxatdan mos supplierni topamiz
    const supplier = suppliers.find((s) => {
      const cleanName = getCleanName(s.name);
      return cleanName === cleanSupplierName.toUpperCase();
    });

    if (!supplier) {
      console.error(`❌ Supplier topilmadi: ${cleanSupplierName}`);
      return [];
    }

    console.log("✅ Topilgan supplier:", supplier);

    // 🔹 Supplier ID orqali ostatka olish
    const response = await getRemainsBySupplier(supplier.id);

    return response;
  } catch (error) {
    console.error("⚠️ API xatosi (supplier remains):", error.message);
    throw new Error("Ostatkalarni yuklashda xato yuz berdi");
  }
};

// YANGI: Doktor sotuvlarini sahifalash (har sahifada 10 ta sale)
const getDoctorSalesPage = async (doctorCode, page, limit = 10) => {
  try {
    const response = await fetchDoctorSalesFromAPI(doctorCode, page, limit);
    const { data: sales, total, totalAmount, pages } = response;

    // Har bir sale uchun items sonini hisoblash (faqat statistika uchun)
    const salesWithItemCount = sales.map((sale) => {
      // Sale ma'lumotlarini to'g'rilash
      const saleData = {
        ...sale,
        id: sale._id, // ID ni to'g'rilash
        itemsCount: sale.itemsCount || 0,
        soldAmount: sale.soldAmount || 0, // Sold amount (deprecated, use saleAmount instead)
        doctorName: sale.createdBy || "Неизвестен", // Doktor nomini createdBy dan olish
      };

      return saleData;
    });

    return {
      sales: salesWithItemCount,
      totalSales: total || 0,
      totalAmount: totalAmount || 0, // Jami summa API dan keladi
      totalPages: pages || 1,
      currentPage: page,
      hasMore: page < pages,
    };
  } catch (error) {
    throw error;
  }
};

// YANGI: Barcha remains'larni sahifalash (filial va mahsulot bo'yicha)
const getAllRemainsPage = async (supplierName, page, limit = 10) => {
  try {
    const response = await fetchSupplierRemainsFromAPI(supplierName, page);
    const remains = response || [];

    // Sahifalash uchun slice qilish
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const pageRemains = remains.slice(startIndex, endIndex);

    const totalPages = Math.ceil(remains.length / limit);

    return {
      remains: pageRemains,
      totalRemains: remains.length || 0,
      totalPages: totalPages || 1,
      currentPage: page,
      hasMore: endIndex < remains.length,
    };
  } catch (error) {
    throw error;
  }
};

// YANGI: Doktor sotuvlarini formatlash (har sahifada 10 ta sale)
const formatDoctorSalesPage = (pageData) => {
  let message = `📊 *МОИ ПРОДАЖИ*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (pageData.sales.length === 0) {
    return message + `📈 У вас пока нет продаж.`;
  }

  pageData.sales.forEach((sale, index) => {
    const saleNumber = (pageData.currentPage - 1) * 10 + index + 1;
    const dateStr = sale._doc.date
      ? new Date(sale._doc.date).toLocaleDateString("ru-RU")
      : sale._doc.createdAt
      ? new Date(sale._doc.createdAt).toLocaleDateString("ru-RU")
      : "Неизвестно";

    const saleAmount = sale._doc.saleAmount || 0;

    message += `${saleNumber}. 🧾 *Чек №${sale._doc.number}*\n`;
    message += `   📅 ${dateStr}\n`;
    message += `   💰 ${formatNumber(saleAmount)} сум\n`;
    message += `   📦 ${sale.itemsCount || 0} товаров\n\n`;
  });

  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `📄 Страница ${pageData.currentPage} из ${pageData.totalPages}\n`;
  message += `💰 Всего чеков: ${pageData.totalSales}\n`;
  message += `💵 *Общая сумма всех продаж: ${formatNumber(
    pageData.totalAmount || 0
  )} сум*\n`;
  message += `🤖 _Нажмите на номер чека для деталей_\n\n`;

  // Oxirgi yangilanish vaqti
  const refreshStatus = getRefreshStatus();
  if (refreshStatus.lastUpdate) {
    message += `🕐 _Последнее обновление: ${formatDateTime(refreshStatus.lastUpdate)}_`;
  }

  return message;
};

// YANGI: Barcha remains'larni formatlash (filial va mahsulot bo'yicha)
const formatAllRemainsPage = (pageData) => {
  let message = `📦 *ОСТАТКИ ТОВАРОВ*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (pageData.remains.length === 0) {
    return message + `📦 Остатки не найдены.`;
  }

  pageData.remains.forEach((remain, index) => {
    const remainNumber = (pageData.currentPage - 1) * 10 + index + 1;
    const quantityDisplay = calculatePackages(
      remain.quantities,
      remain.unit,
      remain.pieceCount
    );

    message += `${remainNumber}. 💊 *${remain.product}*\n`;
    message += `   🏢 ${remain.branch}\n`;
    message += `   📊 ${quantityDisplay}\n\n`;
  });

  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `📄 Страница ${pageData.currentPage} из ${pageData.totalPages}\n`;
  message += `📊 Всего товаров: ${pageData.totalRemains}\n`;
  message += `🤖 _Показаны все товары с остатками_\n\n`;

  // Oxirgi yangilanish vaqti
  const refreshStatus = getRefreshStatus();
  if (refreshStatus.lastUpdate) {
    message += `🕐 _Последнее обновление: ${formatDateTime(refreshStatus.lastUpdate)}_`;
  }

  return message;
};

// Профессиональная статистика сообщение создание (API dan hisoblash)
const createProfessionalStatisticsMessage = async (supplier, supplierName) => {
  try {
    const remains = (await fetchSupplierRemainsFromAPI(supplierName, 1)) || []; // Faqat statistika uchun 1 sahifa

    // Statistika hisoblash (oddiy misol)
    const totalProducts = remains.length;
    const lowStock = remains.filter(
      (r) => (r.quantities?.units || 0) + (r.quantities?.pieces || 0) < 5
    ).length;
    const criticalStock = remains.filter(
      (r) => (r.quantities?.units || 0) + (r.quantities?.pieces || 0) < 1
    ).length;
    const branchesCount = [...new Set(remains.map((r) => r.branch))].length;
    const stockHealth =
      totalProducts > 0 ? Math.round((1 - lowStock / totalProducts) * 100) : 0;

    const bottomProducts = remains
      .filter(
        (r) => (r.quantities?.units || 0) + (r.quantities?.pieces || 0) < 20
      )
      .slice(0, 5)
      .map((r) => ({
        name: r.product,
        displayQuantity: calculatePackages(r.quantities, r.unit, r.pieceCount),
        branches: [
          ...new Set(
            remains
              .filter((rr) => rr.product === r.product)
              .map((rr) => rr.branch)
          ),
        ].length,
        totalPieces:
          (r.quantities?.units || 0) * (r.pieceCount || 1) +
          (r.quantities?.pieces || 0),
      }));

    const stats = {
      totalProducts,
      lowStock,
      criticalStock,
      bottomProducts,
      branchesCount,
      stockHealth,
    };

    let message = `📊 *АНАЛИТИЧЕСКИЙ ОТЧЁТ*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Header with supplier info
    message += `🏭 *${supplier.name}*\n`;
    message += `📅 ${formatDateTime(new Date())}\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Key Performance Indicators
    message += `📈 *КЛЮЧЕВЫЕ ПОКАЗАТЕЛИ*\n\n`;
    message += `📦 *Товарная линейка:* ${formatNumber(
      totalProducts
    )} позиций\n`;
    message += `🏢 *Филиалы:* ${branchesCount} точек\n\n`;

    // Stock Health Analysis
    message += `🎯 *АНАЛИЗ ОСТАТКОВ*\n\n`;

    const healthEmoji =
      stockHealth >= 80 ? "🟢" : stockHealth >= 60 ? "🟡" : "🔴";
    message += `${healthEmoji} *Здоровье склада:* ${stockHealth}%\n`;

    if (lowStock > 0) {
      message += `⚠️ *Низкий остаток:* ${lowStock} позиций\n`;
    }

    if (criticalStock > 0) {
      message += `🔥 *Критический уровень:* ${criticalStock} позиций\n`;
    }

    if (lowStock === 0 && criticalStock === 0) {
      message += `✅ *Все позиции в норме*\n`;
    }

    message += `\n`;

    // Минимальные остатки
    if (bottomProducts && bottomProducts.length > 0) {
      message += `⚠️ *ПОЗИЦИИ С МИНИМАЛЬНЫМИ ОСТАТКАМИ*\n\n`;
      bottomProducts.forEach((product, index) => {
        const urgencyEmoji =
          product.totalPieces < 5
            ? "🔥"
            : product.totalPieces < 20
            ? "⚠️"
            : "📦";
        message += `${index + 1}. ${urgencyEmoji} *${product.name}*\n`;
        message += `   📊 ${product.displayQuantity}\n`;
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
    message += `⏰ _Обновлено: ${formatDateTime(new Date())}_\n`;

    // Oxirgi yangilanish vaqti
    const refreshStatus = getRefreshStatus();
    if (refreshStatus.lastUpdate) {
      message += `🕐 _Последнее обновление данных: ${formatDateTime(refreshStatus.lastUpdate)}_`;
    }

    return message;
  } catch (error) {
    throw new Error("Statistikani hisoblashda xato yuz berdi");
  }
};

// ODDIY: Поставщик статистики рассчет (API dan)
const calculateSupplierStatistics = async (supplierName) => {
  try {
    const remains = (await fetchSupplierRemainsFromAPI(supplierName, 1)) || []; // Statistika uchun yetarli

    // Oddiy hisoblash
    const totalProducts = remains.length;
    const lowStock = remains.filter(
      (r) => (r.quantities?.units || 0) + (r.quantities?.pieces || 0) < 5
    ).length;
    const criticalStock = remains.filter(
      (r) => (r.quantities?.units || 0) + (r.quantities?.pieces || 0) < 1
    ).length;
    const branchesCount = [
      ...new Set(remains.map((r) => r.branch || "Неизвестный")),
    ].length;
    const stockHealth =
      totalProducts > 0 ? Math.round((1 - lowStock / totalProducts) * 100) : 0;

    const bottomProducts = remains
      .filter(
        (r) => (r.quantities?.units || 0) + (r.quantities?.pieces || 0) < 20
      )
      .slice(0, 5)
      .map((r) => ({
        name: r.product,
        displayQuantity: calculatePackages(r.quantities, r.unit, r.pieceCount),
        branches: [
          ...new Set(
            remains
              .filter((rr) => rr.product === r.product)
              .map((rr) => rr.branch || "Неизвестный")
          ),
        ].length,
        totalPieces:
          (r.quantities?.units || 0) * (r.pieceCount || 1) +
          (r.quantities?.pieces || 0),
      }));

    return {
      totalProducts,
      lowStock,
      criticalStock,
      bottomProducts,
      branchesCount,
      stockHealth,
    };
  } catch (error) {
    throw error;
  }
};

// Загрузка индикатор
const sendLoadingMessage = async (chatId, text = "Загрузка...") => {
  return await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
};

const deleteLoadingMessage = async (chatId, messageId) => {
  try {
    await bot.deleteMessage(chatId, messageId);
  } catch (error) {
    // Ignore error if message already deleted
  }
};

// YANGI: Low stock tekshiruvi va bildirishnoma (placeholder)
const checkLowStockAndNotify = async () => {
  console.log("Low stock tekshiruvi - placeholder");
};

// YANGI: Supplier low stock bildirishnoma (placeholder)
const notifySupplierLowStock = async () => {
  console.log("Supplier low stock bildirishnoma - placeholder");
};

// ИСПРАВЛЕНИЕ: Улучшенная обработка состояний
const setUserState = (chatId, state) => {
  userStates.set(chatId, { ...state, timestamp: Date.now() });
};

const getUserState = (chatId) => {
  const state = userStates.get(chatId);
  // Очищаем устаревшие состояния (старше 30 минут)
  if (state && Date.now() - state.timestamp > 30 * 60 * 1000) {
    userStates.delete(chatId);
    return null;
  }
  return state;
};

// ИСПРАВЛЕНИЕ: Обработка команды /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await bot.sendChatAction(chatId, "typing");

    const telegramUser = await TelegramUser.findOne({ chatId });

    if (telegramUser) {
      // Пользователь уже зарегистрирован
      if (telegramUser.userType === "doctor") {
        const doctor = await Doctor.findById(telegramUser.userId);

        if (
          !doctor ||
          !doctor.isActive ||
          (doctor.activeUntil && new Date(doctor.activeUntil) < new Date())
        ) {
          await TelegramUser.deleteOne({ chatId });
          userStates.delete(chatId);
          userPaginationData.delete(chatId);
          await bot.sendMessage(
            chatId,
            "❌ Ваш аккаунт был деактивирован или срок активации истек.",
            mainMenu
          );
          return;
        }

        await bot.sendMessage(
          chatId,
          `👋 Добро пожаловать обратно, Dr. ${doctor.name}!`,
          doctorMenu
        );
      } else if (telegramUser.userType === "supplier") {
        const supplier = await Supplier.findById(telegramUser.userId);
        if (
          !supplier ||
          !supplier.isActive ||
          (supplier.activeUntil && new Date(supplier.activeUntil) < new Date())
        ) {
          await TelegramUser.deleteOne({ chatId });
          userStates.delete(chatId);
          userPaginationData.delete(chatId);
          await bot.sendMessage(
            chatId,
            "❌ Ваш аккаунт был деактивирован или срок активации истек.",
            mainMenu
          );
          return;
        }

        await bot.sendMessage(
          chatId,
          `👋 Добро пожаловать обратно, ${supplier.name}!`,
          supplierMenu
        );
      }
    } else {
      // Новый пользователь
      setUserState(chatId, { step: "select_type" });
      await bot.sendMessage(
        chatId,
        "👋 Добро пожаловать в систему управления аптекой!\n\nВыберите тип аккаунта:",
        mainMenu
      );
    }
  } catch (error) {
    console.error("❌ /start error:", error);
    await bot.sendMessage(chatId, "⚠️ Произошла ошибка. Попробуйте позже.");
  }
});

// ИСПРАВЛЕНИЕ: Улучшенная обработка сообщений
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Игнорируем команды и пустые сообщения
  if (!text || text.startsWith("/")) return;

  try {
    await bot.sendChatAction(chatId, "typing");

    const telegramUser = await TelegramUser.findOne({ chatId });
    const state = getUserState(chatId);

    console.log(
      `DEBUG: chatId=${chatId}, text="${text}", state=`,
      state,
      "telegramUser=",
      telegramUser ? "exists" : "none"
    );

    // Процесс логина для новых пользователей
    if (!telegramUser) {
      if (text === "👨‍⚕️ Войти как врач") {
        setUserState(chatId, { step: "doctor_login_username" });
        await bot.sendMessage(
          chatId,
          "👨‍⚕️ *ВХОД ДЛЯ ВРАЧА*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nВведите ваш логин врача:",
          { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } }
        );
        return;
      } else if (text === "🏭 Войти как поставщик") {
        setUserState(chatId, { step: "supplier_login_username" });
        await bot.sendMessage(
          chatId,
          "🏭 *ВХОД ДЛЯ ПОСТАВЩИКА*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nВведите ваш логин поставщика:",
          { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } }
        );
        return;
      } else if (state && state.step === "doctor_login_username") {
        // Обработка логина врача
        const doctorLogin = text.trim();
        const doctor = await Doctor.findOne({
          login: doctorLogin,
          isActive: true,
        });

        if (!doctor) {
          await bot.sendMessage(
            chatId,
            "❌ Врач с таким логином не найден или аккаунт неактивен.",
            mainMenu
          );
          userStates.delete(chatId);
          return;
        }

        // Проверяем срок активности
        if (doctor.activeUntil && new Date(doctor.activeUntil) < new Date()) {
          await bot.sendMessage(
            chatId,
            "❌ Срок действия вашего аккаунта истек.",
            mainMenu
          );
          return;
        }

        // Переходим к вводу пароля
        setUserState(chatId, {
          step: "doctor_login_password",
          doctorId: doctor._id,
          doctorLogin: doctorLogin,
        });
        await bot.sendMessage(chatId, "🔒 Введите ваш пароль:", {
          parse_mode: "Markdown",
          reply_markup: { remove_keyboard: true },
        });
        return;
      } else if (state && state.step === "doctor_login_password") {
        // Обработка пароля врача
        const password = text.trim();
        const doctor = await Doctor.findById(state.doctorId);

        if (!doctor || doctor.password !== password) {
          await bot.sendMessage(chatId, "❌ Неверный пароль.", mainMenu);
          userStates.delete(chatId);
          return;
        }

        // Сохраняем пользователя Telegram
        await TelegramUser.create({
          chatId,
          userId: doctor._id,
          userType: "doctor",
          username: msg.from.username || msg.from.first_name,
        });

        userStates.delete(chatId);
        await bot.sendMessage(
          chatId,
          `✅ Успешный вход!\n👋 Добро пожаловать, Dr. ${doctor.name}!`,
          doctorMenu
        );
        return;
      } else if (state && state.step === "supplier_login_username") {
        // Обработка логина поставщика
        const supplierUsername = text.trim();
        const supplier = await Supplier.findOne({
          username: supplierUsername,
          isActive: true,
        });

        if (!supplier) {
          await bot.sendMessage(
            chatId,
            "❌ Поставщик с таким логином не найден или аккаунт неактивен.",
            mainMenu
          );
          userStates.delete(chatId);
          return;
        }

        // Проверяем срок активности
        if (
          supplier.activeUntil &&
          new Date(supplier.activeUntil) < new Date()
        ) {
          await bot.sendMessage(
            chatId,
            "❌ Срок действия вашего аккаунта истек.",
            mainMenu
          );
          return;
        }

        // Переходим к вводу пароля
        setUserState(chatId, {
          step: "supplier_login_password",
          supplierId: supplier._id,
          supplierUsername: supplierUsername,
        });
        await bot.sendMessage(chatId, "🔒 Введите ваш пароль:", {
          parse_mode: "Markdown",
          reply_markup: { remove_keyboard: true },
        });
        return;
      } else if (state && state.step === "supplier_login_password") {
        // Обработка пароля поставщика
        const password = text.trim();
        const supplier = await Supplier.findById(state.supplierId);

        if (!supplier || supplier.password !== password) {
          await bot.sendMessage(chatId, "❌ Неверный пароль.", mainMenu);
          userStates.delete(chatId);
          return;
        }

        // Сохраняем пользователя Telegram
        await TelegramUser.create({
          chatId,
          userId: supplier._id,
          userType: "supplier",
          username: msg.from.username || msg.from.first_name,
        });

        userStates.delete(chatId);
        await bot.sendMessage(
          chatId,
          `✅ Успешный вход!\n👋 Добро пожаловать, ${supplier.name}!`,
          supplierMenu
        );
        return;
      } else {
        // Неизвестная команда для неавторизованного пользователя
        await bot.sendMessage(
          chatId,
          "👋 Добро пожаловать! Выберите тип аккаунта для входа:",
          mainMenu
        );
        return;
      }
    }

    // Команды для авторизованных пользователей
    if (telegramUser.userType === "doctor") {
      const doctor = await Doctor.findById(telegramUser.userId);

      // Проверка активности врача
      if (
        !doctor ||
        !doctor.isActive ||
        (doctor.activeUntil && new Date(doctor.activeUntil) < new Date())
      ) {
        await TelegramUser.deleteOne({ chatId });
        userStates.delete(chatId);
        userPaginationData.delete(chatId);
        await bot.sendMessage(
          chatId,
          "❌ Ваш аккаунт был деактивирован или срок активации истек.",
          mainMenu
        );
        return;
      }

      // Обработка команд врача
      if (text === "📊 Мои продажи") {
        const loadingMsg = await sendLoadingMessage(
          chatId,
          "📊 Загрузка продаж...\n⏰ Пожалуйста, подождите"
        );

        try {
          const pageData = await getDoctorSalesPage(doctor.code, 1);

          await deleteLoadingMessage(chatId, loadingMsg.message_id);

          if (pageData.totalSales === 0) {
            await bot.sendMessage(chatId, "📊 У вас пока нет продаж");
            return;
          }

          userPaginationData.set(chatId, {
            type: "sales",
            doctorCode: doctor.code,
            currentPage: 1,
          });

          const messageText = formatDoctorSalesPage(pageData);
          const buttons = createSalesPaginationButtons(
            1,
            pageData.totalPages,
            pageData.totalSales,
            pageData.sales
          );

          await bot.sendMessage(chatId, messageText, {
            parse_mode: "Markdown",
            ...buttons,
          });
        } catch (error) {
          await deleteLoadingMessage(chatId, loadingMsg.message_id);
          await bot.sendMessage(
            chatId,
            error.message || "❌ Ошибка загрузки продаж"
          );
        }
        return;
      } else if (text === "🚪 Выйти") {
        await TelegramUser.deleteOne({ chatId });
        userStates.delete(chatId);
        userPaginationData.delete(chatId);
        await bot.sendMessage(
          chatId,
          "👋 Вы вышли из системы. Чтобы войти снова, используйте /start",
          { reply_markup: { remove_keyboard: true } }
        );
        return;
      } else {
        await bot.sendMessage(
          chatId,
          "❓ Используйте кнопки меню для навигации.",
          doctorMenu
        );
        return;
      }
    }

    // Команды для поставщика
    if (telegramUser.userType === "supplier") {
      const supplier = await Supplier.findById(telegramUser.userId);

      // Проверка активности поставщика
      if (
        !supplier ||
        !supplier.isActive ||
        (supplier.activeUntil && new Date(supplier.activeUntil) < new Date())
      ) {
        await TelegramUser.deleteOne({ chatId });
        userStates.delete(chatId);
        userPaginationData.delete(chatId);
        await bot.sendMessage(
          chatId,
          "❌ Ваш аккаунт был деактивирован или срок активации истек.",
          mainMenu
        );
        return;
      }

      // Обработка команд поставщика
      if (text === "📦 Остатки") {
        const loadingMsg = await sendLoadingMessage(
          chatId,
          "📦 Загрузка остатков...\n⏰ Пожалуйста, подождите"
        );

        try {
          const pageData = await getAllRemainsPage(supplier.name, 1);

          await deleteLoadingMessage(chatId, loadingMsg.message_id);

          if (pageData.totalRemains === 0) {
            await bot.sendMessage(chatId, "📦 Остатки не найдены");
            return;
          }

          userPaginationData.set(chatId, {
            type: "remains",
            supplierName: supplier.name,
            currentPage: 1,
          });

          const messageText = formatAllRemainsPage(pageData);
          const buttons = createAllRemainsPaginationButtons(
            1,
            pageData.totalPages,
            pageData.totalRemains
          );

          await bot.sendMessage(chatId, messageText, {
            parse_mode: "Markdown",
            ...buttons,
          });
        } catch (error) {
          await deleteLoadingMessage(chatId, loadingMsg.message_id);
          await bot.sendMessage(
            chatId,
            error.message || "❌ Ошибка загрузки остатков"
          );
        }
        return;
      } else if (text === "📈 Статистика") {
        const loadingMsg = await sendLoadingMessage(
          chatId,
          "📊 Подготавливаю детальную аналитику...\n⏰ Пожалуйста, подождите несколько секунд"
        );

        try {
          const statisticsMessage = await createProfessionalStatisticsMessage(
            supplier,
            supplier.name
          );

          await deleteLoadingMessage(chatId, loadingMsg.message_id);
          await bot.sendMessage(chatId, statisticsMessage, {
            parse_mode: "Markdown",
          });
        } catch (error) {
          await deleteLoadingMessage(chatId, loadingMsg.message_id);
          await bot.sendMessage(
            chatId,
            error.message ||
              "❌ Произошла ошибка при создании отчёта. Попробуйте позже."
          );
          console.error("Statistics generation error:", error);
        }
        return;
      } else if (text === "🚪 Выйти") {
        await TelegramUser.deleteOne({ chatId });
        userStates.delete(chatId);
        userPaginationData.delete(chatId);
        await bot.sendMessage(
          chatId,
          "👋 Вы вышли из системы. Чтобы войти снова, используйте /start",
          { reply_markup: { remove_keyboard: true } }
        );
        return;
      } else {
        await bot.sendMessage(
          chatId,
          "❓ Используйте кнопки меню для навигации.",
          supplierMenu
        );
        return;
      }
    }
  } catch (error) {
    console.error("❌ Bot message handling error:", error);
    await bot.sendMessage(chatId, "⚠️ Произошла ошибка. Попробуйте позже.");
  }
});

// Sale tafsilotlarini formatlash
const formatSaleDetails = (sale, items) => {
  console.log(sale);

  let message = `🧾 *ЧЕК №${
    sale._doc?.number || sale.number || "undefined"
  }*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  message += `👨‍⚕️ Dr. ${sale.doctorName || sale.createdBy || "Неизвестен"}\n`;
  message += `📅 ${
    sale.date
      ? new Date(sale.date).toLocaleDateString("ru-RU")
      : sale._doc?.date
      ? new Date(sale._doc.date).toLocaleDateString("ru-RU")
      : sale.createdAt
      ? new Date(sale.createdAt).toLocaleDateString("ru-RU")
      : "Неизвестно"
  }\n`;
  message += `💰 ${formatNumber(sale._doc.saleAmount || 0)} сум\n\n`;
  message += `📦 *Товары:*\n`;

  if (items && items.length > 0) {
    items.forEach((item, index) => {
      message += `${index + 1}. 💊 ${item.product}\n`;
      message += `   📊 ${calculatePackages(
        item.quantity,
        item.unit,
        item.pieceCount
      )}\n`;
      message += `   💰 ${formatNumber(item.salePrice || 0)} сум\n\n`;
    });
  } else {
    message += `📦 Товары не найдены\n\n`;
  }

  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `🤖 _Детали продажи_\n\n`;

  // Oxirgi yangilanish vaqti
  const refreshStatus = getRefreshStatus();
  if (refreshStatus.lastUpdate) {
    message += `🕐 _Последнее обновление: ${formatDateTime(refreshStatus.lastUpdate)}_`;
  }

  return message;
};

// ИСПРАВЛЕНИЕ: Добавляем обработку callback queries для пагинации
bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  try {
    if (data.startsWith("sales_page_")) {
      const page = parseInt(data.split("_")[2]);
      const paginationData = userPaginationData.get(chatId);

      if (paginationData && paginationData.type === "sales") {
        const loadingMsg = await sendLoadingMessage(chatId, "🔄 Загрузка...");

        try {
          const pageData = await getDoctorSalesPage(
            paginationData.doctorCode,
            page
          );
          await deleteLoadingMessage(chatId, loadingMsg.message_id);

          const messageText = formatDoctorSalesPage(pageData);
          const buttons = createSalesPaginationButtons(
            page,
            pageData.totalPages,
            pageData.totalSales,
            pageData.sales
          );

          await bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            parse_mode: "Markdown",
            ...buttons,
          });

          // Update pagination data
          userPaginationData.set(chatId, {
            ...paginationData,
            currentPage: page,
          });
        } catch (error) {
          await deleteLoadingMessage(chatId, loadingMsg.message_id);
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "Ошибка загрузки страницы",
          });
        }
      }
    } else if (data.startsWith("sale_detail_")) {
      const saleIndex = parseInt(data.split("_")[2]);
      const paginationData = userPaginationData.get(chatId);

      if (paginationData && paginationData.type === "sales") {
        const loadingMsg = await sendLoadingMessage(
          chatId,
          "🔄 Загрузка деталей..."
        );

        try {
          const pageData = await getDoctorSalesPage(
            paginationData.doctorCode,
            paginationData.currentPage || 1
          );

          if (pageData.sales[saleIndex]) {
            const sale = pageData.sales[saleIndex];

            try {
              const items = await getSalesItems(sale._doc.id);

              await deleteLoadingMessage(chatId, loadingMsg.message_id);

              const messageText = formatSaleDetails(sale, items);
              const buttons = createSaleDetailButtons(
                sale.id,
                paginationData.currentPage || 1
              );

              await bot.sendMessage(chatId, messageText, {
                parse_mode: "Markdown",
                ...buttons,
              });
            } catch (error) {
              console.error(`Sale ${sale.id} details error:`, error.message);
              await deleteLoadingMessage(chatId, loadingMsg.message_id);

              // Agar items olishda xato bo'lsa, sale ma'lumotlari bilan ko'rsatish
              const messageText = formatSaleDetails(sale, []);
              const buttons = createSaleDetailButtons(
                sale.id,
                paginationData.currentPage || 1
              );

              await bot.sendMessage(chatId, messageText, {
                parse_mode: "Markdown",
                ...buttons,
              });
            }
          }
        } catch (error) {
          await deleteLoadingMessage(chatId, loadingMsg.message_id);
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "Ошибка загрузки деталей",
          });
        }
      }
    } else if (data.startsWith("remains_page_")) {
      const page = parseInt(data.split("_")[2]);
      const paginationData = userPaginationData.get(chatId);

      if (paginationData && paginationData.type === "remains") {
        const loadingMsg = await sendLoadingMessage(chatId, "🔄 Загрузка...");

        try {
          const pageData = await getAllRemainsPage(
            paginationData.supplierName,
            page
          );
          await deleteLoadingMessage(chatId, loadingMsg.message_id);

          const messageText = formatAllRemainsPage(pageData);
          const buttons = createAllRemainsPaginationButtons(
            page,
            pageData.totalPages,
            pageData.totalRemains
          );

          await bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            parse_mode: "Markdown",
            ...buttons,
          });

          // Update pagination data
          userPaginationData.set(chatId, {
            ...paginationData,
            currentPage: page,
          });
        } catch (error) {
          await deleteLoadingMessage(chatId, loadingMsg.message_id);
          await bot.answerCallbackQuery(callbackQuery.id, {
            text: "Ошибка загрузки страницы",
          });
        }
      }
    } else if (data.endsWith("_close")) {
      await bot.deleteMessage(chatId, callbackQuery.message.message_id);
    }

    await bot.answerCallbackQuery(callbackQuery.id);
  } catch (error) {
    console.error("❌ Callback query error:", error);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: "Произошла ошибка",
    });
  }
});

// ИСПРАВЛЕНО: Новые продажи уведомления функция - to'g'ri quantity hisoblash bilan (API dan)
export const notifyDoctorAboutSale = async (saleId, doctorCode) => {
  try {
    const findSale = await Sales.findById(saleId);
    const doctor = await Doctor.findOne({ code: doctorCode });
    if (!doctor || !doctor.isActive) return;

    const telegramUser = await TelegramUser.findOne({
      userId: doctor._id,
      userType: "doctor",
    });
    if (!telegramUser) return;

    // API dan sale items olish (doctors route orqali)
    const response = await axios.get(
      `${API_BASE}/doctors/${doctorCode}/items/${saleId}`,
      {
        timeout: 5000,
      }
    );
    const items = response.data.data || [];

    if (items.length === 0) return;
    console.log("findSale. " + findSale);

    let message = `🔔 *НОВАЯ ПРОДАЖА*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `👨‍⚕️ Dr. ${doctor.name}\n`;
    message += `🧾 Чек №${findSale._doc.number}\n`; // saleId ni number o'rniga ishlatish
    message += `💰 ${formatNumber(findSale._doc.saleAmount || 0)} сум\n`;
    message += `📅 ${formatDateTime(new Date(findSale._doc.date))}\n\n`;
    message += `📦 *Товары:*\n`;

    items.forEach((item, index) => {
      message += `${index + 1}. 💊 ${item.product}\n`;
      // ИСПРАВЛЕНО: To'g'ri quantity formatlashtirish
      const displayQuantity = calculatePackages(
        item.quantity,
        item.unit,
        item.pieceCount
      );
      message += `   📊 ${displayQuantity}\n`;
    });

    message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `🤖 _Автоматическое уведомление_\n`;
    message += `⏰ _${formatDateTime(new Date())}_`;

    await bot.sendMessage(telegramUser.chatId, message, {
      parse_mode: "Markdown",
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

    console.log(`✅ Сообщение отправлено Dr. ${doctorName}`);
    return true;
  } catch (error) {
    console.error(`❌ Ошибка отправки сообщения для Dr. ${doctorName}:`, error);
    return false;
  }
};

// Поставщику админ сообщение отправка
export const sendMessageToSupplier = async (chatId, message, supplierName) => {
  try {
    const formattedMessage =
      `📢 *СООБЩЕНИЕ ОТ АДМИНИСТРАТОРА*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🏭 ${supplierName}\n\n` +
      `💬 ${message}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🏥 _Система управления аптекой_\n` +
      `⏰ _${formatDateTime(new Date())}_`;

    await bot.sendMessage(chatId, formattedMessage, {
      parse_mode: "Markdown",
    });

    console.log(`✅ Сообщение отправлено поставщику ${supplierName}`);
    return true;
  } catch (error) {
    console.error(
      `❌ Ошибка отправки сообщения для поставщика ${supplierName}:`,
      error
    );
    return false;
  }
};

// Low stock notification для поставщиков
export const notifySupplierAboutLowStock = async (
  supplierId,
  productName,
  currentStock,
  branch
) => {
  try {
    const supplier = await Supplier.findById(supplierId);
    if (!supplier || !supplier.isActive) return;

    const telegramUser = await TelegramUser.findOne({
      userId: supplier._id,
      userType: "supplier",
    });
    if (!telegramUser) return;

    const message =
      `⚠️ *НИЗКИЙ ОСТАТОК ТОВАРА*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🏭 ${supplier.name}\n\n` +
      `📦 *Товар:* ${productName}\n` +
      `📊 *Текущий остаток:* ${currentStock}\n` +
      `🏢 *Филиал:* ${branch}\n\n` +
      `💡 *Рекомендация:* Пополните остатки в ближайшее время\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 _Автоматическое уведомление_\n` +
      `⏰ _${formatDateTime(new Date())}_`;

    await bot.sendMessage(telegramUser.chatId, message, {
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error("❌ Low stock notification error:", error);
  }
};

// Critical stock notification для поставщиков
export const notifySupplierAboutCriticalStock = async (
  supplierId,
  productName,
  currentStock,
  branch
) => {
  try {
    const supplier = await Supplier.findById(supplierId);
    if (!supplier || !supplier.isActive) return;

    const telegramUser = await TelegramUser.findOne({
      userId: supplier._id,
      userType: "supplier",
    });
    if (!telegramUser) return;

    const message =
      `🔥 *КРИТИЧЕСКИЙ ОСТАТОК ТОВАРА*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🏭 ${supplier.name}\n\n` +
      `📦 *Товар:* ${productName}\n` +
      `📊 *Текущий остаток:* ${currentStock}\n` +
      `🏢 *Филиал:* ${branch}\n\n` +
      `🚨 *Срочно:* Необходимо немедленное пополнение!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 _Автоматическое уведомление_\n` +
      `⏰ _${formatDateTime(new Date())}_`;

    await bot.sendMessage(telegramUser.chatId, message, {
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error("❌ Critical stock notification error:", error);
  }
};

// Уведомление о новых заказах для поставщиков
export const notifySupplierAboutNewOrder = async (supplierId, orderDetails) => {
  try {
    const supplier = await Supplier.findById(supplierId);
    if (!supplier || !supplier.isActive) return;

    const telegramUser = await TelegramUser.findOne({
      userId: supplier._id,
      userType: "supplier",
    });
    if (!telegramUser) return;

    const { orderId, products, totalAmount, branch, orderDate } = orderDetails;

    let message =
      `🆕 *НОВЫЙ ЗАКАЗ*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🏭 ${supplier.name}\n\n` +
      `📋 *Заказ №:* ${orderId}\n` +
      `💰 *Сумма:* ${formatNumber(totalAmount)} сум\n` +
      `🏢 *Филиал:* ${branch}\n` +
      `📅 *Дата:* ${formatDateTime(orderDate)}\n\n` +
      `📦 *Товары:*\n`;

    products.forEach((product, index) => {
      message += `${index + 1}. ${product.name} - ${product.quantity} ${
        product.unit
      }\n`;
    });

    message +=
      `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 _Автоматическое уведомление_\n` +
      `⏰ _${formatDateTime(new Date())}_`;

    await bot.sendMessage(telegramUser.chatId, message, {
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error("❌ New order notification error:", error);
  }
};

// Функция для массовой отправки сообщений всем пользователям
export const broadcastMessage = async (message, userType = null) => {
  try {
    const query = userType ? { userType } : {};
    const users = await TelegramUser.find(query);

    let successCount = 0;
    let failCount = 0;

    for (const user of users) {
      try {
        const formattedMessage =
          `📢 *МАССОВОЕ УВЕДОМЛЕНИЕ*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `${message}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🏥 _Система управления аптекой_\n` +
          `⏰ _${formatDateTime(new Date())}_`;

        await bot.sendMessage(user.chatId, formattedMessage, {
          parse_mode: "Markdown",
        });
        successCount++;

        // Задержка между отправками чтобы избежать лимитов Telegram
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Ошибка отправки пользователю ${user.chatId}:`, error);
        failCount++;
      }
    }

    console.log(
      `✅ Массовая рассылка завершена: ${successCount} успешно, ${failCount} ошибок`
    );
    return { successCount, failCount };
  } catch (error) {
    console.error("❌ Broadcast message error:", error);
    return { successCount: 0, failCount: 0 };
  }
};

// Функция для получения статистики бота
export const getBotStatistics = async () => {
  try {
    const totalUsers = await TelegramUser.countDocuments();
    const doctorsCount = await TelegramUser.countDocuments({
      userType: "doctor",
    });
    const suppliersCount = await TelegramUser.countDocuments({
      userType: "supplier",
    });

    return {
      totalUsers,
      doctorsCount,
      suppliersCount,
      activeStates: userStates.size,
      activePagination: userPaginationData.size,
    };
  } catch (error) {
    console.error("❌ Get bot statistics error:", error);
    return null;
  }
};

export { checkLowStockAndNotify, notifySupplierLowStock };
export default bot;
