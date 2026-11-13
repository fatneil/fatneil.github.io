// AI invoice reading. Sends the invoice photo(s) straight from the browser to
// the Claude API with the owner's own API key (kept on this device only) and
// gets back structured JSON that pre-fills the log entry form.
import { Anthropic, betaJSONSchemaOutputFormat } from '../vendor/anthropic-sdk.mjs';

export const MODEL = 'claude-opus-5-5';
// Claude Opus 5.5 list price per million tokens, for the rough cost shown after a read.
const PRICE_IN = 4, PRICE_OUT = 20;
const MAX_IMAGES = 6;
const API_EDGE = 1568; // the API downsizes larger images anyway; sending this size saves upload time

const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });

function buildSchema(zoneIds, taskIds) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['is_invoice', 'title', 'date', 'odometer', 'odometer_approximate', 'shop', 'invoice_number', 'total',
      'kind', 'line_items', 'zones', 'task_ids', 'findings', 'uncertain'],
    properties: {
      is_invoice: { type: 'boolean', description: 'True if the images show a vehicle service invoice, work order or parts receipt.' },
      title: { type: 'string', description: 'Short summary of the work done, under 70 characters, e.g. "Transfer case oil change; front brake pads".' },
      date: nullable({ type: 'string', format: 'date', description: 'Service or invoice date as YYYY-MM-DD.' }),
      odometer: nullable({ type: 'integer', description: 'Mileage in / odometer reading printed or written on the invoice.' }),
      odometer_approximate: { type: 'boolean', description: 'True if the mileage is handwritten, partly illegible, or otherwise uncertain.' },
      shop: nullable({ type: 'string', description: 'Business name and city if shown.' }),
      invoice_number: nullable({ type: 'string', description: 'Invoice, RO or work order number.' }),
      total: nullable({ type: 'number', description: 'Grand total paid in dollars, including tax.' }),
      kind: { type: 'string', enum: ['service', 'repair', 'parts', 'admin', 'other'] },
      line_items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['description', 'part_number', 'quantity', 'amount', 'type'],
          properties: {
            description: { type: 'string' },
            part_number: nullable({ type: 'string' }),
            quantity: nullable({ type: 'number' }),
            amount: nullable({ type: 'number', description: 'Line amount in dollars.' }),
            type: { type: 'string', enum: ['part', 'labor', 'fluid', 'fee', 'tax', 'other'] },
          },
        },
      },
      zones: { type: 'array', items: { type: 'string', enum: zoneIds }, description: 'Vehicle systems the completed work touched.' },
      task_ids: {
        type: 'array',
        items: taskIds.length ? { type: 'string', enum: taskIds } : { type: 'string' },
        description: 'Schedule items this invoice shows were actually completed.',
      },
      findings: { type: 'string', description: 'Technician findings, warnings, recommendations and declined work, verbatim where possible. Empty string if none.' },
      uncertain: { type: 'string', description: 'Anything unreadable or guessed (fields, amounts, missing pages). Empty string if all clear.' },
    },
  };
}

function systemPrompt(vehicle, zones, tasks, est, todayIso) {
  const v = vehicle || {};
  return `You read photos of automotive service invoices, work orders and parts receipts for one vehicle and extract them into a maintenance log.

Vehicle: ${[v.year, v.make, v.model].filter(Boolean).join(' ') || 'unknown'}${v.engine ? `, ${v.engine}` : ''}${v.transmission ? `, ${v.transmission}` : ''}.
Today is ${todayIso}. The odometer is estimated at about ${est != null ? Math.round(est) : 'unknown'} miles, so a printed mileage far from that is probably an older invoice or a misread.

Rules:
- Read only what is on the paper. Use null for any field you cannot read; never invent a date, mileage, part number or amount.
- If several photos are pages of one invoice, combine them into one record.
- "total" is the grand total including tax. Line amounts are as printed.
- task_ids: include a schedule item only when the invoice shows that work was completed. Recommended, declined or "needs" items are not completed; put them in findings.
- zones: the vehicle systems the completed work touched.
- Put technician notes, measurements, warnings and recommendations in findings.
- Put anything you were unsure about in uncertain.

Vehicle systems (id: name):
${zones.map(z => `${z.id}: ${z.name}`).join('\n')}

Schedule items (id: name [system]):
${tasks.map(t => `${t.id}: ${t.name} [${t.zone}]`).join('\n')}`;
}

async function toBase64Jpeg(blob) {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const sc = Math.min(1, API_EDGE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.85);
    return url.slice(url.indexOf(',') + 1);
  } catch {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }
}

export class AIError extends Error {
  constructor(message, kind = 'error') { super(message); this.kind = kind; }
}

export async function readInvoice({ apiKey, blobs, vehicle, zones, tasks, est, todayIso }) {
  if (!apiKey) throw new AIError('Add your Anthropic API key first (More → AI invoice reading).', 'nokey');
  if (!blobs.length) throw new AIError('Add a photo of the invoice first.', 'nophoto');

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: 120000, maxRetries: 1 });
  const images = [];
  for (const b of blobs.slice(0, MAX_IMAGES)) {
    images.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await toBase64Jpeg(b) } });
  }
  const schema = buildSchema(zones.map(z => z.id), tasks.map(t => t.id));

  let msg;
  try {
    msg = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: systemPrompt(vehicle, zones, tasks, est, todayIso),
      output_config: { effort: 'medium', format: betaJSONSchemaOutputFormat(schema) },
      messages: [{
        role: 'user',
        content: [...images, { type: 'text', text: `Extract this invoice${images.length > 1 ? ` (${images.length} photos)` : ''} into the log record.` }],
      }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AIError('The API key was rejected. Check it in More → AI invoice reading.', 'auth');
    if (err instanceof Anthropic.PermissionDeniedError) throw new AIError('This API key is not allowed to use this model.', 'auth');
    if (err instanceof Anthropic.RateLimitError) throw new AIError('Rate limited or out of credits. Wait a minute, or check your plan and credits in the Anthropic Console.', 'rate');
    if (err instanceof Anthropic.BadRequestError) throw new AIError('The request was rejected: ' + (err.message || 'bad request'), 'request');
    if (err instanceof Anthropic.APIConnectionError) throw new AIError('Could not reach the Claude API. Check your connection and try again.', 'network');
    if (err instanceof Anthropic.APIError) throw new AIError(`Claude API error${err.status ? ' ' + err.status : ''}: ${err.message}`, 'api');
    throw new AIError('Reading failed: ' + (err?.message || err), 'error');
  }

  if (msg.stop_reason === 'refusal') throw new AIError('Claude declined to read these images.', 'refusal');
  if (msg.stop_reason === 'max_tokens') throw new AIError('The answer was cut off. Try fewer photos at once.', 'truncated');
  const out = msg.parsed_output;
  if (!out) throw new AIError('Claude replied, but not in the expected format. Try again.', 'parse');

  const u = msg.usage || {};
  const cost = ((u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)) * PRICE_IN / 1e6 + (u.output_tokens || 0) * PRICE_OUT / 1e6;
  return { result: out, model: msg.model, cost, usage: u, sentImages: images.length };
}

// Turn the extraction into log-entry details text.
export function detailsFromResult(r) {
  const money = n => (n == null ? '' : ` — $${Number(n).toFixed(2)}`);
  const lines = (r.line_items || []).map(li => `• ${li.quantity && li.quantity !== 1 ? li.quantity + ' × ' : ''}${li.description}${li.part_number ? ` (${li.part_number})` : ''}${money(li.amount)}`);
  if (r.findings) lines.push('', 'Shop notes: ' + r.findings);
  return lines.join('\n').trim();
}
