/**
 * Parse [eltpulse] markers and common dlt/Sling log lines into telemetry PATCH fragments.
 * Mirror of web/lib/elt/telemetry-log-parser.ts — keep in sync.
 */

const PHASE_MARKER = /\[eltpulse\]\s+phase:(\w+)/i;
const RESOURCE_MARKER = /\[eltpulse\]\s+resource:([^\s]+)\s+rows:(\d+)(?:\s+bytes:(\d+))?/i;
const ROWS_LOADED = /\b([\d,]+)\s*rows\s+loaded\b/i;
const ROWS_SO_FAR = /rows\s+processed\s+so\s+far:\s*([\d,]+)/i;
const BYTES_LOADED = /\b([\d,]+)\s*bytes\s+loaded\b/i;
/** dlt normalize stdout: "- issues: 500 row(s)" */
const DLT_TABLE_ROWS = /^\s*-\s*([^:]+):\s*([\d,]+)\s+row\(s\)\s*$/i;

const PHASE_PROGRESS = {
  extract: 15,
  load: 70,
  dbt: 90,
  done: 100,
  failed: 100,
};

function parseIntLoose(raw) {
  const n = Number.parseInt(String(raw).replace(/,/g, ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** @returns {Record<string, unknown> | null} partial PATCH body */
export function parseLogLineForTelemetry(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return null;

  const phaseMatch = trimmed.match(PHASE_MARKER);
  if (phaseMatch) {
    const phase = phaseMatch[1].toLowerCase();
    const progress = PHASE_PROGRESS[phase] ?? 50;
    return {
      telemetrySummary: { currentPhase: phase, progress },
      appendTelemetrySample: { phase, progress },
    };
  }

  const resourceMatch = trimmed.match(RESOURCE_MARKER);
  if (resourceMatch) {
    const resource = resourceMatch[1];
    const rows = parseIntLoose(resourceMatch[2]);
    const bytes = resourceMatch[3] ? parseIntLoose(resourceMatch[3]) : undefined;
    return {
      telemetrySummary: {
        currentResource: resource,
        ...(rows !== undefined ? { rowsLoaded: rows } : {}),
        ...(bytes !== undefined ? { bytesLoaded: bytes } : {}),
      },
      appendTelemetrySample: {
        resource,
        ...(rows !== undefined ? { rows } : {}),
        ...(bytes !== undefined ? { bytes } : {}),
      },
    };
  }

  const rowsLoaded = trimmed.match(ROWS_LOADED);
  if (rowsLoaded) {
    const rows = parseIntLoose(rowsLoaded[1]);
    if (rows !== undefined) {
      return {
        telemetrySummary: { rowsLoaded: rows },
        appendTelemetrySample: { rows },
      };
    }
  }

  const rowsSoFar = trimmed.match(ROWS_SO_FAR);
  if (rowsSoFar) {
    const rows = parseIntLoose(rowsSoFar[1]);
    if (rows !== undefined) {
      return {
        telemetrySummary: { rowsLoaded: rows },
        appendTelemetrySample: { rows },
      };
    }
  }

  const bytesLoaded = trimmed.match(BYTES_LOADED);
  if (bytesLoaded) {
    const bytes = parseIntLoose(bytesLoaded[1]);
    if (bytes !== undefined) {
      return {
        telemetrySummary: { bytesLoaded: bytes },
        appendTelemetrySample: { bytes },
      };
    }
  }

  const dltTableRows = trimmed.match(DLT_TABLE_ROWS);
  if (dltTableRows) {
    const resource = dltTableRows[1].trim();
    const rows = parseIntLoose(dltTableRows[2]);
    if (resource && rows !== undefined) {
      return {
        telemetrySummary: { currentResource: resource, rowsLoaded: rows },
        appendTelemetrySample: { resource, rows },
      };
    }
  }

  return null;
}

/** Shallow-merge telemetry fragments into a PATCH payload (last write wins per top-level key). */
export function mergeTelemetryIntoPayload(payload, telemetryPatch) {
  if (!telemetryPatch) return payload;
  const out = { ...payload };
  if (telemetryPatch.telemetrySummary) {
    out.telemetrySummary = { ...(out.telemetrySummary ?? {}), ...telemetryPatch.telemetrySummary };
  }
  if (telemetryPatch.appendTelemetrySample) {
    out.appendTelemetrySample = telemetryPatch.appendTelemetrySample;
  }
  return out;
}
