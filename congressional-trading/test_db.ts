import { prisma } from './lib/prisma';
async function main() {
  try {
    const d = await prisma.annual_financial_disclosures.findFirst({ 
      where: { bioguide: 'A000055' }, 
      orderBy: [{ filing_year: 'desc' }], 
      select: { doc_id: true, filing_year: true, filing_date: true, filing_type: true, source_url: true } 
    });
    console.log(JSON.stringify(d, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
