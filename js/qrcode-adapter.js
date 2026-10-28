(function () {
  function toCanvas(canvas, text, options, callback) {
    try {
      const settings = options || {};
      const qr = qrcode(0, settings.errorCorrectionLevel || "M");
      qr.addData(text, "Byte");
      qr.make();

      const size = settings.width || 240;
      const margin = (settings.margin || 2) * (size / (qr.getModuleCount() + (settings.margin || 2) * 2));
      const moduleSize = (size - margin * 2) / qr.getModuleCount();
      const context = canvas.getContext("2d");
      canvas.width = size;
      canvas.height = size;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size, size);
      context.fillStyle = "#000000";

      for (let row = 0; row < qr.getModuleCount(); row += 1) {
        for (let column = 0; column < qr.getModuleCount(); column += 1) {
          if (qr.isDark(row, column)) {
            context.fillRect(
              Math.round(margin + column * moduleSize),
              Math.round(margin + row * moduleSize),
              Math.ceil(moduleSize),
              Math.ceil(moduleSize),
            );
          }
        }
      }

      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  globalThis.QRCode = { toCanvas };
})();
