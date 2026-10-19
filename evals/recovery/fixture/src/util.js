function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatRun(run) {
  return `${run.id}:${run.status}`;
}

module.exports = { slugify, formatRun };
