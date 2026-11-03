(function () {
  const api = window.tarkovAPI;
  const root = document.getElementById('lb-root');
  const img = document.getElementById('lb-img');
  const caption = document.getElementById('lb-caption');
  const counter = document.getElementById('lb-counter');
  const thumbs = document.getElementById('lb-thumbs');
  const btnPrev = document.getElementById('lb-prev');
  const btnNext = document.getElementById('lb-next');

  let photos = [];
  let index = 0;
  let title = '';

  function render() {
    if (photos.length === 0) return;
    const cur = photos[index];
    img.src = cur.src;

    const parts = [];
    if (title) parts.push(title);
    if (cur.caption) parts.push(cur.caption);
    caption.textContent = parts.join(' • ');

    const multi = photos.length > 1;
    btnPrev.classList.toggle('hidden', !multi);
    btnNext.classList.toggle('hidden', !multi);
    counter.classList.toggle('hidden', !multi);
    counter.textContent = multi ? `📷 ${index + 1} / ${photos.length}` : '';

    thumbs.querySelectorAll('.lb-thumb').forEach((el, i) => el.classList.toggle('active', i === index));
  }

  function buildThumbs() {
    thumbs.textContent = '';
    if (photos.length < 2) return;
    photos.forEach((p, i) => {
      const t = document.createElement('div');
      t.className = 'lb-thumb';
      t.title = p.caption || `${i + 1}. görsel`;
      const ti = document.createElement('img');
      ti.src = p.src;
      ti.alt = '';
      t.appendChild(ti);
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        index = i;
        render();
      });
      thumbs.appendChild(t);
    });
  }

  function go(delta) {
    if (photos.length <= 1) return;
    index = (index + delta + photos.length) % photos.length;
    render();
  }

  function show(payload) {
    photos = Array.isArray(payload?.photos) ? payload.photos : [];
    index = Number.isInteger(payload?.index) ? payload.index : 0;
    title = payload?.title || '';
    if (photos.length === 0) return;
    buildThumbs();
    render();
    // Animasyonu her açılışta yeniden başlat
    root.classList.add('hidden');
    void root.offsetWidth;
    root.classList.remove('hidden');
  }

  function hide() {
    root.classList.add('hidden');
    img.removeAttribute('src');
    thumbs.textContent = '';
    photos = [];
  }

  function requestClose() {
    hide();
    api.closeLightboxWindow();
  }

  document.getElementById('lb-backdrop').addEventListener('click', requestClose);
  document.getElementById('lb-close').addEventListener('click', (e) => {
    e.stopPropagation();
    requestClose();
  });
  btnPrev.addEventListener('click', (e) => {
    e.stopPropagation();
    go(-1);
  });
  btnNext.addEventListener('click', (e) => {
    e.stopPropagation();
    go(1);
  });
  img.addEventListener('click', (e) => e.stopPropagation());

  window.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.deltaY > 0) go(1);
      else if (e.deltaY < 0) go(-1);
    },
    { passive: false }
  );

  // Pencere odaklanabilir olursa diye klavye desteği (normalde tuşlar ana süreçten gelir)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') requestClose();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  });

  api.onLightboxShow(show);
  api.onLightboxHide(hide);
  api.onLightboxNav((action) => {
    if (action === 'prev') go(-1);
    else if (action === 'next') go(1);
  });
})();
