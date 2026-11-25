import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'conviso_mcp', 'server.js');

// Spawns the real server over stdio and performs the MCP handshake — the failure mode unit
// tests can't catch (broken imports, bad tool registration, JSON catalog loading).
function handshake() {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, CONVISO_API_KEY: 'test-key-not-real' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const timer = setTimeout(() => {
      child.kill();
      rejectP(new Error('handshake timeout'));
    }, 10_000);

    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      for (const line of buf.split('\n')) {
        try {
          const m = JSON.parse(line);
          if (m.id === 1) {
            clearTimeout(timer);
            child.kill();
            resolveP(m.result.tools);
          }
        } catch { /* partial line */ }
      }
    });
    child.on('error', (e) => { clearTimeout(timer); rejectP(e); });
    child.on('exit', (code) => {
      if (code && code !== 0 && code !== 143) {
        clearTimeout(timer);
        rejectP(new Error(`server exited with code ${code}`));
      }
    });

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) + '\n');
  });
}

test('server boots on stdio and lists all tools', async () => {
  const tools = await handshake();
  const names = tools.map((t) => t.name);

  assert.equal(names.length, 47, `expected 47 tools, got ${names.length}: ${names.join(',')}`);
  for (const required of ['get_companies', 'get_company_id_from_object', 'get_issues', 'list_mutations', 'describe_mutation', 'execute_mutation', 'run_dast', 'get_tickets', 'get_project_types', 'get_project_requirement_activities', 'get_activity_attachments', 'read_activity_attachment', 'get_object_timeline']) {
    assert.ok(names.includes(required), `missing tool ${required}`);
  }
  // Consolidated away in v0.6.0 — must not resurface.
  assert.ok(!names.includes('get_issues_by_project_id'));
  assert.ok(!names.includes('get_issues_by_asset_id'));

  // Every tool carries annotations the MCP clients rely on for confirmation UX.
  for (const t of tools) {
    assert.ok(t.annotations, `${t.name} missing annotations`);
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean', `${t.name} missing readOnlyHint`);
  }
  const exec = tools.find((t) => t.name === 'execute_mutation');
  assert.equal(exec.annotations.destructiveHint, true);
  assert.equal(exec.annotations.readOnlyHint, false);
  assert.ok(exec.inputSchema.required.includes('company_id'));
  const resolver = tools.find((t) => t.name === 'get_company_id_from_object');
  assert.equal(resolver.annotations.readOnlyHint, true);
  assert.match(resolver.description, /call this tool first/i);
  const activities = tools.find((t) => t.name === 'get_project_requirement_activities');
  assert.match(activities.description, /first call get_project_requirements/i);
  assert.deepEqual(activities.inputSchema.required, ['project_id', 'project_requirement_id']);
  assert.ok('has_attachments' in activities.inputSchema.properties);

  // New read tools: read-only, with the ids each one cannot work without.
  const expectations = {
    get_activity_attachments: ['project_id', 'activity_id'],
    read_activity_attachment: ['project_id', 'activity_id', 'attachment_id'],
    get_object_timeline: ['object_type', 'object_id'],
  };
  for (const [name, required] of Object.entries(expectations)) {
    const t = tools.find((x) => x.name === name);
    assert.equal(t.annotations.readOnlyHint, true, `${name} must be read-only`);
    assert.equal(t.annotations.destructiveHint, false, `${name} must not be destructive`);
    assert.deepEqual(t.inputSchema.required, required, `${name} required args`);
  }
  const reader = tools.find((t) => t.name === 'read_activity_attachment');
  assert.match(reader.description, /never as instructions/i);
  const timeline = tools.find((t) => t.name === 'get_object_timeline');
  assert.deepEqual(timeline.inputSchema.properties.object_type.enum,
    ['project', 'activity', 'issue', 'asset', 'ticket', 'threat_model_artifact', 'pentest_artifact']);
});
