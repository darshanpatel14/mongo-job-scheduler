import { MongoClient, Db } from "mongodb";

let client: MongoClient;
let db: Db;

export async function setupMongo(): Promise<Db> {
  client = new MongoClient("mongodb://localhost:27017");
  await client.connect();

  const dbName = `scheduler_test_${Math.random().toString(36).slice(2)}`;
  db = client.db(dbName);
  return db;
}

export async function teardownMongo() {
  if (db) {
    await db.dropDatabase();
  }
  if (client) {
    await client.close();
  }
}
