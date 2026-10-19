const { execFile } = require("node:child_process");
const path = require("node:path");

function runRuntime(command, code) {
  const main = path.join(__dirname, "main.js");

  return new Promise((resolve) => {
    execFile(process.execPath, [main, command, code], (error, stdout) => {
      resolve({ ok: !error, output: stdout });
    });
  });
}

module.exports = { runRuntime };
