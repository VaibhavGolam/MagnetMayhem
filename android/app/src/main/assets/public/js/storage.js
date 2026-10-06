'use strict';
// Tiny localStorage wrapper. Everything is namespaced with "mm_".
const Store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('mm_' + k);
      return v === null ? d : JSON.parse(v);
    } catch (e) { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('mm_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ }
  }
};
