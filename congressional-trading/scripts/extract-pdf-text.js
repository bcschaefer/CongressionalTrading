#!/usr/bin/env node

const pdfParse = require('pdf-parse');

async function main() {
  const url = process.argv[2];
  if (!url) {
    process.stdout.write(JSON.stringify({ error: 'Missing PDF URL argument' }));
    process.exit(1);
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      process.stdout.write(JSON.stringify({ error: `PDF unavailable: ${response.status}` }));
      process.exit(1);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const result = await pdfParse(buffer);

    process.stdout.write(JSON.stringify({ text: result.text ?? '' }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  }
}

main();
