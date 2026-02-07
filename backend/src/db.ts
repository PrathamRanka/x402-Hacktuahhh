import { MongoClient, Db } from "mongodb";

let client: MongoClient | null = null;
let connectPromise: Promise<MongoClient> | null = null;

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is required");
  }

  const dbName = process.env.MONGODB_DB || "x402_zkid";

  if (!client) {
    if (!connectPromise) {
      const newClient = new MongoClient(uri);
      connectPromise = newClient.connect();
    }
    client = await connectPromise;
  }

  return client.db(dbName);
}

