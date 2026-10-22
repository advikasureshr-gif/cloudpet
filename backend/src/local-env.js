import { readFileSync } from "node:fs";

// Secrets such as OPENAI_API_KEY can live in backend/.env (never committed: it's in .gitignore).
// Lines look like  KEY=value . Anything you already set in the terminal wins.
try {
  const file = new URL("../.env", import.meta.url);
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
} catch (err) { /* no .env file: fine */ }

// Defaults for running on your own machine. Imported FIRST by server.js (the local entry point only),
// so on AWS (where Lambda doesn't use server.js) these never apply and the real DynamoDB is used.
// To override any of them, set the variable yourself, e.g.  DYNAMO_ENDPOINT=http://localhost:9000 npm start
process.env.DYNAMO_ENDPOINT ??= "http://localhost:8000";   // DynamoDB Local from docker compose
process.env.AUTH_MODE ??= "dev";
process.env.DEV_ROUTES ??= "true";
