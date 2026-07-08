const fs    = require("fs");
const https = require("https");
const path  = require("path");

const DB_PATH = process.env.DB_PATH || "/data/db/thpt2026.db";
const DB_URL  = process.env.DB_URL  || 
  "https://github.com/m93519925-netizen/thpt-api/releases/download/v1.0/thpt2026.db";

function downloadFile(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("Too many redirects"));

    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { "User-Agent": "thpt-api" } }, res => {

      // Xử lý redirect (GitHub redirect sang S3)
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest, redirectCount + 1)
          .then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      const total = parseInt(res.headers["content-length"] || 0);
      let received = 0;
      let lastPct  = 0;

      res.on("data", chunk => {
        received += chunk.length;
        if (total) {
          const pct = Math.floor(received / total * 100);
          if (pct >= lastPct + 10) {
            lastPct = pct;
            console.log(`  ⬇️  ${pct}% — ${(received/1024/1024).toFixed(1)}/${(total/1024/1024).toFixed(1)} MB`);
          }
        }
      });

      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
      file.on("error",  reject);
    }).on("error", reject);
  });
}

async function ensureDB() {
  // Tạo thư mục nếu chưa có
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  // Kiểm tra DB đã có chưa
  if (fs.existsSync(DB_PATH)) {
    const size = fs.statSync(DB_PATH).size;
    if (size > 50 * 1024 * 1024) { // > 50MB → OK
      console.log(`✅ DB exists: ${(size/1024/1024).toFixed(1)} MB`);
      return;
    }
    console.log(`⚠️ DB quá nhỏ (${(size/1024/1024).toFixed(1)} MB), download lại...`);
    fs.unlinkSync(DB_PATH);
  }

  console.log(`⬇️ Downloading DB từ GitHub...`);
  console.log(`   ${DB_URL}`);
  const start = Date.now();
  await downloadFile(DB_URL, DB_PATH);
  const size = fs.statSync(DB_PATH).size / 1024 / 1024;
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✅ Downloaded: ${size.toFixed(1)} MB trong ${secs}s`);
}

async function startServer() {
  await ensureDB();

  const express      = require("express");
  const cors         = require("cors");
  const compression  = require("compression");
  const thpt         = require("./routes/thpt");

  const app  = express();
  const PORT = process.env.PORT || 3000;

  app.use(compression());
  app.use(cors({ origin: "*" }));
  app.use(express.json());

  app.use("/api/thpt", thpt);
  app.get("/health", (_, res) => res.json({
    ok:   true,
    db:   DB_PATH,
    size: fs.existsSync(DB_PATH)
            ? `${(fs.statSync(DB_PATH).size/1024/1024).toFixed(1)} MB`
            : "not found",
  }));

  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error("❌ Fatal:", err);
  process.exit(1);
});
