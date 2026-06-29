// Renders a sample label to a PDF (no printing). Verifies the template +
// Puppeteer pipeline. Usage: npm run test-render
import { renderLabelPdf, closeBrowser } from '../renderLabel.js';

const sample = {
  orderId: 109348,
  orderName: '#109348',
  name: 'JOHN DOE',
  address1: '1234 DISCRETE BLVD, APT 5B',
  address2: '',
  city: 'MIAMI',
  province: 'FL',
  zip: '33101',
  country: 'United States',
  phone: '(305) 555-0198',
  driverNotes:
    'Gate Code: 4321. Instructions: Please leave package on the chair behind the side gate. Do not ring the doorbell.',
  route: 'A-12',
  pkg: 'PKG 1 OF 1',
  timestamp: '07/15/2024 14:32 EST',
};

const path = await renderLabelPdf(sample, { suffix: '_sample' });
console.log('Sample label written to:', path);
await closeBrowser();
