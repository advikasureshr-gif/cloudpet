import "./local-env.js";            // must stay first: sets the local defaults before the database is set up
import { createApp } from "./app.js";
import { ensureTable } from "./table.js";
import { TABLE } from "./db.js";

const port = Number(process.env.PORT) || 3000;

try {
  if (await ensureTable()) console.log(`Created table "${TABLE}".`);
} catch (err) {
  console.error("Can't reach DynamoDB. Is it running?  (npm run db:up)\n", err.message);
  process.exit(1);
}

createApp().listen(port, () => {
  console.log(`Cloudpet API on http://localhost:${port}  (table: ${TABLE}, dynamo: ${process.env.DYNAMO_ENDPOINT || "AWS"})`);
});
