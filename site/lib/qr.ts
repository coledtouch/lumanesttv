// QR codes the TV apps draw themselves: the pairing code (lib/pairing.ts) and the trailer link (lib/extras-service.ts).
import qrcode from 'qrcode-generator';

/** QR modules as rows of "0"/"1" (dark), with no quiet zone, so each app draws it without its own QR encoder. */
export function qrRows(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount(), rows: string[] = [];
  for (let r = 0; r < size; r++) {let row = ''; for (let c = 0; c < size; c++) row += qr.isDark(r, c) ? '1' : '0'; rows.push(row);}
  return rows;
}
