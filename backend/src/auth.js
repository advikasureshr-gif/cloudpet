import { AppError } from "./errors.js";

/* Who is calling?
   dev mode  : send  Authorization: Bearer dev:<name>   (anyone can pretend to be anyone: local testing only!)
   on AWS    : API Gateway checks the Cognito token before our code runs, and passes the user id along (Day 6). */

const MODE = () => process.env.AUTH_MODE || "dev";

export function requireUser(req, _res, next) {
  if (MODE() === "dev") {
    const header = req.get("authorization") || "";
    const match = header.match(/^Bearer dev:([a-zA-Z0-9_-]{1,32})$/);
    if (!match) {
      return next(new AppError(401, "unauthorized", "Send the header  Authorization: Bearer dev:<name>"));
    }
    req.userId = match[1].toLowerCase();
    return next();
  }

  return next(new AppError(501, "auth-not-configured", "Cognito login is added when we move to AWS."));
}
