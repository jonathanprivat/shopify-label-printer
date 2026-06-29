// Renders the sample label AND sends it to the configured printer.
// Usage: npm run test-print
import { renderLabelPdf, closeBrowser } from '../renderLabel.js';
import { printPdf } from '../print.js';

const sample = {
  orderId: 109348,
  orderName: '#109348',
  name: 'JOHN DOE',
  address1: '1234 DISCRETE BLVD, APT 5B',
  city: 'MIAMI',
  province: 'FL',
  zip: '33101',
  phone: '(305) 555-0198',
  driverNotes:
    'Gate Code: 4321. Instructions: Please leave package on the chair behind the side gate. Do not ring the doorbell.',
  route: 'A-12',
  pkg: 'PKG 1 OF 1',
  timestamp: new Date().toLocaleString(),
};

const path = await renderLabelPdf(sample, { suffix: '_testprint' });
console.log('Rendered:', path);
const { jobId } = await printPdf(path);
console.log('Printed. Job:', jobId);
await closeBrowser();
