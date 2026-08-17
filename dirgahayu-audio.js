/* ===== LAGU 17 AGUSTUS - TETAP LANJUT WALAU PINDAH HALAMAN =====
   Pasang <script src="dirgahayu-audio.js"></script> di halaman manapun
   yang perlu lagu ini tetap lanjut (dashboard.html, welcome.html, dst).
   Lagu otomatis berhenti sendiri kalau: sudah selesai, atau user
   keluar dari website (halaman tanpa script ini tidak akan meneruskan lagu). */
(function () {
  var now = new Date();
  var isTanggal17Agustus = (now.getMonth() === 7 && now.getDate() === 17); // Agustus = index 7

  var params = new URLSearchParams(window.location.search);
  var paksaTampil =
    params.get('dirgahayu') === '1' ||
    params.get('promo') === 'dirgahayu17' ||
    params.get('promo') === 'dirgahayu17-test';

  if (!isTanggal17Agustus && !paksaTampil) return;

  var todayKey = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();
  var storedDay = localStorage.getItem('dirgahayuAudioDay');

  // Kalau beda hari dari sesi sebelumnya, reset progress lagu
  if (storedDay !== todayKey) {
    localStorage.removeItem('dirgahayuAudioStart');
    localStorage.setItem('dirgahayuAudioDay', todayKey);
  }

  var startTs = localStorage.getItem('dirgahayuAudioStart');

  var audio = new Audio(encodeURI('Cokelat - Hari Merdeka.mp3'));
  audio.volume = 0.8;
  window._dirgahayuAudio = audio;

  function mulaiUlangDariAwal() {
    localStorage.setItem('dirgahayuAudioStart', Date.now().toString());
    audio.play().catch(function () {});
  }

  function lanjutkanDariDetik(elapsedSec) {
    function setAndPlay() {
      if (elapsedSec > 0 && audio.duration && elapsedSec < audio.duration) {
        audio.currentTime = elapsedSec;
      }
      audio.play().catch(function () {});
    }
    if (audio.readyState >= 1) setAndPlay();
    else audio.addEventListener('loadedmetadata', setAndPlay, { once: true });
  }

  audio.addEventListener('ended', function () {
    localStorage.removeItem('dirgahayuAudioStart');
  });

  if (!startTs) {
    mulaiUlangDariAwal();
  } else {
    var elapsed = (Date.now() - parseInt(startTs, 10)) / 1000;
    audio.addEventListener(
      'loadedmetadata',
      function () {
        if (audio.duration && elapsed >= audio.duration) {
          // Lagu sudah kelar di halaman sebelumnya, tidak usah diputar ulang
          localStorage.removeItem('dirgahayuAudioStart');
          return;
        }
        lanjutkanDariDetik(elapsed);
      },
      { once: true }
    );
  }

  // Jaga-jaga kalau browser blokir autoplay bersuara: coba lagi begitu user sentuh layar
  function cobaLagiKalauKepause() {
    if (audio.paused) audio.play().catch(function () {});
  }
  document.addEventListener('click', cobaLagiKalauKepause, { once: true });
  document.addEventListener('touchstart', cobaLagiKalauKepause, { once: true });
})();
