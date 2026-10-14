// What "persistence" means for R4's controller rule, read from the code: schema and table definitions by place and
// name, and data-access files (`*.repository.ts`, `*.repo.ts`, `*.dao.ts`) that reach a database: they import a
// database package or a schema file. immich names every adapter a repository (logging, email, storage, crypto...);
// the ones that touch no database are adapters, exempt by path, so a new repository counts as persistence by default.
import path from 'node:path';
import type { Analysis } from '../analyzer/types.js';
import { isTestCode, type Layout } from './folder-graph.js';

/** Package-relative: schema, migrations, entity and table definitions. */
export const schemaPattern = '(^|/)(schema|migrations|entities|tables)/|\\.(table|entity)\\.[cm]?[jt]sx?$';
/** Package-relative: data-access files by name. */
export const dataAccessPattern = '\\.(repository|repo|dao)\\.[cm]?[jt]sx?$';

/** Query builders, ORMs and drivers whose import makes a data-access file persistence. */
const databasePackages = new Set([
  'kysely', 'nestjs-kysely', 'typeorm', '@nestjs/typeorm', 'sequelize', 'sequelize-typescript', '@nestjs/sequelize', '@prisma/client',
  'drizzle-orm', 'mongoose', '@nestjs/mongoose', 'mongodb', 'knex', 'objection', 'pg', 'postgres', 'mysql', 'mysql2', 'better-sqlite3', 'sqlite3',
]);

export interface Persistence {
  /** Data-access files that reach a database, package-relative, sorted. */
  dataAccess: string[];
  /** Data-access files by name that don't (adapters), package-relative, sorted: exempt from the rule. */
  adapters: string[];
  /** Schema files, package-relative, sorted. */
  schema: string[];
}

const packageName = (specifier: string) => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
const isBare = (specifier: string) => !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('node:');

export function persistenceOf(analysis: Analysis, layout: Layout): Persistence {
  const prefix = layout.packageRoot ? `${layout.packageRoot}/` : '';
  const schema = new RegExp(schemaPattern);
  const dataAccessName = new RegExp(dataAccessPattern);
  const result: Persistence = { dataAccess: [], adapters: [], schema: [] };
  for (const analyzed of analysis.files.values()) {
    if (!analyzed.path.startsWith(prefix)) continue;
    const file = analyzed.path.slice(prefix.length);
    if (isTestCode(file) || /\.d\.[cm]?ts$/.test(file)) continue;
    if (schema.test(file)) {
      result.schema.push(file);
      continue;
    }
    if (!dataAccessName.test(path.posix.basename(file))) continue;
    const reachesDatabase = analyzed.sites.some((site) => site.resolution.type === 'file'
      ? site.resolution.path.startsWith(prefix) && schema.test(site.resolution.path.slice(prefix.length))
      : isBare(site.specifier) && databasePackages.has(packageName(site.specifier)));
    (reachesDatabase ? result.dataAccess : result.adapters).push(file);
  }
  for (const list of Object.values(result)) list.sort();
  return result;
}
