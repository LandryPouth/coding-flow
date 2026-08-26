
const fs = require("fs");
const path = require("path");
const spec = {"covered":[],"uncovered":[]};
fs.mkdirSync("coverage", { recursive: true });
const lines = ["TN:", "SF:" + path.resolve("src/auth.js")];
for (const line of spec.covered) lines.push("DA:" + line + ",1");
for (const line of spec.uncovered) lines.push("DA:" + line + ",0");
lines.push("end_of_record", "");
fs.writeFileSync("coverage/lcov.info", lines.join("\n"));
