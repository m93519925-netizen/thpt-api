const express  = require("express");
const router   = express.Router();
const Database = require("better-sqlite3");
const path     = require("path");

// Railway Volume mount tại /data
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../data/thpt2026.db");

let db;
try {
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  db.pragma("journal_mode = WAL");
  db.pragma("cache_size = -32000"); // 32MB cache
  console.log("✅ DB connected:", DB_PATH);
} catch (e) {
  console.error("❌ DB error:", e.message);
  process.exit(1);
}

// ── Tổ hợp môn ──────────────────────────────────────────
const TO_HOP = {
  A00:["toan","li","hoa"],   A01:["toan","li","nn"],
  A02:["toan","li","sinh"],  A03:["toan","li","su"],
  A04:["toan","li","dia"],   A07:["toan","su","dia"],
  B00:["toan","hoa","sinh"], B03:["toan","van","sinh"],
  B08:["toan","sinh","nn"],
  C00:["van","su","dia"],    C01:["van","toan","li"],
  C14:["van","toan","gdkt"],
  D01:["van","toan","nn"],   D07:["toan","hoa","nn"],
  D08:["toan","sinh","nn"],  D09:["toan","su","nn"],
  D10:["toan","dia","nn"],   D14:["van","su","nn"],
  D15:["van","dia","nn"],    D66:["van","gdkt","nn"],
};

const VALID_MON = [
  "toan","van","li","hoa","sinh","tin",
  "cncn","cnnn","su","dia","gdkt","nn"
];

const MIEN_LABEL = { bac:"Miền Bắc", trung:"Miền Trung", nam:"Miền Nam" };

// ── Helpers ──────────────────────────────────────────────
function parseMon(to_hop_str) {
  // Trả về { mons, error }
  if (TO_HOP[to_hop_str]) return { mons: TO_HOP[to_hop_str] };
  if (to_hop_str?.includes(",")) {
    const mons = to_hop_str.split(",").map(m => m.trim().toLowerCase());
    if (mons.length < 1 || mons.length > 4)
      return { error: "Tổ hợp tự ghép: 1–4 môn" };
    const invalid = mons.filter(m => !VALID_MON.includes(m));
    if (invalid.length)
      return { error: `Môn không hợp lệ: ${invalid.join(", ")}` };
    return { mons };
  }
  return { error: "Tổ hợp không hợp lệ" };
}

function tinhTong(row, mons) {
  // row dùng integer × 20
  const vals = mons.map(m => row[m]);
  if (vals.some(v => v === null || v === undefined)) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0)) / 20;
}

function formatRow(row) {
  // Decode integer × 20 → điểm thật
  const diem = {};
  VALID_MON.forEach(m => {
    diem[m] = row[m] != null ? row[m] / 20 : null;
  });
  return diem;
}

const stmtSbd = db.prepare("SELECT * FROM diem_thi WHERE sbd = ?");

// ── GET /api/thpt/:sbd ───────────────────────────────────
router.get("/:sbd([0-9]{5,10})", (req, res) => {
  const sbd = req.params.sbd.trim();
  const row = stmtSbd.get(sbd);
  if (!row) return res.status(404).json({ error: "Không tìm thấy SBD" });

  const diem = formatRow(row);

  // Tổ hợp khả dụng
  const to_hop_kha_dung = [];
  for (const [ma, mons] of Object.entries(TO_HOP)) {
    const tong = tinhTong(row, mons);
    if (tong !== null) {
      to_hop_kha_dung.push({ ma, mon: mons, tong });
    }
  }
  to_hop_kha_dung.sort((a, b) => b.tong - a.tong);

  const mon_da_thi = VALID_MON.filter(m => row[m] !== null);

  return res.json({
    sbd:             row.sbd,
    tinh:            row.tinh,
    ma_tinh:         row.ma_tinh,
    mien:            row.mien,
    mien_label:      MIEN_LABEL[row.mien] ?? row.mien,
    diem,
    mon_da_thi,
    to_hop_kha_dung,
  });
});

// ── GET /api/thpt/rank?sbd=&to_hop=A00&scope=quoc_gia ───
router.get("/rank", (req, res) => {
  const { sbd, to_hop, scope = "quoc_gia" } = req.query;
  if (!sbd) return res.status(400).json({ error: "Thiếu SBD" });

  const { mons, error } = parseMon(to_hop);
  if (error) return res.status(400).json({ error });

  const row = stmtSbd.get(sbd.trim());
  if (!row) return res.status(404).json({ error: "Không tìm thấy SBD" });

  // Kiểm tra môn thiếu
  const thieu = mons.filter(m => row[m] === null || row[m] === undefined);
  if (thieu.length) {
    return res.status(400).json({
      error: `SBD này không thi môn: ${thieu.join(", ")}`,
      thieu_mon: thieu,
    });
  }

  const my_tong_int = mons.reduce((a, m) => a + row[m], 0);
  const hasAll      = mons.map(m => `${m} IS NOT NULL`).join(" AND ");
  const colSum      = mons.map(m => m).join("+");

  let scopeWhere = "";
  if (scope === "tinh")  scopeWhere = `AND ma_tinh = '${row.ma_tinh}'`;
  if (scope === "mien")  scopeWhere = `AND mien = '${row.mien}'`;

  const total = db.prepare(
    `SELECT COUNT(*) as n FROM diem_thi WHERE ${hasAll} ${scopeWhere}`
  ).get().n;

  const rank = db.prepare(
    `SELECT COUNT(*)+1 as r FROM diem_thi 
     WHERE ${hasAll} ${scopeWhere} AND (${colSum}) > ?`
  ).get(my_tong_int).r;

  return res.json({
    sbd, to_hop,
    mons,
    tong:       Math.round(my_tong_int) / 20,
    rank,
    total,
    scope,
    pct:        Math.round((1 - rank / total) * 1000) / 10,
    tinh:       row.tinh,
    mien:       row.mien,
    mien_label: MIEN_LABEL[row.mien] ?? row.mien,
  });
});

// ── GET /api/thpt/top?to_hop=A00&scope=quoc_gia&limit=10 
router.get("/top", (req, res) => {
  const { to_hop, scope = "quoc_gia", ma_tinh, mien, limit = 10 } = req.query;
  const lim = Math.min(parseInt(limit) || 10, 50);

  const { mons, error } = parseMon(to_hop);
  if (error) return res.status(400).json({ error });

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
    tong:  Math.round(r.tong_int) / 20,
    diem:  Object.fromEntries(mons.map(m => [m, r[m] != null ? r[m] / 20 : null])),
  }));

  return res.json({ to_hop, scope, total: data.length, data });
});

module.exports = router;
