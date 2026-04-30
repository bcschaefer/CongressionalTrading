#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv/config');

const {
  SENATE_BASE_URL,
  isLikelyAnnualTitle,
  parseReportRow,
  createSenateSession,
  fetchAllReportRows,
  buildMemberIndex,
  resolveBioguideForName,
  createPrismaClient,
} = require('./senate-efd-common');

function parseArgs(argv) {
  const args = {
    startDate: '01/01/2012',
    endDate: new Date().toISOString().slice(0, 10),
    pageSize: 100,
  };

  const mmddyyyy = (isoDate) => {
    const [yyyy, mm, dd] = isoDate.split('-');
    return `${mm}/${dd}/${yyyy}`;
  };

  args.endDate = mmddyyyy(args.endDate);

  for (const arg of argv) {
    if (arg.startsWith('--start-date=')) {
      args.startDate = arg.split('=')[1];
    } else if (arg.startsWith('--end-date=')) {
      args.endDate = arg.split('=')[1];
    } else if (arg.startsWith('--page-size=')) {
      const n = Number(arg.split('=')[1]);
      if (Number.isFinite(n) && n > 0) args.pageSize = n;
    }
  }

  return args;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = await createPrismaClient();

  try {
    console.log(`Starting Senate annual sync (${args.startDate} -> ${args.endDate})...`);

    const session = await createSenateSession();
    const rows = await fetchAllReportRows(session, {
      startDate: args.startDate,
      endDate: args.endDate,
      pageSize: args.pageSize,
      filerTypes: [4],
      reportTypes: [],
    });

    const parsedReports = rows
      .map((r) => parseReportRow(r))
      .filter((r) => r.reportId && r.reportPath && r.reportTitle)
      .filter((r) => r.officeText && /senator/i.test(r.officeText));

    const annualReports = parsedReports.filter((r) => isLikelyAnnualTitle(r.reportTitle));

    const members = await prisma.members.findMany({
      select: { bioguide: true, full_name: true },
    });
    const memberIndex = buildMemberIndex(members);

    let discovered = 0;
    let upserted = 0;
    let unresolved = 0;

    const seen = new Set();

    for (const report of annualReports) {
      const reportId = report.reportId;
      if (!reportId || seen.has(reportId)) continue;
      seen.add(reportId);

      discovered += 1;

      const bioguide = resolveBioguideForName(report.firstName, report.lastName, memberIndex);
      if (!bioguide) unresolved += 1;

      const filingYear = report.filedDateIso ? Number(report.filedDateIso.slice(0, 4)) : new Date().getUTCFullYear();

      const sourceUrl = `${SENATE_BASE_URL}${report.reportPath}`;
      await prisma.annual_financial_disclosures.upsert({
        where: { doc_id: reportId },
        update: {
          bioguide,
          first_name: report.firstName,
          last_name: report.lastName,
          full_name: `${report.firstName ?? ''} ${report.lastName ?? ''}`.trim() || (report.officeText ?? report.reportTitle),
          state_district: null,
          filing_type: 'SENATE_ANNUAL',
          filing_year: filingYear,
          filing_date: report.filedDateIso,
          source_url: sourceUrl,
        },
        create: {
          doc_id: reportId,
          bioguide,
          first_name: report.firstName,
          last_name: report.lastName,
          full_name: `${report.firstName ?? ''} ${report.lastName ?? ''}`.trim() || (report.officeText ?? report.reportTitle),
          state_district: null,
          filing_type: 'SENATE_ANNUAL',
          filing_year: filingYear,
          filing_date: report.filedDateIso,
          source_url: sourceUrl,
        },
      });

      upserted += 1;
    }

    console.log(`Senate annual sync complete. discovered=${discovered}, upserted=${upserted}, unresolved_members=${unresolved}`);
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error('Senate annual sync failed:', error);
  process.exit(1);
});
