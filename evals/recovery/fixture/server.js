const express = require("express");
const { getScript, testWebhook, testFunction } = require("./src/scripts/service");
const { authSecret } = require("./src/config");

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  if (req.headers.authorization !== `Bearer ${authSecret()}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

app.get("/scripts/:id", async (req, res) => {
  const script = await getScript(req.params.id);
  res.json(script);
});

app.post("/scripts/test-webhook", async (req, res) => {
  const result = await testWebhook(req.body.url, req.body.headers);
  res.json(result);
});

app.post("/scripts/test-function", async (req, res) => {
  const result = await testFunction(req.body.code);
  res.json(result);
});

app.get("/dev/signal", (req, res) => {
  console.log("signal", req.query);
  res.json({ ok: true });
});

app.listen(3000);
