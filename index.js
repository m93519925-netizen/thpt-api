const express     = require("express");
const cors        = require("cors");
const compression = require("compression");
const thpt        = require("./routes/thpt");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(cors({ origin: "*" }));
app.use(express.json());

app.use("/api/thpt", thpt);
app.get("/health", (_, res) => res.json({ ok: true, ts: Date.now() }));

app.listen(PORT, () => console.log(`✅ Server :${PORT}`));
