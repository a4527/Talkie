// Synthetic DB-only comparison. Run from app/: node --env-file=.env scripts/benchmark-auth-rate-limits.mjs
import pg from 'pg';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import os from 'node:os';

const database = `talkie_test_auth_bench_${Date.now()}`;
let sourceUrl;
try { sourceUrl = new URL(process.env.DATABASE_URL); }
catch { throw new Error('VALID_DATABASE_URL_REQUIRED'); }
if (!['127.0.0.1', 'localhost', '[::1]'].includes(sourceUrl.hostname)) {
  throw new Error('LOCAL_DATABASE_REQUIRED');
}
const deadline = performance.now() + 240_000;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
const report = { environment: { node: process.version, platform: os.platform(), cpu: os.cpus()[0]?.model,
  logicalCpus: os.cpus().length, memoryBytes: os.totalmem() }, databaseOnly: true, results: [], plans: [] };
let pool;
let created = false;
const latest = (variant) => variant === 'separate'
  ? 'select last_auth_email_requested_at as issued from separate.email_auth_rate_limits where email_address=$1'
  : 'select auth_link_issued_at as issued from merged.email_auth_requests where email_address=$1 order by auth_link_issued_at desc limit 1';

async function measure(variant, workload, concurrency, count, prefix) {
  const samples = [];
  let next = 0, accepted = 0, limited = 0, errors = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = next++;
      if (i >= count) return;
      if (performance.now() > deadline) throw new Error('BENCHMARK_FOUR_MINUTE_LIMIT');
      const email = workload === 'lookup' ? `u${(i * 7919) % report.emails}@example.test`
        : workload === 'hot' ? `${prefix}-hot@example.test` : `${prefix}-${i}@example.test`;
      const start = performance.now();
      let c;
      try {
        c = await pool.connect();
        if (workload === 'lookup') await c.query(latest(variant), [email]);
        else {
          await c.query('begin');
          await c.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [email]);
          const now = (await c.query('select clock_timestamp() as now')).rows[0].now;
          const control = (await c.query(latest(variant), [email])).rows[0];
          if (control && now - control.issued < 30_000) limited++;
          else {
            if (variant === 'separate') await c.query(`insert into separate.email_auth_rate_limits values ($1,$2)
              on conflict(email_address) do update set last_auth_email_requested_at=excluded.last_auth_email_requested_at`, [email, now]);
            await c.query(`update ${variant}.email_auth_requests set auth_link_invalidated_at=$2
              where email_address=$1 and authentication_purpose='login' and auth_link_invalidated_at is null and auth_link_used_at is null`, [email, now]);
            await c.query(`insert into ${variant}.email_auth_requests
              (email_auth_request_id,email_address,authentication_purpose,auth_link_token_hash,auth_link_issued_at,auth_link_expires_at)
              values ($1,$2,'login',$3,$4,$5)`, [randomUUID(), email, randomUUID(), now, new Date(+now + 600_000)]);
            accepted++;
          }
          await c.query('commit');
        }
        samples.push(performance.now() - start);
      } catch (e) {
        errors++;
        if (c) await c.query('rollback').catch(() => {});
        report.errorCodes ??= [];
        report.errorCodes.push(e.code ?? e.name);
      } finally { c?.release(); }
    }
  }));
  samples.sort((a,b) => a-b);
  const elapsedMs = performance.now()-started;
  const percentile = p => samples[Math.max(0, Math.ceil(samples.length*p)-1)];
  return { variant, workload, concurrency, attempts: count, successful: samples.length, accepted, limited, errors,
    elapsedMs, operationsPerSecond: count*1000/elapsedMs, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99) };
}

