import "reflect-metadata";
import "dotenv/config";
import { Global, Module, Injectable, OnModuleDestroy } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { Initial1791936000000 } from "./migrations/1791936000000-Initial";
import { Countries1791990000000 } from "./migrations/1791990000000-Countries";
import { MergeStations1792000000000 } from "./migrations/1792000000000-MergeStations";
export const source = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  migrations: [Initial1791936000000, Countries1791990000000, MergeStations1792000000000],
  synchronize: false,
  extra: { max: 10 },
  logging: false,
});
@Injectable()
export class Database implements OnModuleDestroy {
  get manager() {
    return source.manager;
  }
  async query(sql: string, args: any[] = []): Promise<any[]> {
    const result = await source.query(sql, args);
    // TypeORM returns [rows, affectedCount] for UPDATE and DELETE.
    return Array.isArray(result?.[0]) && typeof result[1] === "number" ? result[0] : result;
  }
  async one(sql: string, args: any[] = []) {
    return (await this.query(sql, args))[0];
  }
  transaction<T>(fn: (m: EntityManager) => Promise<T>) {
    return source.transaction(fn);
  }
  async onModuleDestroy() {
    if (source.isInitialized) await source.destroy();
  }
}
@Global()
@Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}
export async function connect() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!source.isInitialized) await source.initialize();
  await source.runMigrations();
}
export const camel = (row: any): any =>
  row == null
    ? null
    : Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k.replace(/_([a-z])/g, (_, s) => s.toUpperCase()),
          v instanceof Date ? v.toISOString() : v,
        ]),
      );
export async function audit(
  m: EntityManager,
  actor: string | null,
  action: string,
  id: string | null,
  details: any = {},
) {
  await m.query(
    "INSERT INTO audit_log(actor_id,action,entity_id,details) VALUES($1,$2,$3,$4)",
    [actor, action, id, JSON.stringify(details)],
  );
}
