// routes/thpt.js
const express  = require("express");
const router   = express.Router();
const Database = require("better-sqlite3");
const path     = require("path");

const DB_PATH = process.env.DB_PATH || "/data/db/thpt2026.db";

// ── Khởi tạo DB ─────────────────────────────────────────
let db;
try {
  db = new Database(DB_PATH, { fileMustExist: true });
  db.pragma("journal_mode = WAL");
  db.pragma("cache_size = -32000");
  db.pragma("temp_store = memory");
  console.log("✅ DB connected:", DB_PATH);
} catch (e) {
  console.log("⚠️ WAL failed, thử immutable mode...");
  try {
    db = new Database(DB_PATH, {
      fileMustExist: true,
      readonly:      true,
      immutable:     true,
    });
    db.pragma("cache_size = -32000");
    db.pragma("temp_store = memory");
    console.log("✅ DB connected (immutable):", DB_PATH);
  } catch (e2) {
    console.error("❌ DB error:", e2.message);
    process.exit(1);
  }
}

// ── Tổ hợp môn ──────────────────────────────────────────
const TO_HOP = {
  A00: ["toan","li","hoa"],
  A01: ["toan","li","nn"],
  A02: ["toan","li","sinh"],
  A03: ["toan","li","su"],
  A04: ["toan","li","dia"],
  A07: ["toan","su","dia"],
  B00: ["toan","hoa","sinh"],
  B03: ["toan","van","sinh"],
  B08: ["toan","sinh","nn"],
  C00: ["van","su","dia"],
  C01: ["van","toan","li"],
  C02: ["van","toan","hoa"],
  C03: ["van","toan","su"],
  C04: ["van","toan","dia"],
  C14: ["van","toan","gdkt"],
  D01: ["van","toan","nn"],
  D07: ["toan","hoa","nn"],
  D08: ["toan","sinh","nn"],
  D09: ["toan","su","nn"],
  D10: ["toan","dia","nn"],
  D14: ["van","su","nn"],
  D15: ["van","dia","nn"],
  D66: ["van","gdkt","nn"],
};

const VALID_MON = [
  "toan","van","li","hoa","sinh","tin",
  "cncn","cnnn","su","dia","gdkt","nn",
];

const MON_LABEL = {
  toan: "Toán",   van:  "Ngữ văn",   li:   "Vật lí",
  hoa:  "Hóa học", sinh: "Sinh học", tin:  "Tin học",
  cncn: "CN Công nghiệp", cnnn: "CN Nông nghiệp",
  su:   "Lịch sử", dia: "Địa lí",
  gdkt: "GD Kinh tế & PL", nn: "Ngoại ngữ",
};

const MIEN_LABEL = {
  bac:   "Miền Bắc",
  trung: "Miền Trung",
  nam:   "Miền Nam",
};

// ── Helpers ──────────────────────────────────────────────
function parseMon(to_hop_str) {
  if (!to_hop_str) return { error: "Thiếu tổ hợp môn" };

  // Mã chuẩn: A00, B00, D01...
  if (TO_HOP[to_hop_str.toUpperCase()]) {
    return { mons: TO_HOP[to_hop_str.toUpperCase()], ma: to_hop_str.toUpperCase() };
  }

  // Tự ghép: "toan,van,su" (1-4 môn)
  if (to_hop_str.includes(",")) {
    const mons = to_hop_str.split(",").map(m => m.trim().toLowerCase());
    if (mons.length < 1 || mons.length > 4)
      return { error: "Tổ hợp tự ghép: 1–4 môn" };
    const invalid = mons.filter(m => !VALID_MON.includes(m));
    if (invalid.length)
      return { error: `Môn không hợp lệ: ${invalid.join(", ")}` };
    return { mons, ma: "TUY_CHON" };
  }

  // 1 môn đơn lẻ
  const m = to_hop_str.trim().toLowerCase();
  if (VALID_MON.includes(m)) return { mons: [m], ma: "TUY_CHON" };

  return { error: `Tổ hợp không hợp lệ: ${to_hop_str}` };
}

function decodeRow(row) {
  // DB lưu integer × 20 → chia về điểm thật
  const diem = {};
  VALID_MON.forEach(m => {
    diem[m] = row[m] != null ? row[m] / 20 : null;
  });
  return diem;
}

function tinhTongInt(row, mons) {
  // Tính tổng trên integer (chính xác hơn float)
  const vals = mons.map(m => row[m]);
  if (vals.some(v => v == null)) return null;
  return vals.reduce((a, b) => a + b, 0);
}

// Prepared statements
const stmtSbd = db.prepare("SELECT * FROM diem_thi WHERE sbd = ?");

// ── GET /api/thpt/:sbd ───────────────────────────────────
router.get("/:sbd([0-9]{5,10})", (req, res) => {
  const sbd = req.params.sbd.trim();
  const row = stmtSbd.get(sbd);
  if (!row) return res.status(404).json({ error: "Không tìm thấy SBD" });

  const diem = decodeRow(row);
  const mon_da_thi = VALID_MON.filter(m => row[m] != null);

  // Tính tất cả tổ hợp khả dụng
  const to_hop_kha_dung = [];
  for (const [ma, mons] of Object.entries(TO_HOP)) {
    const tongInt = tinhTongInt(row, mons);
    if (tongInt !== null) {
      to_hop_kha_dung.push({
        ma,
        mon:   mons,
        label: mons.map(m => MON_LABEL[m]).join(" - "),
        tong:  tongInt / 20,
      });
    }
  }
  to_hop_kha_dung.sort((a, b) => b.tong - a.tong);

  return res.json({
    sbd:             row.sbd,
    tinh:            row.tinh,
    ma_tinh:         row.ma_tinh,
    mien:            row.mien,
    mien_label:      MIEN_LABEL[row.mien] ?? row.mien,
    diem,
    mon_da_thi,
    mon_da_thi_label: mon_da_thi.map(m => ({ key: m, label: MON_LABEL[m] })),
    to_hop_kha_dung,
  });
});

