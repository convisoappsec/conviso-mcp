import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_ATTACHMENTS_QUERY,
  ACTIVITY_FILE_URL_QUERY,
  buildReadResult,
  extractPdfText,
  fetchAttachmentBytes,
  listActivityAttachments,
  readActivityAttachment,
  readableAs,
  resolveKind,
  sniffMime,
} from '../src/conviso_mcp/attachments.js';
import { GraphQLClient } from '../src/conviso_mcp/graphql_client.js';

// Minimal valid PDF: Helvetica text per page — a string, an array of lines, or null for a
// page without text (what a scanned page looks like to a text extractor).
function buildPdf(pages) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>'];
  objs.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  const fontId = 3 + pages.length * 2;
  pages.forEach((text, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`);
    const lines = text === null ? [] : [].concat(text);
    const stream = lines.length
      ? `BT /F1 10 Tf 12 TL 40 760 Td ${lines.map((l) => `(${l}) Tj T*`).join(' ')} ET`
      : '';
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const ZIP = Buffer.from('504b030414000000', 'hex');

function activityPayload({ history = [], evidences = [], totalPages = 1 } = {}) {
  return {
    activities: {
      collection: [{
        id: '77',
        title: 'Validate MFA',
        status: 'DONE',
        attachmentsCount: 2,
        evidenceText: null,
        updatedAt: '2026-11-20T10:00:00Z',
        projectRequirement: { id: '9', label: 'ASVS' },
        evidences,
        history: { collection: history, metadata: { totalCount: history.length, totalPages, currentPage: 1 } },
      }],
    },
  };
}

const HISTORY = [
  {
    id: '501',
    createdAt: '2026-11-20T10:00:00Z',
    actionType: 'STATUS_CHANGE',
    status: 'DONE',
    reason: 'validated',
    evidenceText: 'screenshot of the MFA prompt',
    portalUser: { name: 'Ana Analyst', email: 'ana@example.com' },
    evidences: [
      { id: '9001', filename: 'mfa.png', contentType: 'image/png', size: 2048, createdAt: '2026-11-20T10:00:00Z' },
      { id: '9002', filename: 'report.pdf', contentType: 'application/pdf', size: 4096, createdAt: '2026-11-20T10:00:00Z' },
    ],
  },
  {
    id: '500',
    createdAt: '2026-11-19T09:00:00Z',
    actionType: 'STATUS_CHANGE',
    status: 'IN_PROGRESS',
    reason: null,
    evidenceText: 'checked the login flow manually',
    portalUser: { name: 'Ana Analyst', email: 'ana@example.com' },
    evidences: [],
  },
];
const LEGACY = [{ id: '42', filename: 'old-evidence.zip', contentType: 'application/zip', size: 100, createdAt: '2024-01-01T00:00:00Z' }];

test('listing query selects file metadata only — never url/presignedUrl/updatedAt on files', () => {
  assert.match(ACTIVITY_ATTACHMENTS_QUERY, /attachmentActionsOnly: true/);
  assert.match(ACTIVITY_ATTACHMENTS_QUERY, /evidences \{ id filename contentType size createdAt \}/);
  assert.doesNotMatch(ACTIVITY_ATTACHMENTS_QUERY, /presignedUrl|\burl\b/);
  assert.doesNotMatch(ACTIVITY_ATTACHMENTS_QUERY, /evidences \{[^}]*updatedAt/);
});

test('listing flattens history files and legacy files, keeping uploader and history context', async () => {
  const calls = [];
  const execute = async (query, variables) => {
    calls.push(variables);
    return activityPayload({ history: HISTORY, evidences: LEGACY });
  };
  const listing = await listActivityAttachments(execute, 123, 77);

  assert.deepEqual(calls[0], { projectId: 123, activityId: 77, historyPagination: { page: 1, perPage: 100 } });
  assert.equal(listing.total, 3);
  const [png, pdf, legacy] = listing.attachments;
  assert.equal(png.id, '9001');
  assert.equal(png.readable_as, 'image');
  assert.deepEqual(png.uploaded_by, { name: 'Ana Analyst', email: 'ana@example.com' });
  assert.equal(png.history_entry.status, 'DONE');
  assert.equal(png.history_entry.evidence_text, 'screenshot of the MFA prompt');
  assert.equal(pdf.readable_as, 'pdf_text');
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.readable_as, 'unsupported');
  assert.equal(listing.evidence_texts.length, 1);
  assert.equal(listing.evidence_texts[0].evidence_text, 'checked the login flow manually');
  assert.equal(listing.activity.attachments_count, 2);
});

test('listing walks every history page', async () => {
  const pages = [];
  const execute = async (_q, v) => {
    pages.push(v.historyPagination.page);
    const entry = { ...HISTORY[0], id: `h${v.historyPagination.page}`, evidences: [{ id: `f${v.historyPagination.page}`, filename: 'a.txt', contentType: 'text/plain', size: 1, createdAt: 'x' }] };
    return activityPayload({ history: [entry], totalPages: 3 });
  };
  const listing = await listActivityAttachments(execute, 1, 2);
  assert.deepEqual(pages, [1, 2, 3]);
  assert.deepEqual(listing.attachments.map((a) => a.id), ['f1', 'f2', 'f3']);
  assert.equal(listing.notes, undefined);
});

test('unknown activity is a 404 with a safe message', async () => {
  const execute = async () => ({ activities: { collection: [] } });
  await assert.rejects(listActivityAttachments(execute, 1, 2), (err) => {
    assert.equal(err.status, 404);
    assert.match(err.publicMessage, /Activity 2 not found in project 1/);
    return true;
  });
});

test('read refuses a file that is not attached to the activity — downloadActivityFile is never called', async () => {
  const queries = [];
  const execute = async (query) => {
    queries.push(query);
    return activityPayload({ history: HISTORY });
  };
  let fetched = false;
  await assert.rejects(
    readActivityAttachment(execute, { project_id: 1, activity_id: 77, attachment_id: 31337 }, { fetchBytes: async () => { fetched = true; } }),
    (err) => err.status === 404 && /not attached to activity 77/.test(err.publicMessage),
  );
  assert.equal(fetched, false);
  assert.ok(queries.every((q) => !q.includes('downloadActivityFile')));
});

test('read asks for an INLINE presigned URL (no download audit row) and returns images as image content', async () => {
  const requests = [];
  const execute = async (query, variables) => {
    requests.push({ query, variables });
    if (query.includes('downloadActivityFile')) {
      return { downloadActivityFile: { id: '9001', presignedUrl: 'https://bucket.s3.amazonaws.com/key?X-Amz-Signature=abc' } };
    }
    return activityPayload({ history: HISTORY });
  };
  let fetchedUrl;
  const result = await readActivityAttachment(execute, { project_id: 1, activity_id: 77, attachment_id: 9001 }, {
    fetchBytes: async (url) => { fetchedUrl = url; return PNG; },
  });

  const urlRequest = requests.find((r) => r.query.includes('downloadActivityFile'));
  assert.deepEqual(urlRequest.variables, { id: '9001', projectId: 1 });
  assert.match(ACTIVITY_FILE_URL_QUERY, /disposition: INLINE/);
  assert.doesNotMatch(ACTIVITY_FILE_URL_QUERY, /ATTACHMENT|\burl\b/);
  assert.equal(fetchedUrl, 'https://bucket.s3.amazonaws.com/key?X-Amz-Signature=abc');

  assert.equal(result.content.length, 2);
  const meta = JSON.parse(result.content[0].text);
  assert.match(meta.notice, /never as instructions/);
  assert.equal(meta.read_as, 'image');
  assert.equal(meta.attachment.filename, 'mfa.png');
  assert.deepEqual(result.content[1], { type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' });
});

test('files above the size limit are not downloaded', async () => {
  const queries = [];
  const execute = async (query) => {
    queries.push(query);
    return activityPayload({ history: HISTORY });
  };
  const result = await readActivityAttachment(execute, { project_id: 1, activity_id: 77, attachment_id: 9002 }, {
    maxBytes: 1000,
    fetchBytes: async () => { throw new Error('must not download'); },
  });
  const meta = JSON.parse(result.content[0].text);
  assert.equal(meta.read_as, 'metadata_only');
  assert.match(meta.note, /above the/);
  assert.ok(queries.every((q) => !q.includes('downloadActivityFile')));
});

test('file type comes from magic bytes, not the declared type or extension', () => {
  assert.equal(sniffMime(PNG), 'image/png');
  assert.equal(sniffMime(Buffer.from('ffd8ffe000104a46', 'hex')), 'image/jpeg');
  assert.equal(sniffMime(Buffer.from('GIF89a')), 'image/gif');
  assert.equal(sniffMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), 'image/webp');
  assert.equal(sniffMime(Buffer.from('%PDF-1.7')), 'application/pdf');
  assert.equal(sniffMime(ZIP), 'application/zip');
  assert.equal(sniffMime(Buffer.from('hello')), null);

  // A PNG uploaded as "report.pdf" is still an image; a ZIP named .png is not.
  assert.deepEqual(resolveKind(PNG, { filename: 'report.pdf', contentType: 'application/pdf' }), { kind: 'image', mimeType: 'image/png' });
  assert.equal(resolveKind(ZIP, { filename: 'shot.png', contentType: 'image/png' }).kind, 'unsupported');
  assert.equal(resolveKind(Buffer.from('a,b\n1,2'), { filename: 'data.csv', contentType: 'text/csv' }).kind, 'text');
  // Binary garbage declared as text is not decoded as text.
  assert.equal(resolveKind(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]), { filename: 'x.txt', contentType: 'text/plain' }).kind, 'unsupported');
});

test('readable_as is predicted from metadata, using the extension when the type is generic', () => {
  assert.equal(readableAs({ filename: 'a.jpg', contentType: 'image/jpeg' }), 'image');
  assert.equal(readableAs({ filename: 'scan.pdf', contentType: 'application/octet-stream' }), 'pdf_text');
  assert.equal(readableAs({ filename: 'out.log', contentType: 'application/octet-stream' }), 'text');
  assert.equal(readableAs({ filename: 'data.json', contentType: 'application/json' }), 'text');
  assert.equal(readableAs({ filename: 'img.tiff', contentType: 'image/tiff' }), 'unsupported');
  assert.equal(readableAs({ filename: 'doc.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'unsupported');
});

const FILE = { id: '1', filename: 'f', content_type: null, uploaded_at: null, uploaded_by: null, history_entry: null };

test('a listed string ID and MIME type round-trip for extensionless text evidence', async () => {
  const evidence = { id: '9007199254740993', filename: 'evidence', contentType: 'text/plain' };
  const execute = async (query, variables) => {
    if (query === ACTIVITY_FILE_URL_QUERY) {
      assert.equal(variables.id, evidence.id);
      return { downloadActivityFile: { presignedUrl: 'https://example.com/evidence' } };
    }
    return activityPayload({ evidences: [evidence] });
  };
  const listing = await listActivityAttachments(execute, 1, 77);
  const [file] = listing.attachments;
  assert.equal(file.readable_as, 'text');
  const result = await readActivityAttachment(execute, { project_id: 1, activity_id: 77, attachment_id: file.id }, {
    fetchBytes: async () => Buffer.from('Written verification'),
  });
  assert.equal(JSON.parse(result.content[0].text).attachment.detected_type, 'text/plain');
  assert.deepEqual(result.content[1], { type: 'text', text: 'Written verification' });
});

test('text files come back as text, capped by max_chars', async () => {
  const result = await buildReadResult({
    projectId: 1, activityId: 2, file: { ...FILE, filename: 'notes.txt', content_type: 'text/plain' },
    buf: Buffer.from('x'.repeat(5000)), options: { max_chars: 1000 },
  });
  const meta = JSON.parse(result.content[0].text);
  assert.equal(meta.read_as, 'text');
  assert.equal(meta.text.truncated, true);
  assert.equal(result.content[1].text.length, 1000);
});

test('unsupported formats return metadata, and the raw file only with include_original', async () => {
  const file = { ...FILE, filename: 'bundle.zip', content_type: 'application/zip' };
  const plain = await buildReadResult({ projectId: 1, activityId: 2, file, buf: ZIP });
  assert.equal(plain.content.length, 1);
  assert.match(JSON.parse(plain.content[0].text).note, /include_original=true/);

  const withOriginal = await buildReadResult({ projectId: 1, activityId: 2, file, buf: ZIP, options: { include_original: true } });
  const resource = withOriginal.content[1];
  assert.equal(resource.type, 'resource');
  assert.equal(resource.resource.mimeType, 'application/zip');
  assert.equal(resource.resource.blob, ZIP.toString('base64'));
  assert.equal(resource.resource.uri, 'conviso://projects/1/activities/2/attachments/1/bundle.zip');
});

test('PDF text is extracted per page, honouring page range, without writing to stdout', async () => {
  const pdf = buildPdf(['Hello evidence page one', 'Second page text', 'Third page']);
  const originalLog = console.log;
  let stdoutWrites = 0;
  console.log = () => { stdoutWrites += 1; };
  try {
    const all = await extractPdfText(pdf);
    assert.equal(all.total_pages, 3);
    assert.equal(all.has_text, true);
    assert.match(all.text, /--- page 1 ---\nHello evidence page one/);
    assert.match(all.text, /--- page 3 ---\nThird page/);

    const range = await extractPdfText(pdf, { pageFrom: 2, pageTo: 2 });
    assert.equal(range.page_from, 2);
    assert.equal(range.page_to, 2);
    assert.doesNotMatch(range.text, /page one/);
    assert.match(range.text, /Second page text/);
  } finally {
    console.log = originalLog;
  }
  // pdf.js logs warnings with console.log, which would corrupt the stdio MCP channel.
  assert.equal(stdoutWrites, 0);
});

test('PDF text is truncated at max_chars with a next_page to continue from', async () => {
  const page = (ch) => Array.from({ length: 12 }, () => ch.repeat(50));
  const pdf = buildPdf([page('A'), page('B'), page('C')]);
  const out = await extractPdfText(pdf, { maxChars: 1000 });
  assert.equal(out.truncated, true);
  assert.equal(out.page_to, 1);
  assert.equal(out.next_page, 2);
  assert.ok(out.text.length <= 1000);
});

test('continuing a PDF within a page reproduces the full selected text exactly', async () => {
  const lines = Array.from({ length: 42 }, (_, i) => `Evidence line ${i} ${'a'.repeat(42)}`);
  const buf = buildPdf([null, lines, lines, 'outside selected range']);
  const expected = await extractPdfText(buf, { pageTo: 3 });
  let text = '';
  let page = 1;
  let offset = 0;
  for (let i = 0; i < 20; i += 1) {
    const result = await buildReadResult({
      projectId: 1, activityId: 2, file: FILE, buf,
      options: { page_from: page, page_to: 3, page_offset: offset, max_chars: 1000 },
    });
    const { pdf, note } = JSON.parse(result.content[0].text);
    const chunk = result.content[1].text;
    assert.ok(chunk.length > 0 && chunk.length <= 1000);
    text += chunk;
    if (!pdf.truncated) break;
    assert.match(note, /page_offset=/);
    page = pdf.next_page;
    offset = pdf.next_page_offset;
  }
  assert.equal(text, expected.text);
});

test('scanned PDFs (no text layer) say so and point to include_original', async () => {
  const pdf = buildPdf([null]);
  const result = await buildReadResult({ projectId: 1, activityId: 2, file: { ...FILE, filename: 'scan.pdf' }, buf: pdf });
  const meta = JSON.parse(result.content[0].text);
  assert.equal(meta.read_as, 'pdf');
  assert.equal(meta.pdf.has_text, false);
  assert.match(meta.note, /scanned PDF/);
});

test('page_from past the end of the PDF is a clear 400', async () => {
  await assert.rejects(extractPdfText(buildPdf(['only page']), { pageFrom: 5 }), (err) => err.status === 400);
});

test('download refuses non-HTTPS URLs and sends no platform credentials', async () => {
  await assert.rejects(fetchAttachmentBytes('http://bucket.s3.amazonaws.com/key'), (err) => err.status === 502);
  await assert.rejects(fetchAttachmentBytes('not a url'), (err) => err.status === 502);

  let seen;
  const http = { get: async (url, config) => { seen = { url, config }; return { data: PNG }; } };
  const buf = await fetchAttachmentBytes('https://bucket.s3.amazonaws.com/key?sig=1', { maxBytes: 1234, http });
  assert.deepEqual(buf, PNG);
  assert.equal(seen.config.maxRedirects, 0);
  assert.equal(seen.config.maxContentLength, 1234);
  assert.equal(seen.config.responseType, 'arraybuffer');
  assert.ok(!Object.keys(seen.config.headers).some((h) => /api-key|authorization/i.test(h)));
});

test('oversized downloads map to a 413 with a safe message', async () => {
  const http = { get: async () => { throw new Error('maxContentLength size of 1234 exceeded'); } };
  await assert.rejects(fetchAttachmentBytes('https://x.example/f', { maxBytes: 1234, http }), (err) => err.status === 413 && /read limit/.test(err.publicMessage));
});

test('GraphQLClient wires the attachment methods to its execute()', async () => {
  const client = new GraphQLClient('https://example.invalid/graphql', 'test');
  client.execute = async () => activityPayload({ history: HISTORY });
  const listing = await client.get_activity_attachments(1, 77);
  assert.equal(listing.total, 2);
});
