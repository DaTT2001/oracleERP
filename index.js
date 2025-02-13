const express = require("express");
const oracledb = require("oracledb");

const app = express();
const PORT = 4000;

// const oracledb = require("oracledb");

async function initOracle() {
    try {
        await oracledb.createPool({
            user: "datit",
            password: "dcdat2001",
            connectString: "10.10.10.21:1521/topprod",
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

app.get("/api/inventory", async (req, res) => {
  try {
      const connection = await oracledb.getConnection({ poolAlias: "default" });
      const result = await connection.execute(
          `SELECT * FROM (
                SELECT img.IMG01, img.IMG02, img.IMG03, img.IMG04, 
                       img.IMG08 AS qty_available, 
                       ima.IMA02 AS product_name, ima.IMA25 AS unit
                FROM KDVN.IMG_FILE img
                LEFT JOIN KDVN_T.IMA_FILE ima ON img.IMG01 = ima.IMA01
                WHERE img.IMG02 = '1903'  -- Chỉ lấy kho 1903
                ORDER BY img.IMG01
            ) WHERE ROWNUM <= 50`,
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      await connection.close();
      res.json(result.rows);
  } catch (err) {
      console.error("Lỗi truy vấn dữ liệu:", err);
      res.status(500).json({ error: "Lỗi server" });
  }
});



// Mở server
app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
});
