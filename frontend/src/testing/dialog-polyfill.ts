/**
 * jsdom (as used by the Vitest-based unit-test builder) does not implement
 * `HTMLDialogElement.showModal()`/`close()` - see
 * https://github.com/jsdom/jsdom/issues/3294. Every modal and the mobile
 * nav drawer are built on native `<dialog>` (see
 * shared/ui/modal/modal.ts), so without this polyfill any spec that opens
 * one fails with "showModal is not a function" rather than testing real
 * component behavior.
 *
 * Registered as a global Vitest setup file - see the `test.options.setupFiles`
 * entry in angular.json - so individual specs don't need to import it.
 */
declare global {
  interface HTMLDialogElement {
    showModal(): void;
    close(returnValue?: string): void;
  }
}

if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void {
    this.setAttribute('open', '');
  };

  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement): void {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

export {};
