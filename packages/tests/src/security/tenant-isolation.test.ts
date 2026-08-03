/**
 * Tenant Isolation Tests — regression guard for audit finding 11.
 *
 * `GET /thoughts?type=<type>` used to be served by a GSI partitioned on
 * `type#<type>` with no user component and ProjectionType.ALL, so any
 * authenticated caller could read every other user's full note text. It was
 * reproduced live on 2026-08-03 before being fixed.
 *
 * This test plants a note owned by a synthetic second user directly in DynamoDB
 * (the API can only ever write as the calling user, so a second tenant cannot be
 * created through it), then asserts the API never returns it. It is written as a
 * real cross-tenant probe rather than a status-code check: a test that only
 * asserts HTTP 200 would have passed throughout the entire vulnerable period.
 *
 * Requires the AWS CLI configured with DynamoDB access to the thoughts table, in
 * addition to the usual RAGBRAIN_API_URL / RAGBRAIN_API_KEY. The CLI is used
 * rather than an SDK import because this test package is intentionally
 * dependency-free (tsx + typescript only) and API-driven; pulling in
 * @aws-sdk/client-dynamodb just to seed one row is not worth the install.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  suite, test, assert, api, printSummary,
} from '../test-utils.js';

const execFileAsync = promisify(execFile);

const TABLE_NAME = process.env.RAGBRAIN_TABLE_NAME
  || `ragbrain-thoughts-${process.env.RAGBRAIN_ENV || 'dev'}`;
const AWS_PROFILE = process.env.AWS_PROFILE || 'default';
const AWS_REGION = process.env.AWS_REGION || 'us-west-2';

async function aws(args: string[]): Promise<void> {
  await execFileAsync('aws', [
    ...args,
    '--table-name', TABLE_NAME,
    '--profile', AWS_PROFILE,
    '--region', AWS_REGION,
  ]);
}

// Fixed timestamp so a failed run leaves one predictable row, not a growing pile.
const VICTIM_USER = 'tenant-isolation-probe';
const VICTIM_EPOCH = 1770000000000;
const VICTIM_ID = 't_tenant_isolation_probe';
const VICTIM_SK = `ts#${VICTIM_EPOCH}#${VICTIM_ID}`;
const VICTIM_SECRET = 'TENANT_ISOLATION_CANARY_a7f3e9c1_must_never_be_returned';

// The types the API accepts; the probe is planted under each in turn so a leak
// through any single type filter is caught.
const TYPES = ['thought', 'decision', 'insight', 'todo', 'code', 'link'];

async function plantVictimNote(type: string): Promise<void> {
  await aws(['dynamodb', 'put-item', '--item', JSON.stringify({
    pk: { S: `user#${VICTIM_USER}` },
    sk: { S: VICTIM_SK },
    id: { S: VICTIM_ID },
    text: { S: VICTIM_SECRET },
    type: { S: type },
    tags: { SS: ['tenant-isolation-probe'] },
    createdAt: { N: VICTIM_EPOCH.toString() },
    createdAtIso: { S: new Date(VICTIM_EPOCH).toISOString() },
    decisionScore: { N: '0' },
    s3Key: { S: `thoughts/${VICTIM_USER}/probe.json` },
  })]);
}

async function removeVictimNote(): Promise<void> {
  await aws(['dynamodb', 'delete-item', '--key', JSON.stringify({
    pk: { S: `user#${VICTIM_USER}` },
    sk: { S: VICTIM_SK },
  })]);
}

function leakedRows(data: any): any[] {
  const thoughts = data?.thoughts || [];
  return thoughts.filter((t: any) =>
    t?.user === VICTIM_USER
    || t?.id === VICTIM_ID
    || (typeof t?.text === 'string' && t.text.includes(VICTIM_SECRET))
  );
}

suite('Tenant Isolation (finding 11)');

try {
  {
    for (const type of TYPES) {
      await plantVictimNote(type);

      await test(`GET /thoughts?type=${type} excludes another user's notes`, async () => {
        const { status, data } = await api<any>('GET', `/thoughts?type=${type}&limit=100`);
        assert(status === 200, `expected 200, got ${status}`);

        const leaked = leakedRows(data);
        assert(
          leaked.length === 0,
          `CROSS-TENANT LEAK: ${leaked.length} row(s) owned by ${VICTIM_USER} `
          + `returned by ?type=${type}`,
        );
      });

      await test(`GET /thoughts?type=${type} with a date range excludes them too`, async () => {
        const from = new Date(VICTIM_EPOCH - 86_400_000).toISOString().slice(0, 10);
        const to = new Date(VICTIM_EPOCH + 86_400_000).toISOString().slice(0, 10);
        const { status, data } = await api<any>(
          'GET', `/thoughts?type=${type}&from=${from}&to=${to}&limit=100`,
        );
        assert(status === 200, `expected 200, got ${status}`);
        assert(
          leakedRows(data).length === 0,
          `CROSS-TENANT LEAK via ?type=${type} + date range`,
        );
      });
    }

    // The tag filter shares the same code path as type, so it needs the same guard.
    await plantVictimNote('thought');
    await test('GET /thoughts?tag= excludes another user\'s notes', async () => {
      const { status, data } = await api<any>(
        'GET', '/thoughts?tag=tenant-isolation-probe&limit=100',
      );
      assert(status === 200, `expected 200, got ${status}`);
      assert(
        leakedRows(data).length === 0,
        'CROSS-TENANT LEAK via ?tag=',
      );
    });

    await test('the default feed excludes another user\'s notes', async () => {
      const { status, data } = await api<any>('GET', '/thoughts?limit=100');
      assert(status === 200, `expected 200, got ${status}`);
      assert(leakedRows(data).length === 0, 'CROSS-TENANT LEAK via default feed');
    });

    // Paging must not be a way around the filter: walk every page and check each.
    await test('paginating a filtered list never surfaces another user\'s notes', async () => {
      let cursor: string | undefined;
      let pages = 0;
      do {
        const path = `/thoughts?type=thought&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const { status, data } = await api<any>('GET', path);
        assert(status === 200, `page ${pages + 1}: expected 200, got ${status}`);
        assert(
          leakedRows(data).length === 0,
          `CROSS-TENANT LEAK on page ${pages + 1} of a filtered list`,
        );
        cursor = data?.cursor;
        pages++;
      } while (cursor && pages < 30);
    });
  }
} finally {
  // Always clean up, including on assertion failure, so a red run does not leave
  // a fake user in the table.
  await removeVictimNote().catch(error => {
    console.error(`Failed to remove the probe row (${VICTIM_USER} / ${VICTIM_SK}):`, error);
  });
}

// test() records failures rather than rethrowing, so exit explicitly on any
// failure. A tenant leak must break the build, not just print a red line.
const summary = printSummary();
if (summary.failed > 0) {
  process.exit(1);
}
