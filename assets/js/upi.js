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

/**
 * Draw a QR code as an SVG inside `host`. The library loads only when needed.
 * @param {HTMLElement} host
 * @param {string} text
 * @param {string} label accessible description, e.g. "QR code to pay ₹1,000 to Rahul"
 */
export async function renderQr(host, text, label) {
  const { default: qrcode } = await import('../vendor/qrcode-generator-2.0.4.mjs');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

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
