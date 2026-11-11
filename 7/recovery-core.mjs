const PACKAGE_AAD = new TextEncoder().encode('pic7-gallery-recovery-v1');
const MAX_PACKAGE_BYTES = 24 * 1024 * 1024;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

function decodeBase64(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

export function readRecoveryLink(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const bundleId = params.get('bundle') || '';
  const key = params.get('key') || '';
  if (!/^[a-f0-9]{32}$/.test(bundleId) || !/^[A-Za-z0-9_-]{43}$/.test(key) || decodeBase64(key).length !== 32) {
    throw new Error('올바른 사진 복구 링크로 다시 열어 주세요.');
  }
  return { bundleId, key };
}

export async function decryptRecoveryPackage(encrypted, encodedKey) {
  const bytes = new Uint8Array(encrypted);
  if (bytes.length < 29 || bytes.length > MAX_PACKAGE_BYTES) throw new Error('복구 파일 크기를 확인할 수 없어요.');
  const key = await crypto.subtle.importKey('raw', decodeBase64(encodedKey), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: PACKAGE_AAD }, key, bytes.slice(12));
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function validateRecoveryPackage(bundle) {
  if (bundle?.version !== 1 || bundle.kind !== 'pic7-original-recovery' || !Array.isArray(bundle.photos) || !bundle.photos.length || bundle.photos.length > 20) {
    throw new Error('올바른 사진 복구 파일이 아니에요.');
  }
  const ids = new Set();
  const photos = [];
  let totalBytes = 0;
  for (const photo of bundle.photos) {
    const match = typeof photo.dataUrl === 'string' && photo.dataUrl.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || match[2].length > MAX_PHOTO_BYTES * 1.4 || !/^[a-f0-9]{64}$/.test(photo.sha256 || '')) throw new Error('복구 사진을 확인할 수 없어요.');
    const bytes = decodeBase64(match[2]);
    totalBytes += bytes.length;
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (digest !== photo.sha256 || photo.id !== `recovered-pic7-${digest}` || ids.has(photo.id) || totalBytes > MAX_PACKAGE_BYTES || !Number.isFinite(Date.parse(photo.createdAt))) {
      throw new Error('복구 사진의 원본 검증에 실패했어요. 기존 보관함은 변경하지 않았어요.');
    }
    ids.add(photo.id);
    photos.push({
      id: photo.id,
      title: String(photo.title || '복구한 촬영 원본').slice(0, 100),
      fileName: String(photo.fileName || 'recovered-original.jpg').replace(/[^\w.\-]/g, '_').slice(0, 120),
      createdAt: photo.createdAt,
      dataUrl: photo.dataUrl,
      sha256: digest,
      recoveryKind: 'original',
    });
  }
  return photos;
}

export function openRecoveryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('eeun-photo-gallery', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('사진 보관함을 열지 못했어요.'));
    request.onblocked = () => reject(new Error('다른 사진 화면을 닫고 다시 시도해 주세요.'));
  });
}

export function addMissingPhotos(database, photos) {
  // One atomic transaction: never clear, overwrite, or partly import a bundle.
  return new Promise((resolve, reject) => {
    const tx = database.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    let added = 0;
    for (const photo of photos) {
      const existing = store.get(photo.id);
      existing.onsuccess = () => {
        if (!existing.result) { store.add(photo); added += 1; }
      };
    }
    tx.oncomplete = () => resolve({ added, skipped: photos.length - added });
    tx.onabort = () => reject(new Error('저장하지 못했어요. 기존 사진은 그대로 유지돼요. 저장 공간을 확인해 주세요.'));
    tx.onerror = () => { /* The abort handler reports the final atomic result. */ };
  });
}
