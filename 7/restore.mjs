import { readRecoveryLink, decryptRecoveryPackage, validateRecoveryPackage, openRecoveryDatabase, addMissingPhotos } from './recovery-core.mjs?v=20261111-recovery-v1';

const button = document.querySelector('#restore');
const status = document.querySelector('#status');
let recovery;
try {
  if (!window.isSecureContext || !crypto.subtle) throw new Error('최신 브라우저에서 HTTPS 복구 링크를 열어 주세요.');
  recovery = readRecoveryLink(location.hash);
  if (location.hostname !== 'aiedue.ddns.net' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') throw new Error('에이두 주소의 복구 링크에서 실행해 주세요.');
  status.textContent = '아래 버튼을 누르면 원본을 검증한 뒤 사진 보관함에 복구해요.';
  button.disabled = false;
} catch (error) {
  status.textContent = error.message;
}

button.addEventListener('click', async () => {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  let database;
  try {
    status.textContent = '복구 사진의 원본을 확인하고 있어요.';
    const response = await fetch(`/pic-db/db-api/storage/files/7/recovery/${recovery.bundleId}.bin`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('복구 사진을 가져오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    const contentLength = Number(response.headers.get('content-length'));
    if (contentLength > 24 * 1024 * 1024) throw new Error('복구 파일이 너무 커요.');
    const bundle = await decryptRecoveryPackage(await response.arrayBuffer(), recovery.key);
    const photos = await validateRecoveryPackage(bundle);
    // Decode every real image before opening a write transaction.
    for (const photo of photos) {
      const image = new Image();
      image.src = photo.dataUrl;
      await image.decode();
      if (image.naturalWidth < 2 || image.naturalHeight < 2) throw new Error('빈 사진은 복구할 수 없어요.');
    }
    database = await openRecoveryDatabase();
    const result = await addMissingPhotos(database, photos);
    status.textContent = `${result.added}장을 복구했어요. 이미 있는 ${result.skipped}장은 그대로 두었어요. 사진 보관함을 열어요.`;
    database.close();
    database = null;
    location.replace('./#gallery');
  } catch (error) {
    // Never log the fragment key, decrypted photos, or private recovery URL.
    status.textContent = error.name === 'OperationError' ? '복구 링크가 올바르지 않거나 파일을 확인하지 못했어요. 기존 보관함은 변경하지 않았어요.' : (error.message || '복구하지 못했어요. 기존 보관함은 변경하지 않았어요.');
    button.disabled = false;
  } finally {
    database?.close();
    button.removeAttribute('aria-busy');
  }
});
