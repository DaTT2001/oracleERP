const express = require("express");
const oracledb = require("oracledb");
require("dotenv").config();

const app = express();
const PORT = 4000;
const cors = require('cors');
app.use(cors());
// const oracledb = require("oracledb");

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
           WHERE img.IMG01 = :productId`,  
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
          "img.IMG02 = '1903'",
          "ima.IMA02 IS NOT NULL"
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



app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
});
