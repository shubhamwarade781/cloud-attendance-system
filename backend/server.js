
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

// Register student only

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        message: "Name, email, password and role are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must contain at least 8 characters",
      });
    }

    if (!["student", "teacher"].includes(role)) {
      return res.status(400).json({
        message: "Only Student and Teacher registration is allowed",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const [existing] = await db.execute(
      "SELECT id FROM users WHERE email = ?",
      [normalizedEmail]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        message: "Email already registered",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const approvalStatus =
      role === "teacher" ? "pending" : "approved";

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [result] = await connection.execute(
        `INSERT INTO users
         (name, email, password_hash, role, approval_status)
         VALUES (?, ?, ?, ?, ?)`,
        [
          name.trim(),
          normalizedEmail,
          passwordHash,
          role,
          approvalStatus,
        ]
      );

      if (role === "student") {
        const [studentRows] = await connection.execute(
          "SELECT id FROM students WHERE user_id = ?",
          [result.insertId]
        );

        if (studentRows.length === 0) {
          const rollNumber = `MCA-${result.insertId}`;

          await connection.execute(
            `INSERT INTO students (user_id, roll_number, class_name)
             VALUES (?, ?, ?)`,
            [result.insertId, rollNumber, "FY MCA"]
          );
        }
      }

      await connection.commit();

      return res.status(201).json({
        message:
          role === "teacher"
            ? "Teacher registration successful. Wait for admin approval."
            : "Student registration successful. You can now log in.",
        userId: result.insertId,
        role,
        approvalStatus,
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Registration error:", error.message);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Email or roll number already exists",
      });
    }

    return res.status(500).json({
      message: "Registration failed",
    });
  }
});



app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({
        message: "Email, password and role are required",
      });
    }

    if (!["student", "teacher", "admin"].includes(role)) {
      return res.status(400).json({
        message: "Invalid login role",
      });
    }

    const [users] = await db.execute(
      `SELECT id, name, email, password_hash, role, approval_status
       FROM users
       WHERE email = ?`,
      [email.trim().toLowerCase()]
    );

    if (users.length === 0) {
      return res.status(401).json({
        message: "Invalid email, password or role",
      });
    }

    const user = users[0];

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword || user.role !== role) {
      return res.status(401).json({
        message: "Invalid email, password or role",
      });
    }

    if (
      user.role === "teacher" &&
      user.approval_status !== "approved"
    ) {
      return res.status(403).json({
        message:
          user.approval_status === "pending"
            ? "Your account is waiting for admin approval"
            : "Your teacher account has not been approved",
      });
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured");
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    return res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({
      message: "Login failed",
    });
  }
});



// JWT authentication
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      message: "Authentication token required",
    });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (error) {
    return res.status(403).json({
      message: "Invalid or expired token",
    });
  }
}

// Role authorization
function allowRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Permission denied",
      });
    }

    next();
  };
}

// Mark or update attendance
app.post(
  "/api/attendance",
  authenticateToken,
  allowRoles("teacher", "admin"),
  async (req, res) => {
    try {
      const { student_id, attendance_date, status } = req.body;

      if (
        !Number.isInteger(student_id) ||
        !attendance_date ||
        !["present", "absent"].includes(status)
      ) {
        return res.status(400).json({
          message:
            "Valid student_id, attendance_date and status are required",
        });
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(attendance_date)) {
        return res.status(400).json({
          message: "Date must use YYYY-MM-DD format",
        });
      }

      const [students] = await db.execute(
        "SELECT id FROM students WHERE id = ?",
        [student_id]
      );

      if (students.length === 0) {
        return res.status(404).json({
          message: "Student not found",
        });
      }

      await db.execute(
        `INSERT INTO attendance
          (student_id, attendance_date, status, marked_by)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          marked_by = VALUES(marked_by)`,
        [student_id, attendance_date, status, req.user.id]
      );

      res.json({
        message: "Attendance saved successfully",
        student_id,
        attendance_date,
        status,
      });
    } catch (error) {
      console.error("Attendance error:", error.message);

      res.status(500).json({
        message: "Could not save attendance",
      });
    }
  }
);

