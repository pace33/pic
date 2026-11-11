import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readRecoveryLink, validateRecoveryPackage, decryptRecoveryPackage } from '../7/recovery-core.mjs';

const bytes = Buffer.from('test-only image byte fixture');
const digest = createHash('sha256').update(bytes).digest('hex');
const photo = {id:`recovered-pic7-${digest}`, title:'복구한 촬영 원본 1', fileName:'recovered-original-1.jpg', createdAt:'2026-10-29T05:24:18.643Z', dataUrl:`data:image/jpeg;base64,${bytes.toString('base64')}`, sha256:digest};
const bundle = {version:1, kind:'pic7-original-recovery', photos:[photo]};

test('requires an exact unguessable bundle id and 256-bit fragment key', () => {
 assert.equal(readRecoveryLink(`#bundle=${'a'.repeat(32)}&key=${'A'.repeat(43)}`).bundleId,'a'.repeat(32));
 for (const hash of ['', '#bundle=../../secret&key=x', `#bundle=${'a'.repeat(32)}&key=bad`]) assert.throws(()=>readRecoveryLink(hash));
});
test('preserves original bytes, date and deterministic id', async () => {
 const [restored] = await validateRecoveryPackage(bundle);
 assert.deepEqual(restored, {...photo, recoveryKind:'original'});
});
test('rejects damaged bytes, duplicate ids, unknown package and invalid dates', async () => {
 for (const item of [ {...bundle,photos:[{...photo,dataUrl:'data:image/jpeg;base64,YmFk'}]}, {...bundle,photos:[photo,photo]}, {...bundle,kind:'other'}, {...bundle,photos:[{...photo,createdAt:'not-a-date'}]}, {...bundle,photos:[{...photo,id:'existing-user-photo'}]} ]) await assert.rejects(validateRecoveryPackage(item));
});
test('decrypts authenticated package; wrong key or tampered ciphertext fails', async () => {
 const keyBytes = webcrypto.getRandomValues(new Uint8Array(32));
 const iv = webcrypto.getRandomValues(new Uint8Array(12));
 const key = await webcrypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['encrypt']);
 const encrypted = await webcrypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('pic7-gallery-recovery-v1')},key,new TextEncoder().encode(JSON.stringify(bundle)));
 const blob = new Uint8Array(12+encrypted.byteLength);blob.set(iv);blob.set(new Uint8Array(encrypted),12);
 const encoded = Buffer.from(keyBytes).toString('base64url');
 assert.deepEqual(await decryptRecoveryPackage(blob,encoded),bundle);
 const bad = blob.slice();bad[20]^=1;await assert.rejects(decryptRecoveryPackage(bad,encoded));
 await assert.rejects(decryptRecoveryPackage(blob,'A'.repeat(43)));
});
