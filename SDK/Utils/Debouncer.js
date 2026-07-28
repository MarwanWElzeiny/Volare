class Debouncer {
  constructor(func, delay = 300) {
    this.func = func;
    this.delay = delay;
    this.timeoutId = null;
  }

  call(...args) {
    clearTimeout(this.timeoutId);
    this.timeoutId = setTimeout(() => {
      this.func.apply(this, args);
    }, this.delay);
  }
}
export default Debouncer;