const { findScriptById } = require("./repository");
const { runRuntime } = require("../runtime/client");

async function getScript(id) {
  return findScriptById(id);
}

async function testWebhook(url, headers) {
  const response = await fetch(url, { headers });
  return { status: response.status, body: await response.text() };
}

async function testFunction(code) {
  return runRuntime("evaluate", code);
}

module.exports = { getScript, testWebhook, testFunction };
