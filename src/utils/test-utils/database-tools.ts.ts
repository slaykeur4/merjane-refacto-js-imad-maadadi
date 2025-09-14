import {rm} from 'node:fs/promises';
import path from 'path';
import {exec as execCallback} from 'node:child_process';
import {promisify} from 'node:util';
import SqliteDatabase, { Database } from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {
	uniqueNamesGenerator, adjectives, colors, animals,
} from 'unique-names-generator';
import fg from 'fast-glob';
import * as schema from '@/db/schema.js';

const exec = promisify(execCallback);

export const UNIT_TEST_DB_PREFIX = './unit-test-';

export async function cleanAllLooseDatabases(prefix: string) {
	const entries = await fg([`${prefix}*.db`]);
	await Promise.all(entries.map(async entry => cleanUp(entry)));
}

export async function cleanUp(databaseName: string, db?: Database) {
	// Added logic to close DB connection if provided
    // Close DB connection if provided
    if (db && typeof db.close === 'function') {
        await db.close();
    }

    // Wait briefly to ensure file lock is released (Windows workaround)
    await new Promise(resolve => setTimeout(resolve, 100));

    // Delete the DB file
    const dbPath = path.resolve(process.cwd(), `${databaseName}.db`);
    try {
        await rm(dbPath, {force: true});
    } catch (err) {
        console.warn(`Failed to delete test DB: ${dbPath}`, err);
    }
}

export async function createDatabaseMock() {
	const randomName = uniqueNamesGenerator({dictionaries: [adjectives, colors, animals]}); // Big_red_donkey
	const databaseName = `${UNIT_TEST_DB_PREFIX}${randomName}.db`;
	const sqlite = new SqliteDatabase(databaseName);
	await exec(`pnpm drizzle-kit push --schema=src/db/schema.ts --dialect=sqlite --url=${databaseName}`);

	const databaseMock = drizzle(sqlite, {
		schema,
	});
	return {databaseMock, databaseName};
}
