export type LeadCsvRecord = {
  line: number;
  name: string;
  email: string;
  company: string;
  role: string;
  location: string;
};

export type LeadCsvError = { line: number; reason: string };

function parseRows(input: string) {
  const rows: Array<{ line: number; values: string[] }> = [];
  let values: string[] = [];
  let value = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
        if (character === "\n") line += 1;
      }
      continue;
    }
    if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === ",") {
      values.push(value.trim());
      value = "";
    } else if (character === "\n") {
      values.push(value.trim());
      if (values.some(Boolean)) rows.push({ line: rowLine, values });
      values = [];
      value = "";
      line += 1;
      rowLine = line;
    } else if (character !== "\r") {
      value += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  values.push(value.trim());
  if (values.some(Boolean)) rows.push({ line: rowLine, values });
  return rows;
}

function headerKey(value: string) {
  return value.replace(/^\ufeff/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function columnIndex(headers: string[], names: string[]) {
  return names.map(headerKey).map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
}

export function parseLeadCsv(input: string, maxRows = 5000): { records: LeadCsvRecord[]; errors: LeadCsvError[] } {
  if (input.length > 2_000_000) throw new Error("CSV is too large. Keep imports under 2 MB.");
  const rows = parseRows(input);
  if (!rows.length) throw new Error("CSV is empty.");
  const headers = rows[0].values.map(headerKey);
  const nameIndex = columnIndex(headers, ["name", "fullname", "contactname"]);
  const emailIndex = columnIndex(headers, ["email", "businessemail", "emailaddress"]);
  const companyIndex = columnIndex(headers, ["company", "companyname", "organization"]);
  const roleIndex = columnIndex(headers, ["role", "title", "jobtitle"]);
  const locationIndex = columnIndex(headers, ["location", "city", "region"]);
  if (nameIndex < 0 || emailIndex < 0 || companyIndex < 0) throw new Error("CSV needs name, email, and company columns.");
  const records: LeadCsvRecord[] = [];
  const errors: LeadCsvError[] = [];
  for (const row of rows.slice(1, maxRows + 1)) {
    const read = (index: number) => index >= 0 ? row.values[index] || "" : "";
    const record = { line: row.line, name: read(nameIndex), email: read(emailIndex).toLowerCase(), company: read(companyIndex), role: read(roleIndex) || "Unknown", location: read(locationIndex) || "Unknown" };
    if (!record.name || !record.company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(record.email)) {
      errors.push({ line: row.line, reason: "name, company, and a valid email are required" });
      continue;
    }
    records.push(record);
  }
  if (rows.length - 1 > maxRows) errors.push({ line: rows[maxRows + 1]?.line || maxRows + 2, reason: `Only the first ${maxRows} rows were considered` });
  return { records, errors };
}
