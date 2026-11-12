#!/usr/bin/env node
/**
 * Compares the OpenAPI documents served by the NestJS API and the Spring Boot API for every operation
 * Spring implements: summary, tags, security, parameters, request body schema and response codes.
 * Read-only (two GET requests). Exits 1 if any shared operation differs.
 *
 *   node scripts/migration/openapi-compare.mjs [--nest http://localhost:3001] [--spring http://localhost:3002]
 */
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const NEST = opt('--nest', 'http://localhost:3001');
const SPRING = opt('--spring', 'http://localhost:3002');

async function load(base) {
  const res = await fetch(`${base}/api/docs-json`);
  if (!res.ok) throw new Error(`${base}/api/docs-json answered ${res.status}`);
  return res.json();
}

function deref(doc, node) {
  let current = node;
  const seen = new Set();
  while (current && current.$ref && !seen.has(current.$ref)) {
    seen.add(current.$ref);
    current = current.$ref.replace(/^#\//, '').split('/').reduce((acc, key) => acc?.[key], doc);
  }
  return current;
}

/** A comparable shape of a schema: property names with types, required list and constraints. */
function schemaShape(doc, schema, depth = 0) {
  const s = deref(doc, schema);
  if (!s || depth > 4) return null;
  if (s.type === 'array') return { type: 'array', items: schemaShape(doc, s.items, depth + 1) };
  if (s.properties) {
    const props = {};
    for (const key of Object.keys(s.properties).sort()) {
      const p = deref(doc, s.properties[key]);
      props[key] = {
        type: p?.type ?? (p?.properties ? 'object' : p?.enum ? 'string' : undefined),
        ...(p?.enum ? { enum: [...p.enum].sort() } : {}),
        ...(p?.format ? { format: p.format } : {}),
        ...(p?.pattern ? { pattern: p.pattern } : {}),
        ...(p?.description ? { description: p.description } : {}),
        ...(p?.minLength != null ? { minLength: p.minLength } : {}),
        ...(p?.maxLength != null ? { maxLength: p.maxLength } : {}),
        ...(p?.minimum != null ? { minimum: p.minimum } : {}),
        ...(p?.maximum != null ? { maximum: p.maximum } : {}),
      };
    }
    return { type: 'object', required: [...(s.required ?? [])].sort(), properties: props };
  }
  return { type: s.type };
}

function operations(doc) {
  const out = new Map();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      out.set(`${method.toUpperCase()} ${path}`, op);
    }
  }
  return out;
}

function describe(doc, op) {
  const body = op.requestBody?.content?.['application/json']?.schema;
  return {
    summary: op.summary ?? null,
    description: op.description ?? null,
    tags: [...(op.tags ?? [])].sort(),
    security: (op.security ?? doc.security ?? []).flatMap((entry) => Object.keys(entry)).sort(),
    parameters: (op.parameters ?? [])
      .map((p) => deref(doc, p))
      .map((p) => `${p.in}:${p.name}${p.required ? '!' : '?'} ${canonical(p.schema ?? {})}`)
      .sort(),
    requestBody: body ? schemaShape(doc, body) : null,
    responses: Object.keys(op.responses ?? {}).sort(),
  };
}

/**
 * Reviewed, intentional documentation differences. NestJS's explicit @ApiUnauthorizedResponse on refresh suppresses
 * the default success response in @nestjs/swagger, so its document omits the 200 the route actually returns.
 */
const ACCEPTED = new Map([
  ['POST /api/auth/refresh|responses', 'Spring also documents the 200 that NestJS omits'],
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    // `required` is a set in JSON Schema; springdoc sorts it, @nestjs/swagger keeps declaration order.
    const entry = (k) =>
      `${JSON.stringify(k)}:${canonical(k === 'required' && Array.isArray(value[k]) ? [...value[k]].sort() : value[k])}`;
    return `{${Object.keys(value).sort().map(entry).join(',')}}`;
  }
  return JSON.stringify(value);
}

const [nest, spring] = await Promise.all([load(NEST), load(SPRING)]);
const nestOps = operations(nest);
const springOps = operations(spring);

const report = [];
let differing = 0;
for (const [key, springOp] of springOps) {
  const nestOp = nestOps.get(key);
  if (!nestOp) {
    report.push(`EXTRA   ${key} (not in NestJS)`);
    differing++;
    continue;
  }
  const a = describe(nest, nestOp);
  const b = describe(spring, springOp);
  const all = Object.keys(a).filter((f) => canonical(a[f]) !== canonical(b[f]));
  for (const f of all.filter((f) => ACCEPTED.has(`${key}|${f}`))) {
    report.push(`ACCEPT  ${key} ${f}: ${ACCEPTED.get(`${key}|${f}`)}`);
  }
  const fields = all.filter((f) => !ACCEPTED.has(`${key}|${f}`));
  if (fields.length === 0) continue;
  differing++;
  report.push(`DIFF    ${key}`);
  const clip = (value) => {
    const text = JSON.stringify(value);
    return text.length > 400 ? `${text.slice(0, 400)}… (${text.length} chars)` : text;
  };
  for (const f of fields) {
    report.push(`          ${f}: nest=${clip(a[f])}`);
    report.push(`          ${' '.repeat(f.length)}  spring=${clip(b[f])}`);
  }
}
const notMigrated = [...nestOps.keys()].filter((k) => !springOps.has(k));
for (const key of notMigrated) console.log(`MISSING ${key}`);

const infoSame = nest.info?.title === spring.info?.title && nest.info?.version === spring.info?.version;
const schemesSame =
  canonical(nest.components?.securitySchemes ?? {}) === canonical(spring.components?.securitySchemes ?? {});
const errorSame =
  canonical(nest.components?.schemas?.ErrorResponse ?? null) ===
  canonical(spring.components?.schemas?.ErrorResponse ?? null);

console.log(report.join('\n'));
console.log(`info (title/version) identical: ${infoSame}`);
console.log(`security schemes identical: ${schemesSame}`);
console.log(`ErrorResponse schema identical: ${errorSame}`);
console.log(
  `operations: NestJS ${nestOps.size}, Spring ${springOps.size}; ` +
    `shared ${springOps.size - report.filter((l) => l.startsWith('EXTRA')).length}, ` +
    `differing ${differing}, not yet migrated ${notMigrated.length}`,
);
// Partial comparisons are useful during implementation but cannot satisfy the final coverage gate.
const coverageComplete = notMigrated.length === 0 || args.includes('--allow-partial');
process.exit(differing === 0 && infoSame && schemesSame && errorSame && coverageComplete ? 0 : 1);
