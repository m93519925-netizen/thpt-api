const express  = require("express");
const router   = express.Router();
const Database = require("better-sqlite3");
const path     = require("path");

const DB_PATH = process.env.DB_PATH || "/data/db/thpt2026.db";

let db;
try {
  db = new Database(DB_PATH, { fileMustExist: true });
  db.pragma("journal_mode = WAL");
  db.pragma("cache_size = -32000");
  db.pragma("temp_store = memory");
  console.log("✅ DB connected:", DB_PATH);
} catch (e) {
  try {
    db = new Database(DB_PATH, { fileMustExist: true, readonly: true, immutable: true });
    db.pragma("cache_size = -32000");
    db.pragma("temp_store = memory");
    console.log("✅ DB connected (immutable):", DB_PATH);
  } catch (e2) {
    console.error("❌ DB error:", e2.message);
    process.exit(1);
  }
}

const TO_HOP = {
  A00:["toan","li","hoa"],   A01:["toan","li","nn"],
  A02:["toan","li","sinh"],  A03:["toan","li","su"],
  A04:["toan","li","dia"],   A07:["toan","su","dia"],
  B00:["toan","hoa","sinh"], B03:["toan","van","sinh"],
  B08:["toan","sinh","nn"],  C00:["van","su","dia"],
  C01:["van","toan","li"],   C02:["van","toan","hoa"],
  C03:["van","toan","su"],   C04:["van","toan","dia"],
  C14:["van","toan","gdkt"], D01:["van","toan","nn"],
  D07:["toan","hoa","nn"],   D08:["toan","sinh","nn"],
  D09:["toan","su","nn"],    D10:["toan","dia","nn"],
  D14:["van","su","nn"],     D15:["van","dia","nn"],
  D66:["van","gdkt","nn"],
};

const VALID_MON = ["toan","van","li","hoa","sinh","tin","cncn","cnnn","su","dia","gdkt","nn"];

const MON_LABEL = {
  toan:"Toán", van:"Ngữ văn", li:"Vật lí", hoa:"Hóa học",
  sinh:"Sinh học", tin:"Tin học", cncn:"CN Công nghiệp",
  cnnn:"CN Nông nghiệp", su:"Lịch sử", dia:"Địa lí",
  gdkt:"GD Kinh tế & PL", nn:"Ngoại ngữ",
};

const MIEN_LABEL = { bac:"Miền Bắc", trung:"Miền Trung", nam:"Miền Nam" };

function parseMon(str) {
  if (!str) return { error: "Thiếu tổ hợp môn" };
  const up = str.toUpperCase();
  if (TO_HOP[up]) return { mons: TO_HOP[up], ma: up };
  if (str.includes(",")) {
    const mons = str.split(",").map(m => m.trim().toLowerCase());
    if (mons.length < 1 || mons.length > 4) return { error: "Tổ hợp tự ghép: 1–4 môn" };
    const bad = mons.filter(m => !VALID_MON.includes(m));
    if (bad.length) return { error: `Môn không hợp lệ: ${bad.join(", ")}` };
    return { mons, ma: "TUY_CHON" };
  }
  const m = str.trim().toLowerCase();
  if (VALID_MON.includes(m)) return { mons: [m], ma: "TUY_CHON" };
  return { error: `Tổ hợp không hợp lệ: ${str}` };
}

function tinhTong(row, mons) {
  const vals = mons.map(m => row[m]);
  if (vals.some(v => v == null)) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100;
}

const stmtSbd = db.prepare("SELECT * FROM diem_thi WHERE sbd = ?");

// GET /api/thpt/:sbd
router.get("/:sbd([0-9]{5,10})", (req, res) => {
  const row = stmtSbd.get(req.params.sbd.trim());
  if (!row) return res.status(404).json({ error: "Không tìm thấy SBD" });

  const diem        = Object.fromEntries(VALID_MON.map(m => [m, row[m] ?? null]));
  const mon_da_thi  = VALID_MON.filter(m => row[m] != null);

  const to_hop_kha_dung = [];
  for (const [ma, mons] of Object.entries(TO_HOP)) {
    const tong = tinhTong(row, mons);
    if (tong !== null) {
      to_hop_kha_dung.push({
        ma, mon: mons,
        label: mons.map(m => MON_LABEL[m]).join(" - "),
        tong,
      });
    }
  }
  to_hop_kha_dung.sort((a, b) => b.tong - a.tong);

  return res.json({
    sbd:         String(row.sbd),
    tinh:        row.tinh,
    ma_tinh:     String(row.ma_tinh).padStart(2, "0"),
    mien:        row.mien,
    mien_label:  MIEN_LABEL[row.mien] ?? row.mien,
    diem,
    mon_da_thi,
    mon_da_thi_label: mon_da_thi.map(m => ({ key: m, label: MON_LABEL[m] })),
    to_hop_kha_dung,
  });
});