// ── GET /api/thpt/rank ───────────────────────────────────
// ?sbd=38000001&to_hop=A00&scope=quoc_gia|tinh|mien
router.get("/rank", (req, res) => {
  const { sbd, to_hop, scope = "quoc_gia" } = req.query;
  if (!sbd)    return res.status(400).json({ error: "Thiếu SBD" });
  if (!to_hop) return res.status(400).json({ error: "Thiếu tổ hợp môn" });

  const { mons, ma, error } = parseMon(to_hop);
  if (error) return res.status(400).json({ error });

  const row = stmtSbd.get(sbd.trim());
  if (!row) return res.status(404).json({ error: "Không tìm thấy SBD" });

  // Kiểm tra môn thiếu
  const thieu = mons.filter(m => row[m] == null);
  if (thieu.length) {
    return res.status(400).json({
      error:     `SBD này không thi môn: ${thieu.map(m => MON_LABEL[m]).join(", ")}`,
      thieu_mon: thieu,
    });
  }

  const my_tong_int = tinhTongInt(row, mons);
  const hasAll      = mons.map(m => `${m} IS NOT NULL`).join(" AND ");
  const colSum      = mons.join("+");

  let scopeWhere = "";
  if (scope === "tinh") scopeWhere = `AND ma_tinh = '${row.ma_tinh}'`;
  if (scope === "mien") scopeWhere = `AND mien = '${row.mien}'`;

  const total = db.prepare(
    `SELECT COUNT(*) as n FROM diem_thi WHERE ${hasAll} ${scopeWhere}`
  ).get().n;

  const rank = db.prepare(
    `SELECT COUNT(*)+1 as r FROM diem_thi
     WHERE ${hasAll} ${scopeWhere} AND (${colSum}) > ?`
  ).get(my_tong_int).r;

  return res.json({
    sbd,
    to_hop:     ma,
    mons,
    tong:       my_tong_int / 20,
    rank,
    total,
    scope,
    pct:        Math.round((1 - rank / total) * 1000) / 10,
    tinh:       row.tinh,
    mien:       row.mien,
    mien_label: MIEN_LABEL[row.mien] ?? row.mien,
  });
});

// ── GET /api/thpt/top ────────────────────────────────────
// ?to_hop=A00&scope=quoc_gia|tinh|mien&ma_tinh=38&mien=bac&limit=10
router.get("/top", (req, res) => {
  const {
    to_hop,
    scope    = "quoc_gia",
    ma_tinh,
    mien,
    limit    = 10,
  } = req.query;

  if (!to_hop) return res.status(400).json({ error: "Thiếu tổ hợp môn" });

  const { mons, ma, error } = parseMon(to_hop);
  if (error) return res.status(400).json({ error });

  const lim     = Math.min(parseInt(limit) || 10, 50);
  const hasAll  = mons.map(m => `${m} IS NOT NULL`).join(" AND ");
  const colSum  = mons.join("+");
  const monCols = mons.join(", ");

  let scopeWhere = "";
  if (scope === "tinh" && ma_tinh) scopeWhere = `AND ma_tinh = '${ma_tinh}'`;
  if (scope === "mien" && mien)    scopeWhere = `AND mien = '${mien}'`;

  const rows = db.prepare(`
    SELECT sbd, tinh, mien, ma_tinh, ${monCols},
           (${colSum}) as tong_int
    FROM diem_thi
    WHERE ${hasAll} ${scopeWhere}
    ORDER BY tong_int DESC
    LIMIT ${lim}
  `).all();

  const data = rows.map((r, i) => ({
    rank:  i + 1,
    sbd:   r.sbd,
    tinh:  r.tinh,
    mien:  r.mien,
    tong:  r.tong_int / 20,
    diem:  Object.fromEntries(
      mons.map(m => [m, r[m] != null ? r[m] / 20 : null])
    ),
  }));

  return res.json({
    to_hop: ma,
    mons,
    scope,
    total:  data.length,
    data,
  });
});

// ── GET /api/thpt/stats ──────────────────────────────────
// Thống kê tổng quan
router.get("/stats", (_, res) => {
  const total = db.prepare("SELECT COUNT(*) as n FROM diem_thi").get().n;

  const byMien = db.prepare(`
    SELECT mien, COUNT(*) as n FROM diem_thi GROUP BY mien
  `).all();

  const monStats = VALID_MON.map(m => {
    const n = db.prepare(
      `SELECT COUNT(*) as n FROM diem_thi WHERE ${m} IS NOT NULL`
    ).get().n;
    return { mon: m, label: MON_LABEL[m], count: n };
  });

  return res.json({
    total,
    by_mien: byMien.map(r => ({
      mien:  r.mien,
      label: MIEN_LABEL[r.mien],
      count: r.n,
    })),
    by_mon: monStats,
  });
});

module.exports = router;
