// Defaults for running on your own machine. Imported FIRST by server.js (the local entry point only),
// so on AWS (where Lambda doesn't use server.js) these never apply and the real DynamoDB is used.
// To override any of them, set the variable yourself, e.g.  DYNAMO_ENDPOINT=http://localhost:9000 npm start
process.env.DYNAMO_ENDPOINT ??= "http://localhost:8000";   // DynamoDB Local from docker compose
process.env.AUTH_MODE ??= "dev";
process.env.DEV_ROUTES ??= "true";