// GET /api/thpt/rank?sbd=&to_hop=A00&scope=quoc_gia
router.get("/rank", (req, res) => {
  const { sbd, to_hop, scope = "quoc_gia" } = req.query;
  if (!sbd)    return res.status(400).json({ error: "Thiếu SBD" });

  const { mons, ma, error } = parseMon(to_hop);
  if (error) return res.status(400).json({ error });

  const row = stmtSbd.get(sbd.trim());
  if (!row) return res.status(404).json({ error: "Không tìm thấy SBD" });

  const thieu = mons.filter(m => row[m] == null);
  if (thieu.length) return res.status(400).json({
    error:     `SBD này không thi môn: ${thieu.map(m => MON_LABEL[m]).join(", ")}`,
    thieu_mon: thieu,
  });

  const my_tong = tinhTong(row, mons);
  const hasAll  = mons.map(m => `${m} IS NOT NULL`).join(" AND ");
  const colSum  = mons.join("+");

  let sw = "";
  if (scope === "tinh") sw = `AND ma_tinh = ${row.ma_tinh}`;
  if (scope === "mien") sw = `AND mien = '${row.mien}'`;

  const total = db.prepare(
    `SELECT COUNT(*) as n FROM diem_thi WHERE ${hasAll} ${sw}`
  ).get().n;

  const rank = db.prepare(
    `SELECT COUNT(*)+1 as r FROM diem_thi WHERE ${hasAll} ${sw} AND (${colSum}) > ?`
  ).get(my_tong).r;

  return res.json({
    sbd: String(row.sbd), to_hop: ma, mons, tong: my_tong,
    rank, total, scope,
    pct:        Math.round((1 - rank / total) * 1000) / 10,
    tinh:       row.tinh,
    mien:       row.mien,
    mien_label: MIEN_LABEL[row.mien] ?? row.mien,
  });
});

// GET /api/thpt/top?to_hop=A00&scope=quoc_gia&limit=10
router.get("/top", (req, res) => {
  const { to_hop, scope = "quoc_gia", ma_tinh, mien, limit = 10 } = req.query;

  const { mons, ma, error } = parseMon(to_hop);
  if (error) return res.status(400).json({ error });

  const lim    = Math.min(parseInt(limit) || 10, 50);
  const hasAll = mons.map(m => `${m} IS NOT NULL`).join(" AND ");
  const colSum = mons.join("+");

  let sw = "";
  if (scope === "tinh" && ma_tinh) sw = `AND ma_tinh = ${ma_tinh}`;
  if (scope === "mien" && mien)    sw = `AND mien = '${mien}'`;

  const rows = db.prepare(`
    SELECT sbd, tinh, mien, ma_tinh,
           ${mons.join(", ")},
           (${colSum}) as tong
    FROM diem_thi
    WHERE ${hasAll} ${sw}
    ORDER BY tong DESC
    LIMIT ${lim}
  `).all();

  return res.json({
    to_hop: ma, mons, scope,
    total:  rows.length,
    data:   rows.map((r, i) => ({
      rank: i + 1,
      sbd:  String(r.sbd),
      tinh: r.tinh,
      mien: r.mien,
      tong: Math.round(r.tong * 100) / 100,
      diem: Object.fromEntries(mons.map(m => [m, r[m] ?? null])),
    })),
  });
});

// GET /api/thpt/stats
router.get("/stats", (_, res) => {
  const total  = db.prepare("SELECT COUNT(*) as n FROM diem_thi").get().n;
  const byMien = db.prepare("SELECT mien, COUNT(*) as n FROM diem_thi GROUP BY mien").all();
  const byMon  = VALID_MON.map(m => ({
    mon:   m,
    label: MON_LABEL[m],
    count: db.prepare(`SELECT COUNT(*) as n FROM diem_thi WHERE ${m} IS NOT NULL`).get().n,
  }));
  return res.json({
    total,
    by_mien: byMien.map(r => ({ mien: r.mien, label: MIEN_LABEL[r.mien], count: r.n })),
    by_mon:  byMon,
  });
});

// GET /api/thpt/dist?to_hop=D01&scope=quoc_gia
router.get("/dist", (req, res) => {
  const { to_hop, scope = "quoc_gia", ma_tinh, mien } = req.query;
  const { mons, error } = parseMon(to_hop);
  if (error) return res.status(400).json({ error });

  const hasAll = mons.map(m => `${m} IS NOT NULL`).join(" AND ");
  const colSum = mons.join("+");
  let sw = "";
  if (scope === "tinh" && ma_tinh) sw = `AND ma_tinh = ${ma_tinh}`;
  if (scope === "mien" && mien)    sw = `AND mien = '${mien}'`;

  // Tạo bins 0.5 điểm
  const rows = db.prepare(`
    SELECT ROUND((${colSum}) * 2) / 2 as bin, COUNT(*) as cnt
    FROM diem_thi WHERE ${hasAll} ${sw}
    GROUP BY bin ORDER BY bin
  `).all();

  const bins = rows.map(r => ({
    range: `${r.bin}–${r.bin + 0.5}`,
    count: r.cnt,
  }));

  return res.json({ to_hop, scope, bins });
});

// GET /api/thpt/tinh-stats?to_hop=D01
router.get("/tinh-stats", (req, res) => {
  const { to_hop } = req.query;
  const { mons, error } = parseMon(to_hop);
  if (error) return res.status(400).json({ error });

  const hasAll = mons.map(m => `${m} IS NOT NULL`).join(" AND ");
  const colSum = mons.join("+");

  const rows = db.prepare(`
    SELECT
      ma_tinh, tinh, mien,
      COUNT(*)                        as so_thi_sinh,
      ROUND(AVG(${colSum}), 3)        as diem_tb,
      ROUND(MAX(${colSum}), 2)        as diem_max,
      ROUND(MIN(${colSum}), 2)        as diem_min
    FROM diem_thi
    WHERE ${hasAll}
    GROUP BY ma_tinh
    ORDER BY diem_tb DESC
  `).all();

  return res.json({
    to_hop, mons,
    data: rows.map((r, i) => ({
      rank:         i + 1,
      ma_tinh:      String(r.ma_tinh).padStart(2,"0"),
      tinh:         r.tinh,
      mien:         r.mien,
      mien_label:   MIEN_LABEL[r.mien] ?? r.mien,
      so_thi_sinh:  r.so_thi_sinh,
      diem_tb:      r.diem_tb,
      diem_max:     r.diem_max,
      diem_min:     r.diem_min,
    })),
  });
});

module.exports = router;
