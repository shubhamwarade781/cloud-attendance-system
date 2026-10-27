
const db = require("./db");

async function testConnection() {
  try {
    const [rows] = await db.query("SHOW TABLES");
    console.log("Database connected successfully!");
    console.log(rows);
  } catch (error) {
    console.error("Database connection failed:", error.message);
  } finally {
    await db.end();
  }
}

testConnection();
