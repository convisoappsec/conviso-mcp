import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'conviso_mcp', 'server.js');

function callTool(name, args) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, CONVISO_API_KEY: 'test-key-not-real' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const timer = setTimeout(() => {
      child.kill();
      rejectP(new Error('tools/call timeout'));
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
            resolveP(m);
          }
        } catch { /* partial line */ }
      }
    });
    child.on('error', (e) => { clearTimeout(timer); rejectP(e); });

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + '\n');
  });
}

function toolError(message) {
  assert.equal(message.error, undefined, `protocol error instead of a tool result: ${JSON.stringify(message.error)}`);
  return JSON.parse(message.result.content[0].text);
}

test('a create_asset without a type tells the model to ask the user', async () => {
  const result = toolError(await callTool('create_asset', { company_id: 1, name: 'shop', url: 'shop.example.com' }));

  assert.equal(result.status, 400);
  assert.match(result.error, /Ask the user whether it is a repository, an FQDN or an API/);
});

test('an unknown or differently cased type reaches the same check', async () => {
  const unknown = toolError(await callTool('create_asset', { company_id: 1, asset_type: 'web', name: 's', url: 's.io' }));
  const upper = toolError(await callTool('create_asset', { company_id: 1, asset_type: 'FQDN', name: 's' }));

  assert.match(unknown.error, /Ask the user/);
  assert.match(upper.error, /FQDN asset needs name and url/);
});

test('a raw createAsset without a section is refused before the policy check', async () => {
  const result = toolError(await callTool('execute_mutation', {
    company_id: 1, name: 'createAsset', variables: { companyId: 1, name: 's', assetType: 'none' },
  }));

  assert.equal(result.status, 400);
  assert.match(result.error, /Ask the user/);
});
