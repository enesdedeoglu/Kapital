import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { createDb, createSql, loadRootEnv, type Db, type Sql } from '@kapital/db';

loadRootEnv();

export const SQL = Symbol('SQL');
export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    { provide: SQL, useFactory: (): Sql => createSql({ max: 20 }) },
    { provide: DB, inject: [SQL], useFactory: (sql: Sql): Db => createDb(sql) },
  ],
  exports: [SQL, DB],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(SQL) private readonly sql: Sql) {}
  async onModuleDestroy() {
    await this.sql.end({ timeout: 5 });
  }
}
