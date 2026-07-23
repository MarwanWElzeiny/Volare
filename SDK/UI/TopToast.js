let toastElement = null;
let toastTimeout = null;
let toastCounter = 0;
let activeToastId = null;

function showTopToast(title, message, duration = null) {
  if (!toastElement) {
    toastElement = document.createElement('div');
    toastElement.className = 'top-toast';
    toastElement.innerHTML = `
      <i class="fa-solid fa-xmark closetoast"></i>
      <h1></h1>
      <span></span>
    `;
    document.body.appendChild(toastElement);

    toastElement.querySelector(".closetoast").addEventListener("click", () => {
      toastElement.classList.remove("top-toast-show");
      clearTimeout(toastTimeout);
      activeToastId = null;
    });

    // Drag-up-to-dismiss
    let _ty = 0, _dragging = false;
    toastElement.addEventListener('pointerdown', (e) => {
      _ty = e.clientY;
      _dragging = true;
      toastElement.setPointerCapture(e.pointerId);
    });
    toastElement.addEventListener('pointermove', (e) => {
      if (!_dragging) return;
      const dy = _ty - e.clientY;
      if (dy > 0) toastElement.style.transform = `translateY(${-dy}px)`;
    });
    toastElement.addEventListener('pointerup', (e) => {
      if (!_dragging) return;
      _dragging = false;
      const dy = _ty - e.clientY;
      toastElement.style.transform = '';
      if (dy >= 40) {
        toastElement.classList.remove('top-toast-show');
        clearTimeout(toastTimeout);
        activeToastId = null;
      }
    });
  }

  toastElement.querySelector("h1").textContent = title;
  toastElement.querySelector("span").textContent = message;
  toastElement.classList.add("top-toast-show");

  clearTimeout(toastTimeout);
  const id = ++toastCounter;
  activeToastId = id;

  if (duration != null) {
    toastTimeout = setTimeout(() => {
      if (activeToastId === id) {
        toastElement.classList.remove("top-toast-show");
        activeToastId = null;
      }
    }, duration);
  }

  return id;
}

function hideTopToast(handle) {
  if (!toastElement) return;
  if (handle != null && handle !== activeToastId) return;
  toastElement.classList.remove("top-toast-show");
  clearTimeout(toastTimeout);
  activeToastId = null;
}

export { showTopToast };
export { hideTopToast };