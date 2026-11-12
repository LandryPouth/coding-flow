const { db } = require("../db");

async function findScriptById(id) {
  const { rows } = await db.query("SELECT * FROM public.scripts WHERE id = $1", [id]);
  return rows[0] || null;
}

module.exports = { findScriptById };
