import { ensureTable } from "../src/table.js";
import { TABLE } from "../src/db.js";

const created = await ensureTable();
console.log(created ? `Created table "${TABLE}".` : `Table "${TABLE}" already exists.`);
