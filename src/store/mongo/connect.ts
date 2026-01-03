import { MongoClient, Db } from "mongodb";

export interface MongoConnectionOptions {
  uri: string;
  dbName: string;
}

export async function connectMongo(
  options: MongoConnectionOptions
): Promise<Db> {
  const client = new MongoClient(options.uri);
  await client.connect();

  return client.db(options.dbName);
}
