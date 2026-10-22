import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// One table holds everything (single-table design). See the README for the item layout.
export const TABLE = process.env.TABLE_NAME || "CloudPet";

const endpoint = process.env.DYNAMO_ENDPOINT || undefined;

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  // Local only: DynamoDB Local accepts any credentials. On AWS the endpoint is empty and the Lambda's role is used.
  ...(endpoint ? { endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } } : {})
});

// The document client lets us use plain JS objects instead of DynamoDB's { S: "..." } wrappers.
export const db = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true }
});

export const rawClient = client;
