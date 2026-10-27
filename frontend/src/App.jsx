import { useCallback, useEffect, useState } from "react";
import "./App.css";

const API = "http://localhost:5000";

function App() {
  const [page, setPage] = useState(
    localStorage.getItem("token") ? "dashboard" : "login"
  );

  const [token, setToken] = useState(localStorage.getItem("token") || "");

  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  });

  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("student");
  const [showPassword, setShowPassword] = useState(false);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [students, setStudents] = useState([]);
  const [records, setRecords] = useState([]);
  const [pendingTeachers, setPendingTeachers] = useState([]);
  const [approvalLoading, setApprovalLoading] = useState(false);

  const [stats, setStats] = useState({
    totalStudents: 0,
    present: 0,
    absent: 0,
    notMarked: 0,
    attendancePercentage: 0,
  });

  const [date, setDate] = useState(
    new Date().toLocaleDateString("en-CA")
  );

  const isTeacher = ["teacher", "admin"].includes(user?.role);

  const presentCount = records.filter(
    (record) => record.status === "present"
  ).length;

  const absentCount = records.filter(
    (record) => record.status === "absent"
  ).length;

  const studentPercentage =
    records.length > 0
      ? Math.round((presentCount / records.length) * 100)
      : 0;

  // Switch between Login and Register
  const changeForm = (registerMode) => {
    setIsRegister(registerMode);
    setRole("student");
    setMessage("");
    setPassword("");
    setShowPassword(false);
  };

  // Login and Registration
  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      const endpoint = isRegister
        ? "/api/auth/register"
        : "/api/auth/login";

      const payload = isRegister
        ? {
            name: name.trim(),
            email: email.trim(),
            password,
            role: ["student", "teacher"].includes(role)
              ? role
              : "student",
          }
        : {
            email: email.trim(),
            password,
            role,
          };

      const response = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Something went wrong");
      }

      if (isRegister) {
        setMessage(
          role === "teacher"
            ? "Registration successful! Wait for admin approval."
            : "Registration successful! Please login."
        );

        setIsRegister(false);
        setPassword("");
        setRole("student");
      } else {
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));

        setToken(data.token);
        setUser(data.user);
        setPage("dashboard");
        setMessage("");
      }
    } catch (error) {
      setMessage(error.message || "Unable to connect to server");
    } finally {
      setLoading(false);
    }
  };

  // Load students for Teacher and Admin
  const loadStudents = useCallback(async () => {
    if (!token || !isTeacher) return;

    try {
      const response = await fetch(`${API}/api/students`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Could not load students");
      }

      setStudents(data);
    } catch (error) {
      setMessage(error.message);
    }
  }, [token, isTeacher]);

  // Load attendance records
  const loadAttendance = useCallback(async () => {
    if (!token) return;

    try {
      const response = await fetch(`${API}/api/attendance`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Could not load attendance");
      }

      setRecords(data);
    } catch (error) {
      setMessage(error.message);
    }
  }, [token]);

  // Load attendance statistics
  const loadStats = useCallback(async () => {
    if (!token || !isTeacher) return;

    try {
      const response = await fetch(
        `${API}/api/attendance/stats?date=${date}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Could not load statistics");
      }

      setStats(data);
    } catch (error) {
      setMessage(error.message);
    }
  }, [token, isTeacher, date]);

  // Load pending teacher requests (Admin only)
  const loadPendingTeachers = async () => {
    try {
      setApprovalLoading(true);

      const response = await fetch(
        `${API}/api/admin/pending-teachers`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Could not load pending teachers"
        );
      }

      setPendingTeachers(data);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setApprovalLoading(false);
    }
  };

  // Approve or reject teacher registration (Admin only)
  const updateTeacherStatus = async (teacherId, status) => {
    try {
      setApprovalLoading(true);

      const response = await fetch(
        `${API}/api/admin/teachers/${teacherId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Could not update teacher"
        );
      }

      setMessage(data.message);
      await loadPendingTeachers();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setApprovalLoading(false);
    }
  };

  // Refresh dashboard data
  const refreshDashboard = useCallback(async () => {
    await Promise.all([
      loadAttendance(),
      ...(isTeacher ? [loadStudents(), loadStats()] : []),
    ]);
  }, [loadAttendance, loadStudents, loadStats, isTeacher]);

  // Load dashboard when logged in
  useEffect(() => {
    if (page === "dashboard" && token && user) {
      refreshDashboard();
    }
  }, [page, token, user, refreshDashboard]);

  // Load pending requests when Admin opens dashboard
  useEffect(() => {
    if (
      page === "dashboard" &&
      token &&
      user?.role === "admin"
    ) {
      loadPendingTeachers();
    }
  }, [page, token, user, token]);

  // Mark attendance
  const markAttendance = async (studentId, status) => {
    setMessage("");

    try {
      const response = await fetch(`${API}/api/attendance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          student_id: Number(studentId),
          attendance_date: date,
          status,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Could not save attendance"
        );
      }

      setMessage(`Attendance marked ${status} successfully.`);
      await refreshDashboard();
    } catch (error) {
      setMessage(error.message);
    }
  };

  // Logout
  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    setToken("");
    setUser(null);
    setStudents([]);
    setRecords([]);
    setPendingTeachers([]);
    setPage("login");
    setIsRegister(false);
    setRole("student");
    setMessage("");
    setPassword("");
  };

  // Filter records by selected date for Teacher and Admin
  const displayedRecords = isTeacher
    ? records.filter(
        (record) =>
          String(record.attendance_date).slice(0, 10) === date
      )
    : records;

  // LOGIN AND REGISTRATION PAGE
  if (page === "login" || page === "register") {
    return (
      <main className="auth-page premium-auth">
        <section className="auth-showcase">
          <div className="showcase-brand">
            <div className="showcase-logo">CA</div>

            <div>
              <h2>Cloud Attendance</h2>
              <p>Student Attendance Management System</p>
            </div>
          </div>

          <div className="showcase-content">
            <span className="eyebrow">
              SMART · SIMPLE · SECURE
            </span>

            <h1>
              Attendance
              <span> Made Smarter.</span>
            </h1>

            <p className="showcase-description">
              Manage classroom attendance with a simple, secure and
              reliable cloud-based system.
            </p>

            <div className="feature-item">
              <div className="feature-icon">🎓</div>
              <div>
                <h3>Student Portal</h3>
                <p>View your attendance record and daily status.</p>
              </div>
            </div>

            <div className="feature-item">
              <div className="feature-icon purple">👨‍🏫</div>
              <div>
                <h3>Teacher Portal</h3>
                <p>Mark and update student attendance easily.</p>
              </div>
            </div>

            <div className="feature-item">
              <div className="feature-icon orange">📊</div>
              <div>
                <h3>Attendance Analytics</h3>
                <p>Check attendance summaries and class statistics.</p>
              </div>
            </div>
          </div>

          <div className="showcase-bottom">
            <span className="showcase-bottom-icon">☁</span>
            <span>Smarter attendance. Better management.</span>
          </div>
        </section>

        <section className="auth-form-side">
          <div className="auth-card premium-card">
            <div className="mobile-brand">
              <div className="brand-icon">CA</div>
              <h2>Cloud Attendance</h2>
            </div>

            <div className="auth-tabs">
              <button
                type="button"
                className={!isRegister ? "tab active-tab" : "tab"}
                onClick={() => changeForm(false)}
              >
                Login
              </button>

              <button
                type="button"
                className={isRegister ? "tab active-tab" : "tab"}
                onClick={() => changeForm(true)}
              >
                Register
              </button>
            </div>

            <div className="form-heading">
              <h1>
                {isRegister ? "Create Account" : "Welcome Back!"}
              </h1>

              <p>
                {isRegister
                  ? "Create your account to get started."
                  : "Sign in to continue to your dashboard."}
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              {isRegister && (
                <>
                  <label htmlFor="name">Full Name</label>

                  <div className="input-with-icon">
                    <span className="field-icon">♙</span>

                    <input
                      id="name"
                      type="text"
                      placeholder="Enter your full name"
                      value={name}
                      onChange={(event) =>
                        setName(event.target.value)
                      }
                      autoComplete="name"
                      required
                    />
                  </div>

                  <div className="role-selection">
                    <label>Register as</label>

                    <div className="role-options">
                      <button
                        type="button"
                        className={
                          role === "student"
                            ? "role-btn selected"
                            : "role-btn"
                        }
                        onClick={() => setRole("student")}
                        aria-pressed={role === "student"}
                      >
                        🎓 Student
                      </button>

                      <button
                        type="button"
                        className={
                          role === "teacher"
                            ? "role-btn selected"
                            : "role-btn"
                        }
                        onClick={() => setRole("teacher")}
                        aria-pressed={role === "teacher"}
                      >
                        👨‍🏫 Teacher
                      </button>
                    </div>
                  </div>
                </>
              )}

              {!isRegister && (
                <div className="role-selection">
                  <label>Login as</label>

                  <div className="role-options">
                    <button
                      type="button"
                      className={
                        role === "student"
                          ? "role-btn selected"
                          : "role-btn"
                      }
                      onClick={() => setRole("student")}
                      aria-pressed={role === "student"}
                    >
                      <span className="role-emoji">🎓</span>
                      <span>Student</span>
                      {role === "student" && (
                        <span className="role-check">✓</span>
                      )}
                    </button>

                    <button
                      type="button"
                      className={
                        role === "admin"
                          ? "role-btn selected"
                          : "role-btn"
                      }
                      onClick={() => setRole("admin")}
                      aria-pressed={role === "admin"}
                    >
                      🛡️ Admin
                    </button>

                    <button
                      type="button"
                      className={
                        role === "teacher"
                          ? "role-btn selected"
                          : "role-btn"
                      }
                      onClick={() => setRole("teacher")}
                      aria-pressed={role === "teacher"}
                    >
                      <span className="role-emoji">👨‍🏫</span>
                      <span>Teacher</span>
                      {role === "teacher" && (
                        <span className="role-check">✓</span>
                      )}
                    </button>
                  </div>
                </div>
              )}

              <label htmlFor="email">Email Address</label>

              <div className="input-with-icon">
                <span className="field-icon">✉</span>

                <input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  autoComplete="email"
                  required
                />
              </div>

              <label htmlFor="password">Password</label>

              <div className="password-wrapper input-with-icon">
                <span className="field-icon">🔒</span>

                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder={
                    isRegister
                      ? "Minimum 8 characters"
                      : "Enter your password"
                  }
                  value={password}
                  onChange={(event) =>
                    setPassword(event.target.value)
                  }
                  autoComplete={
                    isRegister
                      ? "new-password"
                      : "current-password"
                  }
                  minLength={isRegister ? 8 : undefined}
                  required
                />

                <button
                  type="button"
                  className="password-toggle"
                  onClick={() =>
                    setShowPassword((previous) => !previous)
                  }
                  aria-label={
                    showPassword ? "Hide password" : "Show password"
                  }
                  title={
                    showPassword ? "Hide password" : "Show password"
                  }
                >
                  {showPassword ? "🙈" : "👁"}
                </button>
              </div>

              {message && (
                <p className="message" role="status">
                  {message}
                </p>
              )}

              <button
                type="submit"
                className="primary-btn premium-submit"
                disabled={loading}
              >
                {loading
                  ? "Please wait..."
                  : isRegister
                  ? `Create ${
                      role === "student" ? "Student" : "Teacher"
                    } Account →`
                  : `Sign In as ${
                      role === "admin"
                        ? "Admin"
                        : role === "student"
                        ? "Student"
                        : "Teacher"
                    } →`}
              </button>
            </form>

            <div className="secure-note">
              <span>🔐</span>
              Secure login with role-based access
            </div>

            <p className="auth-footer">
              {isRegister
                ? "Already have an account? "
                : "Don't have an account? "}

              <button
                type="button"
                className="text-btn"
                onClick={() => changeForm(!isRegister)}
              >
                {isRegister ? "Login here" : "Register here"}
              </button>
            </p>
          </div>
        </section>
      </main>
    );
  }

  // DASHBOARD PAGE
  return (
    <main className="dashboard-page">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="topbar-logo">CA</div>

          <div>
            <h1>Cloud Attendance</h1>
            <p>Student Attendance Management System</p>
          </div>
        </div>

        <div className="user-area">
          <div className="user-avatar">
            {(user?.name || "U").charAt(0).toUpperCase()}
          </div>

          <div className="user-info">
            <strong>{user?.name}</strong>
            <span>{user?.role}</span>
          </div>

          <button
            type="button"
            className="logout-btn"
            onClick={logout}
          >
            Log out ↗
          </button>
        </div>
      </header>

      <section className="dashboard-content">
        {/* ADMIN TEACHER APPROVAL PANEL */}
        {user?.role === "admin" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>Teacher Approval Requests</h3>
                <p>
                  Review and approve new teacher registrations.
                </p>
              </div>

              <button
                type="button"
                onClick={loadPendingTeachers}
                disabled={approvalLoading}
              >
                {approvalLoading ? "Loading..." : "Refresh"}
              </button>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Teacher Name</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {pendingTeachers.map((teacher) => (
                    <tr key={teacher.id}>
                      <td>{teacher.name}</td>
                      <td>{teacher.email}</td>
                      <td>Pending</td>

                      <td>
                        <button
                          type="button"
                          disabled={approvalLoading}
                          onClick={() =>
                            updateTeacherStatus(
                              teacher.id,
                              "approved"
                            )
                          }
                        >
                          Approve
                        </button>

                        <button
                          type="button"
                          disabled={approvalLoading}
                          onClick={() =>
                            updateTeacherStatus(
                              teacher.id,
                              "rejected"
                            )
                          }
                        >
                          Reject
                        </button>
                      </td>
                    </tr>
                  ))}

                  {pendingTeachers.length === 0 && (
                    <tr>
                      <td colSpan="4" className="empty-state">
                        No pending teacher requests.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div className="welcome-row">
          <div>
            <span className="dashboard-eyebrow">
              {user?.role === "admin"
                ? "ADMIN PORTAL"
                : isTeacher
                ? "TEACHER PORTAL"
                : "STUDENT PORTAL"}
            </span>

            <h2>Hello, {user?.name || "User"} 👋</h2>

            <p>
              {isTeacher
                ? "Manage attendance and review your class statistics."
                : "Here is your personal attendance overview."}
            </p>
          </div>

          {isTeacher && (
            <div className="date-control">
              <label htmlFor="attendance-date">
                Attendance Date
              </label>

              <input
                id="attendance-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          )}
        </div>

        {message && (
          <div className="dashboard-message" role="status">
            {message}
          </div>
        )}

        {/* TEACHER AND ADMIN DASHBOARD */}
        {isTeacher ? (
          <>
            <div className="stats-grid">
              <StatCard
                icon="👨‍🎓"
                label="Total Students"
                value={stats.totalStudents}
              />

              <StatCard
                icon="✅"
                label="Present"
                value={stats.present}
                tone="green"
              />

              <StatCard
                icon="❌"
                label="Absent"
                value={stats.absent}
                tone="red"
              />

              <StatCard
                icon="🕒"
                label="Not Marked"
                value={stats.notMarked}
                tone="orange"
              />

              <StatCard
                icon="📈"
                label="Attendance"
                value={`${stats.attendancePercentage}%`}
                tone="purple"
              />
            </div>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>All Students</h3>
                  <p>Mark attendance for {date}</p>
                </div>

                <span>{students.length} students</span>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Roll Number</th>
                      <th>Student Name</th>
                      <th>Class</th>
                      <th>Attendance</th>
                    </tr>
                  </thead>

                  <tbody>
                    {students.map((student) => {
                      const current = records.find(
                        (record) =>
                          Number(record.student_id) ===
                            Number(student.student_id) &&
                          String(record.attendance_date).slice(0, 10) ===
                            date
                      );

                      return (
                        <tr key={student.student_id}>
                          <td>{student.roll_number}</td>

                          <td>
                            <div className="student-name-cell">
                              <span className="table-avatar">
                                {(student.name || "S")
                                  .charAt(0)
                                  .toUpperCase()}
                              </span>

                              <span>{student.name}</span>
                            </div>
                          </td>

                          <td>{student.class_name}</td>

                          <td>
                            <div className="attendance-actions">
                              <button
                                type="button"
                                className={`small-btn present-btn ${
                                  current?.status === "present"
                                    ? "chosen"
                                    : ""
                                }`}
                                onClick={() =>
                                  markAttendance(
                                    student.student_id,
                                    "present"
                                  )
                                }
                              >
                                ✓ Present
                              </button>

                              <button
                                type="button"
                                className={`small-btn absent-btn ${
                                  current?.status === "absent"
                                    ? "chosen"
                                    : ""
                                }`}
                                onClick={() =>
                                  markAttendance(
                                    student.student_id,
                                    "absent"
                                  )
                                }
                              >
                                ✕ Absent
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {students.length === 0 && (
                      <tr>
                        <td colSpan="4" className="empty-state">
                          No students found. Register students first.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          /* STUDENT DASHBOARD */
          <div className="stats-grid student-stats">
            <StatCard
              icon="📚"
              label="Total Records"
              value={records.length}
            />

            <StatCard
              icon="✅"
              label="Present Days"
              value={presentCount}
              tone="green"
            />

            <StatCard
              icon="❌"
              label="Absent Days"
              value={absentCount}
              tone="red"
            />

            <StatCard
              icon="📈"
              label="My Attendance"
              value={`${studentPercentage}%`}
              tone="purple"
            />
          </div>
        )}

        {/* ATTENDANCE HISTORY */}
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>
                {isTeacher
                  ? "Attendance Records"
                  : "My Attendance History"}
              </h3>

              <p>
                {isTeacher
                  ? `Attendance records for ${date}`
                  : "Your personal attendance history"}
              </p>
            </div>

            <span>{displayedRecords.length} records</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {isTeacher && <th>Roll Number</th>}
                  {isTeacher && <th>Student Name</th>}
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {displayedRecords.map((record) => (
                  <tr key={record.id}>
                    {isTeacher && <td>{record.roll_number}</td>}
                    {isTeacher && <td>{record.student_name}</td>}

                    <td>
                      {String(record.attendance_date).slice(0, 10)}
                    </td>

                    <td>
                      <span
                        className={`status-pill ${
                          record.status === "present"
                            ? "status-present"
                            : "status-absent"
                        }`}
                      >
                        {record.status === "present"
                          ? "✓ Present"
                          : "✕ Absent"}
                      </span>
                    </td>
                  </tr>
                ))}

                {displayedRecords.length === 0 && (
                  <tr>
                    <td
                      colSpan={isTeacher ? 4 : 2}
                      className="empty-state"
                    >
                      No attendance records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="dashboard-footer">
          <span>☁ Cloud Attendance</span>
          <span>Secure · Simple · Reliable</span>
        </footer>
      </section>
    </main>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone = "blue",
}) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${tone}`}>{icon}</div>

      <div className="stat-details">
        <p>{label}</p>
        <h3>{value}</h3>
      </div>
    </article>
  );
}

export default App;