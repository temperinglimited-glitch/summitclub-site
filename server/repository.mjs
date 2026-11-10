import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CoreRepository } from './repository-core.mjs';
export { BookingError } from './repository-core.mjs';

export class Repository extends CoreRepository {
  constructor(path, seed) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(path);
    database.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;');
    super(database, seed);
  }
}
