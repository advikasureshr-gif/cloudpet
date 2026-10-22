import { tickEverything } from "./services/tick.js";

// Run by EventBridge Scheduler every 15 minutes: age every pet, predict visits, send reminders, notice neglect.
export const handler = async () => {
  const result = await tickEverything();
  console.log("tick", JSON.stringify(result));
  return result;
};
