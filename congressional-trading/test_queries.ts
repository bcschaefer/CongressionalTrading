import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

async function main() {
  console.log("Query 1: Distinct Filing Types");
  const query1 = await prisma.$queryRaw`SELECT DISTINCT filing_type FROM annual_financial_disclosures ORDER BY filing_type`;
  console.log(JSON.stringify(query1, null, 2));

  console.log("\nQuery 2: Count by Filing Type");
  const query2 = await prisma.$queryRaw`SELECT filing_type, COUNT(*) as count FROM annual_financial_disclosures GROUP BY filing_type ORDER BY filing_type`;
  console.log(JSON.stringify(query2, null, 2));

  console.log("\nQuery 3: Tom Suozzi Disclosures");
  const query3 = await prisma.$queryRaw`SELECT id, doc_id, filing_year, filing_date, filing_type, bioguide FROM annual_financial_disclosures WHERE full_name ILIKE '%Suozzi%' ORDER BY filing_year DESC, filing_date DESC`;
  console.log(JSON.stringify(query3, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
