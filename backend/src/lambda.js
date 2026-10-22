import serverless from "serverless-http";
import { createApp } from "./app.js";

// The same Express app that runs on your laptop, behind API Gateway.
// `request` keeps the original API Gateway event, which holds the verified Cognito claims (see auth.js).
export const handler = serverless(createApp(), {
  request(req, event) { req.apiEvent = event; }
});
