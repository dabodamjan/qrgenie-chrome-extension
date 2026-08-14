/*
 * Classifies a decoded QR payload so the UI can label it and offer the right
 * actions. Loaded with importScripts() in the service worker and with
 * require() in the Node test suite, hence the UMD-ish wrapper.
 *
 * classify(raw) returns:
 *   {
 *     kind:  'url' | 'wifi' | 'email' | 'phone' | 'sms' | 'geo' |
 *            'contact' | 'calendar' | 'otp' | 'text',
 *     label: human-readable label for the kind,
 *     raw:   the trimmed payload,
 *     url:   present only for http/https links (safe to open in a tab),
 *     fields: [{ name, value }] extra parsed details (wifi, contact, ...)
 *   }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QRGeniePayload = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Splits "KEY:value;KEY:value;;" segments used by WIFI:, MECARD: and
  // MATMSG: payloads. Values may escape ; \ , : with a backslash.
  function parseSegments(body) {
    const fields = {};
    let key = '';
    let value = '';
    let inValue = false;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === '\\' && inValue && i + 1 < body.length) {
        value += body[++i];
      } else if (!inValue && ch === ':') {
        inValue = true;
      } else if (inValue && ch === ';') {
        if (key) fields[key.toUpperCase()] = value;
        key = '';
        value = '';
        inValue = false;
      } else if (inValue) {
        value += ch;
      } else {
        key += ch;
      }
    }
    if (key && inValue) fields[key.toUpperCase()] = value;
    return fields;
  }

  function classify(input) {
    const raw = String(input == null ? '' : input).trim();
    const lower = raw.toLowerCase();

    if (/^https?:\/\/\S+$/i.test(raw)) {
      return { kind: 'url', label: 'Link', raw, url: raw, fields: [] };
    }

    if (lower.startsWith('wifi:')) {
      const f = parseSegments(raw.slice(5));
      const fields = [];
      if (f.S) fields.push({ name: 'Network', value: f.S });
      if (f.P) fields.push({ name: 'Password', value: f.P });
      if (f.T) fields.push({ name: 'Security', value: f.T });
      return { kind: 'wifi', label: 'Wi-Fi network', raw, fields };
    }

    if (lower.startsWith('mailto:')) {
      const rest = raw.slice(7);
      const q = rest.indexOf('?');
      const addr = q === -1 ? rest : rest.slice(0, q);
      const fields = addr ? [{ name: 'To', value: decodeURIComponent(addr) }] : [];
      return { kind: 'email', label: 'Email address', raw, fields };
    }

    if (lower.startsWith('matmsg:')) {
      const f = parseSegments(raw.slice(7));
      const fields = [];
      if (f.TO) fields.push({ name: 'To', value: f.TO });
      if (f.SUB) fields.push({ name: 'Subject', value: f.SUB });
      if (f.BODY) fields.push({ name: 'Message', value: f.BODY });
      return { kind: 'email', label: 'Email message', raw, fields };
    }

    if (lower.startsWith('tel:')) {
      return {
        kind: 'phone',
        label: 'Phone number',
        raw,
        fields: [{ name: 'Number', value: raw.slice(4) }]
      };
    }

    if (lower.startsWith('sms:') || lower.startsWith('smsto:')) {
      const rest = raw.slice(raw.indexOf(':') + 1);
      const parts = rest.split(/[:?]/);
      const fields = [];
      if (parts[0]) fields.push({ name: 'Number', value: parts[0] });
      return { kind: 'sms', label: 'Text message', raw, fields };
    }

    if (lower.startsWith('geo:')) {
      const coords = raw.slice(4).split('?')[0];
      return {
        kind: 'geo',
        label: 'Location',
        raw,
        fields: coords ? [{ name: 'Coordinates', value: coords }] : []
      };
    }

    if (lower.startsWith('begin:vcard') || lower.startsWith('mecard:')) {
      const fields = [];
      if (lower.startsWith('mecard:')) {
        const f = parseSegments(raw.slice(7));
        if (f.N) fields.push({ name: 'Name', value: f.N });
        if (f.TEL) fields.push({ name: 'Phone', value: f.TEL });
        if (f.EMAIL) fields.push({ name: 'Email', value: f.EMAIL });
      } else {
        const fn = raw.match(/^FN[^:]*:(.+)$/im);
        const tel = raw.match(/^TEL[^:]*:(.+)$/im);
        const email = raw.match(/^EMAIL[^:]*:(.+)$/im);
        if (fn) fields.push({ name: 'Name', value: fn[1].trim() });
        if (tel) fields.push({ name: 'Phone', value: tel[1].trim() });
        if (email) fields.push({ name: 'Email', value: email[1].trim() });
      }
      return { kind: 'contact', label: 'Contact card', raw, fields };
    }

    if (lower.startsWith('begin:vevent') || lower.includes('begin:vevent')) {
      const summary = raw.match(/^SUMMARY[^:]*:(.+)$/im);
      return {
        kind: 'calendar',
        label: 'Calendar event',
        raw,
        fields: summary ? [{ name: 'Event', value: summary[1].trim() }] : []
      };
    }

    if (lower.startsWith('otpauth://')) {
      return { kind: 'otp', label: 'Authenticator setup', raw, fields: [] };
    }

    return { kind: 'text', label: 'Text', raw, fields: [] };
  }

  return { classify };
});
