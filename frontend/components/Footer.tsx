export default function Footer() {
  return (
    <footer className="mt-16 border-t border-gray-200 bg-white">
      <div className="max-w-6xl mx-auto px-4 py-8 text-sm text-gray-500 flex flex-col sm:flex-row justify-between gap-3">
        <div>© {new Date().getFullYear()} Ranco Autoshop. Semua hak dilindungi.</div>
        <div className="flex gap-4">
          <span>Pembayaran via Midtrans</span>
          <span>Pengiriman via JNE / POS / TIKI</span>
        </div>
      </div>
    </footer>
  );
}
