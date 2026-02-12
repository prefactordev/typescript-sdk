import { JSX } from 'typedoc';

export function buildSearchShortcutScript() {
  return `(() => {
  const SEARCH_DIALOG_ID = 'tsd-search';
  const SEARCH_INPUT_ID = 'tsd-search-input';
  const SEARCH_TRIGGER_ID = 'tsd-search-trigger';

  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    if (target.isContentEditable) {
      return true;
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return true;
    }

    return false;
  }

  function openAndFocusSearch() {
    const searchInput = document.getElementById(SEARCH_INPUT_ID);
    const searchDialog = document.getElementById(SEARCH_DIALOG_ID);
    const searchTrigger = document.getElementById(SEARCH_TRIGGER_ID);

    if (!(searchInput instanceof HTMLInputElement)) {
      return;
    }

    if (searchDialog instanceof HTMLDialogElement && !searchDialog.open) {
      try {
        searchDialog.showModal();
      } catch {
        if (searchTrigger instanceof HTMLElement) {
          searchTrigger.click();
        }
      }
    }

    requestAnimationFrame(() => {
      searchInput.focus();
      searchInput.select();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing) {
      return;
    }

    if (event.key.toLowerCase() !== 'k') {
      return;
    }

    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
      return;
    }

    if (isEditableTarget(event.target)) {
      return;
    }

    event.preventDefault();
    openAndFocusSearch();
  });
})();`;
}

export function load(app) {
  app.renderer.hooks.on('head.end', () => {
    return JSX.createElement('script', null, JSX.createElement(JSX.Raw, {
      html: buildSearchShortcutScript(),
    }));
  });
}
