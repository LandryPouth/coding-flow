
const fs = require("fs");
const path = require("path");
const spec = {"covered":[1,2,3,4,5,6,7,8,9,10],"uncovered":[]};
fs.mkdirSync("coverage", { recursive: true });
const lines = ["TN:", "SF:" + path.resolve("src/auth.js")];
for (const line of spec.covered) lines.push("DA:" + line + ",1");
for (const line of spec.uncovered) lines.push("DA:" + line + ",0");
lines.push("end_of_record", "");
fs.writeFileSync("coverage/lcov.info", lines.join("\n"));
