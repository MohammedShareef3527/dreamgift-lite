/**
 * upi.js — UPI payment links and QR codes. The app never touches money:
 * these only open the friend's own UPI app, pointed at the organiser's UPI ID.
 */

const NOTE_MAX = 40; // some UPI apps reject long notes

/**
 * Paise as the decimal string UPI expects: 50000 → "500.00".
 * @param {number} paise
 * @returns {string}
 */
export function upiAmount(paise) {
  const value = Math.round(Number(paise));
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

/**
 * Build a upi://pay link.
 * @param {{ upi: string, name: string, amountPaise: number, note?: string }} details
 * @returns {string}
 */
export function buildUpiLink({ upi, name, amountPaise, note = '' }) {
  const params = new URLSearchParams({
    pa: upi.trim(),
    pn: name.trim(),
    am: upiAmount(amountPaise),
    cu: 'INR',
  });
  const shortNote = [...note.trim()].slice(0, NOTE_MAX).join('');
  if (shortNote) params.set('tn', shortNote);
  // URLSearchParams writes spaces as "+", which several UPI apps show literally.
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

/**
 * UPI deep links work reliably only on Android. iOS and desktop get a QR code.
 * @param {string} [userAgent]
 * @returns {boolean}
 */
export function canOpenUpiLink(userAgent = navigator.userAgent) {
  return /android/i.test(userAgent);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Build the QR matrix; the library is loaded on first use. */
async function makeQr(text) {
  const { default: qrcode } = await import('../vendor/qrcode-generator-2.0.4.mjs');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr;
}

/**
 * Draw a QR code as an SVG inside `host`. The library loads only when needed.
 * @param {HTMLElement} host
 * @param {string} text
 * @param {string} label accessible description, e.g. "QR code to pay ₹1,000 to Rahul"
 */
export async function renderQr(host, text, label) {
  const qr = await makeQr(text);

  const count = qr.getModuleCount();
  const quiet = 4;
  const size = count + quiet * 2;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');

  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('width', String(size));
  background.setAttribute('height', String(size));
  background.setAttribute('fill', '#FFFFFF');
  svg.append(background);

  // One path for all dark modules keeps the SVG small.
  let d = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#2A2320');
  svg.append(path);

  host.replaceChildren(svg);
}

/**
 * A QR code as a PNG file, with a caption underneath, for organisers to print or share.
 * @param {string} text what the QR code opens
 * @param {string} caption e.g. "Chip in for Ananya & Rohan"
 * @returns {Promise<Blob>}
 */
export async function qrPng(text, caption) {
  const qr = await makeQr(text);
  const count = qr.getModuleCount();
  const cell = Math.max(8, Math.floor(720 / count));
  const quiet = cell * 4;
  const side = count * cell + quiet * 2;
  const captionHeight = caption ? 96 : 0;

  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side + captionHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#2A2320';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) ctx.fillRect(quiet + col * cell, quiet + row * cell, cell, cell);
    }
  }
  if (caption) {
    ctx.fillStyle = '#6B1E2E';
    ctx.font = '600 36px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(caption, side / 2, side + 40, side - quiet * 2);
    ctx.fillStyle = '#6E625A';
    ctx.font = '24px Inter, system-ui, sans-serif';
    ctx.fillText('Scan to chip in and leave a blessing', side / 2, side + 78, side - quiet * 2);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG_FAILED'))), 'image/png');
  });
}
