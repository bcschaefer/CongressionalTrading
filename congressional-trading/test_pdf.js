const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

async function extractText() {
  const url = 'https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2022/10055565.pdf';
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    const loadingTask = pdfjsLib.getDocument({
      data,
      disableWorker: true,
      verbosity: 0
    });
    const pdf = await loadingTask.promise;
    
    let fullText = '';
    const numPages = Math.min(pdf.numPages, 2);
    
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += `--- Page ${i} ---\n` + pageText + '\n';
    }
    
    console.log('Extraction Succeeded:');
    console.log(fullText.substring(0, 500) + '...');
  } catch (error) {
    console.error('Error:', error);
  }
}

extractText();
