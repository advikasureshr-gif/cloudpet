import { CreateTableCommand, DescribeTableCommand, ResourceNotFoundException } from "@aws-sdk/client-dynamodb";
import { rawClient, TABLE } from "./db.js";

// Creates the table if it isn't there yet. On AWS the SAM template creates it instead (Day 6).
export async function ensureTable() {
  try {
    await rawClient.send(new DescribeTableCommand({ TableName: TABLE }));
    return false;
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException) && err.name !== "ResourceNotFoundException") throw err;
  }

  await rawClient.send(new CreateTableCommand({
    TableName: TABLE,
    BillingMode: "PAY_PER_REQUEST",          // pay per request: nothing to pay while idle
    AttributeDefinitions: [
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" }
    ],
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" }
    ]
  }));
  return true;
}
