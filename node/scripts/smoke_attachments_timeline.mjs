#!/usr/bin/env node
/**
 * Manual smoke test of the evidence-file and timeline tools against the real Conviso API.
 * Not part of `npm test` (it needs a real API key and real object ids).
 *
 * Usage (from node/):
 *   CONVISO_API_KEY=... node scripts/smoke_attachments_timeline.mjs \
 *     --project 123 --activity 456 [--asset 7] [--issue 8] [--ticket 9 --company 1] \
 *     [--threat-model 10] [--pentest 11]
 *
 * Prints a summary only: file metadata, the first characters of extracted text, image byte
 * counts, and the first events of each timeline.
 */
import 'dotenv/config';
import { GraphQLClient } from '../src/conviso_mcp/graphql_client.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (token.startsWith('--')) pairs.push([token.slice(2), Number(all[i + 1])]);
    return pairs;
  }, []),
);

if (!process.env.CONVISO_API_KEY) {
  console.error('Set CONVISO_API_KEY first.');
  process.exit(1);
}

const gql = new GraphQLClient('https://app.convisoappsec.com/graphql', process.env.CONVISO_API_KEY);
let failures = 0;

async function step(label, fn) {
  try {
    await fn();
  } catch (err) {
    failures += 1;
    console.log(`  ✗ ${label}: ${err.publicMessage || err.message}`, err.graphqlErrors || '');
  }
}

function summarizeContent(result) {
  const [metaBlock, ...rest] = result.content;
  const meta = JSON.parse(metaBlock.text);
  const parts = rest.map((block) => {
    if (block.type === 'image') return `image ${block.mimeType} ${Buffer.from(block.data, 'base64').length} bytes`;
    if (block.type === 'text') return `text ${block.text.length} chars: ${JSON.stringify(block.text.slice(0, 160))}…`;
    if (block.type === 'resource') return `resource ${block.resource.mimeType}`;
    return block.type;
  });
  return { read_as: meta.read_as, detected: meta.attachment?.detected_type, pdf: meta.pdf, note: meta.note, parts };
}

function summarizeTimeline(out) {
  console.log(`  object: ${JSON.stringify(out.object)}`);
  console.log(`  pagination: ${JSON.stringify(out.pagination)}`);
  for (const e of out.events.slice(0, 5)) {
    console.log(`  - ${e.at} ${e.type} by ${e.actor?.name || e.actor?.email || '?'} ${e.field ? `${e.field}: ${e.from ?? ''} -> ${e.to ?? ''}` : ''}`);
  }
  for (const n of out.notes || []) console.log(`  note: ${n}`);
}

if (args.project && args.activity) {
  console.log(`\n# get_activity_attachments(project=${args.project}, activity=${args.activity})`);
  let listing;
  await step('listing', async () => {
    listing = await gql.get_activity_attachments(args.project, args.activity);
    console.log(`  activity: ${listing.activity.title} (${listing.activity.status}), attachmentsCount=${listing.activity.attachments_count}, listed=${listing.total}`);
    for (const a of listing.attachments) {
      console.log(`  - #${a.id} ${a.filename} ${a.content_type} ${a.size}B readable_as=${a.readable_as} by ${a.uploaded_by?.name || '-'}${a.legacy ? ' (legacy)' : ''}`);
    }
  });

  for (const a of listing?.attachments || []) {
    console.log(`\n# read_activity_attachment(#${a.id} ${a.filename})`);
    await step(`read ${a.id}`, async () => {
      const result = await gql.read_activity_attachment({ project_id: args.project, activity_id: args.activity, attachment_id: a.id, max_chars: 2000 });
      console.log(`  ${JSON.stringify(summarizeContent(result))}`);
    });
  }

  console.log(`\n# get_object_timeline(activity ${args.activity})`);
  await step('activity timeline', async () => summarizeTimeline(await gql.get_object_timeline({ object_type: 'activity', object_id: args.activity, project_id: args.project })));
}

const timelines = [
  ['project', args.project, {}],
  ['asset', args.asset, {}],
  ['issue', args.issue, {}],
  ['ticket', args.ticket, { company_id: args.company }],
  ['threat_model_artifact', args['threat-model'], {}],
  ['pentest_artifact', args.pentest, {}],
];
for (const [type, id, extra] of timelines) {
  if (!id) continue;
  console.log(`\n# get_object_timeline(${type} ${id})`);
  await step(`${type} timeline`, async () => summarizeTimeline(await gql.get_object_timeline({ object_type: type, object_id: id, limit: 20, ...extra })));
}

console.log(failures ? `\n${failures} step(s) failed` : '\nall steps passed');
process.exit(failures ? 1 : 0);