try {
  await admin.connect();
  report.environment.postgres = (await admin.query('select version() as version')).rows[0].version;
  await admin.query(`create database "${database}"`);
  created = true;
  const url = new URL(sourceUrl);
  url.pathname = `/${database}`;
  pool = new pg.Pool({ connectionString: url.toString(), max: 16, connectionTimeoutMillis: 5000,
    statement_timeout: 5000, options: '-c lock_timeout=3000' });
  for (const [emails, requestsPerEmail] of [[1000, 3], [100000, 10]]) {
    report.emails = emails;
    for (const variant of ['separate', 'merged']) {
      await pool.query(`drop schema if exists ${variant} cascade`);
      await pool.query(`create schema ${variant}`);
      await pool.query(`create table ${variant}.email_auth_requests (
        email_auth_request_id uuid primary key, email_address text not null, authentication_purpose text not null,
        auth_link_token_hash text not null unique, requesting_login_session_id uuid,
        auth_link_issued_at timestamptz not null, auth_link_expires_at timestamptz not null,
        auth_link_used_at timestamptz, auth_link_invalidated_at timestamptz, email_send_status text not null default 'pending',
        check(authentication_purpose in ('login','account_deletion')),
        check(email_send_status in ('pending','smtp_accepted','failed_or_unknown')),
        check((authentication_purpose='login' and requesting_login_session_id is null) or
          (authentication_purpose='account_deletion' and requesting_login_session_id is not null)))`);
      await pool.query(`create index on ${variant}.email_auth_requests(email_address, authentication_purpose)`);
      if (variant === 'merged') await pool.query(`create index on merged.email_auth_requests(email_address, auth_link_issued_at desc)`);
      for (let offset=0; offset<emails; offset+=5000) {
        if (performance.now() > deadline) throw new Error('BENCHMARK_FOUR_MINUTE_LIMIT');
        await pool.query(`insert into ${variant}.email_auth_requests
        (email_auth_request_id,email_address,authentication_purpose,auth_link_token_hash,auth_link_issued_at,auth_link_expires_at)
        select md5(u::text || ':' || r::text)::uuid, 'u'||u||'@example.test','login', md5(u::text || ':' || r::text),
          now()-interval '1 hour'*r, now()-interval '1 hour'*r+interval '10 minutes'
        from generate_series($3::int,$1::int-1) u cross join generate_series(1,$2::int) r`,
        [Math.min(offset+5000,emails), requestsPerEmail, offset]);
      }
      if (variant === 'separate') {
        await pool.query('create table separate.email_auth_rate_limits(email_address text primary key,last_auth_email_requested_at timestamptz not null)');
        await pool.query(`insert into separate.email_auth_rate_limits select 'u'||u||'@example.test',now()-interval '1 hour' from generate_series(0,$1::int-1) u`, [emails]);
        await pool.query('vacuum analyze separate.email_auth_rate_limits');
      }
      await pool.query(`vacuum analyze ${variant}.email_auth_requests`);
      const sizes = await pool.query(`select c.relname,pg_total_relation_size(c.oid)::text as bytes
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relkind='r'`, [variant]);
      const plan = await pool.query(`explain (analyze,buffers,format json) ${latest(variant)}`, ['u123@example.test']);
      report.plans.push({ emails, requestsPerEmail, variant, sizes: sizes.rows, plan: plan.rows });
    }
    for (const concurrency of [1,8,16]) for (const workload of ['lookup','accepted','hot']) {
      const count = workload === 'lookup' ? 2000 : 400;
      for (let round=0; round<3; round++) {
        for (const variant of round % 2 ? ['merged','separate'] : ['separate','merged']) {
          const prefix = `e${emails}c${concurrency}${workload}r${round}`;
          await measure(variant, workload, concurrency, 100, `warm-${prefix}`);
          const result = await measure(variant, workload, concurrency, count, prefix);
          if (result.errors || (workload === 'hot' && (result.accepted !== 1 || result.limited !== count-1)) ||
              (workload === 'accepted' && result.accepted !== count)) throw new Error('BENCHMARK_INVARIANT_FAILED');
          report.results.push({ emails, requestsPerEmail, round, ...result });
        }
      }
    }
  }
} catch (e) {
  report.failure = e.code ?? e.message;
  process.exitCode = 1;
} finally {
  await pool?.end();
  if (created) {
    await admin.query(`drop database "${database}"`);
    report.testDatabaseRemoved = true;
  }
  await admin.end();
  console.log(JSON.stringify(report, null, 2));
}
