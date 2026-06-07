const _pid = (window.ENV && window.ENV.FIREBASE_PROJECT_ID) || "br3eze-africa-312df";
    const firebaseConfig = {
      apiKey: (window.ENV && window.ENV.FIREBASE_API_KEY) || "AIzaSyANPQZKsAV9VsW9vKZJ3ghhrpnkxuLfdP8",
      authDomain: `${_pid}.firebaseapp.com`,
      databaseURL: `https://${_pid}-default-rtdb.firebaseio.com`,
      projectId: _pid,
      storageBucket: `${_pid}.firebasestorage.app`,
      messagingSenderId: "123902078923",
      appId: "1:123902078923:web:1153a45add9fe25208504e",
      measurementId: "G-Y6YS53B86S"
    };
    if (firebaseConfig.projectId && !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

let html5QrCode = null;
    async function scanQRCode() {
      const readerDiv = document.getElementById('qr-reader');
      const input = document.getElementById('loginIdentifier'); // Target username/voucher input

      if (readerDiv.style.display === 'block') {
        if (html5QrCode) {
          try { await html5QrCode.stop(); } catch (e) { }
          html5QrCode.clear();
        }
        readerDiv.style.display = 'none';
        return;
      }

      readerDiv.style.display = 'block';
      if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("qr-reader");
      }

      const onScanSuccess = (decodedText) => {
        input.value = decodedText.trim().toUpperCase();
        if (window.showToast) showToast('✅ Scanned QR', 'success');
        html5QrCode.stop().then(() => {
          html5QrCode.clear();
          readerDiv.style.display = 'none';
        }).catch(() => { readerDiv.style.display = 'none'; });
      };

      const onScanFailure = (error) => { };

      try {
        await html5QrCode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          onScanSuccess,
          onScanFailure
        );
      } catch (err) {
        console.warn('QR Scanner Error:', err);
        if (window.showToast) showToast('Camera error or blocked', 'error');
        readerDiv.style.display = 'none';
      }
    }