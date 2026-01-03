import { MongoClient, Db } from "mongodb";

let client: MongoClient;
let db: Db;

export async function setupMongo(): Promise<Db> {
  client = new MongoClient("mongodb://localhost:27017");
  await client.connect();

  db = client.db("scheduler_test");
  await db.collection("scheduler_jobs").deleteMany({});

  return db;
}

export async function teardownMongo() {
  if (client) {
    await client.close();
  }
}