// Teacher dashboard statistics
app.get(
  "/api/attendance/stats",
  authenticateToken,
  allowRoles("teacher", "admin"),
  async (req, res) => {
    try {
      const date = req.query.date;

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          message: "Valid date is required in YYYY-MM-DD format",
        });
      }

      const [[studentCount]] = await db.execute(
        "SELECT COUNT(*) AS totalStudents FROM students"
      );

      const [[attendanceCount]] = await db.execute(
        `SELECT
           COUNT(*) AS marked,
           COALESCE(SUM(status = 'present'), 0) AS present,
           COALESCE(SUM(status = 'absent'), 0) AS absent
         FROM attendance
         WHERE attendance_date = ?`,
        [date]
      );

      const totalStudents = Number(studentCount.totalStudents);
      const present = Number(attendanceCount.present);
      const absent = Number(attendanceCount.absent);
      const marked = Number(attendanceCount.marked);

      res.json({
        date,
        totalStudents,
        present,
        absent,
        notMarked: Math.max(totalStudents - marked, 0),
        attendancePercentage:
          marked > 0
            ? Number(((present / marked) * 100).toFixed(2))
            : 0,
      });
    } catch (error) {
      console.error("Statistics error:", error.message);

      res.status(500).json({
        message: "Could not fetch attendance statistics",
      });
    }
  }
);

// Get student list
app.get(
  "/api/students",
  authenticateToken,
  allowRoles("teacher", "admin"),
  async (req, res) => {
    try {
      const [students] = await db.execute(`
        SELECT
          s.id AS student_id,
          s.roll_number,
          s.class_name,
          u.name,
          u.email
        FROM students s
        JOIN users u ON s.user_id = u.id
        ORDER BY s.roll_number
      `);

      res.json(students);
    } catch (error) {
      console.error("Students error:", error.message);

      res.status(500).json({
        message: "Could not fetch students",
      });
    }
  }
);

// View attendance
app.get(
  "/api/attendance",
  authenticateToken,
  async (req, res) => {
    try {
      let query = `
        SELECT
          a.id,
          s.id AS student_id,
          s.roll_number,
          u.name AS student_name,
          a.attendance_date,
          a.status
        FROM attendance a
        JOIN students s ON a.student_id = s.id
        JOIN users u ON s.user_id = u.id
      `;

      const params = [];

      if (req.user.role === "student") {
        query += " WHERE s.user_id = ?";
        params.push(req.user.id);
      } else if (
        req.user.role !== "admin" &&
        req.user.role !== "teacher"
      ) {
        return res.status(403).json({
          message: "Permission denied",
        });
      }

      query += " ORDER BY a.attendance_date DESC";

      const [rows] = await db.execute(query, params);

      res.json(rows);
    } catch (error) {
      console.error("Fetch attendance error:", error.message);

      res.status(500).json({
        message: "Could not fetch attendance",
      });
    }
  }
);
// ADMIN: Get all pending teacher accounts
app.get(
  "/api/admin/pending-teachers",
  authenticateToken,
  allowRoles("admin"),
  async (req, res) => {
    try {
      const [teachers] = await db.execute(
        `SELECT id, name, email, approval_status
         FROM users
         WHERE role = 'teacher'
           AND approval_status = 'pending'
         ORDER BY id DESC`
      );

      res.json(teachers);
    } catch (error) {
      console.error("Pending teachers error:", error.message);
      res.status(500).json({
        message: "Could not fetch pending teachers",
      });
    }
  }
);

// ADMIN: Approve or reject a teacher
app.patch(
  "/api/admin/teachers/:id/status",
  authenticateToken,
  allowRoles("admin"),
  async (req, res) => {
    try {
      const teacherId = Number(req.params.id);
      const { status } = req.body;

      if (!Number.isInteger(teacherId) || teacherId <= 0) {
        return res.status(400).json({
          message: "Invalid teacher ID",
        });
      }

      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({
          message: "Status must be approved or rejected",
        });
      }

      const [result] = await db.execute(
        `UPDATE users
         SET approval_status = ?
         WHERE id = ?
           AND role = 'teacher'`,
        [status, teacherId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          message: "Teacher not found",
        });
      }

      res.json({
        message: `Teacher ${status} successfully`,
      });
    } catch (error) {
      console.error("Teacher status error:", error.message);
      res.status(500).json({
        message: "Could not update teacher status",
      });
    }
  }
);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
