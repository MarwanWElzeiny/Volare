function showToast(title, message, duration = 6000) {
    const toastContainer = document.getElementById('toast-overlay');

    // Create the toast element.
    // title may contain trusted icon markup from callers; message is set as text (no HTML injection).
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <i class="fa-solid fa-xmark closetoast"></i>
        <div class="vlr-flex-toast"><h1>${title}</h1></div>
        <span></span>
    `;
    toast.querySelector('span').textContent = message;

    // Append to container
    toastContainer.appendChild(toast);
    void toast.offsetWidth;

    // Show after slight delay
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    // Manual close handler
    toast.querySelector('.closetoast').addEventListener('click', () => hideToast(toast));

    // Drag-right-to-dismiss (each toast independent)
    let _tx = 0, _dragging = false;
    toast.addEventListener('pointerdown', (e) => {
      _tx = e.clientX;
      _dragging = true;
      toast.setPointerCapture(e.pointerId);
    });
    toast.addEventListener('pointermove', (e) => {
      if (!_dragging) return;
      const dx = e.clientX - _tx;
      if (dx > 0) toast.style.transform = `translateX(${dx}px)`;
    });
    toast.addEventListener('pointerup', (e) => {
      if (!_dragging) return;
      _dragging = false;
      const dx = e.clientX - _tx;
      toast.style.transform = '';
      if (dx >= 50) hideToast(toast);
    });

    // Auto-hide after duration
    setTimeout(() => hideToast(toast), duration);
}

function hideToast(toast) {
    toast.classList.remove('show');
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 500); // Sync with CSS transition
}

export default showToast;
