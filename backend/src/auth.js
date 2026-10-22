import { AppError } from "./errors.js";

/* Who is calling?
   dev mode  : send  Authorization: Bearer dev:<name>   (anyone can pretend to be anyone: local testing only!)
   on AWS    : AUTH_MODE=cognito. API Gateway checks the Cognito token before our code runs and passes the claims along. */

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

  if (MODE() === "cognito") {
    // API Gateway already checked the Cognito token's signature, expiry and audience before our code ran.
    // We only read who it says the player is. (lambda.js hands us the original API Gateway event.)
    const claims = req.apiEvent && req.apiEvent.requestContext && req.apiEvent.requestContext.authorizer &&
      req.apiEvent.requestContext.authorizer.jwt && req.apiEvent.requestContext.authorizer.jwt.claims;
    if (!claims || !claims.sub) return next(new AppError(401, "unauthorized", "Please sign in."));
    req.userId = String(claims.sub).toLowerCase();
    req.claims = claims;
    return next();
  }

  return next(new AppError(501, "auth-not-configured", "Unknown AUTH_MODE."));
}
