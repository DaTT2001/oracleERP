const express = require("express");
const oracledb = require("oracledb");
require("dotenv").config();

const app = express();
const PORT = 4000;
const cors = require('cors');
app.use(cors());
app.use(express.json());

async function initOracle() {
    try {
        await oracledb.createPool({
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            connectString: process.env.DB_CONNECT_STRING,
            poolAlias: "default", // Quan trọng: Gán alias "default"
            poolMin: 2,
            poolMax: 10,
            poolIncrement: 1
        });
        console.log("✅ OracleDB Connection Pool Initialized!");
    } catch (err) {
        console.error("❌ Lỗi khởi tạo pool Oracle:", err);
    }
}

initOracle();


// Khởi tạo Oracle Client
oracledb.initOracleClient({ libDir: "/home/it/Oracleclient/instantclient_11_2" });

// Hàm lấy kết nối Oracle
async function getOracleConnection() {
  return await oracledb.getConnection({
    user: "datit",
    password: "dcdat2001",
    connectString: "10.10.10.21:1521/topprod",
  });
}

const getCurrentISODate = () => {
  const now = new Date();
  return now.toISOString().split('T')[0] + 'T00:00:00.000Z';
};


// API GET danh sách từ bảng IMG_FILE
app.get("/api/img_file", async (req, res) => {
  let connection;
  try {
    connection = await getOracleConnection();
    const result = await connection.execute(
      `SELECT * FROM KDVN.IMG_FILE WHERE IMG02 = '1903' AND ROWNUM <= 10` // Dùng ROWNUM thay vì FETCH FIRST
    );

    res.json(result.rows); // Trả về JSON
  } catch (error) {
    console.error("❌ Lỗi truy vấn dữ liệu:", error.message);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) {
      await connection.close();
    }
  }
});

// API GET dữ liệu theo IMG01
app.get("/api/img_file/:id", async (req, res) => {
  let connection;
  try {
    connection = await getOracleConnection();
    const img01 = req.params.id; // Lấy ID từ URL

    const result = await connection.execute(
      `SELECT * FROM KDVN.IMG_FILE WHERE IMG01 = :id`, // Dùng bind variable
      { id: img01 }
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy dữ liệu" });
    }

    res.json(result.rows);
  } catch (error) {
    console.error("❌ Lỗi truy vấn dữ liệu:", error.message);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) {
      await connection.close();
    }
  }
});

