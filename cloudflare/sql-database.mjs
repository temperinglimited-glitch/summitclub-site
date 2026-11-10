// Adapts Cloudflare's synchronous Durable Object SQLite API to the shared repository.
export class DurableSqlDatabase {
  constructor(storage) { this.storage = storage; }
  exec(sql) { this.storage.sql.exec(sql).toArray(); }
  prepare(sql) {
    return {
      run: (...values) => { this.storage.sql.exec(sql, ...values).toArray(); },
      get: (...values) => this.storage.sql.exec(sql, ...values).toArray()[0],
      all: (...values) => this.storage.sql.exec(sql, ...values).toArray()
    };
  }
  transactionSync(callback) { return this.storage.transactionSync(callback); }
  close() { /* Cloudflare owns the persistent connection. */ }
}
