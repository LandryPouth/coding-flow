
const fs = require("fs");
const path = require("path");
const spec = {"file":"src/auth.js","covered":[1,2,3],"uncovered":[4,5,6,7,8,9,10],"format":"lcov"};
fs.mkdirSync("coverage", { recursive: true });

if (spec.format === "lcov") {
  const lines = ["TN:", "SF:" + path.resolve(spec.file)];
  for (const line of spec.covered) lines.push("DA:" + line + ",1");
  for (const line of spec.uncovered) lines.push("DA:" + line + ",0");
  lines.push("end_of_record", "");
  fs.writeFileSync("coverage/lcov.info", lines.join("\n"));
} else {
  const statementMap = {};
  const s = {};
  let id = 0;
  for (const line of spec.covered) { statementMap[id] = { start: { line } }; s[id] = 1; id += 1; }
  for (const line of spec.uncovered) { statementMap[id] = { start: { line } }; s[id] = 0; id += 1; }
  fs.writeFileSync(
    "coverage/coverage-final.json",
    JSON.stringify({ [path.resolve(spec.file)]: { statementMap, s } }),
  );
}
