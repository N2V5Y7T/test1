/**
 * The Nines - CSV to Menu JSON Converter
 *
 * Usage: node scripts/csv-to-menu.js <input.csv> <output.json>
 *
 * Expected CSV columns (headers must match):
 * Group, Section, Subgroup, ID, Name, Description, Price, Diet, Options
 *
 * - Options should be formatted as "Label:Price|Label:Price" (e.g. "Veg:329|Chicken:369")
 */

import fs from 'fs';
import path from 'path';

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: node csv-to-menu.js <input.csv> <output.json>");
  process.exit(1);
}

const inputPath = path.resolve(args[0]);
const outputPath = path.resolve(args[1]);

if (!fs.existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

const content = fs.readFileSync(inputPath, 'utf-8');
const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());

const data = {
  brand: { name: "The Nines", logo: null },
  currency: { code: "INR", symbol: "₹", locale: "en-IN" },
  groups: []
};

const groupMap = new Map();
const sectionMap = new Map();
const subgroupMap = new Map();

for (let i = 1; i < lines.length; i++) {
  const values = parseCSVLine(lines[i]);
  const row = Object.create(null);
  headers.forEach((h, idx) => {
    row[h] = values[idx] || '';
  });

  if (!row.name && !row.group) continue;

  // 1. Group
  const groupKey = row.group.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!groupMap.has(groupKey)) {
    const newGroup = {
      key: groupKey,
      label: row.group,
      video: groupKey === 'food' ? `${groupKey}.mp4` : null,
      sections: []
    };
    data.groups.push(newGroup);
    groupMap.set(groupKey, newGroup);
  }
  const group = groupMap.get(groupKey);

  // 2. Section
  if (!row.section) continue;
  const sectionKey = row.section.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!sectionMap.has(sectionKey)) {
    const newSection = {
      key: sectionKey,
      label: row.section,
      video: `${sectionKey}.mp4`,
      holdFrame: null,
      scrubLengthVh: 140
    };
    group.sections.push(newSection);
    sectionMap.set(sectionKey, newSection);
  }
  const section = sectionMap.get(sectionKey);

  // 3. Subgroup (optional) — uses subHeader to match schema
  let parentList = null;
  if (row.subgroup) {
    const subgroupKey = `${sectionKey}-${row.subgroup.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    if (!section.subgroups) section.subgroups = [];

    let subgroup = subgroupMap.get(subgroupKey);
    if (!subgroup) {
      subgroup = { subHeader: row.subgroup, items: [] };
      section.subgroups.push(subgroup);
      subgroupMap.set(subgroupKey, subgroup);
    }
    parentList = subgroup.items;
  } else {
    if (!section.items) section.items = [];
    parentList = section.items;
  }

  // 4. Item
  if (!row.name) continue;

  const item = {
    id: row.id || row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name: row.name
  };

  if (row.description) item.desc = row.description;
  if (row.diet) item.diet = row.diet.toLowerCase();

  if (row.options) {
    item.options = row.options.split('|').map(opt => {
      const [label, priceStr] = opt.split(':');
      return { label: label.trim(), price: parseFloat(priceStr) || priceStr.trim() };
    });
  } else if (row.price) {
    const p = parseFloat(row.price);
    item.price = isNaN(p) ? row.price : p;
  }

  parentList.push(item);
}

fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
console.log(`Successfully converted ${lines.length - 1} items to ${outputPath}`);
