// // utils/fetchSales.js
// import axios from "axios";
// import Sales from "../models/Sales.js";
// import pLimit from "p-limit";

// const BASE_URL = "https://osonkassa.uz/api/pos";
// const TOKEN =
//   "Bearer eyJhbGciOiJodHRwOi8vd3d3LnczLm9yZy8yMDAxLzA0L3htbGRzaWctbW9yZSNobWFjLXNoYTI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJ3ZWIuYXBpIiwiaXNzIjoiaHR0cHM6Ly9vc29ua2Fzc2EudXovd2ViLmFwaSIsImV4cCI6MTc1ODQ0NjgxOSwiaWF0IjoxNzU4MzY0MDE5LCJVc2VybmFtZSI6ImFwdGVrYSIsIlVzZXJJZCI6IjgxZWViMzFmLTFiZWMtNGM3MC1iOGJmLTYzMjk4MTdiY2NjZSIsIlRlbmFudElkIjoiYmlvZmFybXMiLCJwZXJtaXNzaW9ucyI6InNlY3VyaXR5Iiwicm9sZSI6IiIsIm5iZiI6MTc1ODM2NDAxOX0.-J5t8sMHn00iT38Dd7nO-o9VQ33CuIuRq9QCWtd-WUE"; // <-- tokeningni shu yerga qo‘y

// // LIMIT: bir vaqtda nechta items so‘rovi yuborilsin (10 xavfsiz)
// const limit = pLimit(10);

// export async function fetchAndSaveSales(dateFrom, dateTo) {
//   let pageNumber = 1;
//   let totalPages = 1;

//   try {
//     while (pageNumber <= totalPages) {
//       // 1. Sales asosiy ma'lumotlarini olish
//       const salesRes = await axios.post(
//         `${BASE_URL}/sales/get`,
//         {
//           dateFrom,
//           dateTo,
//           deletedFilter: 1,
//           pageNumber,
//           pageSize: 100,
//           searchText: "",
//           sortOrders: [],
//         },
//         { headers: { Authorization: TOKEN } }
//       );

//       const { items, totalPages: tp, totalCount } = salesRes.data.page;
//       totalPages = tp;

//       console.log(
//         `📄 Sahifa ${pageNumber}/${totalPages} yuklanyapti... (${items.length} sales)`
//       );

//       // 2. Paralel ravishda itemslarni olish va DB'ga saqlash
//       const promises = items.map((sale) =>
//         limit(async () => {
//           try {
//             // items olish
//             const itemsRes = await axios.post(
//               `${BASE_URL}/sales/items/get`,
//               {
//                 includeDeletedSales: false,
//                 pageNumber: 1,
//                 pageSize: 50,
//                 saleId: sale.id,
//                 sortOrders: [],
//               },
//               { headers: { Authorization: TOKEN } }
//             );

//             const saleItems = itemsRes.data.page.items;

//             // MongoDB ga saqlash (upsert)
//             await Sales.findOneAndUpdate(
//               { id: sale.id },
//               {
//                 ...sale,
//                 items: saleItems,
//                 hasItems: saleItems.length > 0,
//                 itemsLastUpdated: new Date(),
//               },
//               { upsert: true, new: true }
//             );

//             console.log(
//               `✅ Sale ${sale.id} saqlandi (${saleItems.length} items)`
//             );
//           } catch (err) {
//             console.error(`❌ Sale ${sale.id} xato:`, err.message);
//           }
//         })
//       );

//       await Promise.all(promises); // shu sahifadagi hammasini kutamiz
//       pageNumber++;
//     }

//     console.log("🎉 Barcha sales yuklab olindi!");
//   } catch (err) {
//     console.error("❌ Xatolik:", err.response?.data || err.message);
//   }
// }
