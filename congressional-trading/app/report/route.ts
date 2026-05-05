import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

export async function GET() {
  const reportPath = path.join(process.cwd(), 'Congressional Trading Analysis.pdf');
  const report = await readFile(reportPath);

  return new Response(report, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="Congressional Trading Analysis.pdf"',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