//get sản phẩm theo id
app.get("/api/inventory/:id", async (req, res) => {
  try {
      const connection = await oracledb.getConnection({ poolAlias: "default" });

      const productId = req.params.id; // Lấy ID từ URL

      const result = await connection.execute(
          `SELECT img.IMG01 AS product_id,
                  img.IMG02 AS warehouse_id,
                  img.IMG10 AS qty_available, 
                  ima.IMA02 AS product_name, 
                  ima.IMA021 AS description,  -- Mô tả
                  ima.IMA12 AS category,      -- Mã nhóm
                  ima.IMA25 AS unit           -- Đơn vị
           FROM KDVN.IMG_FILE img
           LEFT JOIN KDVN.IMA_FILE ima ON img.IMG01 = ima.IMA01
           LEFT JOIN KDVN.IME_FILE ime ON img.IMG01 = ime.IME01
           WHERE img.IMG01 = :productId
             AND img.IMG02 = '1903'
             AND ima.IMA02 IS NOT NULL
             AND (img.IMG03 IS NULL OR LENGTH(img.IMG03) = 1)
             AND (img.IMG04 IS NULL OR LENGTH(img.IMG04) = 1)
             AND (ime.IME03 IS NULL OR LENGTH(ime.IME03) = 1)`,  
          { productId },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      await connection.close();

      if (result.rows.length === 0) {
          return res.status(404).json({ error: "Không tìm thấy sản phẩm" });
      }

      res.json(result.rows[0]); // Trả về 1 sản phẩm
  } catch (err) {
      console.error("Lỗi truy vấn dữ liệu:", err);
      res.status(500).json({ error: "Lỗi server" });
  }
});

app.get("/api/inventory", async (req, res) => {
  try {
      console.log("📌 Query nhận được:", req.query); // Debug

      const {
          id,
          category,
          minQty,
          maxQty,
          search,
          page = 1,
          limit = 50,
      } = req.query;

      // ✅ Chuyển đổi kiểu dữ liệu an toàn
      const parsedPage = parseInt(page);
      const parsedLimit = parseInt(limit); 
      const parsedMinQty = minQty ? parseFloat(minQty) : null;
      const parsedMaxQty = maxQty ? parseFloat(maxQty) : null;

      // ✅ Kiểm tra giá trị NaN, nếu có thì gán null
      if (isNaN(parsedPage) || isNaN(parsedLimit)) {
          return res.status(400).json({ error: "page và limit phải là số" });
      }
      if (minQty && isNaN(parsedMinQty)) {
          return res.status(400).json({ error: "minQty không hợp lệ" });
      }
      if (maxQty && isNaN(parsedMaxQty)) {
          return res.status(400).json({ error: "maxQty không hợp lệ" });
      }

      const offset = (parsedPage - 1) * parsedLimit;
      const maxRow = offset + parsedLimit;
      let conditions = [
        "img.IMG02 = '1903'",  // Chỉ lấy kho 1903
        "ima.IMA02 IS NOT NULL",  // Tên sản phẩm phải có
        "(img.IMG03 IS NULL OR LENGTH(img.IMG03) = 1)",
        "(img.IMG04 IS NULL OR LENGTH(img.IMG04) = 1)",
        "(ime.IME03 IS NULL OR LENGTH(ime.IME03) = 1)" 
      ];
    
  
      let bindParams = {};

      if (id && id !== "undefined") {
          conditions.push("img.IMG01 = :id");
          bindParams.id = id;
      }
      if (category && category !== "undefined") {
          conditions.push("ima.IMA12 = :category");
          bindParams.category = category;
      }
      if (parsedMinQty !== null) {
          conditions.push("CAST(img.IMG10 AS NUMBER) >= :minQty");
          bindParams.minQty = parsedMinQty;
      }
      if (parsedMaxQty !== null) {
          conditions.push("CAST(img.IMG10 AS NUMBER) <= :maxQty");
          bindParams.maxQty = parsedMaxQty;
      }
      if (search && search !== "undefined") {
          conditions.push("(LOWER(ima.IMA02) LIKE :search OR LOWER(ima.IMA021) LIKE :search)");
          bindParams.search = `%${search.toLowerCase()}%`;
      }

      let whereClause = "WHERE " + conditions.join(" AND ");

      console.log("📌 SQL Query:", whereClause);
      console.log("📌 Bind Params:", bindParams);

      const connection = await oracledb.getConnection({ poolAlias: "default" });

      // 🔥 Lấy tổng số bản ghi
      const totalResult = await connection.execute(
          `SELECT COUNT(*) AS total FROM KDVN.IMG_FILE img
           LEFT JOIN KDVN.IMA_FILE ima ON img.IMG01 = ima.IMA01
           LEFT JOIN KDVN.IME_FILE ime ON img.IMG01 = ime.IME01
           ${whereClause}`,
          bindParams,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      const totalRecords = parseInt(totalResult.rows[0].TOTAL) || 0;
      const totalPages = totalRecords > 0 ? Math.ceil(totalRecords / parsedLimit) : 0;

      console.log("🔢 Tổng số bản ghi:", totalRecords);
      console.log("📄 Tổng số trang:", totalPages);

      // 🔥 Lấy dữ liệu phân trang
      const result = await connection.execute(
        `SELECT * FROM (
            SELECT a.*, ROWNUM rnum FROM (
                SELECT img.IMG01 AS product_id,
                       img.IMG02 AS warehouse_id,
                       img.IMG10 AS qty_available, 
                       ima.IMA02 AS product_name, 
                       ima.IMA021 AS description, 
                       ima.IMA12 AS category,     
                       ima.IMA25 AS unit          
                FROM KDVN.IMG_FILE img
                LEFT JOIN KDVN.IMA_FILE ima ON img.IMG01 = ima.IMA01
                LEFT JOIN KDVN.IME_FILE ime ON img.IMG01 = ime.IME01
                ${whereClause}  
                ORDER BY img.IMG01
            ) a WHERE ROWNUM <= :maxRow
        ) WHERE rnum > :offset`,  
        { ...bindParams, maxRow, offset },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

      console.log("📌 Số bản ghi trong trang này:", result.rows.length);

      await connection.close();

      res.json({
          page: parsedPage,
          limit: parsedLimit,
          totalRecords, 
          totalPages,
          data: result.rows
      });

  } catch (err) {
      console.error("❌ Lỗi truy vấn dữ liệu:", err);
      res.status(500).json({ error: "Lỗi server", details: err.message });
  }
});

app.put("/api/inventory/:id", async (req, res) => {
  try {
    const connection = await oracledb.getConnection({ poolAlias: "default" });

    const productId = req.params.id; // Lấy ID từ URL
    const { warehouse_id, qty_available, product_name, description, category, unit } = req.body; // Lấy dữ liệu từ body

    const result = await connection.execute(
      `UPDATE KDVN.IMG_FILE img
       SET img.IMG02 = :warehouse_id,
           img.IMG10 = :qty_available
       WHERE img.IMG01 = :productId`,
      { warehouse_id, qty_available, productId },
      { autoCommit: true }
    );

    const resultIma = await connection.execute(
      `UPDATE KDVN.IMA_FILE ima
       SET ima.IMA02 = :product_name,
           ima.IMA021 = :description,
           ima.IMA12 = :category,
           ima.IMA25 = :unit
       WHERE ima.IMA01 = :productId`,
      { product_name, description, category, unit, productId },
      { autoCommit: true }
    );

    await connection.close();

    if (result.rowsAffected === 0 && resultIma.rowsAffected === 0) {
      return res.status(404).json({ error: "Không tìm thấy sản phẩm để cập nhật" });
    }

    res.json({ message: "Cập nhật sản phẩm thành công" });
  } catch (err) {
    console.error("Lỗi cập nhật dữ liệu:", err);
    res.status(500).json({ error: "Lỗi server", details: err.message });
  }
});

app.get("/api/inventory/total-qty", async (req, res) => {
  try {
      console.log("📌 Query nhận được:", req.query); // Debug

      const {
          id,
          category,
          minQty,
          maxQty,
          search
      } = req.query;

      // ✅ Chuyển đổi kiểu dữ liệu an toàn
      const parsedMinQty = minQty ? parseFloat(minQty) : null;
      const parsedMaxQty = maxQty ? parseFloat(maxQty) : null;

      // ✅ Kiểm tra giá trị NaN, nếu có thì gán null
      if (minQty && isNaN(parsedMinQty)) {
          return res.status(400).json({ error: "minQty không hợp lệ" });
      }
      if (maxQty && isNaN(parsedMaxQty)) {
          return res.status(400).json({ error: "maxQty không hợp lệ" });
      }

      let conditions = [
        "img.IMG02 = '1903'",  // Chỉ lấy kho 1903
        "ima.IMA02 IS NOT NULL",  // Tên sản phẩm phải có
        "(img.IMG03 IS NULL OR LENGTH(img.IMG03) = 1)",
        "(img.IMG04 IS NULL OR LENGTH(img.IMG04) = 1)",
        "(ime.IME03 IS NULL OR LENGTH(ime.IME03) = 1)" 
      ];

      let bindParams = {};

      if (id && id !== "undefined") {
          conditions.push("img.IMG01 = :id");
          bindParams.id = id;
      }
      if (category && category !== "undefined") {
          conditions.push("ima.IMA12 = :category");
          bindParams.category = category;
      }
      if (parsedMinQty !== null) {
          conditions.push("CAST(img.IMG10 AS NUMBER) >= :minQty");
          bindParams.minQty = parsedMinQty;
      }
      if (parsedMaxQty !== null) {
          conditions.push("CAST(img.IMG10 AS NUMBER) <= :maxQty");
          bindParams.maxQty = parsedMaxQty;
      }
      if (search && search !== "undefined") {
          conditions.push("(LOWER(ima.IMA02) LIKE :search OR LOWER(ima.IMA021) LIKE :search)");
          bindParams.search = `%${search.toLowerCase()}%`;
      }

      let whereClause = "WHERE " + conditions.join(" AND ");

      console.log("📌 SQL Query:", whereClause);
      console.log("📌 Bind Params:", bindParams);

      const connection = await oracledb.getConnection({ poolAlias: "default" });

      // 🔥 Lấy tổng số lượng
      const totalQtyResult = await connection.execute(
        `SELECT SUM(CAST(img.IMG10 AS NUMBER)) AS total_qty
        FROM KDVN.IMG_FILE img
        LEFT JOIN KDVN.IMA_FILE ima ON img.IMG01 = ima.IMA01
        LEFT JOIN KDVN.IME_FILE ime ON img.IMG01 = ime.IME01
        ${whereClause}`,
        bindParams,
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      const totalQty = totalQtyResult.rows[0].TOTAL_QTY || 0;

      console.log("🔢 Tổng số lượng:", totalQty);

      await connection.close();

      res.json({
          totalQty
      });

  } catch (err) {
      console.error("❌ Lỗi truy vấn dữ liệu:", err);
      res.status(500).json({ error: "Lỗi server", details: err.message });
  }
});

// app.get("/api/inventory/out-of-stock", async (req, res) => {
//   try {
//       console.log("📌 Query nhận được:", req.query); // Debug

//       const {
//           id,
//           category,
//           search,
//           page = 1,
//           limit = 50,
//       } = req.query;

//       // ✅ Chuyển đổi kiểu dữ liệu an toàn
//       const parsedPage = parseInt(page);
//       const parsedLimit = parseInt(limit);

//       if (isNaN(parsedPage) || isNaN(parsedLimit)) {
//           return res.status(400).json({ error: "page và limit phải là số" });
//       }

//       const offset = (parsedPage - 1) * parsedLimit;
//       const maxRow = offset + parsedLimit;
//       let conditions = [
//         "img.IMG02 = '1903'",  // Chỉ lấy kho 1903
//         "ima.IMA02 IS NOT NULL",  // Tên sản phẩm phải có
//         "(img.IMG03 IS NULL OR LENGTH(img.IMG03) = 1)",
//         "(img.IMG04 IS NULL OR LENGTH(img.IMG04) = 1)",
//         "(ime.IME03 IS NULL OR LENGTH(ime.IME03) = 1)",

//         // Điều kiện lọc sản phẩm hết hàng (qty = 0) và sắp hết hàng (qty <= 1)
//         "(CAST(img.IMG10 AS NUMBER) = 0 OR CAST(img.IMG10 AS NUMBER) <= 1)"
//       ];
    
//       let bindParams = {};

//       if (id && id !== "undefined") {
//           conditions.push("img.IMG01 = :id");
//           bindParams.id = id;
//       }
//       if (category && category !== "undefined") {
//           conditions.push("ima.IMA12 = :category");
//           bindParams.category = category;
//       }
//       if (search && search !== "undefined") {
//           conditions.push("(LOWER(ima.IMA02) LIKE :search OR LOWER(ima.IMA021) LIKE :search)");
//           bindParams.search = `%${search.toLowerCase()}%`;
//       }

//       let whereClause = "WHERE " + conditions.join(" AND ");

//       console.log("📌 SQL Query:", whereClause);
//       console.log("📌 Bind Params:", bindParams);

//       const connection = await oracledb.getConnection({ poolAlias: "default" });

//       // 🔥 Lấy tổng số bản ghi
//       const totalResult = await connection.execute(
//           `SELECT COUNT(*) AS total FROM KDVN.IMG_FILE img
//            LEFT JOIN KDVN.IMA_FILE ima ON img.IMG01 = ima.IMA01
//            LEFT JOIN KDVN.IME_FILE ime ON img.IMG01 = ime.IME01
//            ${whereClause}`,
//           bindParams,
//           { outFormat: oracledb.OUT_FORMAT_OBJECT }
//       );

//       const totalRecords = parseInt(totalResult.rows[0].TOTAL) || 0;
//       const totalPages = totalRecords > 0 ? Math.ceil(totalRecords / parsedLimit) : 0;

//       console.log("🔢 Tổng số bản ghi:", totalRecords);
//       console.log("📄 Tổng số trang:", totalPages);

//       // 🔥 Lấy dữ liệu phân trang
//       const result = await connection.execute(
//         `SELECT * FROM (
//             SELECT a.*, ROWNUM rnum FROM (
//                 SELECT img.IMG01 AS product_id,
//                        img.IMG02 AS warehouse_id,
//                        img.IMG10 AS qty_available, 
//                        ima.IMA02 AS product_name, 
//                        ima.IMA021 AS description, 
//                        ima.IMA12 AS category,     
//                        ima.IMA25 AS unit          
//                 FROM KDVN.IMG_FILE img
//                 LEFT JOIN KDVN.IMA_FILE ima ON img.IMG01 = ima.IMA01
//                 LEFT JOIN KDVN.IME_FILE ime ON img.IMG01 = ime.IME01
//                 ${whereClause}  
//                 ORDER BY img.IMG01
//             ) a WHERE ROWNUM <= :maxRow
//         ) WHERE rnum > :offset`,  
//         { ...bindParams, maxRow, offset },
//         { outFormat: oracledb.OUT_FORMAT_OBJECT }
//     );

//       console.log("📌 Số bản ghi trong trang này:", result.rows.length);

//       await connection.close();

//       res.json({
//           page: parsedPage,
//           limit: parsedLimit,
//           totalRecords, 
//           totalPages,
//           data: result.rows
//       });

//   } catch (err) {
//       console.error("❌ Lỗi truy vấn dữ liệu:", err);
//       res.status(500).json({ error: "Lỗi server", details: err.message });
//   }
// });

// app.get("/api/inventory/out-of-stock", async (req, res) => {
//   try {
//       console.log("📌 Query nhận được:", req.query); // Debug

//       const {
//           id,
//           category,
//           search,
//           page = 1,
//           limit = 50,
//       } = req.query;

//       // ✅ Chuyển đổi kiểu dữ liệu an toàn
//       const parsedPage = parseInt(page);
//       const parsedLimit = parseInt(limit);

//       if (isNaN(parsedPage) || isNaN(parsedLimit)) {
//           return res.status(400).json({ error: "page và limit phải là số" });
//       }

//       const offset = (parsedPage - 1) * parsedLimit;
//       const maxRow = offset + parsedLimit;
//       let conditions = [
//         "img.IMG02 = '1903'",  // Chỉ lấy kho 1903
//         "ima.IMA02 IS NOT NULL",  // Tên sản phẩm phải có
//         "(img.IMG03 IS NULL OR LENGTH(img.IMG03) = 1)",
//         "(img.IMG04 IS NULL OR LENGTH(img.IMG04) = 1)",
//         "(ime.IME03 IS NULL OR LENGTH(ime.IME03) = 1)",

//         // Điều kiện lọc sản phẩm hết hàng (qty = 0) và sắp hết hàng (qty <= 1)
//         "(CAST(img.IMG10 AS NUMBER) = 0 OR CAST(img.IMG10 AS NUMBER) <= 1)"
//       ];
    
//       let bindParams = {};

//       if (id && id !== "undefined") {
//           conditions.push("img.IMG01 = :id");
//           bindParams.id = id;
//       }
//       if (category && category !== "undefined") {
//           conditions.push("ima.IMA12 = :category");
//           bindParams.category = category;
//       }
//       if (search && search !== "undefined") {
//           conditions.push("(LOWER(ima.IMA02) LIKE :search OR LOWER(ima.IMA021) LIKE :search)");
//           bindParams.search = `%${search.toLowerCase()}%`;
//       }

//       let whereClause = "WHERE " + conditions.join(" AND ");

//       console.log("📌 SQL Query:", whereClause);
//       console.log("📌 Bind Params:", bindParams);

//       const connection = await oracledb.getConnection({ poolAlias: "default" });

//       // 🔥 Lấy tổng số bản ghi
//       const totalResult = await connection.execute(
//           `SELECT COUNT(*) AS total FROM KDVN.IMG_FILE img
//            LEFT JOIN KDVN.IMA_FILE ima ON img.IMG01 = ima.IMA01
//            LEFT JOIN KDVN.IME_FILE ime ON img.IMG01 = ime.IME01
//            ${whereClause}`,
//           bindParams,
//           { outFormat: oracledb.OUT_FORMAT_OBJECT }
//       );

//       const totalRecords = parseInt(totalResult.rows[0].TOTAL) || 0;
//       const totalPages = totalRecords > 0 ? Math.ceil(totalRecords / parsedLimit) : 0;

//       console.log("🔢 Tổng số bản ghi:", totalRecords);
//       console.log("📄 Tổng số trang:", totalPages);

//       // 🔥 Lấy dữ liệu phân trang
//       const result = await connection.execute(
//         `SELECT * FROM (
//             SELECT a.*, ROWNUM rnum FROM (
//                 SELECT img.IMG01 AS product_id,
//                        img.IMG02 AS warehouse_id,
//                        img.IMG10 AS qty_available, 
//                        ima.IMA02 AS product_name, 
//                        ima.IMA021 AS description, 
//                        ima.IMA12 AS category,     
//                        ima.IMA25 AS unit          
//                 FROM KDVN.IMG_FILE img
//                 LEFT JOIN KDVN.IMA_FILE ima ON img.IMG01 = ima.IMA01
//                 LEFT JOIN KDVN.IME_FILE ime ON img.IMG01 = ime.IME01
//                 ${whereClause}  
//                 ORDER BY img.IMG01
//             ) a WHERE ROWNUM <= :maxRow
//         ) WHERE rnum > :offset`,  
//         { ...bindParams, maxRow, offset },
//         { outFormat: oracledb.OUT_FORMAT_OBJECT }
//     );

//       console.log("📌 Số bản ghi trong trang này:", result.rows.length);

//       await connection.close();

//       res.json({
//           page: parsedPage,
//           limit: parsedLimit,
//           totalRecords, 
//           totalPages,
//           data: result.rows
//       });

//   } catch (err) {
//       console.error("❌ Lỗi truy vấn dữ liệu:", err);
//       res.status(500).json({ error: "Lỗi server", details: err.message });
//   }
// });

app.get("/api/inventory/stock-status", async (req, res) => {
  try {
      console.log("📌 Query nhận được:", req.query); // Debug

      const {
          stockStatus,  // Thêm tham số stockStatus
          page = 1,
          limit = 50,
      } = req.query;

      // ✅ Chuyển đổi kiểu dữ liệu an toàn
      const parsedPage = parseInt(page);
      const parsedLimit = parseInt(limit);

      // ✅ Kiểm tra giá trị NaN, nếu có thì gán null
      if (isNaN(parsedPage) || isNaN(parsedLimit)) {
          return res.status(400).json({ error: "page và limit phải là số" });
      }

      const offset = (parsedPage - 1) * parsedLimit;
      const maxRow = offset + parsedLimit;

      let conditions = [
        "img.IMG02 = '1903'",  // Chỉ lấy kho 1903
        "ima.IMA02 IS NOT NULL",  // Tên sản phẩm phải có
        "(img.IMG03 IS NULL OR LENGTH(img.IMG03) = 1)",
        "(img.IMG04 IS NULL OR LENGTH(img.IMG04) = 1)",
        "(ime.IME03 IS NULL OR LENGTH(ime.IME03) = 1)" 
      ];

      let bindParams = {};

      // Kiểm tra stockStatus và thêm điều kiện tương ứng
      if (stockStatus === "out-of-stock") {
          conditions.push("CAST(img.IMG10 AS NUMBER) = 0");  // Hết hàng (qty = 0)
      } else if (stockStatus === "low-stock") {
          conditions.push("CAST(img.IMG10 AS NUMBER) = 1");  // Sắp hết hàng (qty <= 1)
      }

      let whereClause = "WHERE " + conditions.join(" AND ");

      console.log("📌 SQL Query:", whereClause);
      console.log("📌 Bind Params:", bindParams);

      const connection = await oracledb.getConnection({ poolAlias: "default" });

      // 🔥 Lấy tổng số bản ghi
      const totalResult = await connection.execute(
          `SELECT COUNT(*) AS total FROM KDVN.IMG_FILE img
           LEFT JOIN KDVN.IMA_FILE ima ON img.IMG01 = ima.IMA01
           LEFT JOIN KDVN.IME_FILE ime ON img.IMG01 = ime.IME01
           ${whereClause}`,
          bindParams,
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      const totalRecords = parseInt(totalResult.rows[0].TOTAL) || 0;
      const totalPages = totalRecords > 0 ? Math.ceil(totalRecords / parsedLimit) : 0;

      console.log("🔢 Tổng số bản ghi:", totalRecords);
      console.log("📄 Tổng số trang:", totalPages);

      // 🔥 Lấy dữ liệu phân trang
      const result = await connection.execute(
        `SELECT * FROM (
            SELECT a.*, ROWNUM rnum FROM (
                SELECT img.IMG01 AS product_id,
                       img.IMG02 AS warehouse_id,
                       img.IMG10 AS qty_available, 
                       ima.IMA02 AS product_name, 
                       ima.IMA021 AS description, 
                       ima.IMA12 AS category,     
                       ima.IMA25 AS unit          
                FROM KDVN.IMG_FILE img
                LEFT JOIN KDVN.IMA_FILE ima ON img.IMG01 = ima.IMA01
                LEFT JOIN KDVN.IME_FILE ime ON img.IMG01 = ime.IME01
                ${whereClause}  
                ORDER BY img.IMG01
            ) a WHERE ROWNUM <= :maxRow
        ) WHERE rnum > :offset`,  
        { ...bindParams, maxRow, offset },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

      console.log("📌 Số bản ghi trong trang này:", result.rows.length);

      await connection.close();

      res.json({
          page: parsedPage,
          limit: parsedLimit,
          totalRecords, 
          totalPages,
          data: result.rows
      });

  } catch (err) {
      console.error("❌ Lỗi truy vấn dữ liệu:", err);
      res.status(500).json({ error: "Lỗi server", details: err.message });
  }
});

app.put("/api/inventory/:id/qty", async (req, res) => {
  try {
    const connection = await oracledb.getConnection({ poolAlias: "default" });

    const productId = req.params.id; // Lấy ID từ URL
    const { qty_to_subtract } = req.body; // Lấy số lượng cần trừ từ body

    if (qty_to_subtract === undefined || isNaN(parseFloat(qty_to_subtract))) {
      return res.status(400).json({ error: "qty_to_subtract phải là số" });
    }

    // Lấy số lượng hiện tại của sản phẩm
    const currentQtyResult = await connection.execute(
      `SELECT IMG10 AS qty_available FROM KDVN.IMG_FILE WHERE IMG01 = :productId`,
      { productId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (currentQtyResult.rows.length === 0) {
      await connection.close();
      return res.status(404).json({ error: "Không tìm thấy sản phẩm" });
    }

    const currentQty = currentQtyResult.rows[0].QTY_AVAILABLE;
    const newQty = currentQty - qty_to_subtract;

    if (newQty < 0) {
      await connection.close();
      return res.status(400).json({ error: "Số lượng không đủ để trừ" });
    }

    const result = await connection.execute(
      `UPDATE KDVN.IMG_FILE img
       SET img.IMG10 = :newQty
       WHERE img.IMG01 = :productId`,
      { newQty, productId },
      { autoCommit: true }
    );

    await connection.close();

    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: "Không tìm thấy sản phẩm để cập nhật" });
    }

    res.json({ message: "Cập nhật số lượng sản phẩm thành công" });
  } catch (err) {
    console.error("Lỗi cập nhật dữ liệu:", err);
    res.status(500).json({ error: "Lỗi server", details: err.message });
  }
});

app.put("/api/inventory/:id/add-qty", async (req, res) => {
  try {
    const connection = await oracledb.getConnection({ poolAlias: "default" });

    const productId = req.params.id; // Lấy ID từ URL
    const { qty_to_add } = req.body; // Lấy số lượng cần cộng từ body

    if (qty_to_add === undefined || isNaN(parseFloat(qty_to_add))) {
      return res.status(400).json({ error: "qty_to_add phải là số" });
    }

    // Lấy số lượng hiện tại của sản phẩm
    const currentQtyResult = await connection.execute(
      `SELECT IMG10 AS qty_available FROM KDVN.IMG_FILE WHERE IMG01 = :productId`,
      { productId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (currentQtyResult.rows.length === 0) {
      await connection.close();
      return res.status(404).json({ error: "Không tìm thấy sản phẩm" });
    }

    const currentQty = currentQtyResult.rows[0].QTY_AVAILABLE;
    const newQty = currentQty + qty_to_add;

    const result = await connection.execute(
      `UPDATE KDVN.IMG_FILE img
       SET img.IMG10 = :newQty
       WHERE img.IMG01 = :productId`,
      { newQty, productId },
      { autoCommit: true }
    );

    await connection.close();

    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: "Không tìm thấy sản phẩm để cập nhật" });
    }

    res.json({ message: "Cập nhật số lượng sản phẩm thành công" });
  } catch (err) {
    console.error("Lỗi cập nhật dữ liệu:", err);
    res.status(500).json({ error: "Lỗi server", details: err.message });
  }
});



app.post('/api/insert', async (req, res) => { 
  let connection;
  try {
    connection = await getOracleConnection();

    const fields = Object.keys(req.body);
    let values = {};

    // Xử lý format ngày tháng
    const formatDateForOracle = (dateString) => {
      return new Date(dateString); // Chuyển thành Date object
    };

    fields.forEach(field => {
      if (typeof req.body[field] === 'string' && req.body[field].match(/^\d{4}-\d{2}-\d{2}/)) {
        values[field] = formatDateForOracle(req.body[field]);
      } else if (req.body[field] === '') {
        values[field] = null;
      } else {
        values[field] = req.body[field];
      }
    });


    // Thêm thời gian hiện tại cho 4 trường
    const currentISODate = getCurrentISODate();
    values['INA02'] = currentISODate;
    values['INA03'] = currentISODate;
    values['INADATE'] = currentISODate;
    values['INACOND'] = currentISODate;
    values['INAPLANT'] = 'KDVN';
    values['INALEGAL'] = 'KDVN';

    fields.push('INAPLANT', 'INALEGAL', 'INA02', 'INA03', 'INADATE', 'INACOND');

    const placeholders = fields.map(f => `:${f}`).join(", ");
    const sql = `INSERT INTO KDVN.INA_FILE (${fields.join(", ")}) VALUES (${placeholders})`;

    console.log('SQL Query:', sql);
    console.log('Values:', values);

    await connection.execute(sql, values, { autoCommit: true });

    res.status(201).json({ message: 'Dữ liệu đã được insert thành công' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Lỗi khi insert dữ liệu', details: error.message });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error(err);
      }
    }
  }
});


app.post('/api/insert-inb', async (req, res) => { 
  let connection;
  try {
    // Kết nối với Oracle DB
    connection = await getOracleConnection();

    // Lọc ra các trường có trong request body
    const fields = Object.keys(req.body);
    let values = {};

    // Chuyển đổi giá trị ngày tháng và gán giá trị cho các trường
    fields.forEach(field => {
      if (typeof req.body[field] === 'string' && req.body[field].includes('T')) {
        values[field] = new Date(req.body[field]); // Chuyển thành kiểu Date nếu có định dạng thời gian
      } else if (req.body[field] === '') {
        values[field] = null; // Gán NULL nếu giá trị rỗng
      } else {
        values[field] = req.body[field];
      }
    });

    // Gán thêm các giá trị mặc định mới
    values['INBPLANT'] = 'KDVN';   
    values['INBLEGAL'] = 'KDVN';   
    values['INB132'] = 0;   
    values['INB133'] = 0;   
    values['INB134'] = 0;   
    values['INB135'] = 0;   
    values['INB136'] = 0;   
    values['INB137'] = 0;   
    values['INB138'] = 0;   
    values['INB10'] = 'N';  
    values['INB15'] = 4006; 
    values['INB03'] = '1';      // Giá trị mặc định mới
    values['INB05'] = '1903';   // Giá trị mặc định mới
    values['INB08_FAC'] = '1';  // Giá trị mặc định mới
    values['INB06'] = ' ';
    values['INB07'] = ' ';
    values['INB11'] = ' ';
    values['INB12'] = ' ';
    values['INB901'] = ' ';
    values['INB13'] = '0';
    values['INB908'] = '0';
    values['INB909'] = '0';
    // Thêm các trường mới vào danh sách fields
    fields.push('INB909','INB908','INB13','INBPLANT', 'INBLEGAL', 'INB132', 'INB133', 'INB134', 'INB135', 'INB136', 'INB137', 'INB138', 'INB10', 'INB15', 'INB03', 'INB05', 'INB08_FAC', 'INB06', 'INB07', 'INB11', 'INB12', 'INB901');

    // Tạo danh sách các placeholder (VD: :INB01, :INB02, ...)
    const placeholders = fields.map(f => `:${f}`).join(", ");

    // Tạo câu lệnh SQL động
    const sql = `INSERT INTO KDVN.INB_FILE (${fields.join(", ")}) VALUES (${placeholders})`;

    // Kiểm tra lại câu lệnh SQL và giá trị để debug
    console.log('SQL Query:', sql);
    console.log('Values:', values);

    // Thực thi câu lệnh SQL
    await connection.execute(sql, values, { autoCommit: true });

    res.status(201).json({ message: 'Dữ liệu đã được insert thành công' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Lỗi khi insert dữ liệu', details: error.message });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error(err);
      }
    }
  }
});

app.get('/api/get-gen/:gen01', async (req, res) => {
  let connection;
  try {
    const { gen01 } = req.params; // Lấy mã nhân viên từ URL

    connection = await getOracleConnection();

    // Câu lệnh SQL truy vấn dữ liệu
    const sql = `
      SELECT GEN01, GEN02, GEN03, GEN04 
      FROM KDVN.GEN_FILE 
      WHERE GEN01 = :gen01
    `;

    // Thực thi truy vấn
    const result = await connection.execute(sql, { gen01 });

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
    }

    // Chuyển đổi dữ liệu về object với key mong muốn
    const row = result.rows[0];
    const data = {
      genid: row[0],    // Mã nhân viên (GEN01)
      name: row[1],  // Họ và tên (GEN02)
      deptID: row[2],  // Mã bộ phận (GEN03)
      title: row[3]  // Chức vụ (GEN04)
    };

    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Lỗi khi lấy dữ liệu', details: error.message });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error(err);
      }
    }
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
});
