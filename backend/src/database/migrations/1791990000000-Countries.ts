import { MigrationInterface, QueryRunner } from "typeorm";
/** Nachbarländer als auswählbare Länder (Daten folgen per Import). */
export class Countries1791990000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`
 INSERT INTO countries(code,names,timezone,enabled) VALUES
 ('DE','{"de":"Deutschland","en":"Germany"}','Europe/Berlin',true),
 ('CH','{"de":"Schweiz","en":"Switzerland"}','Europe/Zurich',true),
 ('CZ','{"de":"Tschechien","en":"Czechia"}','Europe/Prague',true),
 ('HU','{"de":"Ungarn","en":"Hungary"}','Europe/Budapest',true),
 ('SI','{"de":"Slowenien","en":"Slovenia"}','Europe/Ljubljana',true),
 ('SK','{"de":"Slowakei","en":"Slovakia"}','Europe/Bratislava',true),
 ('IT','{"de":"Italien","en":"Italy"}','Europe/Rome',true),
 ('LI','{"de":"Liechtenstein","en":"Liechtenstein"}','Europe/Vaduz',true)
 ON CONFLICT(code) DO NOTHING;`);
  }
  async down(q: QueryRunner) {
    await q.query(
      `DELETE FROM countries WHERE code IN ('DE','CH','CZ','HU','SI','SK','IT','LI') AND NOT EXISTS (SELECT 1 FROM settings WHERE active_country=countries.code)`,
    );
  }
}
