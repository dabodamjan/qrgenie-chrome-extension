'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { classify } = require('../common/payload.js');

test('http and https links are openable urls', () => {
  const https = classify('https://qrgenie.app/path?a=1');
  assert.strictEqual(https.kind, 'url');
  assert.strictEqual(https.url, 'https://qrgenie.app/path?a=1');

  const http = classify('http://example.com');
  assert.strictEqual(http.kind, 'url');
  assert.strictEqual(http.url, 'http://example.com');

  const upper = classify('HTTPS://EXAMPLE.COM');
  assert.strictEqual(upper.kind, 'url');
});

test('non-web schemes never become openable urls', () => {
  for (const raw of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'chrome://settings',
    'ftp://example.com',
    'data:text/html,<b>hi</b>'
  ]) {
    const p = classify(raw);
    assert.strictEqual(p.url, undefined, raw + ' must not be openable');
  }
});

test('bare domains stay plain text, not links', () => {
  const p = classify('qrgenie.app/promo');
  assert.strictEqual(p.kind, 'text');
  assert.strictEqual(p.url, undefined);
});

test('whitespace is trimmed before classifying', () => {
  const p = classify('  https://qrgenie.app  ');
  assert.strictEqual(p.kind, 'url');
  assert.strictEqual(p.raw, 'https://qrgenie.app');
});

test('wifi payloads parse network, password and security', () => {
  const p = classify('WIFI:T:WPA;S:QRGenie Guest;P:decode1234;;');
  assert.strictEqual(p.kind, 'wifi');
  assert.deepStrictEqual(p.fields, [
    { name: 'Network', value: 'QRGenie Guest' },
    { name: 'Password', value: 'decode1234' },
    { name: 'Security', value: 'WPA' }
  ]);
});

test('wifi payloads honor backslash escapes', () => {
  const p = classify('WIFI:S:Caf\\;Net;P:pa\\\\ss;T:WPA2;;');
  assert.deepStrictEqual(p.fields[0], { name: 'Network', value: 'Caf;Net' });
  assert.deepStrictEqual(p.fields[1], { name: 'Password', value: 'pa\\ss' });
});

test('mailto payloads surface the address', () => {
  const p = classify('mailto:hello@qrgenie.app?subject=Hi');
  assert.strictEqual(p.kind, 'email');
  assert.deepStrictEqual(p.fields, [{ name: 'To', value: 'hello@qrgenie.app' }]);
});

test('matmsg payloads surface to, subject and body', () => {
  const p = classify('MATMSG:TO:a@b.c;SUB:Hello;BODY:See you;;');
  assert.strictEqual(p.kind, 'email');
  assert.deepStrictEqual(p.fields, [
    { name: 'To', value: 'a@b.c' },
    { name: 'Subject', value: 'Hello' },
    { name: 'Message', value: 'See you' }
  ]);
});

test('tel and sms payloads classify with numbers', () => {
  const tel = classify('tel:+385911234567');
  assert.strictEqual(tel.kind, 'phone');
  assert.deepStrictEqual(tel.fields, [{ name: 'Number', value: '+385911234567' }]);

  const sms = classify('SMSTO:+385911234567:Hi there');
  assert.strictEqual(sms.kind, 'sms');
  assert.deepStrictEqual(sms.fields, [{ name: 'Number', value: '+385911234567' }]);
});

test('geo payloads surface coordinates', () => {
  const p = classify('geo:45.815,15.982?z=12');
  assert.strictEqual(p.kind, 'geo');
  assert.deepStrictEqual(p.fields, [{ name: 'Coordinates', value: '45.815,15.982' }]);
});

test('vcard and mecard payloads classify as contacts', () => {
  const vcard = classify(
    'BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nTEL:+123456\nEMAIL:ada@example.com\nEND:VCARD'
  );
  assert.strictEqual(vcard.kind, 'contact');
  assert.deepStrictEqual(vcard.fields, [
    { name: 'Name', value: 'Ada Lovelace' },
    { name: 'Phone', value: '+123456' },
    { name: 'Email', value: 'ada@example.com' }
  ]);

  const mecard = classify('MECARD:N:Lovelace Ada;TEL:+123456;EMAIL:ada@example.com;;');
  assert.strictEqual(mecard.kind, 'contact');
  assert.strictEqual(mecard.fields[0].value, 'Lovelace Ada');
});

test('calendar events classify with the summary', () => {
  const p = classify('BEGIN:VEVENT\nSUMMARY:Launch day\nDTSTART:20260901\nEND:VEVENT');
  assert.strictEqual(p.kind, 'calendar');
  assert.deepStrictEqual(p.fields, [{ name: 'Event', value: 'Launch day' }]);
});

test('otpauth payloads get their own label without an openable url', () => {
  const p = classify('otpauth://totp/Example:me?secret=ABC');
  assert.strictEqual(p.kind, 'otp');
  assert.strictEqual(p.url, undefined);
});

test('anything else is plain text', () => {
  const p = classify('just some words');
  assert.strictEqual(p.kind, 'text');
  assert.strictEqual(p.label, 'Text');
  assert.strictEqual(p.raw, 'just some words');
});
